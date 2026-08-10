// ═══════════════════════════════════════════════════════════════════
//  Datenintegrität: Lösch-Kaskaden und Migrations-Parität
//  Ausführen:  node tests/integritaet-test.mjs
//
//  sql.js hat Fremdschlüssel standardmäßig AUS – die ON DELETE CASCADE im
//  Schema greifen nie. Alles muss über die zentralen Kaskaden-Helfer laufen,
//  sonst bleiben unsichtbare Zeilen liegen, die weiterhin in Ampel,
//  Statistik und Mängelauswertung mitzählen.
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
const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, Set, Map,
  TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: el, createElement: el, querySelectorAll: () => [], addEventListener() {}, hidden: false,
    body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, KontrolleHandler: { activePruefer: 'test' }, TableSort: { init() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
const App = sandbox.__App;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// ── Vollständig verknüpfter Testbestand ──
function baueBestand() {
  for (const t of ['kw_maengel', 'kw_status', 'durchsicht_snapshots', 'wiedervorlage_notizen', 'wiedervorlagen',
    'kontrollergebnisse', 'kontrolltermin_schueler', 'kontrolltermin_klassen', 'kontrolltermine',
    'ausbildungsphasen', 'schueler_bemerkungen', 'schueler_dateien', 'schueler', 'klassen', 'berufsschulen',
    'betriebe', 'ausbilder', 'abschlussjahrgaenge', 'blockplan']) {
    try { db.run(`DELETE FROM ${t}`); } catch (e) {}
  }
  db.run(`INSERT INTO berufsschulen (id,name) VALUES (1,'BS Test')`);
  db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (1,'S2027','Sommer',2027)`);
  db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,klassenbezeichnung) VALUES (1,1,1,'GaLa 1')`);
  db.run(`INSERT INTO betriebe (id,name,betriebsnummer) VALUES (1,'Gärtnerei',NULL)`);
  db.run(`INSERT INTO ausbilder (id,betrieb_id,nachname) VALUES (1,1,'Meister')`);
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,betrieb_id) VALUES (1,'Test','Azubi',1,1,1,1)`);
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,klasse_id,jahrgang_id) VALUES (1,'2026-03-01',1,1)`);
  db.run(`INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (1,1)`);
  db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (1,1)`);
  db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (1,1,1,'in_ordnung')`);
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (1,1,10,'A')`);
  db.run(`INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (1,1,10,'A')`);
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,frist_datum) VALUES (1,1,1,'2026-04-01')`);
  db.run(`INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz) VALUES (1,'Notiz')`);
  db.run(`INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum) VALUES (1,1,1,'2026-03-01')`);
  db.run(`INSERT INTO ausbildungsphasen (schueler_id,von,typ) VALUES (1,'2024-09-01','ausbildung')`);
  db.run(`INSERT INTO schueler_bemerkungen (schueler_id,text) VALUES (1,'Bemerkung')`);
  db.run(`INSERT INTO schueler_dateien (schueler_id,dateiname,original_name) VALUES (1,'a.pdf','a.pdf')`);
  db.run(`INSERT INTO blockplan (berufsschule_id,kalenderwoche) VALUES (1,10)`);
}
const zaehl = (t, w) => { try { return App.scalar(`SELECT COUNT(*) FROM ${t} WHERE ${w}`); } catch (e) { return -1; } };

console.log('══ Azubi löschen: keine Datenleichen ══');
{
  baueBestand();
  App.deleteSchuelerKaskade(1);
  const reste = [];
  for (const [t, w] of [['kontrollergebnisse', 'schueler_id=1'], ['kw_status', 'schueler_id=1'],
    ['wiedervorlagen', 'schueler_id=1'], ['wiedervorlage_notizen', 'wiedervorlage_id=1'],
    ['durchsicht_snapshots', 'schueler_id=1'], ['ausbildungsphasen', 'schueler_id=1'],
    ['schueler_bemerkungen', 'schueler_id=1'], ['schueler_dateien', 'schueler_id=1'],
    ['kontrolltermin_schueler', 'schueler_id=1'], ['kw_maengel', 'kontrollergebnis_id=1'],
    ['schueler', 'id=1']]) {
    const n = zaehl(t, w);
    if (n > 0) reste.push(`${t}=${n}`);
  }
  check(reste.length === 0, `Alle abhängigen Zeilen entfernt${reste.length ? ' – Reste: ' + reste.join(', ') : ''}`);
}

console.log('\n══ Kontrolltermin löschen ══');
{
  baueBestand();
  App.deleteTerminKaskade(1);
  const reste = [];
  for (const [t, w] of [['kontrollergebnisse', 'kontrolltermin_id=1'], ['kontrolltermin_klassen', 'kontrolltermin_id=1'],
    ['kontrolltermin_schueler', 'kontrolltermin_id=1'], ['kw_maengel', 'kontrollergebnis_id=1'],
    ['wiedervorlagen', 'kontrollergebnis_id=1'], ['kontrolltermine', 'id=1']]) {
    const n = zaehl(t, w);
    if (n > 0) reste.push(`${t}=${n}`);
  }
  check(reste.length === 0, `Keine verwaisten Kontrollergebnisse${reste.length ? ' – Reste: ' + reste.join(', ') : ''}`);
  check(zaehl('schueler', 'id=1') === 1, 'Der Azubi selbst bleibt erhalten');
}

console.log('\n══ Klasse, Schule, Betrieb, Jahrgang ══');
{
  baueBestand();
  App.deleteKlasseKaskade(1);
  check(App.scalar('SELECT klasse_id FROM schueler WHERE id=1') === null, 'Azubi wird von der Klasse gelöst, nicht gelöscht');
  check(zaehl('kontrolltermin_klassen', 'klasse_id=1') === 0, 'Termin-Klassen-Zuordnung entfernt');

  baueBestand();
  App.deleteSchuleKaskade(1);
  check(zaehl('klassen', 'berufsschule_id=1') === 0, 'Klassen der Schule entfernt');
  check(zaehl('blockplan', 'berufsschule_id=1') === 0, 'Blockplan der Schule entfernt');
  check(zaehl('schueler', 'id=1') === 1, 'Azubis bleiben erhalten');

  baueBestand();
  App.deleteBetriebKaskade(1);
  check(App.scalar('SELECT betrieb_id FROM schueler WHERE id=1') === null, 'Azubi wird vom Betrieb gelöst');
  check(zaehl('ausbilder', 'betrieb_id=1') === 0, 'Ausbilder des Betriebs entfernt');

  baueBestand();
  App.deleteJahrgangKaskade(1);
  check(App.scalar('SELECT jahrgang_id FROM schueler WHERE id=1') === null, 'Azubi wird vom Jahrgang gelöst');
  check(App.scalar('SELECT jahrgang_id FROM klassen WHERE id=1') === null, 'Klasse wird vom Jahrgang gelöst');
}

console.log('\n══ Migrations-Parität: Schema / Arbeitskopie / Netzlaufwerk ══');
{
  const tabellen = (d) => { const r = []; const st = d.prepare("SELECT name FROM sqlite_master WHERE type='table'"); while (st.step()) r.push(st.getAsObject().name); st.free(); return r; };
  const imSchema = tabellen(db);
  for (const t of ['wiedervorlage_notizen', 'bhk_tombstones', 'bhk_applied_ops']) {
    check(imSchema.includes(t), `${t} existiert nach migrateDB()`);
  }
  // Alt-Datenbank ohne Zusatztabellen durch _migrateDiskDb schicken
  const alt = new SQL.Database();
  alt.run(`CREATE TABLE schueler (id INTEGER PRIMARY KEY AUTOINCREMENT, nachname TEXT)`);
  alt.run(`CREATE TABLE kontrolltermine (id INTEGER PRIMARY KEY AUTOINCREMENT, geplant_datum TEXT)`);
  alt.run(`CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY AUTOINCREMENT, kontrolltermin_id INTEGER, schueler_id INTEGER, ergebnis TEXT DEFAULT '')`);
  alt.run(`CREATE TABLE berufsschulen (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`);
  alt.run(`CREATE TABLE klassen (id INTEGER PRIMARY KEY AUTOINCREMENT, klassenbezeichnung TEXT)`);
  alt.run(`CREATE TABLE abschlussjahrgaenge (id INTEGER PRIMARY KEY AUTOINCREMENT, bezeichnung TEXT)`);
  alt.run(`CREATE TABLE fachrichtungen (id INTEGER PRIMARY KEY AUTOINCREMENT, bezeichnung TEXT)`);
  alt.run(`CREATE TABLE wiedervorlagen (id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER)`);
  App._migrateDiskDb(alt);
  const aufDisk = tabellen(alt);
  for (const t of ['wiedervorlage_notizen', 'bhk_tombstones', 'bhk_applied_ops', 'kw_status', 'kw_maengel', 'ausbildungsphasen']) {
    check(aufDisk.includes(t), `${t} wird auch auf einer Alt-Datenbank angelegt`);
  }
  alt.close();
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
