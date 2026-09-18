// ═══════════════════════════════════════════════════════════════════
//  Datenbank-Tools (Einstellungen): Bestand, Verdichten, Jahrgang mit
//  Archiv löschen + Rückholung, Aufräumen, Neuaufbau (VACUUM), Wächter
//  Ausführen:  node tests/dbtools-test.mjs
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
const DBT_SRC = read('src/js/modules/db-tools.js');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = (id) => ({ id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false }, appendChild() {} } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => new Date().toISOString().slice(0, 10), dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '', svgIcon: () => '', Papa: {}, XLSX: undefined,
  Views: {}, SchuelerView: {}, SchuelerAkte: { getCount: () => 0 }, StammdatenTab: {}, GlobalSearch: {}, KontrolleHandler: { activePruefer: 'Tester' },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(DBT_SRC + '\n;globalThis.DbTools = DbTools;', sandbox, { filename: 'db-tools.js' });
const { __App: App, DbTools: T } = sandbox;
App.db = db; App._sqlJsFactory = SQL; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.showLoading = () => {}; App.hideLoading = () => {}; App.currentUser = 'Test';
App.migrateDB();

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const cnt = (sql, p) => App.scalar(sql, p || []) || 0;
const iso = (d) => d.toISOString().slice(0, 10);
const vorJahren = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return iso(d); };
const vorMonaten = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return iso(d); };

// ── Testdaten ──
db.run("INSERT OR IGNORE INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'036','GaLaBau','Gärtner')");
db.run("INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (10,'S2021','Sommer',2021),(20,'S2027','Sommer',2027)");
db.run("INSERT INTO berufsschulen (id,name) VALUES (1,'BS Test')");
db.run("INSERT INTO klassen (id,berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung) VALUES (11,1,10,1,'GL S2021'),(21,1,20,1,'GL S2027'),(99,1,20,NULL,'leer')");
db.run("INSERT INTO betriebe (id,betriebsnummer,name,ort) VALUES (1,'B1','Gärtnerei Alt','Altheim'),(2,'B2','Gärtnerei Neu','Neustadt'),(3,'B3','Ohne Bezug','Nirgendwo')");
db.run("INSERT INTO ausbilder (id,betrieb_id,nachname) VALUES (1,3,'Verwaist-Bald')");
// Alte Azubis (S2021): 1 + 2 bestanden, 3 inaktiv aber offene WV, 4 erst kürzlich inaktiv
const alt = vorJahren(3), kurz = vorMonaten(2), geteilt = vorMonaten(30);
db.run(`INSERT INTO schueler (id,ibykus_id,nachname,vorname,fachrichtung_id,betrieb_id,klasse_id,jahrgang_id,aktiv,status,inaktiv_datum,ausbildungsende) VALUES
  (1,'A1','Alt','Anna',1,1,11,10,0,'ap_bestanden','${alt}','${alt}'),
  (2,'A2','Alt','Bernd',1,1,11,10,0,'ap_bestanden','${alt}','${alt}'),
  (3,'A3','Alt','Clara',1,1,11,10,0,'abgebrochen','${alt}','${alt}'),
  (4,'A4','Alt','Dieter',1,1,11,10,0,'ap_bestanden','${kurz}','${kurz}'),
  (5,'N5','Neu','Emil',1,2,21,20,1,'aktiv','',''),
  (6,'N6','Neu','Frida',1,2,21,20,1,'aktiv','','')`);
db.run(`INSERT INTO kontrolltermine (id,berufsschule_id,jahrgang_id,klasse_id,geplant_datum,durchgefuehrt_datum,status) VALUES
  (100,1,10,11,'${alt}','${alt}','durchgefuehrt'),
  (101,1,NULL,NULL,'${geteilt}','${geteilt}','durchgefuehrt'),
  (200,1,20,21,'${kurz}','${kurz}','durchgefuehrt')`);
// 101 = geteilter Termin (alter Azubi 2 + neuer Azubi 5)
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis) VALUES
  (1000,100,1,'in_ordnung'),(1001,100,2,'post_an_rp'),(1002,100,3,'post_an_rp'),(1003,100,4,'in_ordnung'),
  (1010,101,2,'in_ordnung'),(1011,101,5,'in_ordnung'),
  (2000,200,5,'in_ordnung'),(2001,200,6,'post_an_rp')`);
for (const sid of [1, 2, 3, 4, 5, 6]) for (let kw = 1; kw <= 20; kw++) db.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (?,?,?,?)', [sid, 1, kw, kw % 5 === 0 ? 'A' : '']);
db.run("INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES (1001,1,5,'A'),(1002,1,5,'A'),(2001,1,5,'A')");
db.run("INSERT INTO durchsicht_snapshots (kontrollergebnis_id,schueler_id,snapshot_datum,kw_daten_json) VALUES (1000,1,'2023-05-05','{}'),(1001,2,'2023-05-05','{}'),(1002,3,'2023-05-05','{}'),(2001,6,'2026-08-01','{}')");
db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES
  (500,1001,2,'post','${alt}','erledigt'),(501,1002,3,'post','${alt}','offen'),(600,2001,6,'post','${kurz}','offen')`);
db.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz) VALUES (500,'erledigt'),(501,'offen')");
db.run("INSERT INTO schueler_bemerkungen (schueler_id,text) VALUES (1,'Bemerkung Anna'),(5,'Bemerkung Emil')");
db.run("INSERT INTO schueler_dateien (schueler_id,dateiname,original_name) VALUES (1,'a.pdf','a.pdf')");
db.run("INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (100,1),(200,5)");
db.run("INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (100,11),(200,21)");
// Änderungslog: alt (normal), alt (geloescht → bleibt), neu
db.run(`INSERT INTO aenderungslog (schueler_id,schueler_name,feld,alter_wert,neuer_wert,aktion,zeitpunkt) VALUES
  (1,'Alt, Anna','telefon','1','2','geaendert','${vorJahren(3)} 10:00:00'),
  (0,'Weg, Wilma','datensatz','Weg, Wilma','gelöscht','geloescht','${vorJahren(3)} 10:00:00'),
  (5,'Neu, Emil','telefon','1','2','geaendert','${vorMonaten(1)} 10:00:00')`);
db.run(`INSERT INTO import_historie (zeitpunkt,typ,datei,zeilen,details_json) VALUES ('${vorJahren(2)} 08:00:00','azubis','alt.csv',10,'[{"x":1}]'),('${vorMonaten(1)} 08:00:00','azubis','neu.csv',10,'[{"x":1}]')`);
const sjAlt = `${new Date().getFullYear() - 4}/${new Date().getFullYear() - 3}`;
db.run(`INSERT INTO blockplan (berufsschule_id,schuljahr,lehrjahr,kalenderwoche) VALUES (1,'${sjAlt}',1,10),(1,'${App.schuljahrZu(new Date())}',1,10)`);
db.run("INSERT INTO bhk_papierkorb (art,ref_id,label,daten) VALUES ('schueler',1,'Alt, Anna','{}'),('termin',300,'alt','{}')");
// Waisen
db.run("INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id) VALUES (9000,200,777)");
db.run("INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche) VALUES (777,1,1)");
db.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz) VALUES (7777,'waise')");
db.run("INSERT INTO aktive_sitzung (kontrolltermin_id,schueler_id,pruefer,seit) VALUES (200,5,'X','2020-01-01 10:00:00')");

console.log('══ Bestand ══');
{
  const b = T.bestand();
  const t = Object.fromEntries(b.tabellen.map(x => [x.name, x.zeilen]));
  check(t.schueler === 6 && t.kw_status === 121 && t.kontrollergebnisse === 9, `Zeilen je Tabelle (schueler ${t.schueler}, kw_status ${t.kw_status}, KE ${t.kontrollergebnisse})`);
  check(b.azubis.aktiv === 2 && b.azubis.inaktiv === 4, 'Aktiv/inaktiv gezählt');
  const j10 = b.jahrgaenge.find(j => j.id === 10), j20 = b.jahrgaenge.find(j => j.id === 20);
  check(j10 && j10.abgeschlossen && j10.aktiv === 0 && j10.inaktiv === 4, 'S2021 gilt als abgeschlossen (0 aktiv, 4 inaktiv)');
  check(j20 && !j20.abgeschlossen && j20.aktiv === 2, 'S2027 nicht abgeschlossen');
  check(j10.letzter_termin === geteilt, `Letzter Termin des Jahrgangs berücksichtigt geteilte Termine über Ergebnisse (${j10.letzter_termin})`);
  check(j10.kw_zeilen === 80 && j10.snapshots === 3 && j10.wv_offen === 1, 'Wochenzeilen, Snapshots und offene WV je Jahrgang');
}

console.log('══ Verdichten ══');
{
  const k = T.verdichtenKandidaten(24);
  const ids = k.map(r => r.id);
  check(ids.includes(1) && ids.includes(2), 'Lange inaktive Azubis ohne offene WV sind Kandidaten');
  check(!ids.includes(3), 'Inaktiv mit offener Wiedervorlage wird NICHT verdichtet');
  check(!ids.includes(4), 'Erst kürzlich inaktiv (2 Monate) wird NICHT verdichtet');
  check(!ids.includes(5) && !ids.includes(6), 'Aktive Azubis nie');
  const v = T.verdichtenVorschau(24);
  check(v.azubis === 2 && v.kwZeilen === 40 && v.snapshots === 2 && v.maengel === 1, `Vorschau zählt (${v.azubis} Azubis, ${v.kwZeilen} KW, ${v.snapshots} Snapshots, ${v.maengel} Mängel)`);
  check(T.verdichtenVorschau(24, [20]).azubis === 0 && T.verdichtenVorschau(24, [10]).azubis === 2, 'Jahrgangs-Eingrenzung wirkt');
  const n = T._verdichtenAusfuehren(v.ids);
  check(n === 2, 'Zwei Azubis verdichtet');
  check(cnt('SELECT COUNT(*) FROM kw_status WHERE schueler_id IN (1,2)') === 0 && cnt('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id IN (1,2)') === 0 && cnt('SELECT COUNT(*) FROM kw_maengel WHERE kontrollergebnis_id=1001') === 0, 'Wochendaten, Snapshots und KW-Mängel entfernt');
  check(cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id IN (1,2)') === 3 && cnt('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=2') === 1 && cnt('SELECT COUNT(*) FROM schueler_bemerkungen WHERE schueler_id=1') === 1, 'Ergebnisse, Wiedervorlagen und Bemerkungen bleiben');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE aktion='verdichtet' AND schueler_id IN (1,2)") === 2, 'Verdichtung im Änderungslog vermerkt');
  check(cnt('SELECT COUNT(*) FROM kw_status WHERE schueler_id=3') === 20, 'Nicht-Kandidat unberührt');
  check(T._verdichtenAusfuehren([5]) === 0 && cnt('SELECT COUNT(*) FROM kw_status WHERE schueler_id=5') === 20, 'Aktiver Azubi wird auch bei direktem Aufruf nicht verdichtet');
}

console.log('══ Jahrgang löschen: Vorschau + Archiv ══');
let archivDb = null;
{
  const v = T.jahrgangLoeschenVorschau([10]);
  check(v.aktiv === 0 && v.azubis === 4 && v.ergebnisse === 5, `Vorschau: ${v.azubis} Azubis, ${v.ergebnisse} Ergebnisse`);
  check(v.termine === 1 && v.terminIds[0] === 100 && v.termineGeteilt === 1, 'Eigener Termin wird gelöscht, geteilter Termin 101 bleibt (nur gezählt)');
  check(v.klassen === 1 && v.dateien === 1 && v.wiedervorlagen === 2 && v.wvOffen === 1, 'Klassen, Dateien, Wiedervorlagen gezählt');
  check(T.jahrgangLoeschenVorschau([20]).aktiv === 2, 'Aktiver Jahrgang zeigt aktive Azubis (Löschen wird verweigert)');
  const a = T._archivDbBauen([10], SQL);
  archivDb = a.db;
  const q = (sql) => archivDb.exec(sql)[0]?.values[0][0] ?? 0;
  check(q('SELECT COUNT(*) FROM schueler') === 4 && q('SELECT COUNT(*) FROM kontrollergebnisse') === 5, 'Archiv enthält Azubis und ihre Ergebnisse');
  check(q('SELECT COUNT(*) FROM kontrolltermine') === 2, 'Archiv enthält eigenen UND geteilten Termin');
  check(q('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=5') === 0, 'Fremde Ergebnisse des geteilten Termins NICHT im Archiv');
  check(q('SELECT COUNT(*) FROM kw_status') === 40 && q('SELECT COUNT(*) FROM wiedervorlagen') === 2 && q('SELECT COUNT(*) FROM wiedervorlage_notizen') === 2 && q('SELECT COUNT(*) FROM schueler_dateien') === 1, `Wochendaten, WV, Notizen, Dateien im Archiv (${q('SELECT COUNT(*) FROM kw_status')}/${q('SELECT COUNT(*) FROM wiedervorlagen')}/${q('SELECT COUNT(*) FROM wiedervorlage_notizen')}/${q('SELECT COUNT(*) FROM schueler_dateien')})`);
  check(q('SELECT COUNT(*) FROM abschlussjahrgaenge') === 1 && q('SELECT COUNT(*) FROM klassen') === 1 && q('SELECT COUNT(*) FROM betriebe') === 1 && q('SELECT COUNT(*) FROM berufsschulen') === 1, 'Stammdaten (Jahrgang, Klasse, Betrieb, Schule) im Archiv');
  check(q("SELECT wert FROM archiv_info WHERE schluessel='jahrgaenge'") === 'S2021', 'Archiv-Info mit Jahrgang');
  check(String(archivDb.exec("SELECT sql FROM sqlite_master WHERE name='schueler'")[0].values[0][0]).includes('inaktiv_grund'), 'Archiv-Schema = echtes Schema (inkl. migrierter Spalten)');
  check(T._archivName([{ bezeichnung: 'S2021' }]).startsWith('archiv_S2021_'), 'Archiv-Dateiname');
}

console.log('══ Jahrgang löschen: Ausführung ══');
{
  const r = T._jahrgaengeLoeschenAusfuehren([10], 'archiv_S2021_test.sqlite');
  check(r.azubis === 4, 'Rückgabe mit Zahlen');
  check(cnt('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=10') === 0 && cnt('SELECT COUNT(*) FROM schueler') === 2, 'Azubis des Jahrgangs weg, andere bleiben');
  check(cnt('SELECT COUNT(*) FROM kontrolltermine WHERE id=100') === 0 && cnt('SELECT COUNT(*) FROM kontrolltermine WHERE id=101') === 1, 'Eigener Termin weg, geteilter bleibt');
  check(cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=101') === 1 && cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=101 AND schueler_id=5') === 1, 'Am geteilten Termin bleibt nur das fremde Ergebnis');
  check(cnt('SELECT COUNT(*) FROM kw_status WHERE schueler_id IN (1,2,3,4)') === 0 && cnt('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id IN (1,2,3,4)') === 0 && cnt('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id IN (500,501)') === 0, 'Abhängige Zeilen kaskadiert');
  check(cnt('SELECT COUNT(*) FROM klassen WHERE id=11') === 0 && cnt('SELECT COUNT(*) FROM abschlussjahrgaenge WHERE id=10') === 0, 'Klasse und Jahrgang entfernt');
  check(cnt('SELECT COUNT(*) FROM klassen WHERE id=21') === 1 && cnt('SELECT COUNT(*) FROM kw_status WHERE schueler_id IN (5,6)') === 40, 'Aktiver Jahrgang unberührt');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE aktion='geloescht' AND schueler_id IN (1,2,3,4) AND neuer_wert LIKE '%archiv_S2021_test%'") === 4, 'Lösch-Logbuch nennt das Archiv je Azubi');
  check(cnt("SELECT COUNT(*) FROM bhk_papierkorb WHERE art='schueler' AND ref_id=1") === 0 && cnt("SELECT COUNT(*) FROM bhk_papierkorb WHERE art='termin'") === 1, 'Papierkorb-Einträge der archivierten Azubis entfernt, andere bleiben');
}

console.log('══ Archiv-Rückholung ══');
{
  const r = T._archivWiederherstellenAus(archivDb, [2]);
  check(r.azubis === 1, 'Ein Azubi zurückgeholt');
  const s = App.query('SELECT * FROM schueler WHERE id=2')[0];
  check(s && s.nachname === 'Alt' && s.aktiv === 0 && s.jahrgang_id === 10 && s.klasse_id === 11, 'Azubi mit alter ID, inaktiv, Jahrgang/Klasse gesetzt');
  check(cnt('SELECT COUNT(*) FROM abschlussjahrgaenge WHERE id=10') === 1 && cnt('SELECT COUNT(*) FROM klassen WHERE id=11') === 1, 'Fehlender Jahrgang und Klasse wieder angelegt');
  check(cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=2') === 2 && cnt('SELECT COUNT(*) FROM kontrolltermine WHERE id=100') === 1, 'Ergebnisse samt fehlendem Termin zurück');
  check(cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=101') === 2, 'Geteilter Termin: fremdes Ergebnis nicht dupliziert, eigenes zurück');
  check(cnt('SELECT COUNT(*) FROM wiedervorlagen WHERE id=500') === 1 && cnt('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=500') === 1, 'Wiedervorlage samt Notiz zurück');
  check(cnt('SELECT COUNT(*) FROM schueler WHERE id=1') === 0, 'Nicht ausgewählte Azubis bleiben im Archiv');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE aktion='wiederhergestellt' AND schueler_id=2") === 1, 'Rückholung im Logbuch');
  const r2 = T._archivWiederherstellenAus(archivDb, [2]);
  check(r2.azubis === 1 && cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=2') === 2, 'Zweite Rückholung dupliziert nichts (INSERT OR IGNORE)');
  archivDb.close();
}

console.log('══ Aufräumen ══');
{
  App._rowStamps = new Map([['alt', { x: { ts: Date.now() - 200 * 86400000, c: 'a', seq: 1 } }], ['neu', { x: { ts: Date.now(), c: 'a', seq: 1 } }], ['gemischt', { x: { ts: Date.now() - 200 * 86400000 }, y: { ts: Date.now() } }]]);
  const v = T.aufraeumenVorschau();
  const p = Object.fromEntries(v.posten.map(x => [x.key, x.n]));
  check(p.waisen === 3, `Verwaiste Zeilen erkannt (${p.waisen}: KE ohne Azubi, KW ohne Azubi, Notiz ohne WV)`);
  check(p.sitzungen === 1 && p.klassen === 1 && p.blockplan === 1 && p.log === 1 && p.importDetails === 1 && p.stamps === 1, `Sitzungen ${p.sitzungen}, leere Klassen ${p.klassen}, Blockplan ${p.blockplan}, Log ${p.log}, Import-Details ${p.importDetails}, Stempel ${p.stamps}`);
  check(p.betriebe === undefined && p.papierkorb === undefined, 'Betriebe und Papierkorb standardmäßig NICHT im Umfang');
  check(T.aufraeumenVorschau({ betriebe: true, papierkorb: true }).posten.find(x => x.key === 'betriebe').n === 1, 'Betrieb ohne Bezug erkannt, wenn Option gesetzt');
  const r = T._aufraeumenAusfuehren({ betriebe: true });
  check(cnt('SELECT COUNT(*) FROM kontrollergebnisse WHERE id=9000') === 0 && cnt('SELECT COUNT(*) FROM kw_status WHERE schueler_id=777') === 0 && cnt('SELECT COUNT(*) FROM wiedervorlage_notizen WHERE wiedervorlage_id=7777') === 0, 'Waisen entfernt');
  check(cnt('SELECT COUNT(*) FROM aktive_sitzung') === 0, 'Alte Sitzungs-Sperre entfernt');
  check(cnt('SELECT COUNT(*) FROM klassen WHERE id=99') === 0 && cnt('SELECT COUNT(*) FROM klassen WHERE id=21') === 1, 'Leere Klasse weg, belegte Klasse bleibt');
  check(cnt('SELECT COUNT(*) FROM blockplan') === 1 && cnt(`SELECT COUNT(*) FROM blockplan WHERE schuljahr='${sjAlt}'`) === 0, 'Alter Blockplan weg, aktueller bleibt');
  check(cnt("SELECT COUNT(*) FROM aenderungslog WHERE feld='telefon' AND schueler_id=1") === 0 && cnt("SELECT COUNT(*) FROM aenderungslog WHERE schueler_name='Weg, Wilma'") === 1 && cnt("SELECT COUNT(*) FROM aenderungslog WHERE schueler_id=5 AND feld='telefon'") === 1, 'Altes Log weg, Lösch-Logbuch und junge Einträge bleiben');
  check(App.query("SELECT details_json FROM import_historie WHERE datei='alt.csv'")[0].details_json === '[]' && App.query("SELECT details_json FROM import_historie WHERE datei='neu.csv'")[0].details_json !== '[]' && cnt('SELECT COUNT(*) FROM import_historie') === 2, 'Alte Import-Details geleert, Zusammenfassung bleibt');
  check(!App._rowStamps.has('alt') && App._rowStamps.has('neu') && App._rowStamps.has('gemischt'), 'Nur komplett alte Stempel entfernt');
  check(cnt('SELECT COUNT(*) FROM betriebe WHERE id=3') === 0 && cnt('SELECT COUNT(*) FROM ausbilder WHERE betrieb_id=3') === 0 && cnt('SELECT COUNT(*) FROM betriebe') === 2, 'Betrieb ohne Bezug samt Ausbilder entfernt, andere bleiben');
  check(cnt('SELECT COUNT(*) FROM bhk_papierkorb') === 1, 'Papierkorb ohne Option unberührt');
  check(r.waisen === 3 && r.klassen === 1 && r.betriebe === 1, `Ergebniszahlen (${JSON.stringify(r)})`);
  check(T.aufraeumenVorschau().gesamt === 0, 'Zweiter Lauf findet nichts mehr');
}

console.log('══ Neuaufbau (VACUUM) ══');
{
  App.db.run('CREATE TABLE ballast (x TEXT)');
  App.db.run('BEGIN'); for (let i = 0; i < 3000; i++) App.db.run('INSERT INTO ballast VALUES (?)', ['x'.repeat(500)]); App.db.run('COMMIT');
  const voll = App.db.export().length;
  App.db.run('DROP TABLE ballast');
  const geloescht = App.db.export().length;
  App.db.run('VACUUM');
  const klein = App.db.export().length;
  check(geloescht === voll && klein < voll / 2, `Löschen allein schrumpft nicht (${geloescht}), VACUUM schon (${klein})`);
  const b = T.bestand();
  check(b.freiBytes === 0 && b.speicherBytes === klein, 'Bestand meldet Speicher und Freiraum');
}

console.log('══ Wächter ══');
{
  check(T._sperrgrund() === '', 'Kein Sperrgrund im Normalbetrieb');
  App.offlineModus = true; check(/Offline/.test(T._sperrgrund()), 'Offline-Modus sperrt'); App.offlineModus = false;
  App._netzWeg = true; check(/Netzlaufwerk/.test(T._sperrgrund()), 'Netzabriss sperrt'); App._netzWeg = false;
  App._bulkPending = true; check(/Import/.test(T._sperrgrund()), 'Ausstehender Import sperrt'); App._bulkPending = false;
  check(/_bulkImport = true/.test(DBT_SRC) && /App\.fullSave\(/.test(DBT_SRC) && /createBackup\('vor-'/.test(DBT_SRC) && /run\('VACUUM'\)/.test(DBT_SRC), 'Ablauf: Backup → Bulk-Pfad → VACUUM → Snapshot (fullSave)');
  check(/eingabe !== 'LÖSCHEN'/.test(DBT_SRC) && /_archivSchreiben\(/.test(DBT_SRC) && /NICHTS gelöscht/.test(DBT_SRC), 'Jahrgang-Löschen: Tippbestätigung, Archiv vor dem Löschen, Abbruch bei Archivfehler');
  check(/n !== v\.azubis\) throw/.test(DBT_SRC), 'Archiv wird gegengelesen (Azubi-Zahl) – sonst kein Löschen');
  const APP = APP_SRC;
  check(/opts\.ohnePapierkorb && !opts\.dateienBehalten/.test(APP), 'deleteSchuelerKaskade lässt Akten-Dateien auf Wunsch stehen (werden ins Archiv verschoben)');
  const VIEWS = read('src/js/modules/views.js');
  check(/DbTools\.cardHtml\(\)/.test(VIEWS) && /DbTools\.renderCard\(\)/.test(VIEWS), 'Karte in den Einstellungen eingebunden');
  check(/db-tools\.js/.test(read('build.sh')) && /db-tools\.js/.test(read('index.html')), 'Modul in build.sh und index.html');
  check(/rolle'\) === 'assistenz'/.test(DBT_SRC), 'Rollenprofil Assistenz sieht die Werkzeuge nicht');
}

console.log('══ Speichern unter Last: Warten, längere Versuche, Nachholung ══');
{
  const toasts = [];
  App.toast = (m, t) => toasts.push([String(m), t]);
  App.dbFileHandle = {}; App.createBackup = async () => {}; App._bulkPending = false;
  T._ausstehendStarten = () => {}; T.WARTE_MAX = 3; T.WARTE_SCHRITT_MS = 1;
  let ran = 0, nachher = 0, saveOpts = null;
  App._compactInProgress = true;
  await T._ausfuehren('test', () => { ran++; return 'Testlauf'; });
  check(ran === 0 && toasts.at(-1)[1] === 'warning' && /Kompaktierung läuft noch/.test(toasts.at(-1)[0]) && App._dbToolsAktiv === false, 'Laufende Kompaktierung: nach Wartezeit Abbruch OHNE Änderung');
  App._compactInProgress = false;
  App.fullSave = async (o) => { saveOpts = o; };
  await T._ausfuehren('test', () => { ran++; return 'Testlauf'; }, { nachher: async () => { nachher++; } });
  check(ran === 1 && nachher === 1 && toasts.at(-1)[1] === 'success', 'Freie Kompaktierung: Arbeit, Speichern, Nacharbeit, Erfolgsmeldung');
  check(saveOpts && saveOpts.versuche === 8 && saveOpts.pause === 15000 && saveOpts.grund === 'bereinigung' && saveOpts.label === 'Bereinigung', 'Speichern mit 8 Versuchen à 15 s statt 3 à 3 s');
  App.fullSave = async () => { App._bulkPending = true; throw new Error('Kompaktierung nicht möglich (Lock belegt oder Schreibfehler)'); };
  await T._ausfuehren('jahrgang', () => { ran++; return 'Jahrgang gelöscht'; }, { nachher: async () => { nachher++; } });
  check(ran === 2 && nachher === 1 && T._ausstehend && T._ausstehend.meldung === 'Jahrgang gelöscht' && T._letzterLauf.ausstehend === true, 'Lock belegt: Stand bleibt im Speicher, Nacharbeit wartet, Lauf als ausstehend markiert');
  check(toasts.at(-1)[1] === 'error' && /nachgeholt/.test(toasts.at(-1)[0]) && /NICHT schließen/.test(toasts.at(-1)[0]), 'Meldung nennt Nachholung und warnt vor dem Schließen');
  await T._ausfuehren('test', () => { ran++; return 'x'; });
  check(ran === 2 && /noch nicht gespeichert/.test(toasts.at(-1)[0]), 'Keine zweite Bereinigung, solange die erste aussteht');
  check(await T._ausstehendPruefen() === false && T._ausstehend, 'Solange _bulkPending: Nachholung noch offen');
  App._bulkPending = false;
  check(await T._ausstehendPruefen() === true && !T._ausstehend && nachher === 2 && /jetzt gespeichert/.test(toasts.at(-1)[0]) && !T._letzterLauf.ausstehend, 'Nach der Kompaktierung: Nacharbeit läuft, Erfolgsmeldung, Karte frei');
  check(/async fullSave\(opts\)/.test(APP_SRC) && /versuch <= o\.versuche/.test(APP_SRC) && /this\._compact\(o\.grund\)/.test(APP_SRC), 'App.fullSave nimmt Versuche/Pause/Grund/Label entgegen');
  check((APP_SRC.match(/!this\._dbToolsAktiv && await this\._compactionDue\(\)/g) || []).length === 2, 'Automatische Start- und Größen-Kompaktierung pausieren während einer Bereinigung');
  check(!/Kompaktierung läuft gerade – bitte kurz warten/.test(DBT_SRC) && /Warte auf laufende Kompaktierung/.test(DBT_SRC), 'Laufende Kompaktierung wird abgewartet statt abgelehnt');
}

console.log('══ Zweit-Registerkarte & Sperre ══');
{
  App._tabIsPrimary = false;
  check(/Zweit-Registerkarte/.test(T._sperrgrund()), 'Zweit-Registerkarte wird vor jeder Änderung abgewiesen (kann nie den Snapshot schreiben)');
  App._tabIsPrimary = true;
  check(/_compactAbgelehnt\('Zweit-Registerkarte/.test(APP_SRC) && /_compactAbgelehnt\(`Sperre belegt/.test(APP_SRC) && /_compactAbgelehnt\(`fremder Snapshot/.test(APP_SRC) && /this\._compactGrund = '';/.test(APP_SRC), '_compact protokolliert jeden Ablehnungsgrund und löscht ihn bei Erfolg');
  check(/Kompaktierung nicht möglich' \+ \(this\._compactGrund/.test(APP_SRC) && /weiterhin nicht kompaktiert \(\$\{this\._compactGrund/.test(APP_SRC), 'fullSave-Fehler und Nachhol-Warnung nennen den Grund');
  check(/this\._lockInfo = \{ von: lock\.u/.test(APP_SRC) && /_lockName\(\) \{/.test(APP_SRC), 'Sperrhalter und Alter werden gemerkt, Sperrname zentral');
  check(/App\._tabIsPrimary === false\) return App\.toast\('Diese Registerkarte ist eine Zweit-Registerkarte/.test(read('src/js/modules/import-handler.js')), 'Import in der Zweit-Registerkarte gesperrt');
  check(/Verbunden \(Zweit-Tab\)/.test(APP_SRC), 'Zweit-Tab dauerhaft in der Statusanzeige sichtbar');
  // Sperre lesen/entfernen mit Fake-Ordner
  const store = new Map();
  const dir = { async getFileHandle(name, o) { if (!store.has(name)) { if (!(o && o.create)) throw new Error('nf'); store.set(name, { data: '', mtime: Date.now() }); } return { async getFile() { const f = store.get(name); return { lastModified: f.mtime, async text() { return f.data; } }; }, async createWritable() { let b = ''; return { async write(d) { b = String(d); }, async close() { store.set(name, { data: b, mtime: Date.now() }); } }; } }; } };
  App.autoLoadedDbName = 'test.sqlite';
  check((await T._sperreLesen(dir)).frei === true, 'Keine Sperrdatei → frei');
  store.set('lock_test', { data: JSON.stringify({ u: 'Bernd', t: new Date(Date.now() - 400000).toISOString(), n: 'x' }), mtime: Date.now() - 400000 });
  const s1 = await T._sperreLesen(dir);
  check(s1.frei === false && s1.von === 'Bernd' && s1.alterS >= 399, `Belegte Sperre mit Halter und Alter (${s1.von}, ${s1.alterS} s)`);
  await T._sperreEntfernen(dir);
  check((await T._sperreLesen(dir)).frei === true && store.get('lock_test').data === '', 'Freigeben leert die Sperrdatei (leer = frei für _acquireLock)');
  check(/sperreDialog\(\)/.test(DBT_SRC) && /Sperre prüfen/.test(DBT_SRC) && /gefaehrlich: true/.test(DBT_SRC.split('sperreFreigeben() {')[1] || ''), 'Karte bietet „Sperre prüfen“, Freigeben nur mit roter Bestätigung');
}

console.log('══ Eigene Sperre nach Schreibfehler (Safe Browsing) ══');
{
  const store = new Map();
  const dir = { async getFileHandle(name, o) { if (!store.has(name)) { if (!(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; } store.set(name, { data: '', mtime: Date.now() }); } return { async getFile() { const f = store.get(name); return { lastModified: f.mtime, async text() { return f.data; } }; }, async createWritable() { let b = ''; return { async write(d) { b = String(d); }, async close() { store.set(name, { data: b, mtime: Date.now() }); } }; } }; }, async removeEntry(name) { if (!store.has(name)) throw new Error('nf'); store.delete(name); } };
  App.bhkDirHandle = dir; App.dirHandle = dir; App.autoLoadedDbName = 'test.sqlite'; App._netzWeg = false; App.offlineModus = false; App._compactInProgress = false;
  App._clientIdCache = 'client-XYZW'; App.currentUser = 'Anna'; sandbox.KontrolleHandler.activePruefer = '';
  check(App._sperrHalter() === 'Anna (Rechner XYZW)', `Sperrhalter nennt Person und Rechner statt „?" (${App._sperrHalter()})`);
  App.currentUser = ''; check(App._sperrHalter() === 'Rechner XYZW', 'Ohne Prüfer immerhin das Rechner-Kürzel');
  App.currentUser = 'Anna';
  // Sperre holen, Freigabe scheitert (removeEntry wirft) → Nonce gemerkt
  check(await App._acquireLock() === true, 'Sperre wird geholt');
  const nonce = App._lockNonce;
  const echtesRemove = dir.removeEntry;
  dir.removeEntry = async () => { const e = new Error('Failed to perform Safe Browsing check.'); e.name = 'AbortError'; throw e; };
  await App._releaseLock();
  check(App._lockVerwaist === nonce && store.has('lock_test'), 'Gescheiterte Freigabe: Sperrdatei bleibt liegen, eigene Kennung wird gemerkt');
  check(await App._acquireLock() === true, 'Eigene, nicht freigegebene Sperre wird sofort wieder übernommen (blockiert nicht 150 s)');
  // Die Übernahme hat eine neue Kennung geschrieben – diese gilt jetzt als verwaist
  App._lockVerwaist = App._lockNonce; App._lockVerwaistDatei = 'lock_test';
  dir.removeEntry = echtesRemove;
  check(await App._sperreAufraeumen() === true && !store.has('lock_test') && App._lockVerwaist === null, 'Aufräumen im Abgleich-Takt gibt die Sperre nachträglich frei');
  // Fremde Sperre wird niemals angefasst
  store.set('lock_test', { data: JSON.stringify({ u: 'Bernd (Rechner BBBB)', t: new Date().toISOString(), n: 'fremd' }), mtime: Date.now() });
  App._lockVerwaist = 'meins'; App._lockVerwaistDatei = 'lock_test';
  check(await App._sperreAufraeumen() === false && store.has('lock_test') && App._lockVerwaist === null, 'Fremde Sperre wird nicht freigegeben, eigener Merker verfällt');
  App._lockNonce = null; App._lockVerwaist = null;
  check(await App._acquireLock() === false && /Bernd/.test(App._lockInfo.von), 'Fremde frische Sperre blockiert weiterhin, Halter wird benannt');
  check(/lock\.n === this\._lockNonce \|\| lock\.n === this\._lockVerwaist/.test(APP_SRC), 'Übernahme nur bei nachweislich eigener Kennung');
  check(/safe browsing\/i\.test\(String\(e\.message/.test(APP_SRC) && /Safe Browsing/.test(APP_SRC.split('Kompaktierung fehlgeschlagen')[0].slice(-600)), 'Schreibfehler landet als Klartext-Grund in _compactGrund (inkl. Safe-Browsing-Hinweis)');
  check(/await this\._sperreAufraeumen\(\)/.test(APP_SRC.split('this._schedulePoll = () => {')[1] || ''), 'Aufräumen hängt am Abgleich-Takt');
  store.clear();
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
