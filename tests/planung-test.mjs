// ═══════════════════════════════════════════════════════════════════
//  Kontrollplanung: Schultermin-Workflow
//  Ausführen:  node tests/planung-test.mjs
//
//  Der reale Ablauf: Termine finden AN einzelnen Berufsschulen statt;
//  kontrolliert werden dort ALLE anwesenden Azubis (definierte Menge über
//  kontrolltermin_schueler) – auch Landesfachklassen-Gäste und Azubis mit
//  fremdem zuständigen Amt. Deren Ergebnisse werden anschließend je Amt an
//  die zuständigen Ausbildungsberater weitergegeben.
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
const KONTROLLE_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/kontrolle.js'), 'utf8');
const NACHERF_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/nacherfassung.js'), 'utf8');
const PDF_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/pdf-export.js'), 'utf8');
const WORKFLOWS_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/workflows.js'), 'utf8');

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

// ── Testbestand: 2 Schulen, LFK, gemischte Ämter und Lehrjahre ──
db.run(`DELETE FROM fachrichtungen`);
db.run(`INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'GL','GaLaBau','Gärtner'),(2,'OB','Obstbau','Gärtner')`);
db.run(`INSERT INTO berufsschulen (id,name) VALUES (1,'BS Freiburg'),(2,'BS Heidelberg')`);
db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (1,'S2027','Sommer',2027),(2,'W2028','Winter',2028)`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung,lehrjahr) VALUES
  (1,1,1,1,'GaLa 2',2),(2,1,2,2,'Obst 2',2),(3,1,2,1,'GaLa 1',1)`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,fachrichtung_id,zustaendiges_amt,zwischenpruefung) VALUES
  (1,'Eigen','A',1,1,1,1,'93','H2026'),
  (2,'Fremd','B',1,1,1,1,'94','H2026'),
  (3,'Gast','C',1,2,2,2,'76',''),
  (4,'Inaktiv','D',0,1,1,1,'93',''),
  (5,'Erstes','E',1,3,1,1,'93','')`);

console.log('══ gf(termine): Termine ohne Klassen bleiben unter Filtern sichtbar ══');
{
  // Einsendungs-Termin: NUR Einzelschüler (der klassische Fall, der verschwand)
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,typ) VALUES (10,'2026-11-20','einsendung')`);
  db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (10,2)`);
  // Klassen-Termin als Kontrast
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,jahrgang_id) VALUES (20,'2026-11-21',1)`);
  db.run(`INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (20,1)`);
  const ids = () => App.query(`SELECT kt.id FROM kontrolltermine kt WHERE 1=1${App.gf('kt')}`).map(r => r.id).sort((a, b) => a - b);
  App.filterAmt = ['94'];
  check(JSON.stringify(ids()) === '[10,20]', 'Amt-Filter 94: Einsendung (über Einzelschüler) UND Klassen-Termin sichtbar');
  App.filterAmt = ['93'];
  check(ids().includes(20) && !ids().includes(10), 'Amt-Filter 93: Klassen-Termin ja, 94er-Einsendung nein (korrekt)');
  App.filterAmt = [];
  App.filterFachrichtungen = [1];
  check(JSON.stringify(ids()) === '[10,20]', 'Fachrichtungs-Filter: Einsendung über den Einzelschüler weiterhin sichtbar');
  App.filterFachrichtungen = [];
  App.filterJahrgang = [1];
  check(JSON.stringify(ids()) === '[10,20]', 'Jahrgangs-Filter: Einsendung matcht über den Einzelschüler (jahrgang_id des Termins ist NULL)');
  App.filterJahrgang = [];
}

console.log('\n══ getTerminSchueler: definierte Azubi-Menge des Termins ══');
{
  // Klassen-Termin 20: Klasse 1 hat Azubi 1 (93), 2 (94), 4 (inaktiv)
  let liste = App.getTerminSchueler(20).map(s => s.id).sort();
  check(JSON.stringify(liste) === '[1,2]', `Klassen-Termin: nur AKTIVE Klassenmitglieder (inkl. fremdes Amt): ${JSON.stringify(liste)}`);
  // Ad-hoc kontrollierter Gast (nur KE, kein kts) muss enthalten sein
  db.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis) VALUES (20,3,'in_ordnung')`);
  liste = App.getTerminSchueler(20).map(s => s.id).sort();
  check(liste.includes(3), 'Ad-hoc kontrollierter Gast (nur Kontrollergebnis) erscheint in der Terminliste/Exporten');
  // Inaktiver mit dokumentiertem Ergebnis bleibt ebenfalls
  db.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis) VALUES (20,4,'post_an_rp')`);
  liste = App.getTerminSchueler(20).map(s => s.id).sort();
  check(liste.includes(4), 'Inzwischen inaktiver Azubi mit erfasstem Ergebnis bleibt dem Termin erhalten');
}

console.log('\n══ getTerminSchule: Ort des Termins ══');
{
  check(App.getTerminSchule(20)?.name === 'BS Freiburg', 'Fallback: Stammschule der ersten Klasse');
  db.run(`UPDATE kontrolltermine SET berufsschule_id=2 WHERE id=20`);
  App.invalidateTerminCache && App.invalidateTerminCache();
  check(App.getTerminSchule(20)?.name === 'BS Heidelberg', 'Explizites berufsschule_id (z.B. LFK-Standort) hat Vorrang');
  check(App.getTerminSchule(10) === null || App.getTerminSchule(10) === undefined || App.getTerminSchule(10) === null,
    'Einsendung ohne Ort → keine (falsche) Schule');
  db.run(`UPDATE kontrolltermine SET berufsschule_id=1 WHERE id=10`);
  check(App.getTerminSchule(10)?.name === 'BS Freiburg', 'Einsendung MIT gesetztem Ort liefert die Schule');
}

console.log('\n══ getStandortgruppen: Lehrjahr-Filter (2.+3. LJ an der Schule) ══');
{
  const alle = App.getStandortgruppen({});
  check(alle.reduce((n, g) => n + g.schueler.length, 0) === 4, 'Ohne Filter: alle 4 aktiven Azubis');
  const lj23 = App.getStandortgruppen({ lehrjahre: [2, 3] });
  const ids23 = lj23.flatMap(g => g.schueler.map(s => s.id)).sort();
  check(JSON.stringify(ids23) === '[1,2,3]', `Lehrjahre 2+3: Erstjahres-Azubi fällt raus (${JSON.stringify(ids23)})`);
  const amtListe = App.getStandortgruppen({ lehrjahre: [2, 3] }).flatMap(g => g.schueler)
    .filter(s => s.zustaendiges_amt && s.zustaendiges_amt !== App.EIGENES_AMT).map(s => s.id).sort();
  check(JSON.stringify(amtListe) === '[2,3]', 'Fremde Ämter sind in den Standortgruppen enthalten (werden mitkontrolliert)');
}

console.log('\n══ Weitergabe-Datenbasis: fremde Ämter je Termin ══');
{
  const fremde = App.getTerminSchueler(20).filter(s => (s.zustaendiges_amt || '') !== '' && s.zustaendiges_amt !== App.EIGENES_AMT);
  const nachAmt = {};
  fremde.forEach(s => { (nachAmt[s.zustaendiges_amt] = nachAmt[s.zustaendiges_amt] || []).push(s.id); });
  check(Object.keys(nachAmt).sort().join(',') === '76,94', `Gruppierung je Amt: ${JSON.stringify(nachAmt)}`);
  check(App.EIGENES_AMT === '93' && App.amtLabel('94').startsWith('94'), 'EIGENES_AMT und Amt-Beschriftung vorhanden');
}

console.log('\n══ Quelltext-Zusicherungen: Workflow-Reparaturen ══');
{
  check(/BEWUSST UNGEFILTERT/.test(PLANUNG_SRC) && !/WHERE 1=1\$\{gfK\}/.test(PLANUNG_SRC),
    'Termin-Dialog lädt Klassen/Azubis ohne globale Filter (fremde Ämter wählbar)');
  check(/INSERT OR IGNORE INTO kontrolltermin_schueler[\s\S]{0,200}currentTerminId, schuelerId/.test(KONTROLLE_SRC),
    '"+ Schüler hinzufügen" bindet den Azubi als Einzel-Zuordnung an den Termin');
  check(/mitInhalt/.test(PLANUNG_SRC) && /ke\.e !== ''/.test(PLANUNG_SRC),
    'Termin-Bearbeitung schützt Kontrollergebnisse mit Inhalt vor dem Aufräumen');
  check(/UPDATE kontrolltermine SET klasse_id=\? WHERE id=\?', \[selectedKlassen\[0\] \|\| null, id\]/.test(PLANUNG_SRC),
    'Legacy klasse_id wird auch beim Entfernen aller Klassen geleert');
  check(/menge = new Set\(this\._standortSchuelerIds/.test(PLANUNG_SRC),
    'Standortgruppen-Klick MERGT die Azubis statt die Auswahl zu ersetzen');
  check(/_kampAnlegen/.test(PLANUNG_SRC) && /kontrolltermin_schueler \(kontrolltermin_id, schueler_id\) VALUES \(\?,\?\)', \[newId, s\.id\]/.test(PLANUNG_SRC),
    'Kampagnen-Assistent legt je Schule einen Termin mit exakter Azubi-Menge an');
  check(/fremdeAemter/.test(PLANUNG_SRC) && /exportAmtPDF/.test(PLANUNG_SRC) && /exportAmtExcel/.test(PLANUNG_SRC),
    'Weitergabe an fremde Ämter (PDF + Excel je Amt) vorhanden');
  check(!/SELECT DISTINCT k\.id FROM klassen k WHERE k\.berufsschule_id=\?", \[bsId\]\)/.test(NACHERF_SRC),
    'Nacherfassung verknüpft nicht mehr pauschal alle Klassen der Schule');
  check(/schuelerInfo\[s\.id\]/.test(PDF_SRC) && /getAktuelleSchule/.test(PDF_SRC),
    'Durchsichtsbogen trägt Schule/Klasse des AZUBIS (inkl. LFK), nicht pauschal die des Termins');
  check(/getTerminSchule\(terminId\)/.test(WORKFLOWS_SRC),
    'Schul-E-Mail geht an den ORT des Termins (nicht an die Stammschule der ersten Klasse)');
  check(/doJahresplan/.test(PLANUNG_SRC) === false,
    'Alter 1-Termin-pro-Klasse-Assistent ist ersetzt');
  check(/lj: \[1, 2, 3, 4\]\.map/.test(PLANUNG_SRC),
    'Termin-Dialog hat eine Lehrjahr-Mehrfachauswahl');
  check(/App\.filterAmt = \[\];/.test(PLANUNG_SRC),
    'Kontroll-Vorlagen schalten den Amt-Filter aus (fremde Ämter mitkontrollieren)');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
