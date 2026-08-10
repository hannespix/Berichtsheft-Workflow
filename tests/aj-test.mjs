// ═══════════════════════════════════════════════════════════════════
//  Ausbildungsjahr- und KW-Raster-Logik
//  Ausführen:  node tests/aj-test.mjs
//
//  Fachliche Regel: Die Anzahl der Ausbildungsjahre ergibt sich aus der
//  VERTRAGSDAUER, nicht aus überspannten Kalender-Schuljahren. Eine feste
//  Schuljahresgrenze (Sep oder Aug) kann 1.8.- und 1.9.-Verträge nicht
//  gleichzeitig korrekt zählen.
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
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, Promise,
  TextEncoder, TextDecoder, Uint8Array, Set, Map,
  document: { getElementById: el, createElement: el, querySelectorAll: () => [], addEventListener() {}, hidden: false,
    body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, KontrolleHandler: { activePruefer: 'test' }, TableSort: { init() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
// AzubiRechner mitladen – getSchuelerAJs leitet das Vertragsende aus Phasen ab
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/modules/azubi-rechner.js'), 'utf8'), sandbox, { filename: 'azubi-rechner.js' });
const App = sandbox.__App;
App.db = db;
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

const ID = 900001;
function setAV(beginn, ende, extra = {}) {
  db.run('DELETE FROM schueler WHERE id=?', [ID]);
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende,regulaer_dauer_monate,verkuerzung_monate)
          VALUES (?,?,?,1,?,?,?,?)`,
    [ID, 'Test', 'Fall', beginn, ende, extra.dauer ?? 36, extra.verkuerzung ?? 0]);
}

console.log('══ Anzahl Ausbildungsjahre (Regelverträge) ══');
const faelle = [
  ['2023-09-01', '2026-08-31', 3, '3 Jahre, Beginn 1.9.'],
  ['2023-08-01', '2026-07-31', 3, '3 Jahre, Beginn 1.8.'],
  ['2023-07-01', '2026-06-30', 3, '3 Jahre, Beginn 1.7.'],
  ['2024-03-01', '2027-02-28', 3, '3 Jahre, Beginn 1.3.'],
  ['2023-08-15', '2026-08-14', 3, '3 Jahre, Beginn Monatsmitte'],
  ['2023-09-01', '2025-08-31', 2, 'Verkürzt auf 2 Jahre, Beginn 1.9.'],
  ['2023-08-01', '2025-07-31', 2, 'Verkürzt auf 2 Jahre, Beginn 1.8.'],
  ['2024-09-01', '2026-02-28', 2, 'Verkürzt auf 1,5 Jahre'],
  ['2023-09-01', '2027-02-28', 4, 'Verlängert auf 3,5 Jahre'],
  ['2023-09-01', '2027-08-31', 4, 'Verlängert auf 4 Jahre'],
];
for (const [b, e, soll, label] of faelle) {
  setAV(b, e);
  const ajs = App.getSchuelerAJs(ID);
  check(ajs.length === soll, `${label}: ${ajs.length} Raster (erwartet ${soll}) [${ajs}]`);
}

console.log('\n══ Verkürzer starten im höheren Ausbildungsjahr ══');
setAV('2023-09-01', '2025-08-31');
check(JSON.stringify(App.getSchuelerAJs(ID)) === '[2,3]', '2-Jahres-Vertrag → Raster [2,3]');
setAV('2024-09-01', '2025-08-31');
check(JSON.stringify(App.getSchuelerAJs(ID)) === '[3]', '1-Jahres-Vertrag → Raster [3]');
setAV('2023-09-01', '2026-08-31');
check(JSON.stringify(App.getSchuelerAJs(ID)) === '[1,2,3]', '3-Jahres-Vertrag → Raster [1,2,3]');

console.log('\n══ Verkürzung wird berücksichtigt (Phasen-Azubi) ══');
{
  // Azubi mit offener Phase + 12 Monaten Verkürzung: Soll-Ende = Beginn + 24 Monate
  setAV('2025-09-01', '', { dauer: 36, verkuerzung: 12 });
  db.run('DELETE FROM ausbildungsphasen WHERE schueler_id=?', [ID]);
  db.run(`INSERT INTO ausbildungsphasen (schueler_id,von,bis,typ,teilzeit_prozent) VALUES (?,?,NULL,'ausbildung',100)`, [ID, '2025-09-01']);
  const ajs = App.getSchuelerAJs(ID);
  check(ajs.length === 2, `12 Monate Verkürzung → ${ajs.length} Raster (erwartet 2) [${ajs}]`);
  db.run('DELETE FROM ausbildungsphasen WHERE schueler_id=?', [ID]);
}

console.log('\n══ KW-Raster deckt den gesamten Vertragszeitraum ab ══');
for (const [b, e, label] of [['2023-09-01','2026-08-31','Sep-Vertrag'], ['2023-08-01','2026-07-31','Aug-Vertrag']]) {
  setAV(b, e);
  const ajs = App.getSchuelerAJs(ID);
  const bounds = App.getAJKWBounds(ID);
  let aktiv = 0;
  ajs.forEach(aj => {
    const bd = bounds[aj];
    if (bd) aktiv += 52 - (bd.inactiveKWs?.length || 0);
  });
  // 3 Jahre ≈ 156 Wochen; Toleranz für Rand-KWs
  check(aktiv >= 145 && aktiv <= 160, `${label}: ${aktiv} aktive Wochen über alle Raster (erwartet ~156)`);
}

console.log('\n══ Randfälle ══');
setAV('2023-09-01', '');
check(App.getSchuelerAJs(ID).length === 3, 'Ohne Ausbildungsende → 3 Raster (Regelannahme)');
db.run('DELETE FROM schueler WHERE id=?', [ID]);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende) VALUES (?,?,?,1,'','')`, [ID, 'Ohne', 'Daten']);
check(App.getSchuelerAJs(ID).length === 3, 'Ohne Ausbildungsdaten → 3 Raster (Regelannahme)');
setAV('2026-08-31', '2023-09-01');
check(App.getSchuelerAJs(ID).length >= 1, 'Ende vor Beginn → mindestens 1 Raster, kein Absturz');

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
