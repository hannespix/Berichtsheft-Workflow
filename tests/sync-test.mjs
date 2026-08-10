// ═══════════════════════════════════════════════════════════════════
//  Sync-v3-Test: Append-only Op-Logs, zwei/drei Clients + Netzlaufwerk
//  Ausführen:  node tests/sync-test.mjs
//
//  Simuliert das komplette Multi-User-System aus app-core.js in Node:
//  jeder Client schreibt nur sein eigenes Op-Log; die DB-Datei ist ein
//  Snapshot, der gelockt kompaktiert wird. Getestet werden: parallele
//  INSERTs (globale IDs), KE-Anlage-Race (Natural-Key + Subselect-FKs),
//  Feld-Sync, LWW-Guard, Lösch-Propagation, Doppel-Apply-Schutz,
//  Kompaktierung + Log-Rotation, Bootstrap eines frischen Clients.
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

function fakeFile(entry) {
  const data = entry.data;
  return {
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    text: async () => new TextDecoder().decode(data),
    slice: (start, end) => ({
      text: async () => new TextDecoder().decode(data.subarray(start ?? 0, end ?? data.length)),
    }),
    lastModified: entry.mtime,
    size: data.length,
  };
}

class FakeFileHandle {
  constructor(store, name) { this.store = store; this.name = name; }
  async getFile() {
    const e = this.store.files.get(this.name);
    if (!e) { const err = new Error('NotFound: ' + this.name); err.name = 'NotFoundError'; throw err; }
    return fakeFile(e);
  }
  async createWritable(opts = {}) {
    const store = this.store, name = this.name;
    const base = opts.keepExistingData && store.files.get(name) ? store.files.get(name).data : new Uint8Array(0);
    let buf = Array.from(base);
    let pos = 0;
    let aborted = false;
    const put = (position, bytes) => {
      for (let i = 0; i < bytes.length; i++) buf[position + i] = bytes[i];
      pos = position + bytes.length;
    };
    return {
      async write(d) {
        if (aborted) throw new Error('stream aborted');
        let data = d, position = pos;
        if (d && typeof d === 'object' && d.type === 'write') { position = d.position ?? pos; data = d.data; }
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
          : data instanceof Uint8Array ? data : new Uint8Array(data);
        put(position, bytes);
      },
      async close() {
        if (aborted) throw new Error('stream aborted');
        store.files.set(name, { data: Uint8Array.from(buf, x => x || 0), mtime: Date.now() });
      },
      async abort() { aborted = true; },
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
  async *entries() {
    for (const name of [...this.store.files.keys()]) {
      yield [name, new FakeFileHandle(this.store, name)];
    }
  }
}

// ── App-Instanz in eigenem vm-Kontext laden ──
const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');

async function makeClient(SQL, store, pruefer, dbBytes) {
  const el = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} } });
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, TextEncoder, TextDecoder, Uint8Array, Set, Map,
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

  app.toast = () => {};
  app.scheduleAutoSave = () => {};
  app._broadcastChange = () => {};
  app._updateNetworkQuality = () => {};
  app._updateNetworkUI = () => {};
  app._persistDirtyOps = async () => {};
  app._showConflicts = () => {};
  app.tryReconnect = async () => {};
  app._smartRefresh = () => {};
  app.markDirty = function () { this.unsavedChanges = true; };

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
  await app._bootstrapV3();
  return app;
}

let failed = 0, passed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ FEHLER: ' + msg); }
}

const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });

// Basis: Schema + 1 Termin + 2 Schüler
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

const A = await makeClient(SQL, store, 'anna', new Uint8Array(seedBytes));
const B = await makeClient(SQL, store, 'bernd', new Uint8Array(seedBytes));
check(A._getClientId() !== B._getClientId(), 'Clients haben verschiedene IDs');
check(A._v3Ready && B._v3Ready, 'Sync-v3 bei beiden aktiv');

console.log('\n══ T1: Parallele INSERTs — nur eigene Logs, keine Locks ══');
{
  A.run("INSERT INTO wiedervorlagen (schueler_id,art,frist_datum,status) VALUES (?,?,?,?)", [1, 'post_an_rp', '2026-08-01', 'offen']);
  B.run("INSERT INTO wiedervorlagen (schueler_id,art,frist_datum,status) VALUES (?,?,?,?)", [2, 'post_an_rp', '2026-08-02', 'offen']);
  await A.mergeAndSave(true);
  await B.mergeAndSave(true);
  check(store.files.has(A._myOplogName()) && store.files.has(B._myOplogName()), 'beide Op-Logs existieren');
  check(![...store.files.keys()].some(n => n.startsWith('lock')), 'KEINE Lock-Datei im Normalbetrieb');
  const snapBefore = store.files.get('test.sqlite').mtime;
  await A._pollOplogs();
  await B._pollOplogs();
  check(store.files.get('test.sqlite').mtime === snapBefore, 'Snapshot-Datei wurde nicht angefasst');
  check(A.scalar('SELECT COUNT(*) FROM wiedervorlagen') === 2, 'A sieht beide Wiedervorlagen');
  check(B.scalar('SELECT COUNT(*) FROM wiedervorlagen') === 2, 'B sieht beide Wiedervorlagen');
  const ids = A.query('SELECT id FROM wiedervorlagen').map(r => r.id);
  check(ids[0] !== ids[1] && ids.every(i => i > 1e15), `globale IDs eindeutig (${ids.join(', ')})`);
}

console.log('\n══ T2: KE-Anlage-Race — Natural-Key-Ops + Subselect-FK ══');
{
  A.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 1, '{}']);
  B.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 1, '{}']);
  const keA = A.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  const keB = B.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  // B ändert das Ergebnis (WHERE id=? → Natural-Key-Rewrite) und hängt eine
  // Wiedervorlage an SEINE lokale KE-id (→ Subselect-Rewrite im Op)
  B.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?", ['bernd', keB]);
  B.run("INSERT INTO wiedervorlagen (kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (?,?,?,?,?)", [keB, 1, 'nachholung_naechste_durchsicht', '2026-09-01', 'offen']);
  await A.mergeAndSave(true);
  await B.mergeAndSave(true);
  await A._pollOplogs();
  await B._pollOplogs();
  const cntA = A.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  check(cntA === 1, 'A: genau eine KE-Zeile (UNIQUE-Index dedupt)');
  check(A.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1') === 'in_ordnung',
    "A sieht B's Ergebnis trotz divergenter lokaler KE-ids");
  const wvKeRefA = A.scalar("SELECT kontrollergebnis_id FROM wiedervorlagen WHERE art='nachholung_naechste_durchsicht'");
  check(wvKeRefA === keA, `A: WV-FK zeigt auf A's LOKALE KE-Zeile (${wvKeRefA} == ${keA}, Subselect)`);
  const wvKeRefB = B.scalar("SELECT kontrollergebnis_id FROM wiedervorlagen WHERE art='nachholung_naechste_durchsicht'");
  check(wvKeRefB === keB, `B: WV-FK zeigt auf B's lokale KE-Zeile (${wvKeRefB} == ${keB})`);
}

console.log('\n══ T3: kw_status-Sync + LWW-Guard ══');
{
  A.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [1, 1, 20, 'F', 2, null]);
  await A.mergeAndSave(true);
  await B._pollOplogs();
  check(B.scalar('SELECT maengel_codes FROM kw_status WHERE schueler_id=1 AND ausbildungsjahr=1 AND kalenderwoche=20') === 'F', 'B sieht A-Mängelcodes');
  // LWW-Guard: verspätete ALTE Op darf neueren lokalen Stand nicht überschreiben
  A.run("UPDATE kontrollergebnisse SET bemerkung='NEU', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?", ['anna', 77, 1]);
  const staleOp = { uid: 'stale-1', ts: Date.now() - 60000, u: 'bernd',
    sql: "UPDATE kontrollergebnisse SET bemerkung='ALT', geaendert_am='2020-01-01 10:00:00', geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?",
    params: ['bernd', 77, 1] };
  A._applyOps([JSON.stringify(staleOp)]);
  check(A.scalar('SELECT bemerkung FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1') === 'NEU', 'LWW-Guard: alte Offline-Op überschreibt neueren Stand nicht');
}

console.log('\n══ T4: Lösch-Propagation ══');
{
  const wvIdB = B.scalar('SELECT id FROM wiedervorlagen WHERE schueler_id=2');
  B.run('DELETE FROM wiedervorlagen WHERE id=?', [wvIdB]);
  await B.mergeAndSave(true);
  await A._pollOplogs();
  check(A.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=2') === 0, 'A: Löschung von B übernommen');
  check(A.scalar("SELECT COUNT(*) FROM bhk_tombstones WHERE tabelle='wiedervorlagen'") >= 1, 'Tombstone repliziert (Schutz für Kompaktierung)');
}

console.log('\n══ T5: Doppel-Apply-Schutz (uid-Dedupe) ══');
{
  A.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?)", [1, 'Testnotiz', 'anna']);
  const dup = A._dirtyOps.map(o => ({ ...o, params: [...o.params] }));
  await A.mergeAndSave(true);
  A._dirtyOps = dup; // Crash-Restore-Simulation: dieselben Ops (gleiche uids) nochmal
  await A.mergeAndSave(true);
  await B._pollOplogs();
  check(B.scalar("SELECT COUNT(*) FROM wiedervorlage_notizen WHERE notiz='Testnotiz'") === 1, 'B wendete die Op trotz doppelter Log-Zeile genau einmal an');
}

console.log('\n══ T6: Kompaktierung + Log-Rotation + frischer Client ══');
{
  const ok = await A._compact('test');
  check(ok === true, 'Kompaktierung erfolgreich');
  check(store.files.has(A._snapMetaName()), 'snapmeta geschrieben');
  check(![...store.files.keys()].some(n => n.startsWith('lock')), 'Lock nach Kompaktierung wieder freigegeben');
  const snap = new SQL.Database(store.files.get('test.sqlite').data);
  check(snap.exec('SELECT COUNT(*) FROM wiedervorlagen')[0].values[0][0] === 2, 'Snapshot enthält den Gesamtstand (2 WV)');
  check(snap.exec("SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1")[0].values[0][0] === 'in_ordnung', 'Snapshot enthält KE-Ergebnis');
  snap.close();
  // B beginnt eine neue Log-Generation, sobald der Snapshot die alte abdeckt.
  // (Früher wurde die Datei geleert – Leser konnten das nicht zuverlässig
  // erkennen und lasen ab der falschen Stelle weiter.)
  const genVorher = B._logGen;
  await B._pollOplogs();
  check(B._logGen === genVorher + 1, `B hat eine neue Log-Generation begonnen (g${genVorher} → g${B._logGen})`);
  const bLogNeu = store.files.get(B._myOplogName());
  check(!bLogNeu || bLogNeu.data.length === 0, 'Neue Generation startet leer');
  // Frischer Client C bootstrappt aus Snapshot + Logs
  const C = await makeClient(SQL, store, 'clara', new Uint8Array(store.files.get('test.sqlite').data));
  check(C.scalar('SELECT COUNT(*) FROM wiedervorlagen') === 2, 'C (neu) sieht alle Wiedervorlagen');
  check(C.scalar("SELECT maengel_codes FROM kw_status WHERE schueler_id=1 AND ausbildungsjahr=1 AND kalenderwoche=20") === 'F', 'C sieht KW-Daten');
  // Nach Rotation: B schreibt neue Op, C muss sie trotz Offset-Reset sehen
  B.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung=?, geaendert_am=datetime('now','localtime') WHERE id=?",
    ['2026-07-11', 'ok', B.scalar('SELECT id FROM wiedervorlagen WHERE schueler_id=1')]);
  await B.mergeAndSave(true);
  await C._pollOplogs();
  check(C.scalar("SELECT status FROM wiedervorlagen WHERE schueler_id=1") === 'erledigt', 'C sieht Op aus rotiertem Log (Offset-Reset)');
}

console.log('\n══ T7: Op-Reihenfolge innerhalb einer Millisekunde ══');
{
  // Anlegen + sofortiges Ändern derselben Zeile: beide Ops tragen denselben
  // Zeitstempel. Ein Zufalls-Tiebreaker verdrehte sie beim Empfänger, wodurch
  // das UPDATE vor dem INSERT lief und wirkungslos verpuffte.
  let verdreht = 0;
  for (let i = 0; i < 12; i++) {
    const sid = 500 + i;
    A.run("INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES (?,?,?,1)", [sid, 'Reihen', 'Folge']);
    A.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, sid, '{}']);
    A.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?", ['anna', 77, sid]);
    await A.mergeAndSave(true);
    await B._pollOplogs();
    const r = B.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [77, sid]);
    if (r !== 'in_ordnung') verdreht++;
  }
  check(verdreht === 0, `12 Durchläufe INSERT+UPDATE: ${verdreht} verdreht (erwartet 0)`);
}

console.log('\n══ T8: kw_maengel bekommt globale IDs ══');
{
  check(A.ID_TABLES.has('kw_maengel'), 'kw_maengel ist als Tabelle mit globalen IDs eingetragen');
  check(A.ID_TABLES.has('pruefer') && A.ID_TABLES.has('abschlussjahrgaenge'), 'pruefer und abschlussjahrgaenge ebenfalls');
  const keA = A.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  const keB = B.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=1');
  A.run('INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage) VALUES (?,?,?,?,?)', [keA, 1, 30, 'A', 0]);
  B.run('INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage) VALUES (?,?,?,?,?)', [keB, 1, 31, 'B', 0]);
  const idA = A.scalar('SELECT id FROM kw_maengel WHERE kalenderwoche=30');
  const idB = B.scalar('SELECT id FROM kw_maengel WHERE kalenderwoche=31');
  check(idA !== idB && idA > 1e15 && idB > 1e15, `IDs global eindeutig (${idA} / ${idB})`);
  await A.mergeAndSave(true); await B.mergeAndSave(true);
  await A._pollOplogs(); await B._pollOplogs();
  check(A.scalar("SELECT maengel_codes FROM kw_maengel WHERE kalenderwoche=31") === 'B', 'A sieht den Mangel von B in der richtigen Woche');
  check(B.scalar("SELECT maengel_codes FROM kw_maengel WHERE kalenderwoche=30") === 'A', 'B sieht den Mangel von A in der richtigen Woche');
}

console.log('\n══ T9: Natural-Key-Rewrite bei "WHERE id=? AND ..." ══');
{
  // Kontrollergebnis für Azubi 2 auf beiden Seiten anlegen (divergente lokale Nummern)
  A.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 2, '{}']);
  B.run("INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws) VALUES (?,?,?)", [77, 2, '{}']);
  const keB = B.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2');
  B.run("UPDATE kontrollergebnisse SET zulassung_ap=1 WHERE id=? AND zulassung_ap=0 AND pruefungsausschuss=0", [keB]);
  const op = B._dirtyOps[B._dirtyOps.length - 1];
  check(!/WHERE\s+id\s*=\s*\?/i.test(op.sql), `Op adressiert über den fachlichen Schlüssel: ${op.sql.slice(op.sql.search(/WHERE/i)).slice(0, 60)}`);
  await B.mergeAndSave(true);
  await A._pollOplogs();
  check(A.scalar('SELECT zulassung_ap FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2') === 1,
    'Änderung kommt trotz abweichender lokaler Nummer an');
}

console.log('\n══ T10: Rotation – wachsendes Log wird vollständig gelesen ══');
{
  // A rotiert und schreibt danach MEHR als vorher. Früher erkannte der Leser
  // die Rotation nur an einer kleiner gewordenen Datei und übersprang Ops.
  const vorher = B.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen');
  const genVor = A._logGen;
  await A._compact('test-rotation');
  await A._pollOplogs();
  check(A._logGen >= genVor, 'A hat rotiert oder die Generation gehalten');
  for (let i = 0; i < 25; i++) {
    A.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?)", [1, 'Rotation-Notiz-' + i, 'anna']);
  }
  await A.mergeAndSave(true);
  await B._pollOplogs();
  const nachher = B.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen');
  check(nachher - vorher === 25, `B hat alle 25 Notizen nach der Rotation erhalten (${nachher - vorher})`);
}

console.log('\n══ T7: datetime-Freeze + Lock-Respekt (Kompaktierungspfad) ══');
{
  A.run("UPDATE kontrollergebnisse SET bemerkung='x', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?", ['anna', 77, 1]);
  const op = A._dirtyOps[A._dirtyOps.length - 1];
  check(!op.sql.includes("datetime('now'"), 'datetime(now) im Replay-Op eingefroren');
  A._dirtyOps = [];
  const lw = await (await new FakeDir(store).getFileHandle('lock_test', { create: true })).createWritable();
  await lw.write(JSON.stringify({ u: 'bernd', t: new Date().toISOString(), n: 'xyz' }));
  await lw.close();
  check(await A._acquireLock() === false, 'frisches fremdes Lock wird respektiert');
  store.files.delete('lock_test');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
