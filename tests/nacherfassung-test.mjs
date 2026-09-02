// ═══════════════════════════════════════════════════════════════════
//  Nacherfassung: „geprüft bis KW", pauschale Fehltage, AJ-Zuordnung,
//  Termin-Wiederverwendung, Archiv-Snapshot
//  Ausführen:  node tests/nacherfassung-test.mjs
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
const NE_SRC = read('src/js/modules/nacherfassung.js');

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
  UndoManager: { push() {}, clear() {} },
  esc: (x) => String(x ?? ''), todayStr: () => '2026-09-15', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '',
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/azubi-rechner.js', 'AzubiRechner'],
                         ['src/js/modules/kontrolle.js', 'KontrolleHandler'],
                         ['src/js/modules/kw-nav.js', 'KWNav'],
                         ['src/js/modules/nacherfassung.js', 'NacherfassungHandler']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, KontrolleHandler, KWNav, NacherfassungHandler: NE } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();
KontrolleHandler.renderSchueler = () => {}; KontrolleHandler.renderUebersicht = () => {};
KontrolleHandler.activePruefer = 'Test';

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const geprueft = (sid, aj) => App.query('SELECT kalenderwoche FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND geprueft=1 ORDER BY kalenderwoche', [sid, aj]).map(r => r.kalenderwoche);

// ── Testbestand: Azubi seit 09/2024 (3 AJ), Schule, Klasse ──
db.run(`INSERT INTO berufsschulen (id,name) VALUES (1,'BS Test')`);
db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (1,'S2027','Sommer',2027)`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,klassenbezeichnung) VALUES (1,1,1,'GaLa')`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,ausbildungsbeginn,ausbildungsende,zustaendiges_amt) VALUES
  (1,'Nach','Erfasst',1,1,1,'2024-09-01','2027-08-31','93')`);
const s = App.query('SELECT * FROM schueler WHERE id=1')[0];

console.log('══ AJ/KW-Zuordnung zum Stichtag ══');
{
  check(App.getAJAtDate('2024-09-01', '2026-09-15', 1) === 3, 'September 2026 → 3. Ausbildungsjahr');
  check(App.getAJAtDate('2024-09-01', '2025-05-10', 1) === 1, 'Mai 2025 → 1. Ausbildungsjahr');
  const z1 = App.ajKwFuerStichtag(1, '2026-09-15', 37);
  check(z1 && z1.aj === 3 && z1.kw === 37, `KW 37 bei Durchsicht 15.09.2026 → AJ3 (${JSON.stringify(z1)})`);
  const z2 = App.ajKwFuerStichtag(1, '2026-09-15', 30);
  check(z2 && z2.aj === 2 && z2.kw === 30, `KW 30 bei Durchsicht 15.09.2026 → VORJAHR AJ2 (${JSON.stringify(z2)})`);
  const z3 = App.ajKwFuerStichtag(1, '2026-03-10', 8);
  check(z3 && z3.aj === 2 && z3.kw === 8, `KW 8 bei Durchsicht 10.03.2026 → AJ2 (${JSON.stringify(z3)})`);
  check(App.ajKwFuerStichtag(1, '2026-03-10', 0) === null && App.ajKwFuerStichtag(1, '2026-03-10', 99) === null, 'Ungültige KW → null');
}

console.log('\n══ Geprüft bis KW: alle Wochen davor werden markiert (Kaskade über AJs) ══');
{
  const terminId = NE._terminFuer('2026-03-10', 1, 'Test', 1);
  check(terminId > 0, 'Nacherfassungs-Termin angelegt');
  const t = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
  check(t.status === 'durchgefuehrt' && t.berufsschule_id === 1 && /^Nacherfassung/.test(t.bemerkung), `Termin: durchgeführt, Schule gesetzt, Titel "${t.bemerkung}"`);
  const keId = NE.erfasseAzubi(terminId, s, { ergebnis: 'in_ordnung', codes: '', bemerkung: '', wvDate: '', fehltageGesamt: null, bisKW: 8 }, '2026-03-10', 'Test');
  check(keId > 0, 'Kontrollergebnis angelegt');
  const aj2 = geprueft(1, 2);
  check(aj2.includes(36) && aj2.includes(52) && aj2.includes(1) && aj2.includes(8) && !aj2.includes(9),
    `AJ2: KW 36…52 + 1…8 geprüft, KW 9 nicht (${aj2.length} Wochen)`);
  const aj1 = geprueft(1, 1);
  check(aj1.length >= 50, `AJ1 (früheres Ausbildungsjahr) komplett kaskadiert (${aj1.length} Wochen)`);
  const ke = App.query('SELECT * FROM kontrollergebnisse WHERE id=?', [keId])[0];
  const sess = JSON.parse(ke.geprueft_kws || '{}');
  check(Array.isArray(sess['2']) && sess['2'].includes(8), 'Session-Tracking (geprueft_kws) wie in der Live-Kontrolle gefüllt');
  check(App.scalar('SELECT COUNT(*) FROM kontrolltermin_schueler WHERE kontrolltermin_id=? AND schueler_id=1', [terminId]) === 1, 'Azubi einzeln an den Termin gebunden');
  check(App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE kontrollergebnis_id=?', [keId]) === 1, 'Archiv-Snapshot angelegt');
  check(ke.durchsicht_nr === 1, 'Durchsichtsnummer 1');
}

console.log('\n══ Pauschale Fehltage ohne 7er-Deckel, kombiniert mit KW-genauen Einträgen ══');
{
  const terminId = NE._terminFuer('2026-09-15', 1, 'Test', 1);
  const keId = NE.erfasseAzubi(terminId, s, { ergebnis: 'nachholung_naechste_durchsicht', codes: 'A,F', bemerkung: 'nachgetragen', wvDate: '2026-10-13', fehltageGesamt: 23, bisKW: 36 }, '2026-09-15', 'Test');
  const ke = App.query('SELECT * FROM kontrollergebnisse WHERE id=?', [keId])[0];
  check(ke.fehltage_gesamt === 23, `Fehltage gesamt = 23 (kein Deckel bei 7): ${ke.fehltage_gesamt}`);
  check(ke.fehltage_pauschal === 23, 'Pauschalanteil am Kontrollergebnis gespeichert');
  check(App.scalar("SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=1") === 0, 'Keine einzelne KW trägt die pauschalen Fehltage');
  check(ke.durchsicht_nr === 2, 'Durchsichtsnummer zählt hoch (2)');
  check(App.scalar('SELECT maengel_codes FROM kw_status WHERE schueler_id=1 AND ausbildungsjahr=3 AND kalenderwoche=36') === 'A,F', 'Codes an der zuletzt geprüften KW (AJ3/KW36)');
  check(App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id=?', [keId]) === 1, 'Wiedervorlage angelegt');
  // Später wochengenau 2 Fehltage in KW 37 → Gesamt 25
  KWNav.persistCodes(keId, 3, 37, 'H', 2, 1, true);
  check(App.scalar('SELECT fehltage_gesamt FROM kontrollergebnisse WHERE id=?', [keId]) === 25, 'Wochengenaue Fehltage kommen obendrauf (23 + 2 = 25)');
  // Erneute Nacherfassung mit Gesamtstand 30 → Pauschal = 30 − 2
  NE.erfasseAzubi(terminId, s, { ergebnis: 'in_ordnung', codes: '', bemerkung: '', wvDate: '', fehltageGesamt: 30, bisKW: 38 }, '2026-09-15', 'Test');
  const ke2 = App.query('SELECT * FROM kontrollergebnisse WHERE id=?', [keId])[0];
  check(ke2.fehltage_pauschal === 28 && ke2.fehltage_gesamt === 30, `Neuer Gesamtstand 30 → pauschal 28 + KW 2 (${ke2.fehltage_pauschal}/${ke2.fehltage_gesamt})`);
  check(ke2.ergebnis === 'in_ordnung', 'Erneutes Speichern aktualisiert das Ergebnis statt zu doppeln');
  check(App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=1', [terminId]) === 1, 'Nur EIN Kontrollergebnis je Termin und Azubi');
}

console.log('\n══ Termin-Wiederverwendung + Übernahme in Folge-Kontrolle ══');
{
  const a = NE._terminFuer('2026-09-15', 1, 'Test', null);
  const b = NE._terminFuer('2026-09-15', 1, 'Test', null);
  check(a === b, 'Gleiche Schule + Datum → derselbe Nacherfassungs-Termin');
  check(NE._terminFuer('2026-09-16', 1, 'Test', null) !== a, 'Anderes Datum → neuer Termin');
  // Nächste Live-Kontrolle übernimmt fehltage_pauschal
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (900,'2026-12-01','geplant')`);
  const prev = App.query(`SELECT ke.* FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=1 AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`)[0];
  App.run(`INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,fehltage_gesamt,fehltage_pauschal,durchsicht_nr) VALUES (?,?,?,?,?,?)`,
    [900, 1, '{}', prev.fehltage_gesamt || 0, prev.fehltage_pauschal || 0, (prev.durchsicht_nr || 0) + 1]);
  const neu = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=900 AND schueler_id=1')[0];
  KontrolleHandler.autoUpdateFehltage(1, neu.id);
  check(App.scalar('SELECT fehltage_gesamt FROM kontrollergebnisse WHERE id=?', [neu.id]) === 30, 'Folge-Kontrolle: Gesamt bleibt 30 (pauschal 28 + KW 2) nach Neuberechnung');
  KontrolleHandler.setFehltagePauschal(1, neu.id, 10);
  check(App.scalar('SELECT fehltage_gesamt FROM kontrollergebnisse WHERE id=?', [neu.id]) === 12, 'Pauschalwert in der Live-Kontrolle korrigierbar (10 + 2 = 12)');
}

console.log('\n══ Quelltext + Migrations-Parität ══');
{
  check(!/Math\.min\(7,/.test(NE_SRC), 'Kein 7-Tage-Deckel mehr in der Nacherfassung');
  check(/KWNav\.persistCodes\(keId, ziel\.aj, ziel\.kw/.test(NE_SRC), 'Nacherfassung nutzt die Markier-Logik der Live-Kontrolle');
  check(!/App\.gf\('schueler'\)/.test(NE_SRC.split('_updateNichtErfasst')[0]), 'Erfassungsliste ohne globale Filter (fremde Ämter wählbar)');
  const diskDb = new SQL.Database();
  diskDb.run(`CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY AUTOINCREMENT, kontrolltermin_id INTEGER, schueler_id INTEGER, ergebnis TEXT DEFAULT '')`);
  for (const t of ['schueler','kontrolltermine','berufsschulen','klassen','abschlussjahrgaenge','fachrichtungen','wiedervorlagen']) diskDb.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  App._migrateDiskDb(diskDb);
  const cols = []; const st = diskDb.prepare('PRAGMA table_info(kontrollergebnisse)'); while (st.step()) cols.push(st.getAsObject().name); st.free();
  check(cols.includes('fehltage_pauschal'), 'fehltage_pauschal auch auf der Disk-Datenbank');
  diskDb.close();
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
