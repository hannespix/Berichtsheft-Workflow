// ═══════════════════════════════════════════════════════════════════
//  Berichtsheft digital vorgelegt oder nachgereicht:
//  kontrollergebnisse.heft_form ('' Papier · digital · digital_offen)
//  und heft_notiz (interne Notiz in der Übersicht), Wiedervorlage
//  „digital_nachreichen“, Vorlagen, Hinweis in den Ankündigungen
//  Ausführen:  node tests/digital-test.mjs
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
const K = read('src/js/modules/kontrolle.js');
const W = read('src/js/modules/workflows.js');

let ok = 0, fehler = 0;
const check = (bed, text) => { if (bed) { ok++; console.log('  ✓ ' + text); } else { fehler++; console.log('  ✗ FEHLER: ' + text); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const speicher = {};
const els = {};   // Elemente, die ein Test dem Dokument unterschiebt (id → Objekt)
const modale = [];
const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const heute = '2026-11-23';
const plusTage = (n) => { const d = new Date(heute + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval: () => 0, clearInterval() {},
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array,
  document: { getElementById: (id) => els[id] || null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: (k) => (k in speicher ? speicher[k] : null), setItem(k, v) { speicher[k] = String(v); }, removeItem(k) { delete speicher[k]; } },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { _letzter: null, push(text, undo, redo) { this._letzter = { text, undo, redo }; }, clear() {} },
  confirm: () => true,
  esc: (x) => String(x ?? ''), todayStr: () => heute, addDaysStr: plusTage,
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '',
  getKW: () => 48,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav'], ['src/js/modules/workflows.js', 'Workflows']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
// wvArtLabel liegt in utils.js – nur diese Funktion herauslösen
vm.runInContext(read('src/js/utils.js').match(/function wvArtLabel\(art\) \{[\s\S]*?\n\}/)[0] + '\n;globalThis.wvArtLabel = wvArtLabel;', sandbox, { filename: 'utils-auszug.js' });
const App = sandbox.__App, KH = sandbox.KontrolleHandler, WF = sandbox.Workflows;
App.db = db; App.demoMode = true; App.markDirty = () => {}; App.toast = () => {}; App.scheduleAutoSave = () => {};
App.openModal = (titel, html, fuss) => { modale.push({ titel, html: String(html), fuss: String(fuss || '') }); };
App.closeModal = () => {}; App.showLoading = () => {}; App.hideLoading = () => {};
App.migrateDB();
App.currentUser = 'Pix';
let gezeichnet = 0;
KH.renderUebersicht = () => { gezeichnet++; }; KH._uebSammelZeigen = () => {}; KH.saveAndRelease = () => {}; KH.enterSchüler = () => {};
KH.renderSchueler = () => {}; KH.isLockedByOther = () => false; KH._terminZeile = () => {};

// ── Testdaten: eine Klasse, zwei Betriebe, ein Termin ──
db.run("INSERT OR IGNORE INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (901,'TGL','GaLaBau Test','Gärtner')");
db.run("INSERT INTO berufsschulen (id,name,ort) VALUES (1,'Schule A','Freiburg')");
db.run("INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr,aktiv) VALUES (1,'S2027','Sommer',2027,1)");
db.run("INSERT INTO klassen (id,berufsschule_id,jahrgang_id,klassenbezeichnung) VALUES (1,1,1,'G2a')");
db.run("INSERT INTO betriebe (id,name,betriebsnummer,email) VALUES (10,'Grünbau','B-10','gruenbau@example.org'),(11,'Alpha Garten','B-11','alpha@example.org'),(12,'Blumen Zeh','B-12','zeh@example.org')");
db.run("INSERT INTO pruefer (name,email,aktiv) VALUES ('Pix','pix@example.org',1)");
const azubi = (id, nach, vor, betrieb) => db.run("INSERT INTO schueler (id,nachname,vorname,aktiv,fachrichtung_id,klasse_id,jahrgang_id,betrieb_id,ausbildungsbeginn,ausbildungsende,zustaendiges_amt,email) VALUES (?,?,?,1,901,1,1,?,'2024-09-01','2027-08-31',?,?)",
  [id, nach, vor, betrieb, App.EIGENES_AMT, `${nach.toLowerCase()}@example.org`]);
azubi(1, 'Adler', 'Anna', 10);
azubi(2, 'Bauer', 'Ben', 11);
azubi(3, 'Conrad', 'Cora', 12);
azubi(4, 'Dorn', 'Dana', 10);
azubi(5, 'Ernst', 'Emil', 12);
db.run("INSERT INTO kontrolltermine (id,klasse_id,jahrgang_id,berufsschule_id,geplant_datum,pruefer,status,typ) VALUES (10,1,1,1,'2026-11-20','Pix','geplant','schulkontrolle')");
db.run("INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (10,1)");
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend,geprueft_kws) VALUES
  (101,10,1,'in_ordnung',1,'{}'),(102,10,2,'',1,'{}'),(103,10,3,'',1,'{}'),(104,10,4,'',0,'{}'),(105,10,5,'',1,'{}')`);
KH.currentTerminId = 10;
KH.currentSchuelerList = App.query('SELECT * FROM schueler ORDER BY nachname');
KH.activePruefer = 'Pix';
KH._viewMode = 'uebersicht';
App._otherPositions = [];
const ke = (sid) => App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=10 AND schueler_id=?', [sid])[0];

console.log('\n══ Schema, Migration, Helfer ══');
{
  const spalten = App.query('PRAGMA table_info(kontrollergebnisse)').map(c => c.name);
  check(spalten.includes('heft_form') && spalten.includes('heft_notiz'), 'Spalten kontrollergebnisse.heft_form und heft_notiz im Schema');
  check((APP_SRC.match(/ADD COLUMN heft_form TEXT DEFAULT ''/g) || []).length === 2 && (APP_SRC.match(/ADD COLUMN heft_notiz TEXT DEFAULT ''/g) || []).length === 2, 'Beide Spalten in migrateDB und _migrateDiskDb');
  const alt = new SQL.Database();
  alt.run("CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY, kontrolltermin_id INTEGER, schueler_id INTEGER, ergebnis TEXT DEFAULT ''); CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT);");
  { const warn = console.warn; console.warn = () => {}; try { App._migrateDiskDb(alt); } catch (e) {} console.warn = warn; }   // die Mini-Datenbank hat nur diese eine Tabelle
  const altSp = alt.exec('PRAGMA table_info(kontrollergebnisse)')[0].values.map(r => r[1]);
  check(altSp.includes('heft_form') && altSp.includes('heft_notiz'), 'Alt-Datenbank bekommt beide Spalten');
  check(/'bemerkung','heft_form','heft_notiz','durchsicht_nr'/.test(APP_SRC), 'mergeColumns führt beide Felder zusammen');
  check(App.heftForm('digital') === 'digital' && App.heftForm('digital_offen') === 'digital_offen' && App.heftForm('quatsch') === '' && App.heftForm(null) === '', 'heftForm lässt nur die drei Werte zu');
  check(App.heftFormLabel('') === 'Papier' && App.heftFormLabel('digital') === 'digital' && App.heftFormLabel('digital', true) === 'digital vorgelegt' && App.heftFormLabel('digital_offen', true) === 'wird digital nachgereicht', 'Beschriftungen kurz und lang');
  check(App.heftNotizNormal('  schickt   PDF\nbis Freitag ') === 'schickt PDF bis Freitag' && App.heftNotizNormal('x'.repeat(300)).length === App.HEFT_NOTIZ_MAX && App.HEFT_NOTIZ_MAX === 120, 'Notiz: Leerraum bereinigt, höchstens 120 Zeichen');
  check(App.setHeftForm(10, [2, 3], 'digital_offen', 'Pix') === 2 && App.setHeftForm(10, [2, 3], 'digital_offen', 'Pix') === 0 && ke(2).heft_form === 'digital_offen' && ke(1).heft_form === '', 'setHeftForm schreibt nur Geändertes (natürlicher Schlüssel Termin + Azubi)');
  check(App.setHeftForm(10, [99], 'digital') === 0, 'Azubi ohne Bogen in diesem Termin: nichts geschrieben');
  check(App.setHeftNotiz(10, 2, ' schickt PDF bis Freitag ') === true && ke(2).heft_notiz === 'schickt PDF bis Freitag' && App.setHeftNotiz(10, 2, 'schickt PDF bis Freitag') === false, 'setHeftNotiz speichert bereinigt und nur bei Änderung');
  check(/UPDATE kontrollergebnisse SET heft_form=\?, geaendert_von=\? WHERE kontrolltermin_id=\? AND schueler_id=\?/.test(APP_SRC), 'Eigene UPDATE-Anweisung – ältere Programmstände verlieren sonst nichts');
  check(App.WV_FRISTEN_STANDARD.digital_nachreichen === 14 && /digital nachgereicht/.test(App.WV_FRISTEN_LABELS.digital_nachreichen) && App.wvFrist('digital_nachreichen') === plusTage(14), 'Frist „digital_nachreichen“: 14 Tage, einstellbar');
  check(sandbox.wvArtLabel('digital_nachreichen') === 'Berichtsheft wird digital nachgereicht', 'Wiedervorlage-Art hat eine Beschriftung');
}

console.log('\n══ Übersicht: Spalte „Heft · Notiz“, Gruppieren, Sammelaktion ══');
{
  const ue = K.split('  renderUebersicht() {')[1].split('  // Einen Azubi direkt aus der Übersicht')[0];
  check(/class="form-control ueb-heft\$\{heft \? ' ueb-heft--' \+ heft : ''\}"/.test(ue) && /onchange="KontrolleHandler\.heftFormSetzen\(\$\{s\.id\}, this\.value\)"/.test(ue) && /aria-label="Vorlage des Berichtshefts: \$\{nameLang\}"/.test(ue), 'Auswahl „Heft“ je Zeile mit Beschriftung');
  check(/class="form-control ueb-notiz"/.test(ue) && /maxlength="\$\{App\.HEFT_NOTIZ_MAX\}"/.test(ue) && /onchange="KontrolleHandler\.heftNotizSetzen\(\$\{s\.id\}, this\.value, this\)"/.test(ue) && /aria-label="Notiz zur Durchsicht: \$\{nameLang\}"/.test(ue), 'Notizfeld je Zeile mit Beschriftung');
  check(/_uebSortKopf\('heft', 'Heft', ordnung\)\} · Notiz<\/th>/.test(ue), 'Spaltenkopf „Heft · Notiz“ sortierbar');
  check(/heft === 'digital_offen' \? 'background:var\(--clr-blue-light\)'/.test(ue), '„Wird digital nachgereicht“ hebt die Zeile hervor');
  check(/davon \$\{digitalOffenCount\}/.test(ue) && /digital vorgelegt/.test(ue), 'Fortschrittszeile nennt nachzureichende und digital vorgelegte Hefte');
  check(KH.UEB_GRUPPEN.some(g => g[0] === 'heft') && KH.UEB_SORT.some(g => g[0] === 'heft'), 'Gruppieren und Sortieren nach „Vorlage des Hefts“');
  speicher.dummy = '';
  App.uSet('ueb_gruppe', 'heft'); App.uSet('ueb_sort', 'nr');
  const gruppen = KH._uebGruppen().map(g => `${g.label}: ${g.indizes.map(i => KH.currentSchuelerList[i].nachname).join(' ')}`).join(' | ');
  check(gruppen === 'Papier: Adler Dorn Ernst | wird digital nachgereicht: Bauer Conrad', `Gruppen nach Vorlage (${gruppen})`);
  App.uSet('ueb_gruppe', '');
  gezeichnet = 0;
  KH.heftFormSetzen(5, 'digital');
  check(ke(5).heft_form === 'digital' && ke(5).geaendert_von === 'Pix' && gezeichnet === 1, 'heftFormSetzen schreibt und zeichnet die Übersicht neu');
  const feld = { value: '  Heft auf dem Tablet gezeigt ', title: '', defaultValue: '' };
  KH.heftNotizSetzen(5, feld.value, feld);
  check(ke(5).heft_notiz === 'Heft auf dem Tablet gezeigt' && feld.value === 'Heft auf dem Tablet gezeigt' && gezeichnet === 1, 'heftNotizSetzen speichert ohne Neuzeichnen und führt das Feld nach');
  check(/const notiz = !!\(el\.classList && el\.classList\.contains\('ueb-notiz'\)\);/.test(K) && /querySelectorAll\(notiz \? '\.ueb-notiz' : '\.ueb-klasse'\)/.test(K), 'Enter/Pfeiltasten springen im Notizfeld zur nächsten Zeile');
  KH._uebAuswahl = new Set([1, 4]);
  KH.uebHeftAuswahl('digital');
  check(ke(1).heft_form === 'digital' && ke(4).heft_form === 'digital', 'Sammelaktion setzt die Vorlage für die Auswahl');
  KH.uebHeftAuswahl('papier');
  check(ke(1).heft_form === '' && ke(4).heft_form === '', 'Sammelaktion „Papier“ nimmt sie zurück');
  KH.uebHeftAuswahl('');
  check(ke(1).heft_form === '', 'Leere Auswahl in der Leiste ändert nichts');
  KH._uebAuswahl = new Set();
  check(/id="uebHeftSammel"/.test(K) && /aria-label="Vorlage des Berichtshefts für die ausgewählten Azubis setzen"/.test(K), 'Auswahl „Heft …“ in der Sammelleiste');
  check(/id="keHeftForm"/.test(K) && /saveField\('heft_form', this\.value\)/.test(K) && /id="keHeftNotiz"/.test(K) && /saveField\('heft_notiz', this\.value\)/.test(K), 'Einzelansicht: Auswahl und Notiz über den Pflichtteilen');
  check(KH._allowedFields.has('heft_form') && KH._allowedFields.has('heft_notiz'), 'saveField lässt beide Felder zu');
  check(/wird digital nachgereicht' : ''\)\}\$\{ke\.heft_form === 'digital'/.test(K) && /<em>Notiz: \$\{esc\(ke\.heft_notiz\)\}<\/em>/.test(K), 'Druckliste nennt Vorlage und Notiz');
}

console.log('\n══ Ergebnis eingetragen → Heft liegt vor ══');
{
  // Bauer (2) und Conrad (3) stehen auf „wird digital nachgereicht“
  KH._markOK([2]);
  check(ke(2).ergebnis === 'in_ordnung' && ke(2).heft_form === 'digital', '„In Ordnung“ in der Übersicht: aus „wird nachgereicht“ wird „digital“');
  KH.currentIndex = KH.currentSchuelerList.findIndex(s => s.id === 3);
  KH._pruefeAbgeschlossen = () => true; KH._wvNachErgebnis = () => null; KH._autoHinweiseCodes = () => ({}); KH.weiterModus = () => 'bleiben';
  KH.saveField('ergebnis', 'berichte_bis_termin_email');
  check(ke(3).ergebnis === 'berichte_bis_termin_email' && ke(3).heft_form === 'digital', 'Ergebnis in der Einzelansicht: ebenfalls „digital“');
  const u = sandbox.UndoManager._letzter;
  u.undo();
  check(ke(3).ergebnis === '' && ke(3).heft_form === 'digital_offen', 'Rückgängig stellt „wird digital nachgereicht“ wieder her');
  u.redo();
  check(ke(3).heft_form === 'digital', 'Wiederholen setzt es erneut');
  u.undo();
  KH.saveField('heft_notiz', '  PDF   kommt Montag ');
  check(ke(3).heft_notiz === 'PDF kommt Montag', 'Notiz aus der Einzelansicht wird bereinigt gespeichert');
  KH.saveField('heft_form', 'unsinn');
  check(ke(3).heft_form === '', 'Unbekannter Wert wird zu „Papier“');
  KH.saveField('heft_form', 'digital_offen');
  check(ke(3).heft_form === 'digital_offen', 'Einzelansicht setzt „wird digital nachgereicht“');
}

console.log('\n══ Nächste Durchsicht übernimmt „digital“ ══');
{
  db.run("INSERT INTO kontrolltermine (id,klasse_id,jahrgang_id,berufsschule_id,geplant_datum,pruefer,status,typ) VALUES (11,1,1,1,'2027-02-10','Pix','geplant','schulkontrolle')");
  check(App.heftZuletztDigital(2, 11) === true && App.heftZuletztDigital(1, 11) === false && App.heftZuletztDigital(3, 11) === false, 'heftZuletztDigital: letzte bewertete Durchsicht zählt (ohne Ergebnis nicht)');
  check(/if \(prev\.heft_form === 'digital' \|\| prev\.heft_form === 'digital_offen'\) \{\n\s+App\.run\("UPDATE kontrollergebnisse SET heft_form='digital' WHERE kontrolltermin_id=\? AND schueler_id=\? AND COALESCE\(heft_form,''\)=''"/.test(K), 'Neuer Bogen: Vorlage wird in eigener Anweisung übernommen');
}

console.log('\n══ Termin abschließen: Wiedervorlage „digital nachgereicht“ ══');
{
  // Stand: 1 in Ordnung · 2 in Ordnung (digital) · 3 wird digital nachgereicht · 4 abwesend · 5 offen (digital)
  db.run("UPDATE kontrollergebnisse SET heft_form='digital_offen', heft_notiz='schickt Scan' WHERE id=104");   // abwesend UND reicht digital nach
  modale.length = 0;
  KH.abschliessen();
  const m = modale[modale.length - 1].html;
  check(/id="wizDigital"/.test(m) && /Berichtsheft wird digital nachgereicht \(2\)/.test(m) && /Conrad, Cora/.test(m) && /Dorn, Dana – <em>schickt Scan<\/em>/.test(m), 'Abschluss-Dialog listet die nachzureichenden Hefte mit Notiz');
  check(/id="wizDigitalWV" checked/.test(m) && new RegExp(`id="wizDigitalFrist" value="${plusTage(14)}"`).test(m), 'Wiedervorlage vorgeschlagen, Frist 14 Tage');
  check(/<strong>2 von 3<\/strong> vorgelegten Berichtsheften kontrolliert/.test(m) && /1 offen/.test(m) && /2 werden digital nachgereicht/.test(m) && !/abwesend/.test(m.split('wizDigital')[0]), 'Zusammenfassung: nachzureichende zählen weder als offen noch als abwesend');
  check(!/Abwesend am Kontrolltag/.test(m), 'Abwesend + digital nachreichen erscheint nicht zusätzlich unter „Abwesend“');
  els.mAbschlDatum = { value: '2026-11-20' };
  els.wizDigitalWV = { checked: true }; els.wizDigitalFrist = { value: '2026-12-04' };
  els.wizNachholungWV = { checked: true }; els.wizNachholungFrist = { value: '2026-12-11' };
  App.terminSchritt = () => {};
  try { KH.doAbschliessen(); } catch (e) { console.log('    (doAbschliessen: ' + e.message + ')'); }
  const wv = App.query("SELECT schueler_id, art, frist_datum, status FROM wiedervorlagen ORDER BY schueler_id");
  check(wv.length === 2 && wv.every(w => w.art === 'digital_nachreichen' && w.frist_datum === '2026-12-04' && w.status === 'offen') && wv.map(w => w.schueler_id).join(',') === '3,4', `Je nachzureichendem Heft eine Wiedervorlage „digital_nachreichen“ mit Frist (${JSON.stringify(wv)})`);
  check(App.query("SELECT status FROM kontrolltermine WHERE id=10")[0].status === 'durchgefuehrt', 'Termin ist abgeschlossen');
  const snap = App.query('SELECT pflichtteile_json FROM durchsicht_snapshots WHERE kontrollergebnis_id=102')[0];
  check(snap && JSON.parse(snap.pflichtteile_json).heft === 'digital', 'Archiv-Bogen hält die Vorlage fest');
  KH.doAbschliessen();
  check(App.scalar('SELECT COUNT(*) FROM wiedervorlagen') === 2, 'Erneutes Abschließen legt keine zweite Wiedervorlage an');
  delete els.wizDigitalWV; delete els.wizNachholungWV;
}

console.log('\n══ E-Mails und Briefe: „Berichtsheft digital nachreichen“ ══');
{
  const d = WF._betriebeDesTermins(10, true);
  const g = (name) => d.betriebe.find(b => b.name === name);
  check(WF._betriebVorlageTyp(g('Grünbau'), true) === 'betrieb_ok', 'Betrieb mit bewertetem Azubi behält seine Ergebnis-Vorlage');
  check(WF._betriebVorlageTyp({ azubis: g('Grünbau').azubis.filter(a => a.id === 4) }, true) === 'digital_nachreichen', 'Kein Azubi bewertet, alle reichen digital nach → Vorlage „digital nachreichen“');
  check(WF._betriebVorlageTyp(g('Blumen Zeh'), true) === 'nachholung', 'Gemischt (einer offen ohne Verabredung) → weiter Nachhol-Aufforderung');
  check(WF._betriebVorlageTyp({ azubis: [g('Blumen Zeh').azubis.find(a => a.id === 3)] }, true) === 'digital_nachreichen' && WF.AZUBI_VORLAGE.digital_nachreichen === 'azubi_digital_nachreichen', 'Je Azubi: eigene Vorlage „azubi_digital_nachreichen“');
  check(WF.BETRIEB_VORLAGEN.includes('digital_nachreichen') && WF._betriebVorlageLabel.digital_nachreichen && WF._azubiVorlageLabel.azubi_digital_nachreichen, 'Vorlage von Hand wählbar (Betrieb und Azubi)');
  check(WF._nachreichFrist('digital_nachreichen', [g('Blumen Zeh').azubis.find(a => a.id === 3)]) === '04.12.2026', 'Frist im Schreiben = Frist der Wiedervorlage');
  check(WF._nachreichFrist('nachholung', []) === sandbox.formatDate(plusTage(21)), 'Nachhol-Aufforderung behält ihre Frist');
  const block = WF._azubiBlock(g('Blumen Zeh').azubis, true);
  check(/Conrad, Cora: Berichtsheft lag nicht vor – wird digital nachgereicht/.test(block), 'Azubi-Block im Schreiben an den Betrieb nennt die Verabredung');
  check(WF._wvVorlageTyp({ art: 'digital_nachreichen' }, false) === 'digital_nachreichen' && WF._wvVorlageTyp({ art: 'digital_nachreichen' }, true) === 'wv_erinnerung', 'Wiedervorlage: Bitte um die PDF, überfällig die Erinnerung');
  const ctx = WF._antwortCtx({ ...App.absenderCtx('Pix'), anrede: '', azubi_block: '  - Conrad, Cora', azubi_namen: 'Conrad, Cora', datum: '20.11.2026', schule: 'Schule A', frist: '04.12.2026' });
  const r = WF._mailVorlage('digital_nachreichen', ctx);
  check(/Berichtsheft digital nachreichen \(Conrad, Cora\)/.test(r.betreff) && /bis spätestens 04\.12\.2026 als PDF per E-Mail an /.test(r.body) && !/\{[a-z_]+\}/.test(r.body), 'Betriebs-Vorlage: Frist, PDF, Adresse – keine offenen Platzhalter');
  const ra = WF._mailVorlage('azubi_digital_nachreichen', { ...ctx, azubi_anrede: 'Guten Tag Cora Conrad,', betrieb_hinweis: 'Ihr Ausbildungsbetrieb wurde informiert.' });
  check(/^Guten Tag Cora Conrad,/.test(ra.body) && /Sie reichen es digital nach/.test(ra.body) && /04\.12\.2026/.test(ra.body) && !/\{[a-z_]+\}/.test(ra.body), 'Azubi-Vorlage: eigene Anrede, nur eigene Angaben');
  check(/m\.typ !== 'betrieb_maengel' && m\.typ !== 'nachholung' && m\.typ !== 'digital_nachreichen'/.test(W) && /typ === 'digital_nachreichen' \? 'Bitte um digitale Vorlage'/.test(W), 'Versandnachweis an der Wiedervorlage auch für die Bitte um die PDF');
  modale.length = 0;
  WF.emailNachholung(10, [3, 4], '2026-12-04', 'digital_nachreichen');
  const m = modale[modale.length - 1];
  check(m && /Berichtsheft digital nachreichen – 2 Betrieb\(e\)/.test(m.titel) && /04\.12\.2026/.test(m.html) && WF._nachholung.typ === 'digital_nachreichen', 'Liste „Betriebe bitten“ nimmt die neue Vorlage');
}

console.log('\n══ Hinweis in den Ankündigungen ({digital_hinweis}) ══');
{
  const ank = ['betrieb_bcc', 'azubi_bcc', 'betrieb_ankuendigung', 'azubi_ankuendigung', 'brief_betrieb'];
  check(ank.every(t => /\{digital_hinweis\}/.test(App.VORLAGEN[t].body) && App.VORLAGEN[t].platzhalter.includes('digital_hinweis')), 'Alle fünf Ankündigungen tragen den Platzhalter');
  const ctx = { ...App.absenderCtx('Pix'), datum: '20.11.2026', schule: 'Schule A', schule_ort: ' in Freiburg', fachrichtung: 'GaLaBau', klassen: 'G2a', azubi_block: '  - Adler, Anna', azubi_liste: '  - Adler, Anna', azubi_namen: 'Adler, Anna', anrede: '', azubi_anrede: 'Guten Tag Anna Adler,', betrieb_hinweis: 'Ihr Ausbildungsbetrieb wurde informiert.' };
  const std = App.renderVorlage('azubi_bcc', ctx).body;
  check(/elektronisch geführt, kann es auch digital vorgelegt werden/.test(std) && !/\{digital_hinweis\}|\{antwort_email\}/.test(std) && std.includes(App.antwortEmail()), 'Standard: Satz mit der Antwortadresse steht in der Ankündigung');
  App.digitalHinweisSetzen('');
  const ohne = App.renderVorlage('azubi_bcc', ctx).body;
  check(!/digital vorgelegt/.test(ohne) && !/\{digital_hinweis\}/.test(ohne) && !/\n{3,}/.test(ohne), 'Leer gespeichert: kein Hinweis, kein Loch im Text');
  check(ank.every(t => { const b = App.renderVorlage(t, ctx).body; return !/\{digital_hinweis\}/.test(b) && !/\n{3,}/.test(b); }), 'Ohne Hinweis bleiben alle Ankündigungen sauber');
  App.digitalHinweisSetzen('Digitale Hefte bitte vorab an {antwort_email}.');
  check(App.renderVorlage('betrieb_bcc', ctx).body.includes(`Digitale Hefte bitte vorab an ${App.antwortEmail()}.`), 'Eigener Text mit {antwort_email}');
  App.digitalHinweisSetzen(App.DIGITAL_HINWEIS_STANDARD);
  check(App.scalar("SELECT COUNT(*) FROM einstellungen WHERE schluessel='digital_hinweis'") === 0 && App.digitalHinweisRoh() === App.DIGITAL_HINWEIS_STANDARD, 'Standardtext = Einstellung entfernt');
  const V = read('src/js/modules/views.js');
  check(/id="setDigitalHinweis"/.test(V) && /App\.digitalHinweisSetzen\(this\.value\)/.test(V) && /<label for="setDigitalHinweis"/.test(V), 'Einstellung in der Vorlagen-Karte mit Beschriftung');
  check(/digital_hinweis: App\.digitalHinweis\(\), \.\.\.beispiel/.test(V), 'Vorschau der Vorlage füllt den Hinweis');
}

console.log('\n══ Ausgaben und Verdrahtung ══');
{
  const B = read('src/js/modules/berichte.js'), P = read('src/js/modules/pdf-export.js'), A = read('src/js/modules/azubi-seite.js'), V = read('src/js/modules/views.js'), C = read('src/css/styles.css'), T = read('src/js/modules/termin-seite.js');
  check(/'Heft': App\.heftFormLabel\(ke\.heft_form, true\), 'Notiz': ke\.heft_notiz \|\| ''/.test(B) && /\(wird digital nachgereicht\)/.test(B), 'Excel-Ergebnisliste: Spalten „Heft“ und „Notiz“');
  check(/ke && ke\.heft_form === 'digital' \? ' · Berichtsheft digital vorgelegt' : ''/.test(P), 'Durchsichtsbogen nennt die digitale Vorlage im Kopf');
  check(/COALESCE\(ke\.heft_form,''\) AS heft_form/.test(A) && /wird digital nachgereicht<\/span>/.test(A) && /Heft digital vorgelegt/.test(A), 'Azubi-Seite: Vorlage und Notiz je Durchsicht');
  check(/Digital nachzureichen/.test(T) && /digitalOffen/.test(T), 'Termin-Seite: Zeile „Digital nachzureichen“');
  check(/<h4 class="help-untertitel">Berichtsheft digital vorgelegt oder nachgereicht<\/h4>/.test(V) && /will es als PDF schicken/.test(V), 'Hilfe-Abschnitt und FAQ');
  const stil = C.split('/* Vorlage des Berichtshefts')[1].split('\n\n')[0];
  check(/\.ueb-heft \{[^}]*font-size: 12px/.test(stil) && /\.ueb-notiz \{[^}]*font-size: 12px/.test(stil) && !/font-size: (?:[0-9]|1[01])px/.test(stil) && /\.ueb-heft:focus-visible, \.ueb-notiz:focus-visible/.test(stil), 'Stile: Schrift ≥ 12 px, sichtbarer Fokus');
  check(!/<input type="file"/.test(K.split('heft-karte')[1].split('Pflichtteile (kompakt)')[0]), 'Kein Datei-Upload – das Tool speichert keine Berichtshefte');
}

console.log(`\n═══ Ergebnis: ${ok} OK, ${fehler} Fehler ═══`);
process.exit(fehler ? 1 : 0);
