// ═══════════════════════════════════════════════════════════════════
//  Namenssuche tolerant gegen Groß/Klein, Umlaute und ß
//  Feldfall: Azubi „Weiß“ ließ sich keinem Termin hinzufügen. SQLite
//  vergleicht bei LIKE nur ASCII ohne Groß/Klein („ärmel“ ≠ „Ärmel“,
//  „weiss“ ≠ „Weiß“), und die Trefferlisten wurden vor dem Filtern nach
//  10 bzw. 50 Zeilen (nach Namen sortiert) abgeschnitten.
//  Ausführen:  node tests/namenssuche-test.mjs
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
const P = read('src/js/modules/planung.js'), K = read('src/js/modules/kontrolle.js'), ST = read('src/js/modules/stammdaten.js'), V = read('src/js/modules/views.js');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const el = (id) => ({ id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => '2026-11-20', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).slice(0, 10).split('-').reverse().join('.') : '–', svgIcon: () => '', Papa: {}, XLSX: {},
  Views: {}, SchuelerView: { render() {} }, SchuelerAkte: { getCount: () => 0 }, GlobalSearch: {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(ST + '\n;globalThis.StammdatenTab = StammdatenTab;', sandbox, { filename: 'stammdaten.js' });
const { __App: App, StammdatenTab } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();

console.log('══ Normalformen ══');
{
  check(App.suchNorm('Weiß') === 'weiss' && App.suchNorm('WEISS') === 'weiss' && App.suchNorm('Weiẞ') === 'weiss', '„Weiß“, „WEISS“ und „Weiẞ“ (großes ß) ergeben dieselbe Form');
  check(App.suchNorm('Ärmel') === 'aermel' && App.suchNorm2('Ärmel') === 'armel' && App.suchNorm('Müller') === 'mueller' && App.suchNorm2('Müller') === 'muller', 'Umlaute in beiden Formen: ä→ae und ä→a');
  check(App.suchNorm('Müller') === App.suchNorm('Müller') && App.suchNorm('José') === 'jose' && App.suchNorm('  Weiß  ') === 'weiss', 'Zerlegte Umlaute, Akzente und geschützte Leerzeichen stören nicht');
  const w = (q) => App.suchWoerter(q);
  const passt = (name, q) => App.suchPasst(App.suchText(name), w(q));
  check(passt('Weiß', 'weiss') && passt('Weiß', 'weiß') && passt('Weiß', 'WEISS') && passt('Weiss', 'weiß') && passt('Weiß', 'wei'), '„weiss“ findet „Weiß“ und umgekehrt, auch als Wortanfang');
  check(passt('Ärmel', 'ärmel') && passt('Ärmel', 'aermel') && passt('Ärmel', 'armel') && passt('Müller', 'MÜLLER') && passt('Müller', 'mueller') && passt('Müller', 'muller'), 'Umlaut am Wortanfang klein getippt, ae/ue-Schreibweise, Großbuchstaben');
  check(App.suchPasst(App.suchText('Weiß', 'Jonas', 'Gärtnerei Grün'), w('jonas weiss')) && App.suchPasst(App.suchText('Weiß', 'Jonas', 'Gärtnerei Grün'), w('gruen, weiß')) && !App.suchPasst(App.suchText('Weiß', 'Jonas'), w('weiss max')), 'Mehrere Wörter: alle müssen vorkommen, Reihenfolge egal');
  check(!passt('Weis', 'weiss') && !passt('Weber', 'weiss') && w('  ').length === 0, 'Andere Namen bleiben verschieden; leere Eingabe ohne Wörter');
}

console.log('\n══ Azubis suchen und ordnen (ohne Abschneiden vor dem Filtern) ══');
{
  // 60 Azubis, deren Betrieb „Weinbau“ heißt, dazu einer namens Weiß am Ende des Alphabets
  const liste = [];
  for (let i = 0; i < 60; i++) liste.push({ id: i + 1, nachname: 'Ackermann' + String(i).padStart(2, '0'), vorname: 'Anna', betrieb: 'Weinbau Sonne' });
  liste.push({ id: 100, nachname: 'Weiß', vorname: 'Jonas', betrieb: 'Gärtnerei Grün' }, { id: 101, nachname: 'Schweiß', vorname: 'Tim', betrieb: '' }, { id: 102, nachname: 'Berg', vorname: 'Weißgerber', betrieb: '' });
  const felder = s => [s.betrieb];
  const r = App.azubiSuche(liste, 'wei', felder);
  check(r.length === 63 && r[0].id === 100 && r[1].id === 101 && r[2].id === 102 && r[3].nachname === 'Ackermann00', 'Rang: Nachname beginnt mit dem Wort → Nachname enthält es → Vorname → andere Felder');
  check(App.azubiSuche(liste, 'weiss', felder).map(s => s.id).join() === '100,101,102' && App.azubiSuche(liste, 'Weiß Jonas', felder).map(s => s.id).join() === '100' && App.azubiSuche(liste, 'gruen', felder).map(s => s.id).join() === '100', '„weiss“ findet Weiß trotz 60 anderer „wei“-Treffer; Vor- und Nachname zusammen; Betrieb mit ue');
  check(App.azubiSuche(liste, '', felder).length === 0 && App.azubiSuche(null, 'x').length === 0, 'Ohne Eingabe oder Liste keine Treffer');
}

console.log('\n══ Azubi-Liste der Stammdaten (SQL-LIKE mit Schreibweisen) ══');
{
  const v = (t) => App.suchVarianten(t);
  check(v('weiss').includes('weiß') && v('weiß').some(x => x.toLowerCase() === 'weiss') && v('ärmel').some(x => x.charAt(0) === 'Ä') && v('MÜLLER').includes('müller') && v('mueller').some(x => x.toLowerCase() === 'müller'), 'Schreibweisen: ß ↔ ss, Umlaut groß/klein, ue ↔ ü');
  check(v('berg').length === 1 && v('').length === 0 && v('weiß').length <= 8 && !v('weiß').some(x => x.includes('ẞ')), 'Reine ASCII-Wörter bleiben ein Muster; höchstens acht Schreibweisen; kein großes ß');
  db.run("INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsstaette) VALUES (1,'Weiß','Jonas',1,'Gärtnerei Grün'),(2,'Ärmel','Öznur',1,'Baumschule Süd'),(3,'Müller','Max',1,''),(4,'Weiss','Wanda',1,''),(5,'Berg','Bea',1,'Über den Bergen')");
  const finde = (q) => { const k = StammdatenTab._azubiSuchKlausel(q); return App.query(`SELECT s.id ${StammdatenTab._AZUBI_FROM} WHERE 1=1${k.sql} ORDER BY s.id`, k.params).map(r => r.id).join(); };
  check(finde('weiss') === '1,4' && finde('Weiß') === '1,4' && finde('WEISS') === '1,4', `„weiss“, „Weiß“ und „WEISS“ finden beide Schreibweisen (${finde('weiss')})`);
  check(finde('ärmel') === '2' && finde('aermel') === '2' && finde('öznur') === '2' && finde('MÜLLER') === '3' && finde('mueller') === '3' && finde('über') === '5', 'Umlaut am Wortanfang klein getippt, ae/ue-Schreibweise, Großbuchstaben');
  check(finde('jonas weiss') === '1' && finde('gruen') === '1' && finde('xyz') === '' && finde('') === '1,2,3,4,5', 'Mehrere Wörter (UND), Betrieb mit ue, kein Treffer, leere Suche');
  const k = StammdatenTab._azubiSuchKlausel('berg');
  check(k.tokens.join() === 'berg' && k.params.length === 17 && (k.sql.match(/ AND \(/g) || []).length === 1, 'ASCII-Wort: ein Muster je Feld wie bisher');
}

console.log('\n══ Verdrahtung ══');
{
  const pl = P.split('  _searchEinsendSchueler(q) {')[1].split('  _addEinsendSchueler(id) {')[0];
  check(/App\.azubiSuche\(this\._einsendSchuelerData, q, s => \[s\.betrieb_display, s\.ausbildungsstaette, s\.ibykus_id\]\)/.test(pl) && !/toLowerCase\(\)\.includes\(ql\)/.test(pl) && /EINSEND_TREFFER_MAX: 20,/.test(P), 'Termin-Dialog „Einzelne Azubis hinzufügen“: tolerante Suche, bis 20 Treffer');
  check(/treffer\.slice\(0, this\.EINSEND_TREFFER_MAX\)/.test(pl) && /weitere Treffer – bitte genauer eingeben/.test(pl) && /schon ausgewählt/.test(pl) && /inaktive\$\{inaktiv === 1 \? 'r' : ''\} Azubi mit diesem Namen/.test(pl), 'Erst filtern, dann kürzen; „weitere Treffer“; Erklärung bei schon gewählten oder inaktiven Azubis');
  const ko = K.split('  _liveSearchSchueler(query) {')[1].split('  // Add existing student from another class')[0];
  check(/App\.azubiSuche\(alleAzubis\.filter\(s => s\.aktiv\), q, felder\)/.test(ko) && !/LIKE \?/.test(ko) && !/LIMIT 50/.test(ko) && /gesamt\.slice\(0, this\.ADD_TREFFER_MAX\)/.test(ko), 'Durchsicht „+ Azubi hinzufügen“: tolerante Suche über alle aktiven Azubis, kein LIMIT vor dem Filtern');
  check(/bereits in dieser Durchsicht/.test(ko) && /inaktive\$\{inaktiv === 1 \? 'r' : ''\} Azubi mit diesem Namen/.test(ko) && /\$\{gesamt\.length\} Treffer/.test(ko), 'Erklärung, wenn Treffer schon im Termin stehen oder inaktiv sind; Zahl aller Treffer');
  check(/App\.suchVarianten \? App\.suchVarianten\(token\) : \[token\]/.test(ST), 'Azubi-Liste nutzt die Schreibweisen');
  check(/„weiss“ findet „Weiß“/.test(V), 'Hilfe nennt die tolerante Namenssuche');
}

console.log(`\n${failed ? '✗' : '✓'} ${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
