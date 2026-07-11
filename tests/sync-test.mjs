// ═══════════════════════════════════════════════════════════════════
//  Zwei-Client-Sync-Test: simuliert zwei Nutzer + Netzlaufwerk in Node
//  Ausführen:  node tests/sync-test.mjs
//
//  Testet die komplette Multi-User-Pipeline aus app-core.js gegen ein
//  In-Memory-"Netzlaufwerk": Lock-Protokoll, Dirty-Op-Replay, explizite
//  IDs, Natural-Key-Rewrite, KE-Id-Reconciliation, Tombstones (Lösch-
//  Propagation), Idempotenz-Ledger, Feld-Import.
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));

// ── Fake-Netzlaufwerk (File System Access API Nachbau) ──
function makeStore() { return { files: new Map() }; }

class FakeFileHandle {
  constructor(store, name) { this.store = store; this.name = name; }
  async getFile() {
    const e = this.store.files.get(this.name);
    if (!e) { const err = new Error('NotFound: ' + this.name); err.name = 'NotFoundError'; throw err; }
    const data = e.data;
    return {
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      text: async () => new TextDecoder().decode(data),
      lastModified: e.mtime,
      size: data.length,
    };
  }
  async createWritable() {
    let chunks = [];
    const store = this.store, name = this.name;
    return {
      async write(d) {
        if (!chunks) throw new Error('stream aborted');
        chunks.push(typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d));
      },
      async close() {
        if (!chunks) throw new Error('stream aborted');
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const buf = new Uint8Array(total); let o = 0;
        chunks.forEach(c => { buf.set(c, o); o += c.length; });
        store.files.set(name, { data: buf, mtime: Date.now() });
      },
      async abort() { chunks = null; },
    };
  }
}

class FakeDir {
  constructor(store) { this.store = store; }
  async getFileHandle(name, opts = {}) {
    if (!this.store.files.has(name)) {
      if (!opts.create) { const err = new Error('NotFound: ' + name); err.name = 'NotFoundError'; throw err; }
      this.store.files.set(name, { data: new Uint8Array(0), mtime: Date.now() });
    }
    return new FakeFileHandle(this.store, name);
  }
  async removeEntry(name) { this.store.files.delete(name); }
}

// ── App-Instanz in eigenem vm-Kontext laden (2× = 2 unabhängige Clients) ──
const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');

function makeClient(SQL, store, pruefer, dbBytes) {
  const el = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} } });
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, TextEncoder, TextDecoder, Uint8Array, Set, Map, RegExp, Error, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN,
    document: { getElementById: el, createElement: el, hidden: false, addEventListener() {}, body: { classList: { add() {}, remove() {}, contains: () => false } } },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    initSqlJs: async () => SQL,
    KontrolleHandler: { activePruefer: pruefer },
    TableSort: { init() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
  const app = sandbox.__App;

  // UI-/Nebenwege stummschalten
  app.toast = () => {};
  app.scheduleAutoSave = () => {};
  app._broadcastChange = () => {};
  app._updateNetworkQuality = () => {};
  app._updateNetworkUI = () => {};
  app._persistDirtyOps = async () => {};
  app._showConflicts = () => {};
  app.tryReconnect = async () => {};
  app.markDirty = function () { this.unsavedChanges = true; };

  // Umgebung
  app.db = new SQL.Database(dbBytes);
  app.migrateDB();
  app.dbFileHandle = new FakeFileHandle(store, 'test.sqlite');
  app.dirHandle = new FakeDir(store);
  app.bhkDirHandle = null;
  app.autoLoadedDbName = 'test.sqlite';
  app.demoMode = false;
  app._networkQuality = 'good';
  app._syncReady = true;
  app._importChangeCount = 0;
  return app;
}

// ── Assertions ──
let failed = 0, passed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FEHLER: ' + msg); }
}

const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });

// Basis-Datenbestand: Schema + 1 Termin + 2 Schüler
const seed = new SQL.Database();
{
  const schemaSrc = APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1];
  seed.run(schemaSrc);
  seed.run("INSERT INTO schueler (id,nachname,vorname) VALUES (1,'Mustermann','Max'),(2,'Beispiel','Berta')");
  seed.run("INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (77,'2026-07-01','geplant')");
}
const seedBytes = seed.export();

const store = makeStore();
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });

const A = makeClient(SQL, store, 'anna', new Uint8Array(seedBytes));
const B = makeClient(SQL, store, 'bernd', new Uint8Array(seedBytes));

console.log('\n══ T1: Explizite IDs — parallele INSERTs kollidieren nicht ══');
{
  A.run("INSERT INTO wiedervorlagen (schueler_id,art,frist_datum,status) VALUES (?,?,?,?)", [1, 'post_an_rp', '2026-08-01', 'offen']);
  B.run("INSERT INTO wiedervorlagen (schueler_id,art,frist_datum,status) VALUES (?,?,?,?)", [2, 'post_an_rp', '2026-08-02', 'offen']);
  const idA = A.scalar('SELECT id FROM wiedervorlagen');
  const idB = B.scalar('SELECT id FROM wiedervorlagen');
  check(idA > 1e15 && idB > 1e15, `beide IDs zeitbasiert groß (A=${idA}, B=${idB})`);
  check(idA !== idB, 'IDs der beiden Clients verschieden');

  await A.mergeAndSave(true);
  await B.mergeAndSave(true);
  const disk = new SQL.Database(store.files.get('test.sqlite').data);
  const cnt = disk.exec('SELECT COUNT(*) FROM wiedervorlagen')[0].values[0][0];
  check(cnt === 2, `Disk hat beide Wiedervorlagen (${cnt}/2)`);
  check(B.scalar('SELECT COUNT(*) FROM wiedervorlagen') === 2, 'B hat A-Wiedervorlage importiert');
  disk.close();
}

console.log('\n══ T2: KE-Auto-Anlage-Race — Natural-Key-Replay + Id-Reconciliation ══');
{
  // Beide legen "gleichzeitig" das Kontrollergebnis für (Termin 77, Schüler 1) an
  A.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 1, '{}']);
  B.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 1, '{}']);
  const keA = A.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  const keB = B.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  check(keA !== keB, `lokale KE-Ids divergieren zunächst (A=${keA}, B=${keB})`);

  await A.mergeAndSave(true); // A gewinnt das Race auf der Disk
  // B editiert VOR seinem Save (Op adressiert per WHERE id=? → Natural-Key-Rewrite)
  B.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?", ['bernd', keB]);
  await B.mergeAndSave(true);

  const disk = new SQL.Database(store.files.get('test.sqlite').data);
  const rows = disk.exec('SELECT id, ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  check(rows[0].values.length === 1, 'Disk hat genau EINE KE-Zeile (kein Duplikat)');
  check(rows[0].values[0][0] === keA, `Disk behielt A's id (${rows[0].values[0][0]})`);
  check(rows[0].values[0][1] === 'in_ordnung', "B's Edit landete trotz Id-Divergenz auf der richtigen Zeile");
  const keBafter = B.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  check(keBafter === keA, `B übernahm die Disk-id lokal (Reconcile: ${keBafter})`);
  disk.close();
}

console.log('\n══ T3: kw_status — UPSERT-Replay + Feld-Import ══');
{
  A.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [1, 1, 20, 'F', 2, null]);
  await A.mergeAndSave(true);
  await B.mergeAndSave(true); // B importiert
  check(B.scalar("SELECT maengel_codes FROM kw_status WHERE schueler_id=1 AND ausbildungsjahr=1 AND kalenderwoche=20") === 'F', 'B sieht A-Mängelcodes (Neuzeile)');
  // A ändert die Codes; B (nicht dirty) muss die Änderung übernehmen
  const kwIdA = A.scalar('SELECT id FROM kw_status WHERE schueler_id=1 AND ausbildungsjahr=1 AND kalenderwoche=20');
  A.run('UPDATE kw_status SET maengel_codes=?, fehltage=? WHERE id=?', ['F,H', 3, kwIdA]);
  await A.mergeAndSave(true);
  await B.mergeAndSave(true);
  check(B.scalar("SELECT maengel_codes FROM kw_status WHERE schueler_id=1 AND ausbildungsjahr=1 AND kalenderwoche=20") === 'F,H', 'B übernahm geänderte Mängelcodes (Feld-Merge bestehender Zeile)');
}

console.log('\n══ T4: Tombstones — Löschung propagiert und bleibt ══');
{
  const wvIdB = B.scalar('SELECT id FROM wiedervorlagen WHERE schueler_id=2');
  B.run('DELETE FROM wiedervorlagen WHERE id=?', [wvIdB]);
  check(B.scalar("SELECT COUNT(*) FROM bhk_tombstones WHERE tabelle='wiedervorlagen'") === 1, 'Tombstone lokal erfasst');
  await B.mergeAndSave(true);
  const disk = new SQL.Database(store.files.get('test.sqlite').data);
  check(disk.exec('SELECT COUNT(*) FROM wiedervorlagen')[0].values[0][0] === 1, 'Disk: Zeile gelöscht');
  check(disk.exec("SELECT COUNT(*) FROM bhk_tombstones WHERE tabelle='wiedervorlagen'")[0].values[0][0] === 1, 'Disk: Tombstone repliziert');
  disk.close();
  // A hat die Zeile noch lokal → Import muss sie löschen, NICHT re-importieren
  await A.mergeAndSave(true);
  check(A.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=2') === 0, 'A: Löschung übernommen (keine Re-Animation)');
  const disk2 = new SQL.Database(store.files.get('test.sqlite').data);
  check(disk2.exec('SELECT COUNT(*) FROM wiedervorlagen')[0].values[0][0] === 1, 'Disk: gelöschte Zeile kam nicht zurück');
  disk2.close();
}

console.log('\n══ T5: Idempotenz-Ledger — Doppel-Replay erzeugt keine Duplikate ══');
{
  A.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?)", [1, 'Testnotiz', 'anna']);
  const opsBackup = A._dirtyOps.map(o => ({ ...o, params: [...o.params] }));
  await A.mergeAndSave(true);
  // Crash-Simulation: Ops kommen (z.B. aus IndexedDB) zurück und werden erneut replayed
  A._dirtyOps = opsBackup;
  await A.mergeAndSave(true);
  const disk = new SQL.Database(store.files.get('test.sqlite').data);
  const cnt = disk.exec("SELECT COUNT(*) FROM wiedervorlage_notizen WHERE notiz='Testnotiz'")[0].values[0][0];
  check(cnt === 1, `Notiz existiert genau einmal trotz Doppel-Replay (${cnt})`);
  disk.close();
}

console.log('\n══ T6: datetime-Freeze + Lock-Verhalten ══');
{
  A.run("UPDATE kontrollergebnisse SET bemerkung='x', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?", ['anna', 77, 1]);
  const op = A._dirtyOps[A._dirtyOps.length - 1];
  check(!op.sql.includes("datetime('now'"), 'datetime(now) im Replay-Op eingefroren');
  check(/geaendert_am='\d{4}-\d{2}-\d{2} /.test(op.sql), 'eingefrorener Zeitstempel als Literal');
  A._dirtyOps = [];
  // Lock: B hält das Lock → A muss warten (kein Fail-Open)
  await new FakeDir(store).getFileHandle('lock_test', { create: true });
  const lw = await (await new FakeDir(store).getFileHandle('lock_test', { create: true })).createWritable();
  await lw.write(JSON.stringify({ u: 'bernd', t: new Date().toISOString(), n: 'xyz' }));
  await lw.close();
  const got = await A._acquireLock();
  check(got === false, 'frisches fremdes Lock wird respektiert');
  store.files.delete('lock_test');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
