// ═══════════════════════════════════════════════════════════════════
//  Kontrolldurchführung: Schreibziel, Mängel-Historie, Fehltage, Zulassung
//  Ausführen:  node tests/kontrolle-test.mjs
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

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { _stack: [], push(desc, undo, redo) { this._stack.push({ desc, undo, redo }); }, clear() { this._stack = []; } },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
// const-Deklarationen landen im Modul-Scope, nicht auf globalThis –
// deshalb pro Modul explizit durchreichen.
for (const [f, name] of [['src/js/modules/azubi-rechner.js', 'AzubiRechner'],
                         ['src/js/modules/kontrolle.js', 'KontrolleHandler'],
                         ['src/js/modules/kw-nav.js', 'KWNav']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, KontrolleHandler, KWNav } = sandbox;
App.db = db;
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
KontrolleHandler.renderSchueler = () => {};
KontrolleHandler.renderUebersicht = () => {};

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// ── Testdaten: 2 Azubis, 1 Kontrolltermin ──
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende) VALUES
  (1,'Erst','Anna',1,'2024-09-01','2027-08-31'),
  (2,'Zweit','Bernd',1,'2024-09-01','2027-08-31')`);
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-03-01','geplant')`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,geprueft_kws) VALUES (100,10,1,'{}'), (200,10,2,'{}')`);
KontrolleHandler.currentTerminId = 10;
KontrolleHandler.currentSchuelerList = [{ id: 1, nachname: 'Erst' }, { id: 2, nachname: 'Zweit' }];
KontrolleHandler.activePruefer = 'Test';

const kwCount = (sid) => App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND geprueft=1', [sid]);
const kwRow = (sid, aj, kw) => App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw])[0];

console.log('══ Schreibziel: der bearbeitete, nicht der angezeigte Azubi ══');
{
  // Prüfer blättert auf Azubi 2 weiter, die Aktion gilt aber Azubi 1 (Undo-Fall)
  KontrolleHandler.currentIndex = 1;
  const vorher2 = kwCount(2);
  KWNav.persistCodes(100, 1, 20, 'A', 0, 1, false);
  check(kwRow(1, 1, 20)?.maengel_codes === 'A', 'Mangel steht bei Azubi 1');
  check(kwCount(2) === vorher2, `Azubi 2 unverändert (${kwCount(2)} geprüfte Wochen)`);
  check(App.scalar('SELECT geprueft_kws FROM kontrollergebnisse WHERE id=200') === '{}', 'Geprüft-Liste von Azubi 2 unberührt');
  KontrolleHandler.currentIndex = 0;
}

console.log('\n══ Mängel-Historie: entfernte Codes gelten als behoben ══');
{
  // Weg 1: Code im Modal abwählen (persistCodes mit leerem String)
  KWNav.persistCodes(100, 1, 21, 'B,C', 0, 1, false);
  KWNav.persistCodes(100, 1, 21, 'B', 0, 1, false);
  const r = kwRow(1, 1, 21);
  check(r?.maengel_codes === 'B', 'Verbleibender Mangel B steht noch offen');
  check((r?.behobene_codes || '').split(',').includes('C'), `Entfernter Mangel C ist als behoben protokolliert (${r?.behobene_codes})`);

  // Weg 2: alle Codes entfernen -> Zeile bleibt mit Historie erhalten
  KWNav.persistCodes(100, 1, 21, '', 0, 1, false);
  const r2 = kwRow(1, 1, 21);
  check(!!r2, 'Zeile bleibt erhalten (nicht gelöscht)');
  check((r2?.behobene_codes || '').split(',').sort().join(',') === 'B,C', `Beide Mängel als behoben protokolliert (${r2?.behobene_codes})`);
  check(r2?.maengel_codes === '', 'Keine offenen Mängel mehr');

  // Weg 3: "Keine Beanstandungen" auf einer Woche mit Mangel
  KWNav.persistCodes(100, 1, 22, 'D', 0, 1, false);
  KWNav.persistCodes(100, 1, 22, '', 0, 1, true);
  check((kwRow(1, 1, 22)?.behobene_codes || '').includes('D'), 'O-Taste protokolliert den Mangel ebenfalls als behoben');
}

console.log('\n══ Gesamt-Fehltage werden nachgeführt ══');
{
  App.run('UPDATE kontrollergebnisse SET fehltage_gesamt=99 WHERE id=100');
  KWNav.persistCodes(100, 1, 23, 'H', 3, 1, false);
  const gesamt = App.scalar('SELECT fehltage_gesamt FROM kontrollergebnisse WHERE id=100');
  const summe = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=1');
  check(gesamt === summe, `fehltage_gesamt (${gesamt}) entspricht der Summe der Wochen (${summe})`);
  check(gesamt !== 99, 'Alter Wert wurde überschrieben, nicht stehengelassen');
}

console.log('\n══ Manuelle Abwahl der AP-Zulassung bleibt bestehen ══');
{
  check(App.query('PRAGMA table_info(kontrollergebnisse)').some(c => c.name === 'zulassung_manuell'),
    'Spalte zulassung_manuell existiert im Schema');
  App.run('UPDATE kontrollergebnisse SET zulassung_ap=1 WHERE id=100');
  KontrolleHandler.toggleZulassung(1, false);
  check(App.scalar('SELECT zulassung_ap FROM kontrollergebnisse WHERE id=100') === 0, 'Zulassung ist abgewählt');
  check(App.scalar('SELECT zulassung_manuell FROM kontrollergebnisse WHERE id=100') === 1, 'Abwahl ist dauerhaft vermerkt');
  // Auto-Zulassung darf sie nicht zurücksetzen
  App.run('UPDATE kontrollergebnisse SET zulassung_ap=1 WHERE id=? AND zulassung_ap=0 AND pruefungsausschuss=0 AND COALESCE(zulassung_manuell,0)=0', [100]);
  check(App.scalar('SELECT zulassung_ap FROM kontrollergebnisse WHERE id=100') === 0, 'Automatik setzt die Abwahl nicht zurück');
  KontrolleHandler.toggleZulassung(1, true);
  check(App.scalar('SELECT zulassung_manuell FROM kontrollergebnisse WHERE id=100') === 0, 'Wiedereinschalten hebt die Sperre auf');
}

console.log('\n══ Migrations-Parität (Disk-Datenbank) ══');
{
  const diskDb = new SQL.Database();
  diskDb.run(`CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY AUTOINCREMENT, kontrolltermin_id INTEGER, schueler_id INTEGER, ergebnis TEXT DEFAULT '')`);
  diskDb.run(`CREATE TABLE schueler (id INTEGER PRIMARY KEY AUTOINCREMENT, nachname TEXT)`);
  diskDb.run(`CREATE TABLE kontrolltermine (id INTEGER PRIMARY KEY AUTOINCREMENT, geplant_datum TEXT)`);
  diskDb.run(`CREATE TABLE berufsschulen (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`);
  diskDb.run(`CREATE TABLE klassen (id INTEGER PRIMARY KEY AUTOINCREMENT, klassenbezeichnung TEXT)`);
  diskDb.run(`CREATE TABLE abschlussjahrgaenge (id INTEGER PRIMARY KEY AUTOINCREMENT, bezeichnung TEXT)`);
  diskDb.run(`CREATE TABLE fachrichtungen (id INTEGER PRIMARY KEY AUTOINCREMENT, bezeichnung TEXT)`);
  diskDb.run(`CREATE TABLE wiedervorlagen (id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER)`);
  App._migrateDiskDb(diskDb);
  const cols = [];
  const st = diskDb.prepare('PRAGMA table_info(kontrollergebnisse)');
  while (st.step()) cols.push(st.getAsObject().name);
  st.free();
  check(cols.includes('zulassung_manuell'), 'zulassung_manuell wird auch auf der Disk-Datenbank angelegt');
  diskDb.close();
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
