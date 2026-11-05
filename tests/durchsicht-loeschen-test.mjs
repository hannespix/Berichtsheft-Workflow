// Durchsicht und Archiv-Bögen beim Azubi löschen
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });
const APP_SRC = read('src/js/app-core.js');
const AZ = read('src/js/modules/azubi-seite.js');
const ST = read('src/js/modules/stammdaten.js');
const V = read('src/js/modules/views.js');
let ok = 0, fail = 0;
const check = (c, name) => { if (c) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FEHLER: ' + name); } };

console.log('\n══ Oberfläche ══');
check(/deleteKontrollergebnisKaskade\(terminId, schuelerId\) \{/.test(APP_SRC) && /deleteSnapshot\(snapId\) \{/.test(APP_SRC) && /DELETE FROM kontrollergebnisse WHERE kontrolltermin_id=\? AND schueler_id=\?'/.test(APP_SRC), 'Kern: Kaskade je Durchsicht (natürlicher Schlüssel) und Snapshot-Löschung');
check(/<th title="Archivierte Durchsichtsbögen[^"]*">Archiv<\/th>/.test(AZ) && /AS snaps\n/.test(AZ) && /StammdatenTab\.showAzubiSnapshots\(\$\{s\.id\}\)/.test(AZ), 'Azubi-Seite: Spalte Archiv mit Zahl der Bögen und Absprung in den Archiv-Dialog');
check(/label: '✕ Durchsicht löschen', onclick: `AzubiSeite\.kontrolleLoeschen\(\$\{r\.kontrolltermin_id\}, \$\{s\.id\}\)`/.test(AZ) && /async kontrolleLoeschen\(terminId, schuelerId\) \{/.test(AZ) && /App\.deleteKontrollergebnisKaskade\(terminId, schuelerId\)/.test(AZ) && /gefaehrlich: true/.test(AZ) && /gehört zu einer Klasse dieses Termins/.test(AZ), 'Azubi-Seite: ⋯ → „Durchsicht löschen“ mit gefährlicher Rückfrage und Klassen-Hinweis');
check(/AzubiSeite\.kontrolleOeffnen\(\$\{r\.kontrolltermin_id\}, \$\{s\.id\}\)[^>]*>Öffnen<\/button> \$\{menue\}/.test(AZ), '„Öffnen“ bleibt der Hauptknopf');
check(/az-waisen/.test(AZ) && /NOT EXISTS \(SELECT 1 FROM kontrollergebnisse ke JOIN kontrolltermine kt/.test(AZ), 'Verwaiste Archiv-Bögen werden gemeldet');
check(/StammdatenTab\.snapshotLoeschen\(\$\{snap\.id\}, \$\{sid\}\)/.test(ST) && /async snapshotLoeschen\(snapId, sid\) \{/.test(ST) && /App\.deleteSnapshot\(snapId\)/.test(ST) && /ohne Durchsicht/.test(ST), 'Archiv-Dialog: Bogen einzeln löschen, Waisen markiert');
check(/Eine Durchsicht oder ein archivierter Bogen soll beim Azubi verschwinden/.test(V), 'FAQ erklärt Löschen, Klassen-Effekt und Aufräumen');

console.log('\n══ Verhalten mit Daten ══');
const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const el = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } });
const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: el, createElement: el, querySelectorAll: () => [], addEventListener() {}, hidden: false, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, initSqlJs: async () => SQL, KontrolleHandler: { activePruefer: 'test' }, TableSort: { init() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
const App = sandbox.__App;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();
db.run(`INSERT INTO berufsschulen (id,name) VALUES (1,'BS');
  INSERT INTO klassen (id,berufsschule_id,klassenbezeichnung,lehrjahr) VALUES (1,1,'K1',1);
  INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id) VALUES (1,'A','a',1,1),(2,'B','b',1,1);
  INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (1,'2026-01-10','durchgefuehrt');
  INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (1,1);
  INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (1,2);
  INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (11,1,1,'nachholung_naechste_durchsicht'),(12,1,2,'in_ordnung');
  INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (501,11,1,'nachholung','2026-03-01','offen');
  INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz) VALUES (501,'n');
  INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (11,1,40,'A');
  INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum,kw_daten_json) VALUES (901,11,1,'2026-01-10','{}'),(902,11,1,'2026-01-11','{}'),(903,12,2,'2026-01-10','{}');`);
const n = App.deleteKontrollergebnisKaskade(1, 1);
check(n.snapshots === 2 && n.wiedervorlagen === 1, 'Kaskade meldet 2 Bögen und 1 Wiedervorlage');
check(App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=1') === 0 && App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id=1') === 0 && App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=1') === 0 && App.scalar('SELECT COUNT(*) FROM wiedervorlage_notizen') === 0 && App.scalar('SELECT COUNT(*) FROM kw_maengel') === 0, 'Ergebnis, Bögen, Wiedervorlage, Notiz und Mängel von Azubi 1 weg');
check(App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=2') === 1 && App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id=2') === 1, 'Azubi 2 unberührt');
App.deleteKontrollergebnisKaskade(1, 2);
check(App.scalar('SELECT COUNT(*) FROM kontrolltermin_schueler WHERE schueler_id=2') === 0 && App.scalar('SELECT COUNT(*) FROM kontrollergebnisse') === 0, 'Einzelzuordnung von Azubi 2 mit entfernt');
check(App.scalar('SELECT COUNT(*) FROM kontrolltermine') === 1, 'Der Termin selbst bleibt');
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES (13,1,2,'in_ordnung'); INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum,kw_daten_json) VALUES (904,13,2,'2026-01-10','{}'),(905,13,2,'2026-02-10','{}')`);
App.deleteSnapshot(904);
check(App.query('SELECT id FROM durchsicht_snapshots WHERE schueler_id=2').map(r => r.id).join(',') === '905' && App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE id=13') === 1, 'Einzelner Bogen gelöscht, Ergebnis und zweiter Bogen bleiben');

console.log(`\n═══ Ergebnis: ${ok} OK, ${fail} Fehler ═══`);
process.exit(fail ? 1 : 0);
