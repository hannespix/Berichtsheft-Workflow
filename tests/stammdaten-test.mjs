// ═══════════════════════════════════════════════════════════════════
//  Stammdaten heilen: Normalisierung, Dubletten, Aliase, Zusammenführen
//  (Schulen mit UNIQUE-Klassen, Betriebe, Jahrgänge) und Import-Wächter
//  Ausführen:  node tests/stammdaten-test.mjs
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
const IH_SRC = read('src/js/modules/import-handler.js');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

let modalHtml = '';
const selects = []; // simulierte .imp-zuord-Selects der Vorschau
const el = (id) => ({ id, value: id && id.startsWith('map_') ? id.slice(4) : '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: (sel) => sel === '.imp-zuord' ? selects : [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => '2026-09-11', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: { importView() {} }, SchuelerView: { render() {} }, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: { azubis() {} }, GlobalSearch: {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/azubi-rechner.js', 'AzubiRechner'], ['src/js/modules/import-handler.js', 'ImportHandler']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, ImportHandler: IH } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.showLoading = () => {}; App.hideLoading = () => {}; App.fullSave = async () => {}; App.dbFileHandle = {};
App.openModal = (t, html, footer) => { modalHtml = String(html) + String(footer || ''); }; App.closeModal = () => {};
App.currentUser = 'Test';
App.migrateDB();

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const cnt = (sql, p) => App.scalar(sql, p || []) || 0;

console.log('══ Normalisierung & Ähnlichkeit ══');
{
  const n = (s, a) => App.normName(s, a);
  check(n('Berufsschule Heidelberg', 'schule') === n('BS Heidelberg', 'schule') && n('BS Heidelberg', 'schule') === n('Gewerbliche Schule Heidelberg', 'schule'), 'Schulnamen: Füllwörter „Berufsschule“/„BS“/„Gewerbliche Schule“ fallen weg');
  check(n('Gärtnerei Müller GmbH & Co. KG', 'betrieb') === n('Gaertnerei Mueller', 'betrieb'), 'Betriebe: Umlaute und Rechtsform-Zusätze neutralisiert');
  check(n('S 2026', 'jahrgang') === n('s2026', 'jahrgang'), 'Jahrgänge: Leerzeichen und Groß/Klein');
  check(n('Berufsschule', 'schule') === 'berufsschule', 'Nur Füllwörter → Name bleibt erhalten (kein leerer Schlüssel)');
  check(App._aehnlichkeit(n('Hohenheim', 'schule'), n('Hohenhaim', 'schule')) === 'Tippfehler-Nähe', 'Tippfehler wird erkannt');
  check(App._aehnlichkeit(n('BS Freiburg Nord', 'schule'), n('Freiburg', 'schule')) === 'Name enthalten', 'Enthaltener Name wird erkannt');
  check(App._aehnlichkeit(n('Freiburg', 'schule'), n('Offenburg', 'schule')) === '', 'Verschiedene Namen bleiben verschieden');
}

// ── Testdaten ──
db.run("INSERT OR IGNORE INTO fachrichtungen (code,bezeichnung,typ) VALUES ('036','GaLaBau','Gärtner'),('034','Obstbau','Gärtner')");
const FR1 = App.scalar("SELECT id FROM fachrichtungen WHERE code='036'"), FR2 = App.scalar("SELECT id FROM fachrichtungen WHERE code='034'");
db.run("INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (10,'S2026','Sommer',2026),(11,'S 2026','',2026),(12,'S2027','Sommer',2027)");
db.run("INSERT INTO berufsschulen (id,name,ort,email) VALUES (1,'Berufsschule Heidelberg','Heidelberg',''),(2,'BS Heidelberg','','sekretariat@bs-hd.de'),(3,'BS Freiburg','Freiburg','')");
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung) VALUES (101,1,10,${FR1},'GL S2026 HD'),(201,2,10,${FR1},'GL S2026 HD alt'),(202,2,12,${FR2},'OB S2027'),(110,1,11,${FR2},'OB S 2026')`);
db.run("INSERT INTO betriebe (id,betriebsnummer,name,ort,email) VALUES (1,NULL,'Gärtnerei Müller','Bruchsal',''),(2,'4711','Gaertnerei Mueller GmbH','Bruchsal','info@mueller.de'),(3,'0815','Baumschule Weber','Bühl','')");
db.run("INSERT INTO ausbilder (id,betrieb_id,nachname) VALUES (1,2,'Müller')");
db.run(`INSERT INTO schueler (id,ibykus_id,nachname,vorname,fachrichtung_id,betrieb_id,klasse_id,jahrgang_id,aktiv,status) VALUES
  (1,'A1','Eins','Anna',${FR1},1,101,10,1,'aktiv'),(2,'A2','Zwei','Bernd',${FR1},2,201,10,1,'aktiv'),(3,'A3','Drei','Clara',${FR2},2,202,12,1,'aktiv'),(4,'A4','Vier','Dora',${FR2},3,110,11,1,'aktiv'),(5,'A5','Fuenf','Emil',${FR1},NULL,NULL,11,1,'aktiv')`);
db.run("INSERT INTO kontrolltermine (id,berufsschule_id,jahrgang_id,klasse_id,geplant_datum,status) VALUES (500,2,10,201,'2026-10-01','geplant'),(501,2,12,202,'2026-10-02','geplant'),(510,1,11,110,'2026-10-03','geplant')");
db.run("INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (500,201),(501,202),(510,110)");
db.run("INSERT INTO blockplan (berufsschule_id,schuljahr,lehrjahr,kalenderwoche) VALUES (2,'2026/2027',1,40),(2,'2026/2027',1,41),(1,'2026/2027',1,40)");

console.log('══ Dubletten-Kandidaten ══');
{
  const s = App.dublettenKandidaten('schule');
  check(s.length === 1 && s[0].a.id + s[0].b.id === 3 && s[0].grund.startsWith('gleicher'), 'Schulen: Heidelberg-Paar erkannt, Freiburg nicht');
  const b = App.dublettenKandidaten('betrieb');
  check(b.length === 1 && b[0].a.id + b[0].b.id === 3, 'Betriebe: Müller-Paar erkannt, Weber nicht');
  const j = App.dublettenKandidaten('jahrgang');
  check(j.length === 1 && j[0].a.id + j[0].b.id === 21, 'Jahrgänge: „S2026“/„S 2026“ erkannt');
  const k = App.aehnlicheStammdaten('schule', 'Gewerbliche Schule Heidelberg');
  check(k.length === 2 && k.every(x => x.grund.startsWith('gleicher')), 'Neuer Name „Gewerbliche Schule Heidelberg“ findet beide Heidelberg-Einträge');
  check(App.aehnlicheStammdaten('schule', 'BS Karlsruhe').length === 0, 'Unbekannter Name ohne Kandidaten');
}

console.log('══ Aliase ══');
{
  check(App.aliasZiel('schule', 'Alte Schreibweise') === null, 'Ohne Alias kein Ziel');
  check(App.aliasSetzen('schule', 'Alte Schreibweise', 3), 'Alias gesetzt');
  check(App.aliasZiel('schule', 'alte schreibweise') === 3 && App.aliasZiel('schule', 'ALTE  SCHREIBWEISE ') === 3, 'Alias-Auflösung normalisiert (Groß/Klein, Leerzeichen)');
  check(!App.aliasSetzen('schule', 'BS Freiburg', 3), 'Kein Alias auf den eigenen Namen');
  check(App.aliasSetzen('schule', 'Alte Schreibweise', 1) && App.aliasZiel('schule', 'Alte Schreibweise') === 1, 'Erneutes Setzen überschreibt das Ziel (ON CONFLICT)');
  check(App.aliaseSetzenAus('schule', 3, ['Freiburg Nord', ' Freiburg-Nord ', '', 'BS Freiburg']) === 1 && App.aliasListe('schule', 3).length === 1, 'Alias-Liste aus Dialog: Duplikate/eigener Name/leer fallen weg');
  check(App.aliasZiel('schule', 'Alte Schreibweise') === 1, 'Aliase anderer Ziele unberührt');
  App.aliasLoeschen('schule', App.normName('Alte Schreibweise', 'schule'));
  check(App.aliasZiel('schule', 'Alte Schreibweise') === null, 'Alias gelöscht');
  db.run("DELETE FROM stammdaten_aliase");
}

console.log('══ Schulen zusammenführen (UNIQUE-Klassen) ══');
{
  const r = App.mergeSchulen(1, [2]);
  check(r.klassenVerschmolzen === 1 && r.klassenVerschoben === 1 && r.azubis === 2, `Eine Klasse verschmolzen, eine verschoben, 2 Azubis (${JSON.stringify(r)})`);
  check(cnt('SELECT COUNT(*) FROM berufsschulen WHERE id=2') === 0 && cnt('SELECT COUNT(*) FROM klassen WHERE id=201') === 0, 'Quellschule und Doppel-Klasse entfernt');
  check(App.scalar('SELECT klasse_id FROM schueler WHERE id=2') === 101, 'Azubi der Doppel-Klasse sitzt jetzt in der Ziel-Klasse (verlor sie früher!)');
  check(App.scalar('SELECT berufsschule_id FROM klassen WHERE id=202') === 1 && App.scalar('SELECT klasse_id FROM schueler WHERE id=3') === 202, 'Klasse ohne Gegenstück wurde umgehängt, Azubi behält sie');
  check(App.scalar('SELECT berufsschule_id FROM kontrolltermine WHERE id=500') === 1 && App.scalar('SELECT klasse_id FROM kontrolltermine WHERE id=500') === 101, 'Termin: Schule und Klasse auf Ziel');
  check(cnt('SELECT COUNT(*) FROM kontrolltermin_klassen WHERE kontrolltermin_id=500 AND klasse_id=101') === 1 && cnt('SELECT COUNT(*) FROM kontrolltermin_klassen WHERE klasse_id=201') === 0, 'Termin-Klassen umgehängt');
  check(cnt("SELECT COUNT(*) FROM blockplan WHERE berufsschule_id=1 AND schuljahr='2026/2027'") === 2 && cnt('SELECT COUNT(*) FROM blockplan WHERE berufsschule_id=2') === 0, 'Blockplan übernommen (KW 40 nicht doppelt, KW 41 neu)');
  check(App.scalar('SELECT email FROM berufsschulen WHERE id=1') === 'sekretariat@bs-hd.de' && App.scalar('SELECT ort FROM berufsschulen WHERE id=1') === 'Heidelberg', 'Leere Kontaktfelder des Ziels aus der Quelle gefüllt, gefüllte bleiben');
  check(App.aliasZiel('schule', 'BS Heidelberg') === 1 && r.aliase === 1, 'Alter Name als Alias auf das Ziel');
  check(cnt('SELECT COUNT(*) FROM schueler WHERE klasse_id IS NULL AND id IN (1,2,3)') === 0, 'Kein Azubi ohne Klasse zurückgelassen');
}

console.log('══ Betriebe zusammenführen ══');
{
  const r = App.mergeBetriebe(1, [2]);
  check(r.azubis === 2 && r.ausbilder === 1 && r.aliase === 2, `2 Azubis, 1 Ausbilder, 2 Aliase (Name + Betriebsnummer) (${JSON.stringify(r)})`);
  check(cnt('SELECT COUNT(*) FROM schueler WHERE betrieb_id=1') === 3 && cnt('SELECT COUNT(*) FROM betriebe WHERE id=2') === 0, 'Azubis beim Ziel, Quelle gelöscht');
  check(App.scalar('SELECT betrieb_id FROM ausbilder WHERE id=1') === 1, 'Ausbilder mitgenommen');
  check(App.scalar('SELECT betriebsnummer FROM betriebe WHERE id=1') === '4711' && App.scalar('SELECT email FROM betriebe WHERE id=1') === 'info@mueller.de', 'Betriebsnummer und E-Mail übernommen (UNIQUE-sicher: Quelle zuerst gelöscht)');
  check(App.aliasZiel('betrieb', 'Gaertnerei Mueller GmbH') === 1 && App.aliasZiel('betrieb', '4711') === 1, 'Alias über Namen und über alte Betriebsnummer');
}

console.log('══ Jahrgänge zusammenführen ══');
{
  const r = App.mergeJahrgaenge(10, [11]);
  check(r.klassenVerschoben === 1 && r.klassenVerschmolzen === 0 && r.azubis === 2, `Klasse 110 umgehängt, 2 Azubis (einer ohne Klasse) (${JSON.stringify(r)})`);
  check(cnt('SELECT COUNT(*) FROM abschlussjahrgaenge WHERE id=11') === 0 && App.scalar('SELECT jahrgang_id FROM schueler WHERE id=5') === 10 && App.scalar('SELECT jahrgang_id FROM klassen WHERE id=110') === 10, 'Jahrgang gelöscht, Azubis und Klassen beim Ziel');
  check(App.scalar('SELECT jahrgang_id FROM kontrolltermine WHERE id=510') === 10, 'Termin folgt');
  check(App.aliasZiel('jahrgang', 'S 2026') === 10, 'Alias für die alte Bezeichnung');
  // Verschmelzung bei gleicher Schule/Fachrichtung
  db.run("INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (13,'S-2027','',2027)");
  db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung) VALUES (302,1,13,${FR2},'OB S-2027')`);
  db.run(`INSERT INTO schueler (id,ibykus_id,nachname,vorname,fachrichtung_id,klasse_id,jahrgang_id,aktiv,status) VALUES (6,'A6','Sechs','Fritz',${FR2},302,13,1,'aktiv')`);
  const r2 = App.mergeJahrgaenge(12, [13]);
  check(r2.klassenVerschmolzen === 1 && App.scalar('SELECT klasse_id FROM schueler WHERE id=6') === 202 && cnt('SELECT COUNT(*) FROM klassen WHERE id=302') === 0, 'Gleiche Klasse (Schule+Fachrichtung) wird verschmolzen, Azubi wechselt in die Ziel-Klasse');
}

console.log('══ Import: Alias-Zuordnung und Wächter ══');
{
  IH._datumsFormat = 'TMJ';
  const row = (o) => ({ nachname: 'Import', vorname: 'Ida', ibykus_id: 'I1', ausbildungsbeginn: '01.09.2025', ausbildungsende: '31.08.2028', beruf_code: '036', pruefungstermin: 'S 2026',
    berufsschule: 'BS Heidelberg', ausbildungsstaette: 'Gaertnerei Mueller GmbH', betriebsnummer: '', zustaendiges_amt: '93', bav_status: 'BESTAET', pruefungserfolg: '', ...o });
  const schulenVorher = cnt('SELECT COUNT(*) FROM berufsschulen'), betriebeVorher = cnt('SELECT COUNT(*) FROM betriebe'), jgVorher = cnt('SELECT COUNT(*) FROM abschlussjahrgaenge');
  await IH.doImport([row({})], { stumm: true });
  const s = App.query("SELECT * FROM schueler WHERE ibykus_id='I1'")[0];
  check(!!s && cnt('SELECT COUNT(*) FROM berufsschulen') === schulenVorher && cnt('SELECT COUNT(*) FROM betriebe') === betriebeVorher && cnt('SELECT COUNT(*) FROM abschlussjahrgaenge') === jgVorher, 'Import legt trotz alter Schreibweisen KEINE neuen Schulen/Betriebe/Jahrgänge an');
  check(s && s.betrieb_id === 1 && s.jahrgang_id === 10 && App.scalar('SELECT berufsschule_id FROM klassen WHERE id=?', [s.klasse_id]) === 1, `Azubi hängt über Aliase an Ziel-Betrieb, Ziel-Jahrgang und Ziel-Schule (${s ? `betrieb ${s.betrieb_id}, jg ${s.jahrgang_id}, klasse ${s.klasse_id} → schule ${App.scalar('SELECT berufsschule_id FROM klassen WHERE id=?', [s.klasse_id])}` : 'kein Azubi'})`);

  // „Gewerbliche Schule Heidelberg“ hat denselben Normalschlüssel wie der Alias „BS Heidelberg“ → wird schon automatisch zugeordnet
  await IH.doImport([row({ ibykus_id: 'I9', nachname: 'Neun', berufsschule: 'Gewerbliche Schule Heidelberg' })], { stumm: true });
  const s9 = App.query("SELECT * FROM schueler WHERE ibykus_id='I9'")[0];
  check(s9 && App.scalar('SELECT berufsschule_id FROM klassen WHERE id=?', [s9.klasse_id]) === 1 && cnt('SELECT COUNT(*) FROM berufsschulen') === schulenVorher, 'Alias wirkt über den Normalschlüssel auch für neue Schreibweisen mit gleichem Kern');
  // Vorschau: neue Schule ähnelt vorhandener (enthält den Namen, aber kein Teilstring-Treffer der alten Suche) → Wächter
  await IH.doImport([row({ ibykus_id: 'I2', nachname: 'Neu', berufsschule: 'BS Heidelberg-Wieblingen', ausbildungsstaette: 'Baumschule Weber GmbH' })], { vorschau: true, stumm: true });
  const v = IH._vorschau;
  check(v && v.stats.schulen.has('BS Heidelberg-Wieblingen') && v.stats.betriebe.has('Baumschule Weber GmbH'), `Vorschau meldet neue Schule und neuen Betrieb (${v ? [...v.stats.schulen].join('|') + ' / ' + [...v.stats.betriebe].join('|') : '-'})`);
  check(cnt("SELECT COUNT(*) FROM berufsschulen WHERE name='BS Heidelberg-Wieblingen'") === 0, 'Vorschau schreibt nichts (Savepoint zurückgerollt)');
  const w = IH._stammdatenWaechter(v.stats);
  check(w.length === 2 && w.find(x => x.art === 'schule' && x.kandidaten[0].id === 1) && w.find(x => x.art === 'betrieb' && x.kandidaten[0].id === 3), 'Wächter nennt die passenden vorhandenen Einträge');
  IH._zeigeVorschau(v);
  check(/imp-zuord/.test(modalHtml) && /Neue Stammdaten ähneln vorhandenen/.test(modalHtml) && /neu anlegen/.test(modalHtml), 'Vorschau zeigt Zuordnungs-Auswahl je neuem Eintrag');
  check(/ImportHandler\._zuordnungAusVorschau\(\)/.test(modalHtml), 'Import-Knopf übergibt die gewählte Zuordnung');

  // Zuordnung anwenden: Schule → 1, Betrieb → neu anlegen
  selects.push({ value: '1', dataset: { art: 'schule', name: 'BS Heidelberg-Wieblingen' } }, { value: '', dataset: { art: 'betrieb', name: 'Baumschule Weber GmbH' } });
  const z = IH._zuordnungAusVorschau();
  check(z.schule && z.schule['BS Heidelberg-Wieblingen'] === 1 && !z.betrieb, 'Zuordnung aus der Vorschau gelesen (leer = neu anlegen)');
  await IH.doImport(v.data, { zuordnung: z, stumm: true });
  const s2 = App.query("SELECT * FROM schueler WHERE ibykus_id='I2'")[0];
  check(s2 && App.scalar('SELECT berufsschule_id FROM klassen WHERE id=?', [s2.klasse_id]) === 1 && cnt("SELECT COUNT(*) FROM berufsschulen WHERE name='BS Heidelberg-Wieblingen'") === 0, `Gewählte Zuordnung: keine neue Schule, Azubi an Schule 1 (${s2 ? App.scalar('SELECT berufsschule_id FROM klassen WHERE id=?', [s2.klasse_id]) : '-'})`);
  check(App.aliasZiel('schule', 'BS Heidelberg-Wieblingen') === 1, 'Zuordnung wurde als Alias gemerkt');
  check(cnt("SELECT COUNT(*) FROM betriebe WHERE name='Baumschule Weber GmbH'") === 1, '„neu anlegen“ legt den Betrieb an');
  selects.length = 0;
  await IH.doImport([row({ ibykus_id: 'I3', nachname: 'Dritte', berufsschule: 'Berufsschule Heidelberg Wieblingen' })], { stumm: true });
  const s3 = App.query("SELECT * FROM schueler WHERE ibykus_id='I3'")[0];
  check(s3 && App.scalar('SELECT berufsschule_id FROM klassen WHERE id=?', [s3.klasse_id]) === 1, 'Nächster Import erkennt den Alias automatisch');
}

console.log('══ Schema & Oberfläche ══');
{
  check(/stammdaten_aliase/.test(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]), 'Alias-Tabelle im SCHEMA');
  const mig = APP_SRC.split('migrateDB() {')[1] || '';
  check(/stammdaten_aliase/.test(mig), 'Alias-Tabelle in migrateDB');
  const disk = APP_SRC.split('_migrateDiskDb(diskDb) {')[1] || '';
  check(/stammdaten_aliase/.test(disk.split('\n  },')[0]), 'Alias-Tabelle in _migrateDiskDb');
  const alt = new SQL.Database(); alt.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]); alt.run('DROP TABLE stammdaten_aliase');
  const App2 = Object.create(App); App2.db = alt; App2.run = (sql, p) => alt.run(sql, p || []);
  App2.migrateDB();
  check(alt.exec("SELECT name FROM sqlite_master WHERE name='stammdaten_aliase'").length === 1, 'Bestands-DB ohne Alias-Tabelle bekommt sie per Migration');
  const ST = read('src/js/modules/stammdaten.js');
  check(/App\.mergeSchulen\(targetId, others\)/.test(ST) && !/App\.run\('UPDATE klassen SET berufsschule_id=\? WHERE berufsschule_id=\?'/.test(ST), 'Schul-Zusammenführung nutzt App.mergeSchulen (Lücke bei UNIQUE-Klassen geschlossen)');
  check(/dubletten\('schule'\)/.test(ST) && /dubletten\('betrieb'\)/.test(ST) && /dubletten\('jahrgang'\)/.test(ST) && /doMergeDubletten\(art, zielId, quellId\)/.test(ST), 'Dubletten-Dialog für Schulen, Betriebe, Jahrgänge');
  check(/mSchAliase/.test(ST) && /aliaseSetzenAus\('schule', id/.test(ST), 'Aliase im Schul-Dialog pflegbar');
  check(/StammdatenTab\.dubletten\('\$\{art\}'\)/.test(read('src/js/modules/db-tools.js')), 'Datenbank-Tools verlinken die Dubletten-Prüfung');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
