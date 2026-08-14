// ═══════════════════════════════════════════════════════════════════
//  Globale Filter: Mehrfachauswahl + AP∪ZP-Vereinigung
//  Ausführen:  node tests/filter-test.mjs
//
//  AP-Jahrgänge und ZP-Kohorten sind kombinierbar: Sind beide Dimensionen
//  eingeschränkt, wirkt die Auswahl als VEREINIGUNG (Azubi gehört zu einem
//  gewählten AP-Jahrgang ODER einer gewählten ZP-Kohorte). Getestet werden
//  gf() für alle Entitäten, getStandortgruppen mit Wertelisten und die
//  Mehrfachauswahl im Planungs-Dialog (Quelltext-Zusicherungen).
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
const PLANUNG_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/planung.js'), 'utf8');

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

// ── Testbestand: 2 AP-Jahrgänge, 2 ZP-Kohorten, gemischte Azubis ──
db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES
  (1,'S2027','Sommer',2027),(2,'W2028','Winter',2028),(3,'S2029','Sommer',2029)`);
db.run(`INSERT INTO berufsschulen (id,name) VALUES (1,'BS Nord'),(2,'BS Süd')`);
db.run(`DELETE FROM fachrichtungen`); // migrateDB legt Standard-Fachrichtungen an
db.run(`INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'GL','GaLaBau','Gärtner'),(2,'ZI','Zierpflanzenbau','Gärtner')`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung) VALUES
  (1,1,1,1,'GaLa S2027'),(2,2,2,2,'Zier W2028'),(3,1,3,1,'GaLa S2029')`);
db.run(`INSERT INTO betriebe (id,name,betriebsnummer) VALUES (1,'Gärtnerei A',NULL),(2,'Gärtnerei B',NULL)`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,jahrgang_id,klasse_id,fachrichtung_id,betrieb_id,zwischenpruefung,zustaendiges_amt,bav_status) VALUES
  (1,'Eins','A',1,1,1,1,1,'H2026','FR',''),
  (2,'Zwei','B',1,2,2,2,2,'F2027','KA',''),
  (3,'Drei','C',1,1,1,1,1,'F2027','FR',''),
  (4,'Vier','D',1,3,3,1,2,'H2027','FR',''),
  (5,'Fuenf','E',1,NULL,NULL,NULL,NULL,'','FR','')`);
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,jahrgang_id) VALUES (10,'2026-09-01',1),(20,'2026-09-02',2),(30,'2026-09-03',3)`);
db.run(`INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (10,1),(20,2),(30,3)`);

const ids = (sql) => App.query(sql).map(r => r.id).sort((a, b) => a - b);

console.log('══ gf(schueler): AP und ZP einzeln (wie bisher) ══');
{
  App.filterJahrgang = [1]; App.filterZp = [];
  check(JSON.stringify(ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`)) === '[1,3]',
    'Nur AP S2027 → Azubis 1 und 3');
  App.filterJahrgang = []; App.filterZp = ['F2027'];
  check(JSON.stringify(ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`)) === '[2,3]',
    'Nur ZP F2027 → Azubis 2 und 3');
}

console.log('\n══ gf(schueler): AP + ZP kombiniert = Vereinigung ══');
{
  // Das Nutzer-Szenario: mehrere ZP-Kohorten UND mehrere AP-Jahrgänge zugleich
  App.filterJahrgang = [1, 2]; App.filterZp = ['H2026', 'H2027'];
  const r = ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`);
  check(JSON.stringify(r) === '[1,2,3,4]',
    `AP {S2027,W2028} ∪ ZP {H2026,H2027} → Azubis 1,2,3,4 (bekommen: ${JSON.stringify(r)})`);
  // Eine UND-Verknüpfung hätte hier nur Azubi 1 geliefert (jg 1 UND zp H2026)
  App.filterJahrgang = [2]; App.filterZp = ['H2026'];
  const r2 = ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`);
  check(JSON.stringify(r2) === '[1,2]',
    `AP W2028 ∪ ZP H2026 → Azubis 1 und 2, nicht leer (UND wäre falsch): ${JSON.stringify(r2)}`);
}

console.log('\n══ gf: Sentinels ("Keine") bleiben wirksam ══');
{
  App.filterJahrgang = [-1]; App.filterZp = [];
  check(ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`).length === 0, 'Keine AP → leere Liste');
  App.filterJahrgang = [-1]; App.filterZp = ['H2026'];
  check(JSON.stringify(ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`)) === '[1]',
    'Keine AP + ZP H2026 → nur die ZP-Kohorte (Vereinigung mit leerer Menge)');
}

console.log('\n══ gf: Vereinigung auf allen Entitäten ══');
{
  App.filterJahrgang = [2]; App.filterZp = ['H2026'];
  check(JSON.stringify(ids(`SELECT k.id FROM klassen k WHERE 1=1${App.gf('k')}`)) === '[1,2]',
    'Klassen: GaLa S2027 (über ZP-Schüler) + Zier W2028 (über AP)');
  check(JSON.stringify(ids(`SELECT bs.id FROM berufsschulen bs WHERE 1=1${App.gf('bs')}`)) === '[1,2]',
    'Schulen: beide Standorte betroffen');
  check(JSON.stringify(ids(`SELECT b.id FROM betriebe b WHERE 1=1${App.gf('b')}`)) === '[1,2]',
    'Betriebe: beide Betriebe betroffen');
  check(JSON.stringify(ids(`SELECT kt.id FROM kontrolltermine kt WHERE 1=1${App.gf('kt')}`)) === '[10,20]',
    'Termine: Termin des AP-Jahrgangs + Termin mit ZP-Schülern');
  // Weitere Dimensionen bleiben UND-verknüpft
  App.filterFachrichtungen = [2];
  check(JSON.stringify(ids(`SELECT s.id FROM schueler s WHERE s.aktiv=1${App.gf('s')}`)) === '[2]',
    'Fachrichtung wirkt zusätzlich als UND-Einschränkung');
  App.filterFachrichtungen = [];
  App.filterJahrgang = []; App.filterZp = [];
}

console.log('\n══ getStandortgruppen: Wertelisten + Vereinigung ══');
{
  const alle = App.getStandortgruppen({});
  check(alle.reduce((n, g) => n + g.schueler.length, 0) === 5, 'Ohne Filter: alle 5 Azubis gruppiert');
  const g1 = App.getStandortgruppen({ jahrgangId: [1, 2] });
  check(g1.reduce((n, g) => n + g.schueler.length, 0) === 3, 'Liste von AP-Jahrgängen wird akzeptiert (3 Azubis)');
  const g2 = App.getStandortgruppen({ jahrgangId: 2, zwischenpruefung: ['H2026', 'H2027'] });
  const g2ids = g2.flatMap(g => g.schueler.map(s => s.id)).sort();
  check(JSON.stringify(g2ids) === '[1,2,4]',
    `AP W2028 ∪ ZP {H2026,H2027} → Azubis 1,2,4 (bekommen: ${JSON.stringify(g2ids)})`);
  const g3 = App.getStandortgruppen({ amt: ['FR'], fachrichtungId: [1] });
  check(g3.flatMap(g => g.schueler.map(s => s.id)).sort().join(',') === '1,3,4',
    'Amt- und Fachrichtungs-Listen wirken als UND');
}

console.log('\n══ Quelltext-Zusicherungen: keine Exklusivität mehr, Planung mehrfach ══');
{
  check(!/deaktiviert/.test(APP_SRC.match(/refreshJgDropdown\(\) \{[\s\S]*?\n  \},/)[0]),
    'Jahrgangs-Dropdown kennt keinen Exklusiv-Modus mehr');
  check(/_applyJgZp\(\)/.test(APP_SRC), 'Kombinierte AP/ZP-Übernahme vorhanden');
  check(/jgHit \|\| zpHit/.test(PLANUNG_SRC), 'Planung: AP/ZP-Vereinigung in der Klassenliste');
  check(/_terminFilterHtml\(/.test(PLANUNG_SRC) && /chk-tf-/.test(PLANUNG_SRC),
    'Planung: Termin-Dialog nutzt Mehrfachauswahl-Filter');
  check((PLANUNG_SRC.match(/this\._terminFilterHtml\(jahrgaenge/g) || []).length === 2,
    'Mehrfachauswahl in BEIDEN Dialogen (Neu + Bearbeiten)');
  check(!/option value="">Abschlussprüfung: Alle/.test(PLANUNG_SRC),
    'Alte Einfachauswahl-Selects sind entfernt');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
