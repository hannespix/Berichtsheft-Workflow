// ═══════════════════════════════════════════════════════════════════
//  Großer Bestand: Sicherungen (gemeinsam je Datenbank, Intervall,
//  komprimiert, Wiederherstellung), Kompaktierung (Schwelle, Abstand,
//  Leitung, Zeitlimit), Snapshot ohne Nachladen, Offline-Stand nur auf
//  Wunsch, Schübe in einer Transaktion, Signatur-Cache, Netzqualität aus
//  dem Anhängen, Kollegen-Schalter
//  Ausführen:  node tests/bestand-test.mjs
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP_SRC = read('src/js/app-core.js');

// ── Fake-Ordner (Dateien als Uint8Array, Unterordner) ──
const enc = new TextEncoder(), dec = new TextDecoder();
const fehlerAusgaben = [];
const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
const mkDir = (name) => {
  const dateien = new Map(), ordner = new Map();
  const handle = (n) => ({
    kind: 'file', name: n,
    async getFile() { const f = dateien.get(n); if (!f) throw nf(); return { size: f.data.length, lastModified: f.mtime, async text() { return dec.decode(f.data); }, async arrayBuffer() { return f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength); }, slice(von) { const t = f.data.slice(von); return { async text() { return dec.decode(t); } }; } }; },
    async createWritable(opts) {
      let buf = (opts && opts.keepExistingData && dateien.has(n)) ? dateien.get(n).data : new Uint8Array(0);
      return {
        async write(x) {
          if (x && x.type === 'write') { const d = x.data instanceof Uint8Array ? x.data : enc.encode(String(x.data)); const neu = new Uint8Array(Math.max(buf.length, x.position + d.length)); neu.set(buf.slice(0, x.position)); neu.set(d, x.position); buf = neu; }
          else buf = x instanceof Uint8Array ? new Uint8Array(x) : enc.encode(String(x));
        },
        async close() { dateien.set(n, { data: buf, mtime: Date.now() }); },
        async abort() {},
      };
    },
  });
  return {
    kind: 'directory', name, dateien, ordner,
    async getDirectoryHandle(n, o) { if (!ordner.has(n)) { if (!(o && o.create)) throw nf(); ordner.set(n, mkDir(n)); } return ordner.get(n); },
    async getFileHandle(n, o) { if (!dateien.has(n)) { if (!(o && o.create)) throw nf(); dateien.set(n, { data: new Uint8Array(0), mtime: Date.now() }); } return handle(n); },
    async removeEntry(n) { dateien.delete(n); ordner.delete(n); },
    async *entries() { for (const [k, v] of ordner) yield [k, v]; for (const k of [...dateien.keys()]) yield [k, handle(k)]; },
    async *values() { for (const v of ordner.values()) yield v; for (const k of [...dateien.keys()]) yield handle(k); },
    setze(n, text, mtime) { dateien.set(n, { data: typeof text === 'string' ? enc.encode(text) : text, mtime: mtime || Date.now() }); },
  };
};
const bhk = mkDir('_bhk');
const backups = await bhk.getDirectoryHandle('backups', { create: true });

const elemente = {};
const el = (id) => elemente[id] || (elemente[id] = { id, value: '', innerHTML: '', textContent: '', title: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const speicher = {};
const toasts = [];
const sandbox = {
  console: { log() {}, warn() {}, error: (...a) => fehlerAusgaben.push(a.map(x => x && x.stack || String(x)).join(' ')) }, setTimeout: (f, ms) => { if (typeof f !== 'function') return 0; if ((ms || 0) >= 5000) return 0; f(); return 0; }, clearTimeout() {}, setInterval, clearInterval, // lange Zeitlimits (Append-Timeout) feuern im Test nie
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  CompressionStream, DecompressionStream, Blob, Response,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, prepend() {} } },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem: (k, v) => { speicher[k] = String(v); }, removeItem: (k) => { delete speicher[k]; } },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Anna' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App; globalThis.__Spur = BhkSpur;', sandbox, { filename: 'app-core.js' });
const { __App: App, __Spur: Spur } = sandbox;
const SCHEMA = APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1];
App.db = new SQL.Database(); App.db.run(SCHEMA);
App._sqlJsFactory = SQL;
App.toast = (m, t) => toasts.push([String(m), t]); App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.showLoading = () => {}; App.hideLoading = () => {};
App.openModal = () => {}; App.closeModal = () => {}; App.renderCurrentView = () => {}; App._smartRefresh = () => {}; App._writeSyncMarker = async () => {};
App.dirHandle = bhk; App.bhkDirHandle = bhk; App.backupsDirHandle = backups; App.autoLoadedDbName = 'test.sqlite'; App._clientIdCache = 'client-AAAA';
App.currentUser = 'Anna';
App.db.run("INSERT INTO schueler (id,nachname,vorname) VALUES (1,'A','B'),(2,'C','D')");
let dbDateiInhalt = null; // was die „Datenbankdatei“ beim Lesen liefert
App.dbFileHandle = { name: 'test.sqlite', async getFile() { if (!dbDateiInhalt) throw new Error('Datenbankdatei wurde gelesen, obwohl kein Nachladen nötig war'); return { size: dbDateiInhalt.length, lastModified: Date.now(), async arrayBuffer() { return dbDateiInhalt.buffer.slice(dbDateiInhalt.byteOffset, dbDateiInhalt.byteOffset + dbDateiInhalt.byteLength); } }; }, async createWritable() { throw new Error('nicht im Test'); } };

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const setFeldmodus = (v) => Object.defineProperty(App, 'feldmodus', { value: v, configurable: true, writable: true });
setFeldmodus(false);
const backupName = (minutenAlt, kuerzel = 'BBBB', gz = true) => 'backup_' + new Date(Date.now() - minutenAlt * 60000).toISOString().replace(/[:.]/g, '-').substring(0, 19) + '_' + kuerzel + '.sqlite' + (gz ? '.gz' : '');

console.log('══ Sicherungen: Intervall und Fälligkeit ══');
{
  check(App.backupIntervallMs() === 60 * 60000, 'Standard: alle 60 Minuten');
  App.db.run("INSERT INTO einstellungen (schluessel,wert) VALUES ('backup_intervall_min','120')");
  check(App.backupIntervallMs() === 120 * 60000, 'Einstellung backup_intervall_min wirkt (120)');
  App.db.run("UPDATE einstellungen SET wert='abc' WHERE schluessel='backup_intervall_min'");
  check(App.backupIntervallMs() === 60 * 60000, 'Unsinnige Einstellung → Standard');
  App.db.run("UPDATE einstellungen SET wert='60' WHERE schluessel='backup_intervall_min'");
  check(await App._backupFaellig() === true, 'Ohne Sicherung im Ordner: fällig');
  backups.setze(backupName(20), 'x');
  App._backupListeZeit = 0; App.lastBackupTime = 0;
  check(await App._backupFaellig() === false && App.lastBackupTime > 0, 'Sicherung eines ANDEREN Rechners vor 20 min: nicht fällig, eigene Frist übernimmt deren Zeit');
  backups.dateien.clear(); backups.setze(backupName(90), 'x');
  App._backupListeZeit = 0; App.lastBackupTime = 0;
  check(await App._backupFaellig() === true, 'Neueste Sicherung 90 min alt: fällig');
  App._tabIsPrimary = false; check(await App._backupFaellig() === false, 'Zweit-Registerkarte sichert nie'); App._tabIsPrimary = true;
  App._netzWeg = true; check(await App._backupFaellig() === false, 'Netzabriss: keine Sicherung'); App._netzWeg = false;
  check(App._istBackupDatei('backup_2026-01-01T10-00-00_AAAA.sqlite') && App._istBackupDatei('backup_2026-01-01T10-00-00_AAAA_vor-wiederherstellung.sqlite.gz') && !App._istBackupDatei('backup_x.sqlite.gz.crswap'), 'Beide Endungen gelten als Sicherung, Tauschdateien nicht');
  check(App._backupZeitAusName('backup_2026-01-01T10-30-00_AAAA.sqlite.gz') === Date.parse('2026-01-01T10:30:00Z'), 'Zeitpunkt aus dem Dateinamen');
}

console.log('══ Sicherungen: komprimiert schreiben, lesen, wiederherstellen ══');
{
  backups.dateien.clear();
  check(await App.createBackup() === true, 'Sicherung geschrieben');
  const namen = [...backups.dateien.keys()];
  check(namen.length === 1 && namen[0].endsWith('.sqlite.gz') && /_AAAA\.sqlite\.gz$/.test(namen[0]), `Datei ist komprimiert (${namen[0]})`);
  const roh = App.db.export();
  const gz = backups.dateien.get(namen[0]).data;
  check(gz.length < roh.length * 0.5, `Deutlich kleiner als der Export (${gz.length} statt ${roh.length} Bytes)`);
  const zurueck = await App._dekomprimieren(gz);
  check(zurueck.length === roh.length && zurueck.every((b, i) => b === roh[i]), 'Dekomprimiert gleicht dem Export byteweise');
  check(App.lastBackupTime > 0 && (await App._backupFaellig()) === false, 'Direkt danach nicht erneut fällig');
  const liste = await App.listBackups();
  check(liste.length === 1 && liste[0].komprimiert === true, 'listBackups kennzeichnet komprimierte Sicherungen');
  check(Spur.liste('backup').at(-1).ok && /gzip aus/.test(Spur.liste('backup').at(-1).info), 'Spur: Sicherung mit Größen');
  // Wiederherstellung einer komprimierten Sicherung
  App.db.run("INSERT INTO schueler (id,nachname,vorname) VALUES (3,'Neu','Nachher')");
  App.mergeAndSave = async () => {}; App.fullSave = async () => { App.__fullSave = (App.__fullSave || 0) + 1; }; App.reloadFromFile = async () => {};
  const alt = App.db;
  check(await App.restoreBackup(namen[0]) === true, 'Komprimierte Sicherung wiederhergestellt');
  check(App.db !== alt && App.scalar('SELECT COUNT(*) FROM schueler') === 2 && App.__fullSave === 1, 'Stand von vor der Änderung, als neuer Snapshot geschrieben');
  check([...backups.dateien.keys()].some(n => /vor-wiederherstellung\.sqlite\.gz$/.test(n)), 'Vorher-Stand als komprimierte Sicherung abgelegt');
  // Aufräumen zählt beide Endungen
  for (let i = 0; i < 35; i++) backups.setze(backupName(1000 + i, 'CCCC', i % 2 === 0), 'x');
  await App.cleanOldBackups(30);
  check([...backups.dateien.keys()].length === 30, 'Aufbewahrung 30 über beide Endungen');
  // Ohne CompressionStream: unkomprimiert
  const cs = sandbox.CompressionStream; sandbox.CompressionStream = undefined;
  backups.dateien.clear();
  check(await App.createBackup() === true && [...backups.dateien.keys()][0].endsWith('.sqlite'), 'Ohne CompressionStream fällt die Sicherung auf .sqlite zurück');
  sandbox.CompressionStream = cs;
}

console.log('══ Kompaktierung: Schwelle, Abstand, Leitung, Zeitlimit ══');
{
  App._lastFileSize = 33 * 1048576;
  check(App.kompaktSchwelle() === Math.round(3.3 * 1048576), 'Schwelle 10 % bei 33 MB');
  App._lastFileSize = 2 * 1048576;
  check(App.kompaktSchwelle() === 1500000, 'Mindestens 1,5 MB');
  check(App.snapshotTimeoutMs(33 * 1048576) === 120000 + 33 * 10000, 'Zeitlimit 120 s + 10 s je MB (33 MB → 450 s)');
  App._letzteKompaktierung = Date.now() - 10 * 60000;
  check(/vor 10 min/.test(App._kompaktGebremst()), 'Letzte Kompaktierung vor 10 min bremst');
  App._letzteKompaktierung = 0;
  setFeldmodus(true); check(/langsame Leitung \(Einstellung\)/.test(App._kompaktGebremst()), 'Einstellung „Langsame Leitung“ bremst'); setFeldmodus(false);
  App._networkQuality = 'very-slow'; check(/langsame Leitung/.test(App._kompaktGebremst()), 'Sehr langsame Leitung bremst');
  App._networkQuality = 'good'; check(App._kompaktGebremst() === '', 'Sonst frei');
  // _compactionDue: ungedeckte Protokollbytes
  App._lastFileSize = 0;
  bhk.setze('oplog_test_client-BBBB_g0.jsonl', 'x'.repeat(1000000));
  check(await App._compactionDue() === false, '1 MB ungedeckt: nicht fällig');
  bhk.setze('oplog_test_client-CCCC_g0.jsonl', 'x'.repeat(600000));
  check(await App._compactionDue() === true, '1,6 MB ungedeckt: fällig');
  App._lastFileSize = 33 * 1048576;
  check(await App._compactionDue() === false, 'Bei 33 MB Snapshot reichen 1,6 MB nicht (Schwelle 3,3 MB)');
  App._letzteKompaktierung = Date.now();
  const vorher = Spur.liste('kompakt').length;
  App._lastFileSize = 0;
  check(await App._compactionDue() === false && Spur.liste('kompakt').length === vorher + 1 && /zurückgestellt/.test(Spur.liste('kompakt').at(-1).info), 'Gebremst: nicht fällig, Grund in der Spur');
  App._letzteKompaktierung = 0;
  bhk.dateien.delete('oplog_test_client-BBBB_g0.jsonl'); bhk.dateien.delete('oplog_test_client-CCCC_g0.jsonl');
}

console.log('══ Fremder Snapshot ohne Nachladen ══');
{
  App._v3Ready = true; App._bulkPending = false; App._snapGen = 3;
  App._logOffsets = { 'oplog_test_client-BBBB_g0.jsonl': 5000, 'oplog_test_client-BBBB_g1.jsonl': 200 };
  App._myLogSize = 800;
  const mine = App._myOplogName();
  const meta = (gen, grund, offsets) => ({ gen, grund, by: 'client-BBBB', t: new Date().toISOString(), offsets });
  check(App._snapshotSchonEnthalten(meta(4, 'groesse', { 'oplog_test_client-BBBB_g0.jsonl': 5000, [mine]: 800 })) === true, 'Alle Offsets gedeckt → enthalten');
  check(App._snapshotSchonEnthalten(meta(4, 'groesse', { 'oplog_test_client-BBBB_g1.jsonl': 300 })) === false, 'Fremdes Protokoll weiter als mein Lesestand → nicht enthalten');
  check(App._snapshotSchonEnthalten(meta(4, 'groesse', { [mine]: 900 })) === false, 'Eigenes Protokoll weiter als bekannt → nicht enthalten');
  check(App._snapshotSchonEnthalten(meta(4, 'groesse', { 'oplog_test_client-DDDD_g0.jsonl': 10 })) === false, 'Unbekanntes Protokoll → nicht enthalten');
  check(App._snapshotSchonEnthalten(meta(4, 'import', { [mine]: 800 })) === false && App._snapshotSchonEnthalten(meta(4, 'bereinigung', {})) === false, 'Import/Bereinigung tragen Daten außerhalb der Protokolle → immer nachladen');
  App._bulkPending = true; check(App._snapshotSchonEnthalten(meta(4, 'groesse', {})) === false, 'Offener Import → nicht überspringen'); App._bulkPending = false;
  // Über _pruefeFremdenSnapshot: gedeckt → nur Generation übernehmen, Datei wird NICHT gelesen
  bhk.setze(App._snapMetaName(), JSON.stringify(meta(4, 'groesse', { 'oplog_test_client-BBBB_g0.jsonl': 5000, [mine]: 800 })));
  const db1 = App.db; dbDateiInhalt = null;
  await App._pruefeFremdenSnapshot();
  check(App._snapGen === 4 && App.db === db1, 'Generation 4 übernommen, Datenbank nicht getauscht, Datei nicht gelesen');
  check(Spur.liste('snapshot').at(-1).was === 'Generation übernommen ohne Nachladen', 'Spur nennt den Verzicht');
  check(App._letzteKompaktierung > Date.now() - 5000, 'Zeitpunkt der fremden Kompaktierung aus snapmeta übernommen (bremst die eigene)');
  // Nicht gedeckt → Nachladen (Datei wird gelesen und getauscht)
  const fremd = new SQL.Database(); fremd.run(SCHEMA); fremd.run("INSERT INTO schueler (id,nachname,vorname) VALUES (7,'Aus','Snapshot')");
  dbDateiInhalt = fremd.export(); fremd.close();
  bhk.setze(App._snapMetaName(), JSON.stringify(meta(5, 'groesse', { 'oplog_test_client-BBBB_g1.jsonl': 999 })));
  await App._pruefeFremdenSnapshot();
  check(App._snapGen === 5 && App.db !== db1 && App.scalar('SELECT COUNT(*) FROM schueler WHERE id=7') === 1, 'Lesestand hinter dem Snapshot → nachgeladen und getauscht');
  // Import-Grund → Nachladen trotz gedeckter Offsets
  const db2 = App.db;
  bhk.setze(App._snapMetaName(), JSON.stringify(meta(6, 'import', {})));
  await App._pruefeFremdenSnapshot();
  check(App._snapGen === 6 && App.db !== db2, 'Import-Snapshot wird immer nachgeladen');
  dbDateiInhalt = null;
}

console.log('══ Offline-Stand nur auf Wunsch ══');
{
  check(App.offlineStandAn === false, 'Standard aus');
  App._offlineCachePlanen();
  check(!App._offlineCacheTimer, 'Ohne Wunsch kein Timer');
  App.setOfflineStand(true);
  check(App.offlineStandAn === true && !!App._offlineCacheTimer && App.OFFLINE_STAND_TAKT_MS === 3600000, 'Eingeschaltet: stündlicher Timer');
  App.setOfflineStand(false);
  check(App.offlineStandAn === false && !App._offlineCacheTimer, 'Ausgeschaltet: Timer weg');
}

console.log('══ Schübe in einer Transaktion ══');
{
  App.db.run("INSERT OR IGNORE INTO schueler (id,nachname,vorname) VALUES (1,'A','B'),(2,'C','D')");
  App._appliedForeignUids = new Set(); App._ownLogUids = new Set();
  const zeile = (i, sql, params) => JSON.stringify({ uid: 'u' + i, ts: 1000 + i, seq: i, c: 'client-BBBB', sql, params });
  const lines = [];
  for (let i = 0; i < 3000; i++) lines.push(zeile(i, 'INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [1 + (i % 2), 1 + (i % 3), 1 + (i % 50), i % 7 ? '' : 'A', 0, null]));
  lines.push(zeile(9001, "INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (?,?,?,?)", [1, 1, 1, 'kaputt']));  // CHECK-Verstoß
  lines.push(zeile(9002, 'UPDATE schueler SET telefon=? WHERE id=?', ['0761', 2]));
  const t0 = Date.now();
  const n = App._applyOps(lines);
  const ms = Date.now() - t0;
  check(n === 3001, `3001 von 3002 Ops angewendet (eine mit CHECK-Verstoß übersprungen) in ${ms} ms`);
  check(App.scalar('SELECT COUNT(*) FROM kw_status') === 150 && App.scalar('SELECT telefon FROM schueler WHERE id=2') === '0761', 'Upserts und Update sichtbar, Verstoß hat den Schub nicht zurückgerollt');
  check(App.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table'") > 0 && (() => { try { App.db.run('SAVEPOINT p'); App.db.run('RELEASE p'); return true; } catch(e) { return false; } })(), 'Kein offener Savepoint zurückgeblieben');
  check(ms < 1500, 'Schub bleibt unter 1,5 s');
  App.db.run('BEGIN');
  const n2 = App._applyOps([zeile(9003, 'UPDATE schueler SET telefon=? WHERE id=?', ['0762', 2])]);
  App.db.run('COMMIT');
  check(n2 === 1 && App.scalar('SELECT telefon FROM schueler WHERE id=2') === '0762', 'Funktioniert auch innerhalb einer offenen Transaktion (Datenbank-Tools)');
  check(App._applyOps([zeile(9003, 'UPDATE schueler SET telefon=? WHERE id=?', ['0763', 2])]) === 0, 'Bereits angewendete Kennung wird übersprungen');
}

console.log('══ Signatur-Cache ══');
{
  App._sigCache = null;
  const s1 = App._opSignatur("UPDATE kontrollergebnisse SET ergebnis=?, geaendert_am='2026-01-01 10:00:00' WHERE kontrolltermin_id=? AND schueler_id=? AND durchsicht_nr=1", ['in_ordnung', 5, 9]);
  check(s1 && s1.table === 'kontrollergebnisse' && s1.key === 'kontrolltermin_id:5|schueler_id:9|durchsicht_nr:1' && s1.cols.join(',') === 'ergebnis', 'UPDATE: Parameter, Zahl-Literal, Zeitstempel-Spalte ausgeblendet');
  const s2 = App._opSignatur("UPDATE kontrollergebnisse SET ergebnis=?, geaendert_am='x' WHERE kontrolltermin_id=? AND schueler_id=? AND durchsicht_nr=1", ['nachholung_naechste_durchsicht', 6, 1]);
  check(s2.key === 'kontrolltermin_id:6|schueler_id:1|durchsicht_nr:1' && App._sigCache.size === 2, 'Gleiches SQL-Muster mit anderen Parametern: neue Schlüssel, eine Struktur je SQL-Text');
  const u = App._opSignatur('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [4, 2, 17, 'A', 0, 3]);
  check(u && u.table === 'kw_status' && u.key === 'schueler_id:4|ausbildungsjahr:2|kalenderwoche:17' && u.cols.join(',') === 'maengel_codes,fehltage,geprueft', 'UPSERT: Schlüssel aus den Konflikt-Spalten');
  check(App._opSignatur('UPDATE schueler SET aktiv=0 WHERE id IN (SELECT id FROM x)', []) === null && App._opSignatur('DELETE FROM schueler WHERE id=?', [1]) === null, 'Komplexe Bedingung und DELETE: keine Signatur');
  check(App._opSignatur('UPDATE schueler SET telefon=? WHERE id=?', ['1']) === null, 'Zu wenige Parameter: keine Signatur');
  const vorher = App._sigCache.size;
  for (let i = 0; i < 100; i++) App._opSignatur('UPDATE schueler SET telefon=? WHERE id=?', ['1', i]);
  check(App._sigCache.size === vorher, '100 Aufrufe, keine weitere Struktur (SQL-Text schon bekannt)');
}

console.log('══ Netzqualität aus dem Anhängen ══');
{
  App._lastSaveDurationMs = 30000; App._lastPollMs = 100; App._lastAppendMs = 0;
  App._updateNetworkQuality();
  check(App._networkQuality === 'very-slow', 'Fehlversuch (30 s) → sehr langsam');
  App._v3Ready = true; App._ownLogUids = new Set(); App._logOffsets = {}; App._myLogSize = 0; App._netzWeg = false; App._appendInProgress = false; App._lastCompactCheck = Date.now();
  App._dirtyOps = [{ uid: 'eig1', ts: Date.now(), seq: 1, sql: 'UPDATE schueler SET telefon=? WHERE id=?', params: ['0764', 1] }];
  await App._saveV3();
  check(App._dirtyOps.length === 0 && App._lastAppendMs >= 0 && App._lastSaveDurationMs === App._lastAppendMs && App._networkQuality === 'good', 'Gelungenes Anhängen setzt die Speichermessung neu → wieder „good“');
  check(Spur.liste('anhaengen').at(-1).ok, 'Spur: Anhängen OK' + (fehlerAusgaben.length ? ' – ' + fehlerAusgaben.at(-1).slice(0, 300) : ''));
}

console.log('══ Neue Datenbank im Unterordner Datenbanken/ ══');
{
  const datenbanken = await bhk.getDirectoryHandle('Datenbanken', { create: true });
  datenbanken.setze('neu.sqlite', 'x'.repeat(100));
  App.dbDirHandle = datenbanken; App.autoLoadedDbName = 'neu.sqlite';
  App.dbFileHandle = { name: 'neu.sqlite', async getFile() { throw Object.assign(new Error('veraltet'), { name: 'InvalidStateError' }); } };
  App._verbFehler = 0; App._netzWeg = false; App._lastSaveDurationMs = 0; App._networkQuality = 'good';
  const h = await App._dbDateiHandle();
  check(h && h.name === 'neu.sqlite' && h !== App.dbFileHandle, 'Datenbankdatei wird in Datenbanken/ gefunden, obwohl der alte Zugriffspunkt tot ist');
  await App._netzPruefenAsync('snapshot');
  check(App._verbFehler === 0 && !App._netzWeg && App._networkQuality === 'good', 'Netzprobe zählt keinen Fehler und pinnt die Netzqualität nicht auf 30 s');
  bhk.dateien.delete(App._snapMetaName());
  App._v3Ready = true; App._snapGen = 0;
  const vorher = Spur.liste('snapshot').filter(e => !e.ok).length;
  await App._pruefeFremdenSnapshot(); await App._pruefeFremdenSnapshot();
  check(App._verbFehler === 0 && !App._netzWeg && Spur.liste('snapshot').filter(e => !e.ok).length === vorher, 'Fehlendes snapmeta vor der ersten Kompaktierung: kein Fehler, kein Netzabriss');
  App._netzWeg = true;
  check(await App._netzProbe(false) === true && App.dbFileHandle.name === 'neu.sqlite' && !App._netzWeg, 'Leseprobe findet die Datei in Datenbanken/ und hebt den Netzabriss auf');
  App.dbFileHandle = { name: 'weg.sqlite', async getFile() { throw nf(); } }; App.autoLoadedDbName = 'weg.sqlite';
  let fehler = null; try { await App._dbDateiHandle(); } catch(e) { fehler = e; }
  check(fehler && fehler.name === 'NotFoundError', 'Wirklich fehlende Datei wirft NotFound (echter Netzabriss bleibt erkennbar)');
  check(!/this\.dirHandle\.getFileHandle\(name, \{ create: false \}\)\)\.getFile\(\)/.test(APP_SRC) && (APP_SRC.match(/_dbDateiHandle\(/g) || []).length >= 5, 'Alle Suchpfade nutzen den gemeinsamen Helfer');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
