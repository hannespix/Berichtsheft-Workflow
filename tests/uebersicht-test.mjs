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
