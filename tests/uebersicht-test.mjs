// ═══════════════════════════════════════════════════════════════════
//  Übersicht der Durchsicht: Gruppieren, Sortieren, Klasse an der
//  Berufsschule (frei, je Azubi), Sammelaktionen
//  Ausführen:  node tests/uebersicht-test.mjs
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

let ok = 0, fehler = 0;
const check = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text); } else { fehler++; console.log('  ✗ FEHLER: ' + text); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const speicher = {};
const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem(k, v) { speicher[k] = String(v); }, removeItem(k) { delete speicher[k]; } },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { push() {}, clear() {} },
  confirm: () => true,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const App = sandbox.__App, KH = sandbox.KontrolleHandler;
App.db = db; App.demoMode = true; App.markDirty = () => {}; App.toast = () => {};
KH.renderUebersicht = () => {}; KH._uebSammelZeigen = () => {}; KH.saveAndRelease = () => {}; KH.enterSchüler = () => {};
KH.isLockedByOther = () => false;

// ── Testdaten: eine Schule, GaLaBau und Zierpflanzenbau, zwei Jahrgänge ──
db.run("INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'GL','GaLaBau','Gärtner'),(2,'ZP','Zierpflanzenbau','Gärtner'),(3,'BS','Baumschule','Gärtner')");
db.run("INSERT INTO berufsschulen (id,name) VALUES (1,'Schule A'),(2,'Schule B')");
db.run("INSERT INTO klassen (id,berufsschule_id,klassenbezeichnung) VALUES (1,1,'GaLaBau S2027'),(2,1,'Zierpfl. S2027'),(3,2,'GaLaBau S2027')");
const azubi = (id, nach, vor, fr, kl, betrieb, beginn, ende) => db.run('INSERT INTO schueler (id,nachname,vorname,aktiv,fachrichtung_id,klasse_id,ausbildungsstaette,ausbildungsbeginn,ausbildungsende) VALUES (?,?,?,1,?,?,?,?,?)', [id, nach, vor, fr, kl, betrieb, beginn, ende]);
azubi(1, 'Adler', 'Anna', 1, 1, 'Grünbau', '2024-09-01', '2027-08-31');
azubi(2, 'Bauer', 'Ben', 1, 1, 'Alpha Garten', '2024-09-01', '2027-08-31');
azubi(3, 'Conrad', 'Cora', 2, 2, 'Blumen Zeh', '2024-09-01', '2027-08-31');
azubi(4, 'Dorn', 'Dana', 1, 1, 'Grünbau', '2025-09-01', '2028-08-31');
azubi(5, 'Ernst', 'Emil', 3, 2, '', '2024-09-01', '2027-08-31');
azubi(6, 'Fuchs', 'Finn', 1, 3, 'Andere Schule GmbH', '2024-09-01', '2027-08-31');
db.run("INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-03-10','geplant')");
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend,geprueft_kws) VALUES
  (101,10,1,'in_ordnung',1,'{}'),(102,10,2,'',1,'{}'),(103,10,3,'post_an_rp',1,'{}'),(104,10,4,'',0,'{}'),(105,10,5,'',1,'{}')`);
KH.currentTerminId = 10;
KH.currentSchuelerList = App.query('SELECT * FROM schueler WHERE id <= 5 ORDER BY nachname');
KH.activePruefer = 'Pix';
App._otherPositions = [];
const namen = (idx) => idx.map(i => KH.currentSchuelerList[i].nachname).join(' ');
const gruppenText = () => KH._uebGruppen().map(g => `${g.label || '–'}: ${namen(g.indizes)}`).join(' | ');

console.log('\n══ Klasse an der Berufsschule (freies Feld je Azubi) ══');
{
  check(App.query('PRAGMA table_info(schueler)').some(c => c.name === 'schulklasse'), 'Spalte schueler.schulklasse im Schema');
  check(/ALTER TABLE schueler ADD COLUMN schulklasse TEXT DEFAULT ''/.test(APP_SRC.split('_migrateDiskDb(diskDb) {')[1].split('\n  },')[0]) && (APP_SRC.match(/ADD COLUMN schulklasse/g) || []).length === 2, 'Migration in migrateDB UND _migrateDiskDb');
  const alt = new SQL.Database(); alt.run('CREATE TABLE schueler (id INTEGER PRIMARY KEY, nachname TEXT)'); alt.run('CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT)');
  App._migrateDiskDb(alt);
  check(alt.exec('PRAGMA table_info(schueler)')[0].values.some(r => r[1] === 'schulklasse'), 'Alt-Datenbank bekommt die Spalte');
  check(App.schulklasseNormal('  G 2a   ') === 'G 2a' && App.schulklasseNormal(null) === '' && App.schulklasseNormal('x'.repeat(50)).length === App.SCHULKLASSE_MAX, 'Eingabe wird bereinigt (Leerzeichen, Länge)');
  check(App.setSchulklasse([1, 2], ' G2a ') === 2 && App.scalar('SELECT schulklasse FROM schueler WHERE id=1') === 'G2a', 'setSchulklasse setzt mehrere Azubis');
  check(App.setSchulklasse([1, 2, 4], 'G2a') === 1, 'nur geänderte Azubis werden geschrieben (zwei hatten die Klasse schon)');
  App.setSchulklasse(3, 'P2'); App.setSchulklasse(6, 'G2c');
  KH.currentSchuelerList = App.query('SELECT * FROM schueler WHERE id <= 5 ORDER BY nachname');
  const v = App.schulklassenVorschlaege(KH.currentSchuelerList);
  check(JSON.stringify(v) === '["G2a","P2"]', `Vorschläge: Klassen derselben Berufsschule, nicht die der anderen Schule (${JSON.stringify(v)})`);
  KH.klasseSetzen(5, ' P2 ');
  check(App.scalar('SELECT schulklasse FROM schueler WHERE id=5') === 'P2' && KH.currentSchuelerList.find(s => s.id === 5).schulklasse === 'P2', 'klasseSetzen speichert beim Azubi und führt die Liste nach');
  check(App.setSchulklasse([5], '') === 1 && App.scalar('SELECT schulklasse FROM schueler WHERE id=5') === '', 'leerer Wert entfernt die Klasse');
  KH.currentSchuelerList = App.query('SELECT * FROM schueler WHERE id <= 5 ORDER BY nachname');
}

console.log('\n══ Gruppieren und Sortieren ══');
{
  const o0 = KH.uebOrdnung();
  check(o0.gruppe === '' && o0.sort === 'nr' && o0.ab === false, 'Vorgabe: keine Gruppe, Reihenfolge der Liste (#)');
  check(gruppenText() === '–: Adler Bauer Conrad Dorn Ernst', `ohne Einstellung wie bisher (${gruppenText()})`);
  KH.uebGruppeSetzen('klasse');
  check(gruppenText() === 'G2a: Adler Bauer Dorn | P2: Conrad | Ohne Klasse: Ernst', `nach Klasse, ohne Klasse am Ende (${gruppenText()})`);
  KH.uebGruppeSetzen('fachrichtung');
  check(gruppenText() === 'Baumschule: Ernst | GaLaBau: Adler Bauer Dorn | Zierpflanzenbau: Conrad', `nach Fachrichtung (${gruppenText()})`);
  KH.uebGruppeSetzen('lehrjahr');
  check(gruppenText() === '1. Lehrjahr: Dorn | 2. Lehrjahr: Adler Bauer Conrad Ernst', `nach Lehrjahr zum Termin (${gruppenText()})`);
  KH.uebGruppeSetzen('fachklasse');
  check(gruppenText() === 'GaLaBau S2027: Adler Bauer Dorn | Zierpfl. S2027: Conrad Ernst', `nach Jahrgang · Fachrichtung der Stammdaten (${gruppenText()})`);
  KH.uebGruppeSetzen('stand');
  check(gruppenText() === 'Offen: Bauer Ernst | Beanstandet: Conrad | In Ordnung: Adler | Abwesend: Dorn', `nach Stand, Offene zuerst (${gruppenText()})`);
  KH.uebGruppeSetzen('betrieb');
  check(gruppenText() === 'Alpha Garten: Bauer | Blumen Zeh: Conrad | Grünbau: Adler Dorn | Ohne Betrieb: Ernst', `nach Betrieb (${gruppenText()})`);
  // Zuständiges Amt: eigenes Amt zuerst, fremde nach Nummer, ohne Amt am Ende
  App.run("UPDATE schueler SET zustaendiges_amt='93' WHERE nachname IN ('Adler','Dorn')");
  App.run("UPDATE schueler SET zustaendiges_amt='19' WHERE nachname='Bauer'");
  App.run("UPDATE schueler SET zustaendiges_amt='91' WHERE nachname='Conrad'");
  App.run("UPDATE schueler SET zustaendiges_amt='' WHERE nachname='Ernst'");
  const amtVorher = KH.currentSchuelerList.map(x => x.zustaendiges_amt);
  KH.currentSchuelerList.forEach(x => { x.zustaendiges_amt = App.scalar('SELECT zustaendiges_amt FROM schueler WHERE id=?', [x.id]) || ''; });
  KH.uebGruppeSetzen('amt');
  check(gruppenText() === '93 RP Freiburg (eigenes Amt): Adler Dorn | 19 Brsg-Hochschw.: Bauer | 91 RP Stuttgart: Conrad | Ohne zuständiges Amt: Ernst', `nach zuständigem Amt, eigenes zuerst (${gruppenText()})`);
  KH.uebGruppeSetzen(''); KH.uebSortSetzen('amt');
  check(gruppenText() === '–: Bauer Conrad Adler Dorn Ernst', `Sortierung nach zuständigem Amt, ohne Amt am Ende (${gruppenText()})`);
  check(KH.UEB_GRUPPEN.some(g => g[0] === 'amt' && g[1] === 'Zuständiges Amt') && KH.UEB_SORT.some(g => g[0] === 'amt') && KH.UEB_OHNE.amt === 'Ohne zuständiges Amt', 'Zuständiges Amt steht in Gruppieren und Sortieren');
  KH.currentSchuelerList.forEach((x, i) => { x.zustaendiges_amt = amtVorher[i]; App.run('UPDATE schueler SET zustaendiges_amt=? WHERE id=?', [amtVorher[i] || '', x.id]); });
  KH.uebGruppeSetzen('');
  KH.uebSortSetzen('betrieb');
  check(gruppenText() === '–: Bauer Conrad Adler Dorn Ernst', `Sortierung Betrieb, leere ans Ende, Gleichstand in Listenreihenfolge (${gruppenText()})`);
  KH.uebSortSetzen('betrieb', true);
  check(KH.uebOrdnung().ab === true, 'derselbe Spaltenkopf noch einmal kehrt die Richtung um');
  KH.uebSortSetzen('name', true);
  check(KH.uebOrdnung().sort === 'name' && KH.uebOrdnung().ab === false, 'anderer Spaltenkopf: neue Sortierung, wieder aufsteigend');
  KH.uebSortRichtung();
  check(gruppenText() === '–: Ernst Dorn Conrad Bauer Adler', `Name absteigend (${gruppenText()})`);
  KH.uebGruppeSetzen('klasse'); KH.uebSortSetzen('lehrjahr');
  check(gruppenText() === 'G2a: Dorn Adler Bauer | P2: Conrad | Ohne Klasse: Ernst', `Gruppe Klasse, darin nach Lehrjahr (${gruppenText()})`);
  App.uSet('ueb_gruppe', 'quatsch'); App.uSet('ueb_sort', 'quatsch');
  check(KH.uebOrdnung().gruppe === '' && KH.uebOrdnung().sort === 'nr', 'unbekannte gemerkte Werte fallen auf die Vorgabe zurück');
}

console.log('\n══ „Weiter“ und „nächster offener“ folgen der Reihenfolge ══');
{
  App.uSet('ueb_gruppe', 'klasse'); App.uSet('ueb_sort', 'nr'); App.uSet('ueb_sort_ab', '0');
  // Anzeige: G2a: Adler(0) Bauer(1) Dorn(3) | P2: Conrad(2) | ohne: Ernst(4)
  check(JSON.stringify(KH._reihenfolge()) === '[0,1,3,2,4]', `Reihenfolge der Positionen (${JSON.stringify(KH._reihenfolge())})`);
  KH.currentIndex = 1;
  check(KH._nachbarIndex(1) === 3 && KH._nachbarIndex(-1) === 0, 'Nachbarn von Bauer: Dorn (weiter), Adler (zurück)');
  KH.next();
  check(KH.currentIndex === 3, 'next() springt in der Gruppe weiter zu Dorn (#4), nicht zu #3');
  KH.next(); KH.next();
  check(KH.currentIndex === 4 && KH._nachbarIndex(1) === -1, 'am Ende der Anzeige ist Schluss');
  KH.prev();
  check(KH.currentIndex === 2, 'prev() geht zurück zu Conrad');
  check(KH._ersterOffenerIndex() === 1, 'erster offener in Anzeige-Reihenfolge: Bauer (Dorn ist abwesend)');
  check(KH._ersterOffenerIndex(1) === 4, 'nächster offener nach Bauer: Ernst');
  App.uSet('ueb_gruppe', 'stand');
  check(KH._reihenfolge()[0] === 1 && KH._ersterOffenerIndex() === 1, 'Gruppe „Stand“: Offene stehen vorn');
  App.uSet('ueb_gruppe', '');
  check(JSON.stringify(KH._reihenfolge()) === '[0,1,2,3,4]' && KH._ersterOffenerIndex() === 1, 'ohne Gruppierung unverändert: Listenreihenfolge');
}

console.log('\n══ Auswahl und Sammelaktionen ══');
{
  App.uSet('ueb_gruppe', 'klasse');
  KH._uebAuswahl = new Set(); KH._uebLetzte = null; KH._uebFolge = null;
  KH.uebWaehlen(1, true, {});
  KH.uebWaehlen(3, true, { shiftKey: true });
  check(JSON.stringify(KH._uebAuswahlIds()) === '[1,2,3,4]', `Umschalt+Klick wählt den Bereich in Anzeige-Reihenfolge: Adler, Bauer, Dorn, Conrad (${JSON.stringify(KH._uebAuswahlIds())})`);
  KH.uebAuswahlLeeren();
  KH.uebGruppeWaehlen('G2a', true);
  check(JSON.stringify(KH._uebAuswahlIds()) === '[1,2,4]', 'Gruppen-Häkchen wählt alle Azubis der Gruppe');
  KH.uebGruppeWaehlen('G2a', false);
  KH.uebAlleWaehlen(true);
  check(KH._uebAuswahlIds().length === 5, '„alle“ wählt die ganze Liste');
  KH.uebAuswahlLeeren();
  // Klasse in Menge setzen
  KH.uebWaehlen(3, true, {}); KH.uebWaehlen(5, true, {});
  sandbox.document.getElementById = (id) => id === 'uebKlasseSammel' ? { value: ' P2b ' } : null;
  KH.uebKlasseSetzenAuswahl();
  check(App.query("SELECT id FROM schueler WHERE schulklasse='P2b' ORDER BY id").map(r => r.id).join() === '3,5' && KH.currentSchuelerList.find(s => s.id === 5).schulklasse === 'P2b', 'Klasse für die Auswahl gesetzt (Datenbank und Liste)');
  sandbox.document.getElementById = () => null;
  // anwesend/abwesend für die Auswahl – natürlicher Schlüssel Termin + Azubi
  KH.uebAnwesendAuswahl(false);
  check(App.query('SELECT schueler_id FROM kontrollergebnisse WHERE kontrolltermin_id=10 AND anwesend=0 ORDER BY schueler_id').map(r => r.schueler_id).join() === '3,4,5', 'Auswahl als abwesend markiert');
  KH.uebAnwesendAuswahl(true);
  // In Ordnung nur für anwesende ohne Ergebnis
  KH._pruefeAbgeschlossen = () => true;
  App.confirm = async () => true;
  KH.uebAuswahlLeeren(); KH.uebWaehlen(2, true, {}); KH.uebWaehlen(3, true, {}); KH.uebWaehlen(4, true, {});
  await KH.uebOkAuswahl();
  const erg = App.query('SELECT schueler_id s, ergebnis e FROM kontrollergebnisse WHERE kontrolltermin_id=10 ORDER BY schueler_id').map(r => `${r.s}:${r.e || '-'}`).join(' ');
  check(erg === '1:in_ordnung 2:in_ordnung 3:post_an_rp 4:- 5:-', `„In Ordnung“ nur für anwesende ohne Ergebnis (${erg})`);
  // Auswahl verträgt entfernte Azubis und gilt je Termin
  KH._uebAuswahl.add(999);
  check(!KH._uebAuswahlIds().includes(999), 'Azubis außerhalb der Liste fallen aus der Auswahl');
}

console.log('\n══ Auswahl einem Termin zuweisen (bestehend oder neu) ══');
{
  for (const [k, f] of Object.entries({ formatDate: (d) => String(d || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1'), todayStr: () => '2026-03-10', esc: (x) => String(x ?? ''), addDaysStr: (n) => '2026-03-31' })) if (typeof sandbox[k] !== 'function') sandbox[k] = f;
  db.run("INSERT INTO kontrolltermine (id,geplant_datum,status,berufsschule_id,pruefer) VALUES (20,'2026-04-20','geplant',2,'Pix'),(21,'2026-02-01','durchgefuehrt',1,'Pix'),(22,'2026-01-15','geplant',1,'Pix'),(23,'2026-05-05','abgesagt',1,'Pix')");
  db.run('INSERT INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (20,4)');
  App.invalidateTerminCache();
  check(KH._uebZielTermine().map(t => t.id).join() === '20,22', `Zur Wahl: nur andere geplante Termine, kommende zuerst (${KH._uebZielTermine().map(t => t.id).join()})`);
  // Dialog
  let dlg = null; const openAlt = App.openModal; App.openModal = (t, b, f) => { dlg = { t, b, f }; };
  KH.uebAuswahlLeeren(); KH.uebWaehlen(4, true, {}); KH.uebWaehlen(5, true, {});
  KH.uebTerminZuweisenDialog();
  check(dlg && /2 Azubis einem Termin zuweisen/.test(dlg.t) && /Dorn, Dana · Ernst, Emil/.test(dlg.b) && /<option value="20">/.test(dlg.b) && /<option value="22">/.test(dlg.b) && !/<option value="21">/.test(dlg.b) && /id="uzNeu" style="display:none"/.test(dlg.b), 'Dialog: Namen, geplante Termine zur Wahl, „Bestehender Termin“ vorgewählt');
  check(/id="uzDatum"/.test(dlg.b) && /id="uzTyp"/.test(dlg.b) && /id="uzOrt"/.test(dlg.b) && /id="uzPruefer"/.test(dlg.b) && /id="uzBem" value="Folgetermin zu 10\.03\.2026/.test(dlg.b) && /id="uzAbwesend"/.test(dlg.b) && /Den <strong>einen<\/strong> ausgewählten Azubi ohne Ergebnis/.test(dlg.b) && /KontrolleHandler\.uebTerminZuweisen\(\)/.test(dlg.f), 'Dialog: Felder für den neuen Termin, Häkchen „als abwesend markieren“, Knopf „Zuweisen“');
  check(/In diesem Termin bleiben sie stehen/.test(dlg.b), 'Dialog sagt: die Azubis bleiben zusätzlich in diesem Termin');
  App.openModal = () => {};
  // Bestehender Termin: Azubi 4 ist dort schon, 5 kommt dazu
  const keVor = JSON.stringify(App.query('SELECT schueler_id, ergebnis, anwesend FROM kontrollergebnisse WHERE kontrolltermin_id=10 ORDER BY schueler_id'));
  const r1 = KH.uebTerminZuweisen({ art: 'bestehend', zielId: 20 });
  check(r1 && r1.zielId === 20 && r1.angelegt === false && r1.neu === 1 && r1.schon === 1 && App.query('SELECT schueler_id FROM kontrolltermin_schueler WHERE kontrolltermin_id=20 ORDER BY schueler_id').map(x => x.schueler_id).join() === '4,5', `Bestehender Termin: neu zugeordnet 1, schon dort 1 (${r1 && r1.text})`);
  check(JSON.stringify(App.query('SELECT schueler_id, ergebnis, anwesend FROM kontrollergebnisse WHERE kontrolltermin_id=10 ORDER BY schueler_id')) === keVor && KH.currentSchuelerList.length === 5 && KH._uebAuswahlIds().length === 0, 'Ausgangstermin unverändert (Azubis und Ergebnisse bleiben), Auswahl aufgehoben');
  check(App.getTerminSchueler(20).map(x => x.id).join() === '4,5', 'Zieltermin führt die Azubis');
  // Abweisungen
  KH.uebWaehlen(5, true, {});
  check(KH.uebTerminZuweisen({ art: 'bestehend', zielId: 10 }) === null && KH.uebTerminZuweisen({ art: 'bestehend', zielId: 21 }) === null && KH.uebTerminZuweisen({ art: 'bestehend', zielId: 0 }) === null && KH.uebTerminZuweisen({ art: 'neu', datum: '20.04.2026' }) === null, 'Abgewiesen: derselbe Termin, abgeschlossener Termin, kein Termin, ungültiges Datum');
  check(App.scalar('SELECT COUNT(*) FROM kontrolltermine') === 5, 'Abgewiesene Versuche legen keinen Termin an');
  // Neuer Termin mit freiem Ort, Azubis ohne Ergebnis hier als abwesend
  db.run('UPDATE kontrollergebnisse SET anwesend=1 WHERE kontrolltermin_id=10');
  KH.uebAuswahlLeeren(); KH.uebWaehlen(1, true, {}); KH.uebWaehlen(4, true, {}); KH.uebWaehlen(5, true, {});
  const r2 = KH.uebTerminZuweisen({ art: 'neu', datum: '2026-04-28', typ: 'einsendung', ortId: 1, ortFrei: 'RP Freiburg', pruefer: 'Zilz', bemerkung: 'Nachholtermin', abwesend: true });
  const neu = App.query('SELECT * FROM kontrolltermine WHERE id=?', [r2.zielId])[0];
  check(r2.angelegt && r2.neu === 3 && neu.geplant_datum === '2026-04-28' && neu.typ === 'einsendung' && neu.status === 'geplant' && neu.ort === 'RP Freiburg' && neu.berufsschule_id === null && neu.pruefer === 'Zilz' && neu.bemerkung === 'Nachholtermin' && neu.klasse_id === null, `Neuer Termin angelegt: Datum, Art, freier Ort, Prüfer, Bemerkung (${r2.text})`);
  check(App.getTerminSchueler(r2.zielId).map(x => x.id).join() === '1,4,5' && App.getTerminSchule(r2.zielId).name === 'RP Freiburg', 'Neuer Termin führt genau die Auswahl, Ort über getTerminSchule');
  const anw = App.query('SELECT schueler_id s, anwesend a, ergebnis e FROM kontrollergebnisse WHERE kontrolltermin_id=10 AND schueler_id IN (1,4,5) ORDER BY schueler_id').map(x => `${x.s}:${x.a}:${x.e || '-'}`).join(' ');
  check(r2.abwesend === 2 && anw === '1:1:in_ordnung 4:0:- 5:0:-', `„als abwesend markieren“ nur für die ohne Ergebnis (${anw})`);
  // Neuer Termin an einer Schule, ohne Abwesend-Häkchen
  KH.uebWaehlen(2, true, {});
  const r3 = KH.uebTerminZuweisen({ art: 'neu', datum: '2026-05-12', typ: 'schulkontrolle', ortId: 2, ortFrei: '', pruefer: '', bemerkung: '' });
  const neu3 = App.query('SELECT * FROM kontrolltermine WHERE id=?', [r3.zielId])[0];
  check(neu3.typ === 'schulkontrolle' && neu3.berufsschule_id === 2 && (neu3.ort || '') === '' && r3.abwesend === 0 && App.getTerminSchule(r3.zielId).name === 'Schule B', 'Neuer Schultermin mit Berufsschule als Ort');
  db.run('UPDATE kontrollergebnisse SET anwesend=1 WHERE kontrolltermin_id=10');
  App.openModal = openAlt;
  // Verdrahtung
  const K = read('src/js/modules/kontrolle.js'), V = read('src/js/modules/views.js');
  check(/onclick="KontrolleHandler\.uebTerminZuweisenDialog\(\)"[^>]*>→ Termin zuweisen<\/button>/.test(K.split('  _uebSammelZeigen() {')[1].split('  uebKlasseSetzenAuswahl() {')[0]), 'Sammelleiste: Knopf „→ Termin zuweisen“');
  check(/TerminSeite\.oeffnen\(\$\{zielId\}\)/.test(K) && /App\.invalidateTerminCache\(\);\n    this\._uebAuswahl\.clear\(\);/.test(K), 'Danach: „Termin öffnen“ angeboten, Termin-Zwischenspeicher geleert');
  check(/„→ Termin zuweisen“/.test(V), 'Hilfe beschreibt das Zuweisen');
}

console.log('\n══ Verdrahtung ══');
{
  const K = read('src/js/modules/kontrolle.js'), C = read('src/css/styles.css'), B = read('src/js/modules/berichte.js'), I = read('src/js/modules/import-handler.js'), T = read('src/js/modules/table-sort.js'), V = read('src/js/modules/views.js');
  const ue = K.split('  renderUebersicht() {')[1].split('  // Einen Azubi direkt aus der Übersicht')[0];
  check(/id="uebGruppe"/.test(ue) && /id="uebSort"/.test(ue) && /KontrolleHandler\.uebSortRichtung\(\)/.test(ue), 'Leiste „Gruppieren · Sortieren“ über der Tabelle');
  check(/class="form-control ueb-klasse" list="uebKlassenListe"/.test(ue) && /onchange="KontrolleHandler\.klasseSetzen\(\$\{s\.id\}, this\.value, this\)"/.test(ue) && /<datalist id="uebKlassenListe">/.test(ue), 'Spalte Klasse: Eingabefeld je Azubi mit Vorschlägen');
  check(/aria-label="Klasse an der Berufsschule: \$\{nameLang\}"/.test(ue) && /aria-label="Auswählen: \$\{nameLang\}"/.test(ue) && /id="uebAlle"[^>]*aria-label="Alle Azubis auswählen"/.test(ue), 'Felder und Häkchen sind beschriftet');
  check(/class="ueb-gruppe-chk"/.test(ue) && /id="uebSammel" class="sammel-leiste ueb-sammel"/.test(ue), 'Gruppen-Häkchen und Leiste für Sammelaktionen');
  check(/data-sort-eigen="1"/.test(ue) && /th\.closest\('table\[data-sort-eigen\]'\)/.test(T), 'eigene Sortierung: die allgemeine Tabellensortierung bleibt draußen');
  check(/this\._uebAuswahl = new Set\(\);\n      this\._uebLetzte = null;\n      this\._geladenerTermin/.test(K), 'Auswahl wird beim Terminwechsel geleert');
  const druck = K.split('  printUebersicht(terminIdOverride) {')[1].split("const w = window.open('', '_blank');")[0];
  check(/this\._uebGruppen\(schueler, terminId\)/.test(druck) && /<th title="Klasse an der Berufsschule">Klasse<\/th>/.test(druck), 'Druckliste: dieselbe Gruppierung/Sortierung und Spalte Klasse');
  check(/'Klasse \(Berufsschule\)': App\.schulklasseNormal\(s\.schulklasse\)/.test(B), 'Excel-Export mit Spalte „Klasse (Berufsschule)“');
  check(/id="mSSchulklasse"/.test(I) && /App\.setSchulklasse\(\[id\], klEl\.value\)/.test(I), 'Azubi bearbeiten: Feld „Klasse an der Berufsschule“');
  check(/\.ueb-klasse \{[^}]*font-size: 13px/.test(C) && /\.ueb-sort:focus-visible/.test(C) && !/\.ueb-[a-z-]+[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(C), 'Gestaltung: Schrift ≥ 12 px, sichtbarer Fokus, keine festen Farben');
  check(/Gruppieren und Sortieren/.test(V) && /Klasse an der Berufsschule/.test(V), 'Hilfe erklärt Gruppieren, Sortieren und die Klasse');
}

console.log(`\n═══ Ergebnis: ${ok} OK, ${fehler} Fehler ═══`);
process.exit(fehler ? 1 : 0);
