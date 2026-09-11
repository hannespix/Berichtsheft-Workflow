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

console.log('\n══ Audit 7 A6: Schülerzahl eines Termins zählt Einzel-Zuordnungen ══');
{
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status,typ) VALUES (777,'2026-11-24','geplant','schulkontrolle')`);
  const ids = App.query('SELECT id FROM schueler WHERE aktiv=1 LIMIT 3').map(r => r.id);
  ids.forEach(id => db.run('INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (777,?)', [id]));
  App.invalidateTerminCache();
  App.preloadTerminKlassen([777]);
  check(App.getTerminSchuelerCount(777) === ids.length, `Kampagnen-Termin ohne Klassen zeigt ${ids.length} Azubis statt 0 (${App.getTerminSchuelerCount(777)})`);
}

console.log('\n══ Audit 7 Paket D: Planung im Termin-Modell ══');
{
  sandbox.formatDate = (d) => String(d || ''); sandbox.esc = (x) => String(x ?? ''); sandbox.todayStr = () => new Date().toISOString().slice(0, 10);
  vm.runInContext(PLANUNG_SRC + '\n;globalThis.PlanungHandler = PlanungHandler;', sandbox, { filename: 'planung.js' });
  const PH = sandbox.PlanungHandler;
  // D1: Kohortenjahr aus dem Kampagnenfenster – im Januar 2026 liegt das
  // Nov./Dez.-Fenster im Jahr 2026, die Kohorte ist also AP S2027 (nicht S2026)
  const jan = new Date(2026, 0, 15);
  const f = PH._kampFensterRoh('kontrolle23', jan);
  check(f.von.getFullYear() === 2026 && f.von.getMonth() === 10, `Januar 2026: Fenster der 2.+3.-AJ-Kontrolle = Nov./Dez. 2026 (${f.von.getFullYear()}-${f.von.getMonth() + 1})`);
  const v = PH._kontrollVorlagen(jan).find(x => x.key === 'kontrolle23');
  check(v.jgLabels.includes('S2027') && !v.jgLabels.includes('S2026'), `Kohorte dazu ist AP S2027 (${v.jgLabels.join(',')})`);
  const vApril = PH._kontrollVorlagen(new Date(2026, 3, 1)).find(x => x.key === 'zpF');
  check(vApril.zps.includes('F2027') || vApril.fehlt.includes('ZP F2027'), 'April 2026: ZP-Frühjahr-Kampagne zielt auf F2027 (Fenster Jan.–März 2027)');
  const vSep = PH._kontrollVorlagen(new Date(2026, 8, 11)).find(x => x.key === 'kontrolle23');
  check(vSep.jgLabels.includes('S2027'), 'September 2026: weiterhin AP S2027 (Fenster Nov./Dez. 2026)');

  // D2: Lehrjahr zum Stichtag der Kampagne, nicht zu heute
  const heute = new Date();
  const beginn = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-01`;
  const ende = `${heute.getFullYear() + 3}-${String(heute.getMonth() + 1).padStart(2, '0')}-01`;
  const spaeter = new Date(heute.getFullYear(), heute.getMonth() + 15, 15);
  const refDate = `${spaeter.getFullYear()}-${String(spaeter.getMonth() + 1).padStart(2, '0')}-15`;
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,fachrichtung_id,zustaendiges_amt,ausbildungsbeginn,ausbildungsende) VALUES (901,'Zukunft','Z',1,3,2,1,'93',?,?)`, [beginn, ende]);
  const heuteLJ2 = App.getStandortgruppen({ lehrjahre: [2] }).some(g => g.schueler.some(x => x.id === 901));
  const spaeterLJ2 = App.getStandortgruppen({ lehrjahre: [2], refDate }).some(g => g.schueler.some(x => x.id === 901));
  check(!heuteLJ2 && spaeterLJ2, `Lehrjahr-Filter zum Stichtag ${refDate}: heutiger 1.-Lehrjahr-Azubi zählt dann als 2. Lehrjahr`);
  check(/opts\.refDate = /.test(PLANUNG_SRC) && /if \(terminDatum\) opts\.refDate = terminDatum;/.test(PLANUNG_SRC), 'Assistent und Termin-Dialog übergeben den Stichtag');

  // D3/D4: Gruppen eines Kampagnen-Termins (nur Einzel-Zuordnung, keine Klassen)
  db.run(`UPDATE kontrolltermine SET berufsschule_id=1 WHERE id=777`);
  App.invalidateTerminCache();
  const gr = App.terminGruppen(777);
  check(gr.length > 0 && gr.reduce((n, g) => n + g.count, 0) === App.getTerminSchueler(777).length, `Kampagnen-Termin: Gruppen aus den Azubis (${gr.map(g => g.fr + ' ' + g.aj + '. AJ: ' + g.count).join(' | ')})`);
  check(App.formatTerminFrAj(777) !== '–', `Fachrichtung/AJ des Kampagnen-Termins nicht mehr „–" (${App.formatTerminFrAj(777)})`);
  const VIEWS_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  check((VIEWS_SRC.match(/App\.getTerminSchule\(t\.id\)/g) || []).length >= 3 && !/const schule = klassen\.length \? klassen\[0\]\.schule : '–';\n/.test(VIEWS_SRC.split('Durchsichtsbögen exportieren')[0].split('Nächste Kontrolltermine')[1] || ''), 'Dashboard/Kalender/Berichte zeigen den Ort des Termins (getTerminSchule)');
  check(/terminDays\[day\] = terminDays\[day\] \|\| \[\]/.test(VIEWS_SRC), 'Kalender fasst mehrere Termine je Tag');
  check(/App\.terminGruppen\(t\.termin\.id/.test(WORKFLOWS_SRC) && /!klassen\.length && schuelerList\.length/.test(WORKFLOWS_SRC), 'Terminanfrage: Gruppen, Klassen und Fachrichtung auch aus den Azubis');

  // D5: Kalender-Helfer
  check(App.hatKW53(2026) && !App.hatKW53(2025) && App.hatKW53(2020) && !App.hatKW53(2027), 'KW 53 nach ISO-Regel (2026 und 2020 ja, 2025 und 2027 nein)');
  check(App.schuljahrZu('2026-11-24') === '2026/2027' && App.schuljahrZu('2027-03-01') === '2026/2027' && App.schuljahrZu('2027-08-15') === '2027/2028', 'Schuljahr zu einem Datum');
  check(/App\.hatKW53\(year1\)/.test(fs.readFileSync(path.join(ROOT, 'src/js/modules/stammdaten.js'), 'utf8')), 'Blockplan-Raster nutzt die ISO-Regel');
  check(/App\.schuljahrZu\(document\.getElementById\('mKtDatum'\)/.test(PLANUNG_SRC) && /if \(!schulIds\.length && ortId\) schulIds = \[ortId\];/.test(PLANUNG_SRC), 'KW-Kalender im Dialog: Schuljahr des Termindatums, Schule auch über den Ort');
  check(/berufsschule_id=\? AND schuljahr=\?'/.test(PLANUNG_SRC.split('_kampBlockplanKws(bsId, datum)')[1] || ''), 'Datumsvorschläge lesen den Blockplan je Schuljahr');

  // D6: Schule zum Standortnamen, Doppeltermine
  check(App.berufsschuleIdZuName('BS Freiburg') === 1 && App.berufsschuleIdZuName('Freiburg') === 1, 'Berufsschule zu Standortname (exakt und enthalten)');
  check(App.berufsschuleIdZuName('Landesfachklasse BS Heidelberg Obstbau') === 2 && App.berufsschuleIdZuName('Nirgendwo') === null, 'Freitext-LFK-Standort findet die Schule, Unbekanntes nicht');
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status,typ,berufsschule_id,pruefer) VALUES (778,'2026-11-30','geplant','schulkontrolle',1,'Test')`);
  const k1 = App.terminKollisionen(1, '2026-11-24', 14);
  check(k1.some(t => t.id === 778), 'Doppeltermin ±14 Tage an derselben Schule erkannt');
  check(!App.terminKollisionen(1, '2026-11-24', 14, 778).some(t => t.id === 778), 'Beim Bearbeiten zählt der eigene Termin nicht');
  check(App.terminKollisionen(1, '2027-01-20', 14).length === 0 && App.terminKollisionen(null, '2026-11-30').length === 0, 'Außerhalb des Umkreises bzw. ohne Schule keine Kollision');
  check(/App\.terminKollisionen\(ortId, dt, 14, id \|\| null\)/.test(PLANUNG_SRC) && /const doppelt = \[\];/.test(PLANUNG_SRC), 'Termin-Dialog und Assistent fragen bei Doppelterminen nach');
  check(/ortSel\.value = String\(bsId\)/.test(PLANUNG_SRC), 'Standort-Klick setzt den Ort des Termins');
}

console.log('\n══ Stufe 2 (1): Termin-Statuskette, Arbeitsliste, WV-Filter, ICS ══');
{
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status,typ,berufsschule_id,pruefer) VALUES (790,'2026-12-01','geplant','schulkontrolle',1,'Test')`);
  App.currentUser = 'Muster, Max';
  let k = App.terminKette(App.query('SELECT * FROM kontrolltermine WHERE id=790')[0]);
  check(k.schritt === 'nicht_angefragt', 'Neuer Termin: noch nicht angefragt');
  App.terminSchritt(790, 'angefragt');
  let t = App.query('SELECT * FROM kontrolltermine WHERE id=790')[0];
  check(t.angefragt_am && t.angefragt_von === 'Muster, Max' && App.terminKette(t).schritt === 'angefragt', `Schul-Mail vermerkt „angefragt" mit Datum und Person (${t.angefragt_am}/${t.angefragt_von})`);
  App.terminSchritt(790, 'bestaetigt');
  t = App.query('SELECT * FROM kontrolltermine WHERE id=790')[0];
  check(t.bestaetigt_am && App.terminKette(t).schritt === 'bestaetigt', 'Zusage der Schule → bestätigt');
  db.run(`UPDATE kontrolltermine SET status='durchgefuehrt' WHERE id=790`);
  t = App.query('SELECT * FROM kontrolltermine WHERE id=790')[0];
  check(App.terminKette(t).schritt === 'offen_nachbereitung', 'Durchgeführt ohne Nachbereitung wird als offen erkannt');
  App.terminSchritt(790, 'nachbereitet');
  t = App.query('SELECT * FROM kontrolltermine WHERE id=790')[0];
  check(t.nachbereitet_am && App.terminKette(t).schritt === 'nachbereitet', 'Abschluss-Assistent/Ergebnis-Mail → nachbereitet');
  App.terminSchritt(790, 'anfrage_zurueck');
  t = App.query('SELECT * FROM kontrolltermine WHERE id=790')[0];
  check(t.angefragt_am === '' && t.bestaetigt_am === '', 'Anfrage-Vermerk lässt sich zurücksetzen');
  const W_SRC = WORKFLOWS_SRC;
  check(/App\.terminSchritt\(p\.terminId, p\.isDone \? 'nachbereitet' : 'angefragt'\)/.test(W_SRC) && /bitte nicht doppelt anfragen/.test(W_SRC), 'Schul-Mail setzt den Schritt und warnt vor doppelter Anfrage');
  check(/App\.terminSchritt\(tid, 'nachbereitet'\)/.test(KONTROLLE_SRC), 'Abschluss-Assistent vermerkt die Nachbereitung');
  const diskDb = new SQL.Database();
  diskDb.run(`CREATE TABLE kontrolltermine (id INTEGER PRIMARY KEY AUTOINCREMENT, geplant_datum TEXT, status TEXT)`);
  for (const tb of ['schueler','kontrollergebnisse','berufsschulen','klassen','abschlussjahrgaenge','fachrichtungen','wiedervorlagen']) diskDb.run(`CREATE TABLE ${tb} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  App._migrateDiskDb(diskDb);
  const cols = []; const st = diskDb.prepare('PRAGMA table_info(kontrolltermine)'); while (st.step()) cols.push(st.getAsObject().name); st.free();
  check(['angefragt_am','angefragt_von','bestaetigt_am','nachbereitet_am'].every(c => cols.includes(c)), 'Statuskette-Spalten auch auf der Disk-Datenbank');
  diskDb.close();
  // Arbeitsliste + WV-Filter (Quelltext)
  const VIEWS_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  check(/Arbeitsliste – heute \/ diese Woche/.test(VIEWS_SRC) && /termineOhneAbschluss/.test(VIEWS_SRC) && /termineOhnePruefer/.test(VIEWS_SRC) && /wvOhneVersand/.test(VIEWS_SRC) && /termineNichtAngefragt/.test(VIEWS_SRC), 'Dashboard-Arbeitsliste: überfällig, fällig, ohne Versand, ohne Abschluss, ohne Prüfer, nicht angefragt');
  check(/<option value="unerledigt" selected>/.test(VIEWS_SRC) && /status === 'unerledigt'\) show = st !== 'erledigt'/.test(fs.readFileSync(path.join(ROOT, 'src/js/modules/wiedervorlagen.js'), 'utf8')), 'WV-Liste: Standardfilter „unerledigt" (offen + überfällig)');
  // ICS
  const ics = App.icsText([{ uid: 'bhk-termin-790', date: '2026-12-01', title: 'BH-Kontrolle: BS Freiburg, Hauptstelle', location: 'BS Freiburg, Freiburg', description: 'Prüfer: Test' },
                           { uid: 'bhk-wv-5', todo: true, date: '2026-12-15', title: 'Wiedervorlage: Muster', description: 'Nachholung' }]);
  check(/UID:bhk-termin-790@berichtsheftkontrolle/.test(ics) && /DTSTAMP:\d{8}T\d{6}Z/.test(ics) && /DTEND;VALUE=DATE:20261202/.test(ics) && /LOCATION:BS Freiburg\\, Freiburg/.test(ics), 'ICS-Termin: stabile UID, DTSTAMP, DTEND (Folgetag), LOCATION maskiert');
  check(/BEGIN:VTODO[\s\S]*UID:bhk-wv-5@berichtsheftkontrolle[\s\S]*DUE;VALUE=DATE:20261215[\s\S]*END:VTODO/.test(ics), 'Wiedervorlagen als Aufgaben (VTODO mit Fälligkeit)');
  check(/SUMMARY:BH-Kontrolle: BS Freiburg\\, Hauptstelle/.test(ics), 'Komma im Schulnamen maskiert');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
