// Sammelauswertung: mehrere Termine gemeinsam auswerten, Zusammenführen für Doppelanlagen
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
const SAMMEL_SRC = read('src/js/modules/sammel.js');
const V = read('src/js/modules/views.js');
const B = read('src/js/modules/berichte.js');
const TS = read('src/js/modules/termin-seite.js');
const CSS = read('src/css/styles.css');
const HTML = read('index.html');
const BUILD = read('build.sh');
let ok = 0, fail = 0;
const check = (c, name) => { if (c) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FEHLER: ' + name); } };

console.log('\n══ Verdrahtung ══');
check(/sammel\.js/.test(HTML) && /sammel\.js/.test(BUILD) && HTML.indexOf('termin-seite.js') < HTML.indexOf('sammel.js'), 'Modul registriert (nach der Termin-Seite)');
check(/<th class="sl-th"><input type="checkbox" id="planAlle"[^>]*onchange="Sammel\.alle\(this\.checked\)"/.test(V) && /<td class="sl-td"><input type="checkbox" class="chk-termin" value="\$\{t\.id\}"[^>]*onchange="Sammel\.toggle\(\$\{t\.id\}, this\.checked\)"/.test(V), 'Termine-Liste: Häkchen je Zeile und im Kopf (alle sichtbaren)');
check(/<div id="sammelLeiste" class="sammel-leiste" style="display:none" role="region"/.test(V) && /if \(typeof Sammel !== 'undefined'\) Sammel\._leiste\(\);/.test(V), 'Leiste unter der Tabelle, nach dem Zeichnen aufgefrischt');
check(/Sammel\.uebersicht\(\)/.test(SAMMEL_SRC) && /Sammel\.zulassungsliste\(\)/.test(SAMMEL_SRC) && /Sammel\.excel\(\)/.test(SAMMEL_SRC) && /Sammel\.pdf\(\)/.test(SAMMEL_SRC) && /Sammel\.zusammenfuehrenDialog\(\)/.test(SAMMEL_SRC) && /Sammel\.leer\(\)/.test(SAMMEL_SRC), 'Leiste: Gemeinsame Übersicht, Zulassungsliste, Excel, PDF, ⋯ Zusammenführen, ✕');
check(/Sammel\.zusammenfuehrenDialog\(\[\$\{t\.id\}\], \$\{t\.id\}\)/.test(TS), 'Termin-Seite: „Anderen Termin hierher zusammenführen“ im ⋯-Menü');
check(/if \(view !== 'planung' && typeof Sammel !== 'undefined'\) \{ try \{ Sammel\._ids\.clear\(\); \} catch\(e\) \{\} \}/.test(APP_SRC), 'Auswahl gilt nur in der Termine-Liste');
check(/_terminZeilen\(termin, mitTermin\) \{/.test(B) && /exportTermineExcel\(terminIds\) \{/.test(B) && /const rows = this\._terminZeilen\(termin, false\);/.test(B) && /termine\.flatMap\(t => this\._terminZeilen\(t, true\)\)/.test(B) && /\.\.\.\(mitTermin \? \{ 'Termin':/.test(B), 'Excel: gemeinsame Zeilen für einen und mehrere Termine, Spalte „Termin“ nur im Sammelexport');
check(/\.sammel-leiste \{ position: sticky; bottom: 0;/.test(CSS) && /\.sm-liste \{/.test(CSS) && /\.sm-vorschau \{/.test(CSS) && !/\.s[lm]-[a-z-]+ \{[^}]*font-size: 1[01]px/.test(CSS), 'CSS: Leiste, Dialog, keine Schrift unter 12 px');
check(/Mehrere Termine gemeinsam auswerten/.test(V) && /<strong>Zulassungsliste<\/strong>/.test(V) && /nicht rückgängig machen/.test(V), 'Hilfe erklärt Auswertungen und Zusammenführen');

console.log('\n══ Verhalten mit Daten ══');
const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const el = () => ({ textContent: '', innerHTML: '', style: {}, value: '', classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise, Set, Map, Number, String, Array, Object, parseInt,
  TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: el, createElement: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, hidden: false, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {} },
  KontrolleHandler: { activePruefer: 'test', zulassungsBefund: (s, ke) => ({ ok: ke.zulassung_ap === 1, gruende: ke.zulassung_ap === 1 ? [] : ['Berichtsheft nicht in Ordnung'], fz: { gesamt: 3, prozentBisher: 1.5 }, pflichtOK: true, imLetztenAJ: s.id !== 3, fehlWarn: false }) },
  Views: { planung() {} }, PlanungHandler: { exportTerminPDF() {} }, BerichteHandler: {},
  esc: x => String(x == null ? '' : x), formatDate: d => d ? d.split('-').reverse().join('.') : '', getKW: () => 1,
  window: null,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(SAMMEL_SRC + '\n;globalThis.__S = Sammel;', sandbox, { filename: 'sammel.js' });
const App = sandbox.__App, S = sandbox.__S;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.confirm = async () => true; App.closeModal = () => {}; App.openModal = () => {};
App.migrateDB();
db.run(`INSERT INTO berufsschulen (id,name) VALUES (1,'BS Freiburg'),(2,'BS Offenburg')`);
db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (1,'S2027','Sommer',2027)`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,klassenbezeichnung,lehrjahr) VALUES (1,1,1,'GaLa 3',3),(2,2,1,'Obst 3',3)`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,zustaendiges_amt,ausbildungsstaette) VALUES
  (1,'Adam','A',1,1,1,'93','Betrieb 1'),(2,'Berg','B',1,1,1,'93','Betrieb 2'),(3,'Cato','C',1,2,1,'93','Betrieb 3'),(4,'Dorn','D',1,2,1,'93','Betrieb 4')`);
// Termin 1: Schultermin Klasse 1 (Adam, Berg) – Adam i.O. + Zulassung, Berg abwesend
// Termin 2: Einzelprüfung Berg (Nachholung) + Cato – Berg Mängel, Cato i.O.
// Termin 3: Schultermin Klasse 2 (Cato, Dorn) – nichts erfasst
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status,typ,berufsschule_id,pruefer,bemerkung,durchgefuehrt_datum) VALUES
  (1,'2026-10-01','durchgefuehrt','schulkontrolle',1,'Pix','GaLa 3 Freiburg','2026-10-01'),
  (2,'2026-10-20','durchgefuehrt','einsendung',NULL,'Pix','Nachholung Berg','2026-10-20'),
  (3,'2026-11-05','geplant','schulkontrolle',2,'Zilz','Obst 3 Offenburg','')`);
db.run(`INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (1,1),(3,2)`);
db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (2,2),(2,3)`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,anwesend,ergebnis,zulassung_ap,pruefungsausschuss) VALUES
  (11,1,1,1,'in_ordnung',1,0),(12,1,2,0,'',0,0),(21,2,2,1,'nachholung_naechste_durchsicht',0,0),(22,2,3,1,'in_ordnung',0,0)`);
db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (501,21,2,'nachholung','','offen')`);

let d = S.zeilen([1, 2, 3]);
check(d.termine.length === 3 && d.zeilen.length === 4, 'zeilen(): drei Termine, eine Zeile je Azubi (4 statt 6)');
const berg = d.zeilen.find(z => z.s.id === 2), cato = d.zeilen.find(z => z.s.id === 3);
check(berg && berg.t.id === 2 && berg.ke.ergebnis === 'nachholung_naechste_durchsicht', 'Berg: die Nachholung (jüngste Durchsicht mit Ergebnis) zählt, nicht die Abwesenheit im Schultermin');
check(cato && cato.t.id === 2 && cato.ke.ergebnis === 'in_ordnung', 'Cato: der spätere geplante Termin ohne Ergebnis verdrängt das Ergebnis nicht');
check(d.zeilen.map(z => z.s.nachname).join(',') === 'Adam,Berg,Cato,Dorn', 'Sortiert nach Name');
const html = S._druckHtml(d.zeilen, d.termine, {});
check(/Gemeinsame Übersicht/.test(html) && /3 Termine:/.test(html) && /<th>Durchsicht<\/th>/.test(html) && /20\.10\.2026/.test(html) && (html.match(/<tr style=/g) || []).length === 4, 'Druck: Titel, drei Termine, Spalte Durchsicht, vier Zeilen');
const zul = d.zeilen.filter(z => S._zulassungsrelevant(z));
check(zul.length === 3 && !zul.find(z => z.s.id === 3), 'Zulassungsliste: nur zulassungsrelevante (Cato im Test nicht im letzten Lehrjahr)');
const zh = S._druckHtml(zul, d.termine, { nurZulassung: true });
check(/Zulassungsliste/.test(zh) && /<th>Was fehlt<\/th>/.test(zh) && /Berichtsheft nicht in Ordnung/.test(zh) && /1 Voraussetzung erfüllt/.test(zh) && !/<th title="Anwesend/.test(zh), 'Zulassungsliste: Spalte „Was fehlt“ mit Gründen, Zähler, ohne Anwesenheit');

console.log('\n══ Zusammenführen ══');
check(S._vorschlagZiel([1, 2, 3]) === 1 || S._vorschlagZiel([1, 2, 3]) === 2, 'Vorschlag: ein Termin mit Ergebnissen bleibt');
let v = S.vorschau([1, 2], 1);
check(v.azubis === 3 && v.doppelt === 1 && v.verloren === 0 && v.alleAbgeschlossen === true, 'Vorschau 1+2: 3 Azubis, Berg doppelt, kein Ergebnisverlust (Berg hat in Termin 1 keins), alle abgeschlossen');
v = S.vorschau([1, 2, 3], 1);
check(v.azubis === 4 && v.doppelt === 2 && v.teilsAbgeschlossen === true, 'Vorschau 1+2+3: 4 Azubis, Berg und Cato doppelt, teils abgeschlossen');
const r = await S.zusammenfuehren([1, 2], 1, 'GaLa 3 Freiburg + Nachholung', { ohneRueckfrage: true });
check(r && r.zielId === 1 && r.bewegt === 2 && r.verworfen === 0, 'Zusammenführen 2 → 1: zwei Ergebnisse übernommen');
check(!App.query('SELECT id FROM kontrolltermine WHERE id=2').length, 'Quelle gelöscht');
const t1 = App.query('SELECT * FROM kontrolltermine WHERE id=1')[0];
check(t1.bemerkung === 'GaLa 3 Freiburg + Nachholung' && t1.status === 'durchgefuehrt', 'Ziel: neue Bezeichnung, bleibt abgeschlossen (beide waren abgeschlossen)');
const keBerg = App.query('SELECT * FROM kontrollergebnisse WHERE schueler_id=2');
check(keBerg.length === 1 && keBerg[0].id === 21 && keBerg[0].kontrolltermin_id === 1 && keBerg[0].ergebnis === 'nachholung_naechste_durchsicht', 'Berg: der leere Bogen des Ziels weicht dem Ergebnis der Quelle');
check(App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE id=12') === 0 && App.scalar('SELECT kontrollergebnis_id FROM wiedervorlagen WHERE id=501') === 21, 'Leerer Bogen weg, Wiedervorlage hängt weiter am übernommenen Ergebnis');
check(App.query('SELECT schueler_id FROM kontrolltermin_schueler WHERE kontrolltermin_id=1').map(r => r.schueler_id).sort().join(',') === '2,3' && App.getTerminSchueler(1).length === 3, 'Einzelzuordnungen übernommen: Ziel hat jetzt Adam, Berg, Cato');
check(App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=1 AND schueler_id=3')[0]?.ergebnis === 'in_ordnung', 'Cato mit Ergebnis im Ziel');
// 3 → 1: geplanter Termin dazu → Ziel wird geplant, Cato doppelt mit Ergebnis nur im Ziel
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,anwesend,ergebnis) VALUES (31,3,3,1,'post_an_rp')`);
v = S.vorschau([1, 3], 1);
check(v.verloren === 1, 'Vorschau warnt: Cato hat in beiden Terminen ein Ergebnis');
const r2 = await S.zusammenfuehren([1, 3], 1, '', { ohneRueckfrage: true });
check(r2.verworfen === 1 && App.query('SELECT ergebnis FROM kontrollergebnisse WHERE schueler_id=3')[0].ergebnis === 'in_ordnung' && App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=3') === 1, 'Zwei Ergebnisse: das des Ziels bleibt, das der Quelle wird verworfen');
const t1b = App.query('SELECT * FROM kontrolltermine WHERE id=1')[0];
check(t1b.status === 'geplant' && t1b.nachbereitet_am === '' && App.query('SELECT klasse_id FROM kontrolltermin_klassen WHERE kontrolltermin_id=1').length === 2 && App.getTerminSchueler(1).length === 4, 'Geplanter Termin dazu: Ziel wird geplant, beide Klassen, vier Azubis');

console.log(`\n═══ Ergebnis: ${ok} OK, ${fail} Fehler ═══`);
process.exit(fail ? 1 : 0);
