// ═══════════════════════════════════════════════════════════════════
//  Brief-Editor: Briefe an Betriebe als Modell (jedes Element änderbar),
//  Ausgabe als Word (.docx) und E-Mail-Entwurf (.eml) mit Brief-Anhang,
//  Antwortadresse Funktionspostfach (Reply-To, E-Mail im Briefkopf und in
//  den Texten an Betriebe).
//  Ausführen:  node tests/brief-editor-test.mjs
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

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  esc: (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  todayStr: () => '2026-09-20', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).split('-').reverse().join('.') : '',
  addDaysStr: (n) => { const d = new Date('2026-09-20T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
vm.runInContext(read('src/js/modules/workflows.js') + '\n;globalThis.Workflows = Workflows;', sandbox, { filename: 'workflows.js' });
vm.runInContext(read('src/js/modules/brief-editor.js') + '\n;globalThis.BriefEditor = BriefEditor;', sandbox, { filename: 'brief-editor.js' });
vm.runInContext(read('libs/pizzip.js'), sandbox, { filename: 'pizzip.js' });
sandbox.KontrolleHandler = { activePruefer: 'Muster, Max' };
const { __App: App, Workflows, BriefEditor } = sandbox;
App.db = db; App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.migrateDB();
App.currentUser = 'Muster, Max';

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

db.run(`INSERT INTO berufsschulen (id,name,ort) VALUES (1,'BS Freiburg','Freiburg')`);
db.run(`INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr,aktiv) VALUES (1,'S2027','Sommer',2027,1)`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,klassenbezeichnung) VALUES (1,1,1,'G2a')`);
db.run(`INSERT INTO pruefer (name,email,telefon) VALUES ('Muster, Max','max.muster@rpf.bwl.de','0761 208-1234')`);
db.run(`INSERT INTO betriebe (id,name,betriebsnummer,email,ansprechpartner,strasse,plz,ort) VALUES (21,'Gärtnerei Mail','B-21','mail@example.org','Frau Grün','Weg 1','79100','Freiburg'),(22,'Gärtnerei Brief','B-22','','','Gasse 2','79200','Breisach')`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id,jahrgang_id,betrieb_id,ausbildungsbeginn,ausbildungsende,zustaendiges_amt,ibykus_id,email) VALUES
  (901,'Eins','Erik',1,1,1,21,'2024-09-01','2027-08-31','93','IB-901','erik@example.org'),(902,'Zwei','Zoe',1,1,1,21,'2024-09-01','2027-08-31','93','IB-902',''),(903,'Drei','Dora',1,1,1,22,'2024-09-01','2027-08-31','93','IB-903','')`);
db.run(`INSERT INTO kontrolltermine (id,berufsschule_id,geplant_datum,pruefer,status,typ) VALUES (900,1,'2026-09-16','Muster, Max','durchgefuehrt','schulkontrolle'),(910,1,'2026-11-20','Muster, Max','geplant','schulkontrolle')`);
db.run(`INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (900,901),(900,902),(900,903),(910,901),(910,903)`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,anwesend,fehltage_gesamt) VALUES (9001,900,901,'post_an_rp',1,3),(9002,900,902,'in_ordnung',1,0),(9003,900,903,'',0,0)`);
db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (901,2,40,'A,F',0,1)`);
db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (950,9001,901,'post_an_rp','2026-09-26','offen')`);
App.invalidateTerminCache && App.invalidateTerminCache();

console.log('══ Antwortadresse: Funktionspostfach statt Sachbearbeitung ══');
{
  check(App.BRIEF_STANDARD.antwort === 'Freisprechung.GB@rpf.bwl.de' && App.antwortEmail() === 'Freisprechung.GB@rpf.bwl.de', 'Standard: Freisprechung.GB@rpf.bwl.de');
  check(App.antwortKopf() === '=?UTF-8?B?' + App._b64Text('Regierungspräsidium Freiburg') + '?= <Freisprechung.GB@rpf.bwl.de>', 'Reply-To mit Namen als kodiertes Wort');
  const eml = App.emlErzeugen({ to: 'a@b.de', subject: 'Test', body: 'Text' });
  check(/\r\nReply-To: =\?UTF-8\?B\?[^\r]+\?=\r\n <Freisprechung\.GB@rpf\.bwl\.de>\r\n/.test(eml) && eml.split('\r\n').every(z => z.length <= 78), 'Jeder .eml-Entwurf trägt „Antwort an“ das Funktionspostfach (gefaltet, Zeilen ≤ 78)');
  check(!/Reply-To/.test(App.emlErzeugen({ to: 'a@b.de', subject: 'x', body: 'y', replyTo: false })) && /Reply-To: x@y\.de/.test(App.emlErzeugen({ to: 'a@b.de', subject: 'x', body: 'y', replyTo: 'x@y.de' })), 'replyTo: false ohne, eigene Adresse möglich');
  check(App.absenderCtx('Muster, Max').antwort_email === 'Freisprechung.GB@rpf.bwl.de' && App.absenderCtx('Muster, Max').pruefer_email === 'max.muster@rpf.bwl.de', 'absenderCtx nennt die Antwortadresse, pruefer_email bleibt für interne Post');
  const c = Workflows._antwortCtx({ pruefer_email: 'max.muster@rpf.bwl.de' });
  check(c.pruefer_email === 'Freisprechung.GB@rpf.bwl.de' && Workflows._antwortCtx({ pruefer_email: '' }).pruefer_email === '', 'Texte an Betriebe: {pruefer_email} = Funktionspostfach (ohne Signatur bleibt es leer)');
  const W = read('src/js/modules/workflows.js');
  const n = (W.match(/this\._antwortCtx\(/g) || []).length;
  check(n >= 6, `Alle Wege an Betriebe nutzen die Antwortadresse (Arbeitsliste, Brief, BCC, Wiedervorlage, Nachholung, Sammel-Erinnerung): ${n}`);
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('brief_antwort','')");
  check(App.antwortEmail() === '' && App.antwortKopf() === '' && !/Reply-To/.test(App.emlErzeugen({ to: 'a', subject: 'x', body: 'y' })) && Workflows._antwortCtx({ pruefer_email: 'p@x' }).pruefer_email === 'p@x', 'Leer gesetzt: wieder die E-Mail der Sachbearbeitung, kein Reply-To');
  App.run("DELETE FROM einstellungen WHERE schluessel='brief_antwort'");
  const V = read('src/js/modules/views.js');
  check(/id="setBriefAntwort"/.test(V) && /\['brief_antwort', 'setBriefAntwort'\]/.test(V) && /id="setBriefAntwortName"/.test(V), 'Einstellungen → Kontakt → Briefbogen: Antwortadresse und Name');
}

console.log('\n══ Brief als Modell ══');
let modelle;
{
  modelle = Workflows.briefModelle(900);
  check(modelle.length === 2, `Ein Brief je Betrieb (${modelle.length})`);
  const m = modelle.find(x => x.email);
  check(m && /Frau Grün/.test(m.anschrift) && /Gärtnerei Mail/.test(m.anschrift) && /79100 Freiburg/.test(m.anschrift), 'Anschrift mehrzeilig');
  check(m.info.find(z => z.label === 'E-Mail:').wert === 'Freisprechung.GB@rpf.bwl.de' && m.info.find(z => z.label === 'Telefon:').wert === '0761 208-1234', 'Infoblock: E-Mail = Funktionspostfach, Telefon des Prüfers');
  check(m.typ === 'betrieb_maengel' && m.betreff.length > 5 && /Sehr geehrte/.test(m.text) && !/Mit freundlichen Gr/.test(m.text), 'Betreff und Text der Vorlage, Grußformel abgetrennt');
  check(/^Mit freundlichen Gr/.test(m.gruss) && /Muster, Max/.test(m.unterschrift), 'Grußformel und Unterschrift als eigene Felder');
  check(m.tabelle && m.tabelle.zeilen.length === 2 && m.tabelle.zeilen[0][0] === 'Eins, Erik' && m.tabelle.zeilen[0][3] === '3', 'Übersicht je Azubi (Name, Ergebnis, Wiedervorlage, Fehltage)');
  check(/Berichtsheftdurchsichtsbogen/.test(m.anlagen) && m.fusszeile.split('|').length === 6 && /A-01/.test(m.datenschutz), 'Anlagen, Fußzeile und Datenschutz aus dem Briefbogen');
  check(m.cc === 'erik@example.org' && m.azubiIds.join() === '901,902' && m.keIds.includes(9001), 'CC an Azubis, Azubis mit Bogen, Ergebnisse für den Versandnachweis');
  const ohne = modelle.find(x => !x.email);
  check(ohne && ohne.typ === 'nachholung' && /Gärtnerei Brief/.test(ohne.anschrift), 'Betrieb ohne E-Mail: Nachhol-Aufforderung per Post');
  const vor = Workflows.briefModelle(910);
  check(vor.length === 2 && vor.every(x => x.typ === 'brief_betrieb' && !x.tabelle && !x.anlagen && x.info.some(z => z.label === 'Kontrolltermin:')), 'Vor der Kontrolle: Ankündigung ohne Übersicht und Anlagen');
  check(Workflows.briefModelle(900, { nurOhneEmail: true }).length === 1 && Workflows.briefModelle(900, { nurKey: m.key }).length === 1, 'Filter: nur ohne E-Mail / ein Betrieb');
}

console.log('\n══ Bearbeiten im Editor ══');
{
  let modal = null;
  App.openModal = (t, b, f) => { modal = { t, b, f }; };
  App.uGet = (k, d) => d; App.uSet = () => {};
  BriefEditor.zeichnen = () => {};
  BriefEditor.oeffnen(900);
  check(modal && /Briefe an Betriebe/.test(modal.t) && BriefEditor.modelle().length === 2, 'Editor öffnet mit allen Briefen des Termins');
  const m = BriefEditor.aktuell();
  check(BriefEditor._setzen(m, 'betreff', 'Neuer Betreff – geändert') && m.betreff === 'Neuer Betreff – geändert' && m._geaendert, 'Betreff änderbar');
  BriefEditor._setzen(m, 'info.0.wert', 'Pix, Hannes');
  BriefEditor._setzen(m, 'tabelle.zeilen.0.1', 'Nachreichen per Post');
  BriefEditor._setzen(m, 'anschrift', 'Gärtnerei Mail\nz. H. Herrn Blau\nWeg 1\n79100 Freiburg');
  check(m.info[0].wert === 'Pix, Hannes' && m.tabelle.zeilen[0][1] === 'Nachreichen per Post' && /Herrn Blau/.test(m.anschrift), 'Infoblock, Tabellenzellen und Anschrift änderbar');
  check(!BriefEditor._setzen(m, 'gibtsnicht.3.x', 'a'), 'Unbekannter Pfad wird abgewiesen');
  BriefEditor.zeileHinzu(); check(m.tabelle.zeilen.length === 3, 'Zeile hinzufügen');
  BriefEditor.zeileWeg(2); check(m.tabelle.zeilen.length === 2, 'Zeile entfernen');
  BriefEditor.infoHinzu(); check(m.info[m.info.length - 1].label === 'Neu:', 'Infozeile hinzufügen');
  BriefEditor.infoWeg(m.info.length - 1);
  // Entwürfe bleiben je Termin erhalten und gehen in jede Ausgabe ein
  BriefEditor.oeffnen(900);
  check(BriefEditor.aktuell().betreff === 'Neuer Betreff – geändert', 'Erneutes Öffnen: Änderungen bleiben (bis zum Neuladen)');
  const W = read('src/js/modules/workflows.js');
  check(/if \(entwuerfe\) modelle = modelle\.map\(m => entwuerfe\[m\.key\] \|\| m\)/.test(W), 'Auch das Gesamtpaket (exportSeriendruckPDF) nimmt die bearbeiteten Briefe');
  // Zurücksetzen holt den automatischen Stand
  App.confirm = async () => true;
  await BriefEditor.zuruecksetzen();
  check(BriefEditor.aktuell().betreff !== 'Neuer Betreff – geändert' && !BriefEditor.aktuell()._geaendert, 'Zurücksetzen holt den automatischen Text');
  BriefEditor._setzen(BriefEditor.aktuell(), 'betreff', 'Neuer Betreff – geändert');
  BriefEditor._setzen(BriefEditor.aktuell(), 'tabelle.zeilen.0.1', 'Nachreichen per Post');
}

console.log('\n══ Word (.docx) ══');
{
  const ms = BriefEditor.modelle();
  const bytes = BriefEditor.docxBytes(ms);
  const z = new sandbox.PizZip(bytes);
  const doc = z.file('word/document.xml').asText();
  check(bytes.length > 2000 && z.file('[Content_Types].xml') && z.file('word/styles.xml') && z.file('docProps/core.xml'), `Gültiges Paket (${bytes.length} Bytes)`);
  check(/Neuer Betreff – geändert/.test(doc) && /Nachreichen per Post/.test(doc) && /Gärtnerei Brief/.test(doc), 'Bearbeitete Inhalte stehen in der Word-Datei');
  check((doc.match(/<w:sectPr>/g) || []).length === ms.length && (doc.match(/<w:pgNumType w:start="1"\/>/g) || []).length === ms.length, 'Je Brief ein Abschnitt mit eigener Seitenzählung');
  check(z.file('word/footer1.xml') && z.file('word/footer2.xml') && /SECTIONPAGES/.test(z.file('word/footer1.xml').asText()) && /A-01/.test(z.file('word/footer1.xml').asText()), 'Fußzeile je Brief: Datenschutz, „Seite x von y“, Dienstgebäude');
  check(/<w:tblHeader\/>/.test(doc) && /Auszubildende\/r/.test(doc) && /w:fill="F2F0EF"/.test(doc), 'Übersicht als echte Word-Tabelle mit Kopfzeile');
  check(/<w:rFonts w:ascii="Arial"/.test(z.file('word/styles.xml').asText()) && /w:val="de-DE"/.test(z.file('word/styles.xml').asText()), 'Schrift Arial, Sprache Deutsch');
  const balanciert = (x) => { const st = []; for (const t of x.match(/<\/?[A-Za-z][^>]*?\/?>/g)) { if (t.endsWith('/>') || t.startsWith('<?')) continue; if (t.startsWith('</')) { if (st.pop() !== t.slice(2, -1)) return false; } else st.push(t.slice(1).split(/[\s>]/)[0]); } return st.length === 0; };
  check(balanciert(doc) && balanciert(z.file('word/footer1.xml').asText()), 'XML wohlgeformt (alle Elemente geschlossen)');
  check(!/<w:t[^>]*>[^<]*[<>&][^<]*<\/w:t>/.test(doc.replace(/&(amp|lt|gt|quot);/g, '')), 'Sonderzeichen maskiert');
  if (process.env.BRIEF_DOCX) fs.writeFileSync(process.env.BRIEF_DOCX, bytes);   // Sichtprüfung (LibreOffice/Word)
}

console.log('\n══ E-Mail-Entwurf mit Brief-Anhang ══');
{
  sandbox.jspdf = undefined;
  const m = BriefEditor.modelle().find(x => x.email);
  const eml = BriefEditor.emlFuer(m, { anhang: 'docx', boegen: false });
  check(/\r\nTo: mail@example\.org\r\n/.test(eml) && /\r\nCc: erik@example\.org\r\n/.test(eml) && /Reply-To: [^\r]+\r\n <Freisprechung\.GB@rpf\.bwl\.de>/.test(eml), 'An den Betrieb, CC Azubi, Antwort an das Funktionspostfach');
  check(/Content-Type: application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document; name="Schreiben_Gaertnerei_Mail\.docx"/.test(eml), 'Brief als Word-Anhang mit Endung .docx (vorher erzwang emlErzeugen .pdf)');
  check(new RegExp('Subject: =\\?UTF-8\\?B\\?' + App._b64Text('Neuer Betreff – geändert').replace(/[+/=]/g, '\\$&')).test(eml), 'Betreff = bearbeiteter Betreff');
  const text = BriefEditor.mailText(m);
  check(/Sehr geehrte/.test(text) && /- Eins, Erik – Ergebnis der Durchsicht: /.test(text) && /Mit freundlichen Gr/.test(text) && /E-Mail: Freisprechung\.GB@rpf\.bwl\.de/.test(text), 'Mailtext = Brieftext mit Übersicht, Grußformel und Funktionspostfach');
  check(!/Reply-To/.test(App.emlErzeugen({ to: 'a', subject: 'x', body: 'y', replyTo: false })) && /application\/pdf; name="a\.pdf"/.test(App.emlErzeugen({ to: 'a', subject: 'x', body: 'y', anhaenge: [{ name: 'a', bytes: new Uint8Array([1]) }] })), 'Anhang ohne Endung bleibt PDF');
  // Versandnachweis an der offenen Wiedervorlage (Mängel)
  BriefEditor._versandVermerken(m);
  const w = App.query('SELECT versand_datum, versand_art FROM wiedervorlagen WHERE id=950')[0];
  check(w && w.versand_datum && w.versand_art === 'email', 'E-Mail-Entwurf vermerkt den Versand an der Wiedervorlage');
}

console.log('\n══ Verdrahtung ══');
{
  const W = read('src/js/modules/workflows.js'), I = read('index.html'), BS = read('build.sh'), CSS = read('src/css/styles.css');
  check(/<script src="src\/js\/modules\/brief-editor\.js"><\/script>/.test(I) && /"src\/js\/modules\/brief-editor\.js"/.test(BS), 'index.html und build.sh laden den Editor');
  check(!/onclick="Workflows\.exportSeriendruckPDF/.test(W) && /Workflows\.briefeBearbeiten\(' \+ terminId \+ '\)/.test(W) && /briefeBearbeiten\(\$\{terminId\}, \{ nurOhneEmail: true \}\)/.test(W), 'Alle Brief-Knöpfe öffnen den Editor statt direkt ein PDF');
  const B = read('src/js/modules/brief-editor.js');
  check(/contenteditable="plaintext-only"/.test(B) && /role="textbox"/.test(B) && /aria-label=/.test(B), 'Felder: nur Text, als Textfeld beschriftet (Bildschirmleser)');
  check(/\.bz-feld:focus \{ outline: 2px solid/.test(CSS) && !/\.bz[^{]*\{[^}]*font-size:\s*\d+px/.test(CSS.replace(/font-size:\s*1[2-9]px/g, '').replace(/font-size:\s*[2-9]\dpx/g, '')), 'Sichtbarer Fokus, keine Schrift unter 12 px');
}

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
