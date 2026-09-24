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
// Phasen mitladen – getSchuelerAJs leitet das Vertragsende aus Phasen ab
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js/modules/phasen.js'), 'utf8'), sandbox, { filename: 'phasen.js' });
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
  ['2023-07-01', '2026-06-30', 4, '3 Jahre, Beginn 1.7. (überspannt vier Schuljahre)'],
  ['2024-03-01', '2027-02-28', 4, '3 Jahre, Beginn 1.3. (überspannt vier Schuljahre)'],
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

console.log('\n══ Verkürzer und Nicht-September-Beginner: Raster, Schuljahre, laufendes Jahr ══');
{
  const heute = new Date();
  const jahr = heute.getFullYear();
  // Verkürzer auf 2 Jahre, Beginn 1.9. vor einem Jahr: heute im zweiten Rasterjahr = AJ 3
  const sj = heute.getMonth() >= 8 ? jahr : jahr - 1;
  setAV(`${sj - 1}-09-01`, `${sj + 1}-08-31`, { verkuerzung: 12 });
  check(JSON.stringify(App.getSchuelerAJs(ID)) === '[2,3]', 'Zweijähriger Verkürzer: Raster [2,3]');
  check(App.getCurrentAJ(`${sj - 1}-09-01`, ID) === 3, `Verkürzer im zweiten Rasterjahr: laufendes Ausbildungsjahr 3 (${App.getCurrentAJ(`${sj - 1}-09-01`, ID)})`);
  check(App.getAJAtDate(`${sj - 1}-09-01`, `${sj}-10-15`, ID) === 3 && App.getAJAtDate(`${sj - 1}-09-01`, `${sj - 1}-10-15`, ID) === 2, 'Stichtag im zweiten Jahr → AJ 3, im ersten → AJ 2');
  const st = App.ajKwFuerStichtag(ID, new Date(sj, 9, 15), 40);
  check(st && st.aj === 3 && st.kw === 40, `„Geprüft bis KW 40“ zum Stichtag im zweiten Jahr landet im Raster 3 (${st && st.aj})`);
  // Beginn 1.8.: Raster tragen das Schuljahr des Vertrags, nicht das Vorjahr
  setAV('2025-08-01', '2028-07-31');
  let b = App.getAJKWBounds(ID);
  check(b[1].schoolYear === '2025/26' && b[3].schoolYear === '2027/28' && App.getSchuelerAJs(ID).length === 3, `Beginn 1.8.2025: Raster 2025/26 … 2027/28 (${b[1].schoolYear} … ${b[3].schoolYear})`);
  check(App.getAJAtDate('2025-08-01', '2026-10-15', ID) === 2 && App.getAJAtDate('2025-08-01', '2026-08-15', ID) === 1, 'Beginn 1.8.: Oktober 2026 → AJ 2, August 2026 → noch AJ 1 (Augustwochen am Rasterende)');
  // Beginn 1.3.: vier Schuljahr-Raster, das letzte deckt das Vertragsende
  setAV('2025-03-01', '2028-02-28');
  b = App.getAJKWBounds(ID);
  const ajs = App.getSchuelerAJs(ID);
  check(ajs.length === 4 && b[4].schoolYear === '2027/28' && b[4].endKW === 9 && b[1].startKW === 9, `Beginn 1.3.2025: vier Raster bis 2027/28, letztes endet KW 9 (${ajs}, ${b[4] && b[4].schoolYear})`);
  check(App.getAJAtDate('2025-03-01', '2027-10-15', ID) === 4, 'Oktober 2027 liegt im vierten Raster');
  // Verkürzer ab 1.3.: [2,3,4] – Kennungen bestehender Raster bleiben, ein Raster kommt hinzu
  setAV('2026-03-01', '2028-02-28', { verkuerzung: 12 });
  check(JSON.stringify(App.getSchuelerAJs(ID)) === '[2,3,4]', 'Verkürzer ab 1.3.: Raster [2,3,4]');
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
