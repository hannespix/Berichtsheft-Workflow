// ═══════════════════════════════════════════════════════════════════
//  Kontrolltag (Roadmap Paket C): Sperre mit Vorrang, Modal-Pfad mit Undo,
//  Wiedervorlage folgt dem Ergebnis, „In Ordnung" markiert Wochen als
//  geprüft, Auto-Zulassung nur im letzten Jahr, Nacherfassung schließt
//  Wiedervorlagen, PDF-Auswahl und Prüfer-Unterschrift
//  Ausführen:  node tests/kontrolltag-test.mjs
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
const K_SRC = read('src/js/modules/kontrolle.js');
const NE_SRC = read('src/js/modules/nacherfassung.js');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

// Minimaler DOM: Elemente je Id einstellbar (für das KW-Modal)
const elems = {};
const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, confirm: () => true,
  document: { getElementById: (id) => elems[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: {
    _stack: [], _redo: [],
    push(desc, undo, redo) { this._stack.push({ desc, undo, redo }); this._redo = []; },
    undo() { const e = this._stack.pop(); if (e) { e.undo(); this._redo.push(e); } return e; },
    redo() { const e = this._redo.pop(); if (e) { e.redo(); this._stack.push(e); } return e; },
    last() { return this._stack[this._stack.length - 1]; },
  },
  esc: (s) => String(s ?? ''), todayStr: () => '2026-03-10', formatDate: (d) => String(d || ''),
  addDaysStr: (n) => { const d = new Date('2026-03-10T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); },
  dateStr: (d) => d.toISOString().slice(0, 10),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'],
                         ['src/js/modules/kontrolle.js', 'KontrolleHandler'],
                         ['src/js/modules/kw-nav.js', 'KWNav'],
                         ['src/js/modules/nacherfassung.js', 'NacherfassungHandler']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, KontrolleHandler: KH, KWNav, NacherfassungHandler: NE, UndoManager } = sandbox;
App.db = db;
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {}; App.closeModal = () => {};
KH.renderSchueler = () => {}; KH.renderUebersicht = () => {}; KH._focusNextKW = () => {};
KH.startLiveSync = () => {}; KH.saveAndRelease = () => {};

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const kwRow = (sid, aj, kw) => App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw])[0];
const wvVon = (keId) => App.query('SELECT * FROM wiedervorlagen WHERE kontrollergebnis_id=? ORDER BY id', [keId]);

// ── Testdaten: 3 Azubis im 2. Ausbildungsjahr, Kontrolltermin 10.03.2026 ──
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende) VALUES
  (1,'Erst','Anna',1,'2024-09-01','2027-08-31'),
  (2,'Zweit','Bernd',1,'2024-09-01','2027-08-31'),
  (3,'Dritt','Clara',1,'2024-09-01','2027-08-31')`);
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-03-10','geplant')`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,geprueft_kws) VALUES (100,10,1,'{}'), (200,10,2,'{}'), (300,10,3,'{}')`);
KH.currentTerminId = 10;
KH.currentSchuelerList = App.query('SELECT * FROM schueler ORDER BY id');
KH.activePruefer = 'Anna Berater';
KH.currentIndex = 0;

console.log('══ C1: Zwei Prüfer öffnen denselben Termin – kein gegenseitiges Sperren ══');
{
  App._otherPositions = [];
  check(KH._ersterOffenerIndex() === 0, 'Ohne Kollegen: erster offener Azubi = Nr. 1');
  const vor1Min = new Date(Date.now() - 60000).toISOString();
  App._otherPositions = [{ pruefer: 'Kollege', terminId: 10, schuelerId: 1, schuelerName: 'Erst', seit: vor1Min }];
  check(KH._ersterOffenerIndex() === 1, 'Kollege steht auf Nr. 1 → Einstieg bei Nr. 2');
  KH.enterSchüler = function () { this._entered = this.currentIndex; };
  KH.currentIndex = 0;
  KH.nextOffen(true);
  check(KH._entered === 1 && KH.currentIndex === 1, '„Nächster offener" überspringt den belegten Azubi');
  App._otherPositions = [
    { pruefer: 'Kollege', terminId: 10, schuelerId: 1, seit: vor1Min },
    { pruefer: 'Dritter', terminId: 10, schuelerId: 2, seit: vor1Min },
    { pruefer: 'Vierter', terminId: 10, schuelerId: 3, seit: vor1Min }];
  check(KH._ersterOffenerIndex() === 0, 'Alle offenen belegt → notfalls der erste offene (kein Endlos-Sprung)');
  // Vorrang: wer früher da war, behält den Azubi; Gleichstand entscheidet der Name
  KH._posSeit = Date.now();
  const lockFrueher = { pruefer: 'Kollege', terminId: 10, schuelerId: 1, seit: vor1Min };
  check(KH._lockGiltFuerMich(lockFrueher) === lockFrueher, 'Kollege war früher da → Sperre gilt für mich');
  const lockSpaeter = { pruefer: 'Kollege', terminId: 10, schuelerId: 1, seit: new Date(Date.now() + 60000).toISOString() };
  check(KH._lockGiltFuerMich(lockSpaeter) === null, 'Kollege kam später → er sieht die Sperre, nicht ich');
  const gleichZ = { pruefer: 'Zed', terminId: 10, schuelerId: 1, seit: new Date(Date.now() + 2000).toISOString() };
  const gleichA = { pruefer: 'Aaron', terminId: 10, schuelerId: 1, seit: new Date(Date.now() + 2000).toISOString() };
  check(KH._lockGiltFuerMich(gleichZ) === null && KH._lockGiltFuerMich(gleichA) === gleichA, 'Gleichzeitiger Einstieg: der alphabetisch frühere Name behält den Azubi');
  KH.currentIndex = 0;
  KH.overrideLock();
  check(KH._lockGiltFuerMich(lockFrueher) === null, 'Aufgehobene Sperre kommt beim nächsten Abgleich nicht zurück');
  KH._lockOverrides.clear();
  App._otherPositions = [];
  check(/_writePositionFile\(pruefer, terminId, schuelerId, schuelerName, seit, bereich(, versuch = 0)?\)/.test(APP_SRC) && /data\.seit \|\| data\.ts/.test(APP_SRC), 'Positionsdatei trägt den Einstiegszeitpunkt getrennt vom Heartbeat');
  check((K_SRC.match(/App\._writePositionFile\([\s\S]*?\);/g) || []).every(c => /this\._bereich\)/.test(c)), 'Jeder Positions-Schreibvorgang übergibt Einstiegszeitpunkt und Bereich');
}

console.log('\n══ C2: Modal-Pfad (Leertaste/Enter) mit Mängel-Historie und Undo ══');
{
  KH.nextOffen = () => {};
  KH._kwModalContext = null;
  KWNav.persistCodes(100, 1, 40, 'A,B', 0, 1, false);
  KH.saveKWOk(100, 1, 40);
  let r = kwRow(1, 1, 40);
  check(r && r.maengel_codes === '' && r.geprueft === 1, '„Keine Beanstandungen" im Modal: Woche geprüft, keine Mängel');
  check((r.behobene_codes || '').split(',').sort().join(',') === 'A,B', `Entfernte Codes stehen in der Historie (${r.behobene_codes})`);
  UndoManager.undo();
  r = kwRow(1, 1, 40);
  check(r && r.maengel_codes === 'A,B' && r.behobene_codes === '', 'Undo stellt die Mängel wieder her (Historie zurückgesetzt)');
  UndoManager.redo();
  check(kwRow(1, 1, 40)?.maengel_codes === '', 'Redo räumt wieder auf');

  // Modal speichern: Codes + Fehltage + Bemerkung, Azubi aus dem KE (nicht aus currentIndex)
  KH.currentIndex = 2; // angezeigt ist ein anderer Azubi
  elems.kwc_C = { checked: true }; elems.kwFehltage = { value: '2' }; elems.kwBemText = { value: 'Wetter fehlt' };
  KH.saveKW(100, 1, 41);
  r = kwRow(1, 1, 41);
  check(r && r.maengel_codes === 'C,H' && r.fehltage === 2 && r.bemerkung === 'Wetter fehlt', `Modal speichert Codes, Fehltage und Bemerkung beim RICHTIGEN Azubi (${r?.maengel_codes}/${r?.fehltage})`);
  check(!kwRow(3, 1, 41), 'Angezeigter Azubi 3 bleibt unberührt');
  check(App.scalar('SELECT fehltage_gesamt FROM kontrollergebnisse WHERE id=100') === 2, 'Fehltage gesamt nach Modal-Speichern nachgezogen');
  UndoManager.undo();
  check(!kwRow(1, 1, 41), 'Undo entfernt die Woche wieder komplett');
  UndoManager.redo();
  check(kwRow(1, 1, 41)?.bemerkung === 'Wetter fehlt', 'Redo bringt auch die Bemerkung zurück');
  KH.clearKW(100, 1, 41);
  check(kwRow(1, 1, 41)?.maengel_codes === '' && kwRow(1, 1, 41)?.behobene_codes === 'C,H', 'Leeren im Modal protokolliert die Historie');
  check(UndoManager.last().desc.startsWith('KW 41 geleert'), 'Leeren ist rückgängig machbar');
  delete elems.kwc_C; delete elems.kwFehltage; delete elems.kwBemText;
  KH.currentIndex = 0;
}

console.log('\n══ C3: Wiedervorlage folgt dem Ergebnis ══');
{
  KH.currentIndex = 0;
  KH.saveField('ergebnis', 'nachholung_naechste_durchsicht');
  let wv = wvVon(100);
  check(wv.length === 1 && wv[0].art === 'nachholung_naechste_durchsicht' && wv[0].status === 'offen', 'Mangel-Ergebnis legt genau eine offene WV mit passender Art an');
  check(App.scalar('SELECT pruefer FROM kontrollergebnisse WHERE id=100') === 'Anna Berater', 'Prüfer des Ergebnisses wird am Kontrollergebnis festgehalten');
  KH.saveField('ergebnis', 'post_an_rp');
  wv = wvVon(100);
  check(wv.length === 1 && wv[0].art === 'post_an_rp', 'Ergebniswechsel zieht die WV-Art nach (keine zweite WV)');
  KH.saveField('ergebnis', 'in_ordnung');
  wv = wvVon(100);
  check(wv[0].status === 'erledigt', '„In Ordnung" schließt die WV');
  KH.saveField('ergebnis', 'sachberichte_wetter_email');
  wv = wvVon(100);
  check(wv.length === 1 && wv[0].status === 'offen' && wv[0].art === 'sachberichte_wetter_email' && wv[0].erledigt_datum === '', 'Erneuter Mangel nach „In Ordnung" öffnet die WV wieder');
  UndoManager.undo();
  wv = wvVon(100);
  check(wv[0].status === 'erledigt' && wv[0].art === 'post_an_rp', 'Undo des Ergebniswechsels stellt die WV zurück');
  check(App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE id=100') === 'in_ordnung', 'Undo stellt das Ergebnis zurück');
  // Erst-Anlage rückgängig: die WV verschwindet wieder
  KH.currentIndex = 2;
  KH.saveField('ergebnis', 'post_an_rp');
  check(wvVon(300).length === 1, 'Azubi 3: WV angelegt');
  UndoManager.undo();
  check(wvVon(300).length === 0 && App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE id=300') === '', 'Undo entfernt die erst angelegte WV wieder');
  KH.currentIndex = 0;
}

console.log('\n══ C4: „✓ i.O." markiert die Wochen bis zur Vorwoche als geprüft ══');
{
  const r = KH._markOK([2]);
  check(r.count === 1, 'Azubi 2 als In Ordnung markiert');
  check(App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE id=200') === 'in_ordnung', 'Ergebnis gesetzt');
  check(App.scalar('SELECT pruefer FROM kontrollergebnisse WHERE id=200') === 'Anna Berater', 'Prüfer festgehalten');
  // Termin 10.03.2026 → Vorwoche = KW 10 im 2. Ausbildungsjahr (Beginn 09/2024)
  check(kwRow(2, 2, 10)?.geprueft === 1, 'KW 10 / AJ 2 (Vorwoche) ist geprüft');
  check(!kwRow(2, 2, 11), 'KW 11 (Kontrollwoche selbst) bleibt ungeprüft');
  check(kwRow(2, 2, 36)?.geprueft === 1 && kwRow(2, 1, 20)?.geprueft === 1, 'Kaskade: Schuljahresbeginn AJ 2 und ganzes AJ 1 geprüft');
  const gk = JSON.parse(App.scalar('SELECT geprueft_kws FROM kontrollergebnisse WHERE id=200'));
  check(Array.isArray(gk['2']) && gk['2'].includes(10) && !gk['2'].includes(11), 'Geprüft-Liste des Kontrollergebnisses passt');
  // Vorhandene Mängel bleiben unangetastet
  KWNav.persistCodes(300, 1, 45, 'D', 0, 3, false);
  KH._markOK([3]);
  check(kwRow(3, 1, 45)?.maengel_codes === 'D', 'Bestehender Mangel in einer früheren Woche bleibt beim Schnellweg erhalten');
  App.run("UPDATE kontrollergebnisse SET ergebnis='' WHERE id=300");
}

console.log('\n══ C5: Auto-Zulassung nur im letzten Ausbildungsjahr ══');
{
  check(/const imLetztenAJ = /.test(K_SRC) && /const autoZulassung = bedingungenOK && imLetztenAJ;/.test(K_SRC), 'Automatik an das letzte Ausbildungsjahr gebunden');
  check(/needsAttention = isDone && !bedingungenOK/.test(K_SRC), 'Warnhinweis bezieht sich weiter auf die Bedingungen, nicht auf die Automatik');
  const ajs = App.getSchuelerAJs(1);
  check(ajs[ajs.length - 1] === 3, `Letztes Ausbildungsjahr des Testazubis = 3 (${JSON.stringify(ajs)})`);
}

console.log('\n══ C6: Nacherfassung schließt alte Wiedervorlagen, rückdatierte Mängel gelten als behoben ══');
{
  // Azubi 3: alte Durchsicht 15.01.2026 mit offener WV; spätere Durchsicht 01.06.2026 in Ordnung
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,durchgefuehrt_datum,status) VALUES (5,'2026-01-15','2026-01-15','durchgefuehrt'), (6,'2026-06-01','2026-06-01','durchgefuehrt')`);
  db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,geprueft_kws) VALUES (500,5,3,'nachholung_naechste_durchsicht','{}'), (600,6,3,'in_ordnung','{}')`);
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (50,500,3,'nachholung_naechste_durchsicht','2026-02-15','ueberfaellig')`);
  const s3 = App.query('SELECT * FROM schueler WHERE id=3')[0];
  // a) Nacherfassung 01.03.2026 „In Ordnung" → alte WV erledigt
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,durchgefuehrt_datum,status,bemerkung) VALUES (7,'2026-03-01','2026-03-01','durchgefuehrt','Nacherfassung')`);
  NE.erfasseAzubi(7, s3, { ergebnis: 'in_ordnung', codes: '', bemerkung: '', wvDate: '', fehltageGesamt: null, bisKW: 0 }, '2026-03-01', 'Nach Erfasser');
  const w50 = App.query('SELECT * FROM wiedervorlagen WHERE id=50')[0];
  check(w50.status === 'erledigt' && w50.erledigt_datum === '2026-03-01', `Alte WV durch nacherfasste „In Ordnung"-Durchsicht erledigt (${w50.status})`);
  check(App.scalar('SELECT pruefer FROM kontrollergebnisse WHERE kontrolltermin_id=7 AND schueler_id=3') === 'Nach Erfasser', 'Nacherfassung hält den Prüfer fest');
  // b) Nacherfassung 01.04.2026 mit Mangel A in KW 12 – die Durchsicht vom 01.06. war aber schon in Ordnung
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,durchgefuehrt_datum,status,bemerkung) VALUES (8,'2026-04-01','2026-04-01','durchgefuehrt','Nacherfassung')`);
  App.run("UPDATE wiedervorlagen SET status='offen', erledigt_datum='', erledigt_bemerkung='' WHERE id=50");
  NE.erfasseAzubi(8, s3, { ergebnis: 'berichte_bis_termin_email', codes: 'A', bemerkung: '', wvDate: '2026-04-29', fehltageGesamt: null, bisKW: 12 }, '2026-04-01', 'Nach Erfasser');
  const r = kwRow(3, 2, 12);
  check(r && r.maengel_codes === '' && r.behobene_codes === 'A' && r.behoben_bei === 600, `Rückdatierter Mangel gilt durch die jüngere „In Ordnung"-Durchsicht als behoben (${r?.maengel_codes}/${r?.behobene_codes})`);
  const w50b = App.query('SELECT * FROM wiedervorlagen WHERE id=50')[0];
  check(w50b.status === 'erledigt' && /Überholt/.test(w50b.erledigt_bemerkung), 'Ältere WV wird durch die nacherfasste Mangel-Durchsicht als überholt geschlossen');
  const neueWV = App.query("SELECT * FROM wiedervorlagen WHERE schueler_id=3 AND status='offen'");
  check(neueWV.length === 1 && neueWV[0].art === 'berichte_bis_termin_email' && neueWV[0].frist_datum === '2026-04-29', 'Genau eine neue offene WV zum nacherfassten Ergebnis');
  // c) Jüngere WV bleibt unberührt, wenn die Nacherfassung ÄLTER ist
  db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (60,600,3,'post_an_rp','2026-07-01','offen')`);
  db.run(`INSERT INTO kontrolltermine (id,geplant_datum,durchgefuehrt_datum,status,bemerkung) VALUES (9,'2025-11-05','2025-11-05','durchgefuehrt','Nacherfassung')`);
  NE.erfasseAzubi(9, s3, { ergebnis: 'in_ordnung', codes: '', bemerkung: '', wvDate: '', fehltageGesamt: null, bisKW: 0 }, '2025-11-05', 'Nach Erfasser');
  check(App.scalar('SELECT status FROM wiedervorlagen WHERE id=60') === 'offen', 'WV einer JÜNGEREN Durchsicht bleibt bei rückdatierter Nacherfassung offen');
}

console.log('\n══ C7: PDF-Auswahl und Unterschrift ══');
{
  check(/exportTerminPDF\(tid, mangelIds\)/.test(K_SRC), 'Abschluss-Assistent übergibt nur die mangelhaften Azubis');
  check(/exportTerminPDF\(terminId, nurIds\)/.test(read('src/js/modules/planung.js')), 'exportTerminPDF filtert nach Auswahl');
  check(/ke\?\.pruefer \|\| termin\.pruefer \|\| ke\?\.geaendert_von/.test(read('src/js/modules/pdf-export.js')), 'Unterschrift im Bogen = Prüfer des Ergebnisses, nicht letzter Schreiber');
  check(/ke\.pruefer \|\| ke\.geaendert_von \|\| termin\?\.pruefer/.test(K_SRC), 'Archiv-Snapshot übernimmt den Prüfer des Ergebnisses');
  // Migrations-Parität für die neue Spalte
  const diskDb = new SQL.Database();
  diskDb.run(`CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY AUTOINCREMENT, kontrolltermin_id INTEGER, schueler_id INTEGER, ergebnis TEXT DEFAULT '')`);
  for (const t of ['schueler','kontrolltermine','berufsschulen','klassen','abschlussjahrgaenge','fachrichtungen','wiedervorlagen']) diskDb.run(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
  App._migrateDiskDb(diskDb);
  const cols = []; const st = diskDb.prepare('PRAGMA table_info(kontrollergebnisse)'); while (st.step()) cols.push(st.getAsObject().name); st.free();
  check(cols.includes('pruefer'), 'Spalte pruefer auch auf der Disk-Datenbank');
  diskDb.close();
  check((APP_SRC.match(/ADD COLUMN pruefer TEXT DEFAULT ''/g) || []).length >= 2 && /pruefer TEXT DEFAULT '',\n/.test(APP_SRC), 'Spalte pruefer in SCHEMA, migrateDB() und _migrateDiskDb()');
}

console.log('\n══ Stufe 2 (2): Prüferaufteilung, Ergebnis-Kürzel, heutige KW, Undo-Verlauf ══');
{
  const KW_SRC = read('src/js/modules/kw-nav.js');
  const KS_SRC = read('src/js/modules/keyboard-shortcuts.js');
  KH._viewMode = 'uebersicht';
  App._otherPositions = [];
  App.run("UPDATE kontrollergebnisse SET ergebnis='' WHERE id IN (100,200,300)");
  KH._bereich = null;
  check(KH._ersterOffenerIndex() === 0, 'Ohne Aufteilung: Nr. 1');
  KH._bereich = { von: 2, bis: 3 };
  check(KH._ersterOffenerIndex() === 1, 'Eigener Bereich #2–3 → Einstieg bei Nr. 2');
  KH._bereich = null;
  App._otherPositions = [{ pruefer: 'Kollege', terminId: 10, schuelerId: null, bereich: { von: 1, bis: 2 } }];
  check(KH._ersterOffenerIndex() === 2, 'Bereich des Kollegen #1–2 wird übersprungen → Nr. 3');
  KH._bereich = { von: 1, bis: 1 };
  check(KH._ersterOffenerIndex() === 0, 'Eigener Bereich schlägt den fremden (Überschneidung bewusst gewählt)');
  KH._bereich = null; App._otherPositions = [];
  check(/b: bereich && bereich\.von \? \[bereich\.von, bereich\.bis\] : null/.test(APP_SRC) && /bereich: Array\.isArray\(data\.b\)/.test(APP_SRC), 'Positionsdatei trägt den Bereich, Leser werten ihn aus');
  check(/saveAndRelease\(\) \{\n    this\.microSave\(\);\n  \},/.test(K_SRC), 'Azubi-Wechsel löscht die Positionsdatei nicht mehr (nur Überschreiben)');
  check(/if \(this\._bereich && this\.currentTerminId\) App\._writePositionFile\(pruefer, this\.currentTerminId, null/.test(K_SRC), 'Zurück in die Übersicht: Bereich bleibt für Kollegen sichtbar');
  // Ergebnis-Kürzel
  KH._viewMode = 'einzeln'; KH.currentIndex = 2;
  KH.setzeErgebnisKurz(2);
  check(App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE id=300') === 'nachholung_naechste_durchsicht', 'Shift+2 setzt „Nachholung"');
  KH.setzeErgebnisKurz(0);
  check(App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE id=300') === '', 'Shift+0 setzt zurück');
  check(/\/\^Digit\[0-6\]\$\/\.test\(e\.code\)/.test(KS_SRC) && /KontrolleHandler\.springeZuAktuellerKW\(\)/.test(KS_SRC), 'Tastenkürzel Shift+1–6 und J sind verdrahtet');
  // i.O. in der Einzelansicht markiert bis zur Vorwoche
  // (die Wochen von Azubi 1 im AJ 2 stammen ausschließlich aus dem
  //  „In Ordnung" der Einzelansicht in Abschnitt C3 – _markOK lief nur für 2 und 3)
  KH.currentIndex = 0;
  check(kwRow(1, 2, 10)?.geprueft === 1 && kwRow(1, 2, 36)?.geprueft === 1 && !kwRow(1, 2, 11), 'In Ordnung (Einzelansicht) markiert die Wochen bis zur Vorwoche als geprüft');
  check(/try \{ this\._markiereGeprueftBisVorwoche\(keId, s\.id\); \}/.test(K_SRC), 'saveField(in_ordnung) nutzt dieselbe Markierung wie der Schnellweg');
  // heutige KW
  const heute = new Date();
  const ziel = KH.springeZuAktuellerKW();
  const erwartet = App.ajKwFuerStichtag(1, heute, App._isoKW(heute));
  check(ziel && ziel.aj === erwartet.aj && ziel.kw === erwartet.kw, `Sprung zur heutigen KW (AJ ${ziel?.aj}, KW ${ziel?.kw})`);
  // Undo-Verlauf: nur Kontrolle, Beschreibung mit Azubi, leeren beim Terminwechsel
  check(/if \(App\.currentView !== 'kontrolle'\) return App\.toast\('Rückgängig gibt es nur in der Kontrolle/.test(KS_SRC), 'Strg+Z außerhalb der Kontrolle greift nicht');
  check(/UndoManager\.clear && UndoManager\.clear\(\)/.test(K_SRC) && /clear\(\) \{ this\._stack = \[\]; this\._redoStack = \[\]; \}/.test(read('src/js/modules/undo-manager.js')), 'Undo-Verlauf wird beim Terminwechsel geleert');
  KH._kwModalContext = null;
  KWNav.persistCodes(100, 1, 44, 'A', 0, 1, false);
  KH.saveKWOk(100, 1, 44);
  check(/– Erst$/.test(UndoManager.last().desc), `Undo-Beschreibung nennt den Azubi (${UndoManager.last().desc})`);
  check(/const zu = this\._ajZustand\.has\(aj\)/.test(K_SRC) && /frueher && !maengelCount && geprueftCount >= activeCount/.test(K_SRC), 'Frühere, vollständig geprüfte Ausbildungsjahre sind eingeklappt');
}

console.log('\n══ Sticky-Kopf der Einzelansicht ══');
{
  check(/id="azubiSticky"/.test(K_SRC) && /<span class="as-nr">#\$\{this\.currentIndex \+ 1\}\/\$\{total\}<\/span>/.test(K_SRC) && /c\.innerHTML = `\$\{stickyHtml\}\$\{kwLegendHtml\}/.test(K_SRC), 'Aktueller Azubi steht in einem Sticky-Kopf über der Legende (Nr., Name, Ergebnis, Betrieb/Klasse, Navigation)');
  const CSS = read('src/css/styles.css');
  check(/\.azubi-sticky \{[\s\S]*position: sticky;[\s\S]*z-index: 21;/.test(CSS) && /top: 33px; \/\* unter dem Azubi-Kopf \*\//.test(CSS), 'Legende klebt unter dem Azubi-Kopf');
}

console.log('\n══ 1.1 / 1.5 „geführt / nicht geführt“ mit Hinweis in der Bemerkung ══');
{
  const H11 = App.HINWEISE_NICHT_GEFUEHRT.p_1_1_gefuehrt, H15 = App.HINWEISE_NICHT_GEFUEHRT.p_1_5_gefuehrt;
  check(/1\.1/.test(H11) && /anzukreuzen/.test(H11) && /1\.5/.test(H15) && /Zusammenstellung/.test(H15), 'Beide Hinweistexte vorhanden und klar zugeordnet');
  // Reine Textlogik
  const b = App.bemerkungMitHinweis;
  check(b.call(App, '', 'p_1_1_gefuehrt', 'nein') === H11, 'Leere Bemerkung: Hinweis wird eingesetzt');
  check(b.call(App, 'Sauber geführt', 'p_1_1_gefuehrt', 'nein') === 'Sauber geführt\n' + H11, 'Vorhandener Text bleibt, Hinweis kommt auf eine eigene Zeile');
  check(b.call(App, b.call(App, 'X', 'p_1_1_gefuehrt', 'nein'), 'p_1_1_gefuehrt', 'nein') === 'X\n' + H11, 'Zweimal „nicht geführt“ ergibt den Hinweis nur einmal');
  check(b.call(App, 'X\n' + H11, 'p_1_1_gefuehrt', 'ja') === 'X', '„geführt“ entfernt den Hinweis, der Rest bleibt');
  check(b.call(App, 'X\n' + H11, 'p_1_1_gefuehrt', '') === 'X', 'Zurück auf „–“ entfernt den Hinweis ebenfalls');
  const handgeaendert = H11.replace('laufend', 'fortlaufend');
  check(b.call(App, handgeaendert, 'p_1_1_gefuehrt', 'ja') === handgeaendert, 'Von Hand geänderte Fassung wird nicht angetastet');
  check(b.call(App, 'A\n' + H11 + '\n' + H15, 'p_1_1_gefuehrt', 'ja') === 'A\n' + H15, 'Die Hinweise zu 1.1 und 1.5 sind unabhängig voneinander');

  // Über die echte Eingabe (saveField) am Azubi 2
  KH.currentIndex = 1;
  KH._pruefeAbgeschlossen = () => true;
  const ke = () => App.query('SELECT * FROM kontrollergebnisse WHERE id=200')[0];
  App.run("UPDATE kontrollergebnisse SET bemerkung='Wochenberichte knapp', p_1_1_gefuehrt='', p_1_5_gefuehrt='' WHERE id=200");
  elems.keBemerkung = { value: 'Wochenberichte knapp' };
  KH.saveField('p_1_1_gefuehrt', 'nein');
  check(ke().p_1_1_gefuehrt === 'nein', '1.1 „nicht geführt“ wird gespeichert');
  check(ke().bemerkung === 'Wochenberichte knapp\n' + H11, 'Hinweis steht in der Bemerkung, eigener Text bleibt davor');
  check(elems.keBemerkung.value === ke().bemerkung, 'Das Bemerkungsfeld auf dem Bildschirm zeigt den neuen Text sofort');
  KH.saveField('p_1_5_gefuehrt', 'nein');
  check(ke().bemerkung === 'Wochenberichte knapp\n' + H11 + '\n' + H15, '1.5 „nicht geführt“ ergänzt den zweiten Hinweis');
  UndoManager.undo();
  check(ke().p_1_5_gefuehrt === '' && ke().bemerkung === 'Wochenberichte knapp\n' + H11, 'Rückgängig nimmt Wert UND Hinweis zurück');
  UndoManager.redo();
  check(ke().p_1_5_gefuehrt === 'nein' && ke().bemerkung.endsWith(H15), 'Wiederholen setzt beides erneut');
  KH.saveField('p_1_1_gefuehrt', 'ja');
  check(ke().p_1_1_gefuehrt === 'ja' && !ke().bemerkung.includes(H11) && ke().bemerkung.includes(H15), '„geführt“ entfernt nur den Hinweis zu 1.1');
  // „Alle OK“
  KH.setAllPflichtOK();
  check(ke().p_1_1_gefuehrt === 'ja' && ke().p_1_5_gefuehrt === 'ja', '„Alle OK“ setzt beide auf „geführt“');
  check(ke().bemerkung === 'Wochenberichte knapp', '„Alle OK“ räumt die Hinweise aus der Bemerkung');
  // „In Ordnung“ füllt nur leere Felder, überschreibt nie ein „nicht geführt“
  App.run("UPDATE kontrollergebnisse SET ergebnis='', p_1_1_gefuehrt='', p_1_5_gefuehrt='nein' WHERE id=200");
  KH.nextOffen = () => {};
  KH.saveField('ergebnis', 'in_ordnung');
  check(ke().p_1_1_gefuehrt === 'ja', '„In Ordnung“ setzt ein leeres Feld auf „geführt“');
  check(ke().p_1_5_gefuehrt === 'nein', '„In Ordnung“ überschreibt ein bewusstes „nicht geführt“ NICHT');
  App.run("UPDATE kontrollergebnisse SET ergebnis='' WHERE id=200");
  // Schema an den drei Pflichtstellen
  const schema = APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1];
  check(/p_1_1_gefuehrt TEXT/.test(schema) && /p_1_5_gefuehrt TEXT/.test(schema), 'SCHEMA enthält beide Spalten');
  check(/keCols\.includes\('p_1_1_gefuehrt'\)/.test(APP_SRC) && /keCols\.includes\('p_1_5_gefuehrt'\)/.test(APP_SRC), 'migrateDB() zieht beide nach');
  const disk = APP_SRC.split('_migrateDiskDb(diskDb) {')[1].split('\n  },')[0];
  check(/ADD COLUMN p_1_1_gefuehrt/.test(disk) && /ADD COLUMN p_1_5_gefuehrt/.test(disk), '_migrateDiskDb() zieht beide nach');
  // Archiv und PDF
  check(/g_1_1: ke\.p_1_1_gefuehrt/.test(K_SRC) && /g_1_1: ke\.p_1_1_gefuehrt/.test(NE_SRC), 'Archiv (Kontrolle und Nacherfassung) hält den Wert fest');
  check(/nicht geführt/.test(read('src/js/modules/pdf-export.js')) && /p_1_1_gefuehrt/.test(read('src/js/modules/pdf-export.js')), 'Der Durchsichtsbogen (PDF) zeigt „geführt / nicht geführt“');
  check(/data-field="\$\{name\}"/.test(K_SRC) && /gefuehrtOptHtml\('p_1_1_gefuehrt'/.test(K_SRC) && /gefuehrtOptHtml\('p_1_5_gefuehrt'/.test(K_SRC), 'Beide Auswahlfelder stehen in der Eingabemaske');
  KH.currentIndex = 0;
}

console.log('\n══ UI-Paket 1: Kontrolltag ══');
{
  const V_SRC = read('src/js/modules/views.js');
  const CSS = read('src/css/styles.css');
  check(/id="terminWahlKurz" style="display:none"/.test(V_SRC) && /id="terminWahlVoll"/.test(V_SRC) && /id="selKontrolltermin"/.test(V_SRC), 'Terminwahl: Karte mit kurzer Zeile und voller Auswahl, Auswahl bleibt im DOM');
  check(/_terminZeile\(\) \{/.test(K_SRC) && /terminWechseln\(\) \{/.test(K_SRC) && (K_SRC.match(/this\._terminZeile\(\);/g) || []).length >= 2 && /this\.terminWechseln\(\);/.test(K_SRC), 'Nach dem Laden schrumpft die Terminwahl auf eine Zeile, „Termin wechseln“ klappt sie auf');
  check(/_terminAktionen\(t, fremde\) \{/.test(K_SRC) && /Workflows\.emailSchule\(\$\{tid\}\)/.test(K_SRC) && /Workflows\.seriendruckBetriebe\(\$\{tid\}\)/.test(K_SRC) && /PlanungHandler\.fremdeAemter\(\$\{tid\}\)/.test(K_SRC) && /PlanungHandler\.exportTerminPDF\(\$\{tid\}\)/.test(K_SRC) && /KontrolleHandler\.printUebersicht\(\$\{tid\}\)/.test(K_SRC), 'Termin-Menü: Anfrage/Ergebnisse, Betriebe, Ämter, PDFs, Druck – keine Funktion verloren');
  check(/_menue\(titel, eintraege, title, klasse\) \{ return App\.menue\(/.test(K_SRC) && /details class="aktionen-menue/.test(APP_SRC) && /this\.closest\('details'\)\.removeAttribute\('open'\)/.test(APP_SRC) && /\.aktionen-menue\.oben \.menue-liste \{ top: auto; bottom: calc\(100% \+ 4px\); \}/.test(CSS), 'Aufklappmenü: <details> im Kern (App.menue), schließt beim Klick, kann nach oben öffnen');
  check(/this\._menue\('Weitere Aktionen', \[/.test(K_SRC) && /KontrolleHandler\.quickSetAllAnwesend\(true\)/.test(K_SRC) && /KontrolleHandler\.markOffeneOK\(\)/.test(K_SRC) && /KontrolleHandler\.showAddSchueler\(\)/.test(K_SRC) && /\.\.\.this\._terminAktionen\(termin, fremdeCount\)/.test(K_SRC), 'Übersicht: Sammelaktionen und Termin-Aktionen im Menü „Weitere Aktionen“');
  check(!/Nach FR gruppieren<\/button>/.test(K_SRC) && /Nach Fachrichtung gruppieren/.test(K_SRC), 'FR-Gruppierung als Menüeintrag statt Kopfknopf');
  check((K_SRC.match(/KontrolleHandler\.abschliessen\(\)/g) || []).length === 2 && !/▤ Alle als PDF<\/button>/.test(K_SRC), 'Abschließen bleibt der Hauptknopf (Übersicht und Fortschritt), PDF-Knopf daneben entfällt');
  check(!/<!-- Prüfer \+ Suche \+ Live-Sync -->/.test(K_SRC) && !/← Topbar<\/span>/.test(K_SRC) && /id="kontrolleSearch"/.test(K_SRC) && /id="livePrueferBar"/.test(K_SRC) && /id="syncPulse"/.test(K_SRC), 'Prüfer-Karte entfällt (Prüfer steht in der Kopfzeile); Suche, Live-Anzeige und Kollegen-Positionen bleiben');
  check(/App\.uGet\('legend_hidden', '1'\) !== '0'/.test(K_SRC) && /legendeUmschalten\(an\) \{/.test(K_SRC) && /onclick="KontrolleHandler\.legendeUmschalten\(\)" title="Mängelcodes und Tastenkürzel ein-\/ausblenden">\?<\/button>/.test(K_SRC) && !/kwLegendShow/.test(K_SRC), 'Kürzel-Leiste standardmäßig aus, „?“ im Azubi-Kopf blendet sie ein');
  check(/aspect-ratio: 2 \/ 1;/.test(CSS) && /\.kw-cell \{\n  aspect-ratio: 2 \/ 1;/.test(CSS), 'Rasterzellen halb so hoch wie breit');
  check(/const kuenftig = ajJetzt && aj > ajJetzt && !geprueftCount && !maengelCount;/.test(K_SRC) && /\|\| kuenftig\)/.test(K_SRC) && /class="card-header aj-kopf"[^>]*onclick="KontrolleHandler\.toggleAJ\(\$\{aj\}, \$\{zu \? 'true' : 'false'\}\)"/.test(K_SRC) && /Künftiges Ausbildungsjahr – noch keine geprüfte Woche\./.test(K_SRC), 'Künftige Jahre ohne geprüfte Woche eingeklappt, Kopf klickbar');
  check(/onclick="event\.stopPropagation\(\)"/.test(K_SRC) && /display:\$\{zu \? 'none' : 'flex'\}/.test(K_SRC), 'Bereichsauswahl nur im aufgeklappten Jahr, Klick darauf klappt nicht zu');
  check(/<div class="ke-leiste" id="lockableLeiste"/.test(K_SRC) && /id="keBemerkung"/.test(K_SRC) && /id="wvSection" class="ke-wv"/.test(K_SRC) && /id="wvDatum"/.test(K_SRC) && /name="ergebnis"/.test(K_SRC) && /class="erg-pill/.test(K_SRC), 'Feste Leiste unten: Ergebnis-Pillen, Bemerkung, Wiedervorlage (Kennungen für Kürzel und saveField unverändert)');
  check(/\.ke-leiste \{ position: sticky; bottom: 0;/.test(CSS) && /\.erg-pill:has\(input:checked\)/.test(CSS), 'Leiste haftet am unteren Rand, gewählte Pille hebt sich ab');
  check(/‹ Zurück<\/button>/.test(K_SRC) && /✓ Fertig, nächster offener<\/button>/.test(K_SRC) && /Weiter ›<\/button>/.test(K_SRC) && !/Freigeben<\/button>/.test(K_SRC) && /Freigeben ohne Wechsel/.test(K_SRC) && /PDFExport\.generateSingle\(\$\{this\.currentTerminId\},\$\{s\.id\}\)/.test(K_SRC), 'Fußzeile: drei Knöpfe; PDFs und Freigeben ohne Wechsel im ⋯-Menü');
  check(/\['lockableContent', 'lockableLeiste'\]\.forEach/.test(K_SRC) && (K_SRC.match(/\['lockableContent', 'lockableLeiste'\]/g) || []).length === 2, 'Sperre durch Kollegen deckt auch die feste Leiste ab');
  check(/id="keGesichert"/.test(K_SRC) && /id="quickNavGrid"/.test(K_SRC) && /data-sync-progress-bar/.test(K_SRC) && /id="fehlGesamt"/.test(K_SRC) && /id="fehlPauschalAnzeige"/.test(K_SRC) && /fehlSumAj\$\{aj\}_display/.test(K_SRC), 'Kennungen für Live-Sync, Verlustschutz und Fehltage bleiben erhalten');
  check(/const sel = document\.getElementById\('selKontrolltermin'\);\n    if \(sel\) \{\n      \/\/ Aktuellen Termin vorwählen/.test(K_SRC), '„Termin wechseln“ wählt den aktuellen Termin vor');
  const toc = V_SRC.match(/const helpSections = \[([^\]]*)\]/)[1].split(',').map(x => x.trim().replace(/'/g, ''));
  const ids = [...V_SRC.matchAll(/id="help_(\d+)"/g)].map(m => +m[1]);
  check(!toc.includes('Azubi-Dashboard') && !toc.includes('Azubi-Rechner & Tarife') && !toc.includes('Phasen-Editor') && toc.includes('Ausbildungsverlauf (Phasen)') && toc.includes('Azubi-Akte'), 'Hilfe-Inhaltsverzeichnis ohne entfernte Module, Phasen-Editor im Ausbildungsverlauf');
  check(toc.length === ids.length && ids.every((n, i) => n === i) && !/⇄ Phasen-Editor/.test(V_SRC) && /Import-Schutz:/.test(V_SRC), `Jeder Eintrag hat genau ein Kapitel (${toc.length}), Kapitel fortlaufend nummeriert`);
  check(APP_SRC.includes("nacherfassung: 'help_20', wiedervorlagen: 'help_11', berichte: 'help_12', einstellungen: 'help_21'"), 'Kontexthilfe zeigt auf die neu nummerierten Kapitel');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
