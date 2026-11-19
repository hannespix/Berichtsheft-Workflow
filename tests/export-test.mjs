// ═══════════════════════════════════════════════════════════════════
//  Export an jeder Tabelle (TabellenExport): Leiste unter den Listen,
//  Datenquellen für Stammdaten (Betriebe als Adressliste, Berufsschulen,
//  Klassen, Jahrgänge, Prüfer, Azubis), Termine und Wiedervorlagen,
//  Auswahl = angehakte Zeilen, sonst alle angezeigten; E-Mail-Adressen;
//  Ergebnisliste der Durchsicht nur für die Auswahl.
//  Die Leiste selbst (DOM) prüft der Smoke-Test im echten Browser.
//  Ausführen:  node tests/export-test.mjs
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
const TE_SRC = read('src/js/modules/tabellen-export.js'), ST = read('src/js/modules/stammdaten.js'), V = read('src/js/modules/views.js');
const K = read('src/js/modules/kontrolle.js'), B = read('src/js/modules/berichte.js'), CSS = read('src/css/styles.css');
const UTILS = read('src/js/utils.js'), INDEX = read('index.html'), BUILD = read('build.sh');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const el = (id) => ({ id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const geschrieben = [], kopiert = [], toasts = [];
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, Object, Array, Number, String, parseInt, parseFloat, isNaN,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: el, addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} }, UndoManager: { push() {}, clear() {} },
  confirm: () => false, esc: (x) => String(x ?? ''), todayStr: () => '2026-11-19', dateStr: (d) => d.toISOString().slice(0, 10),
  formatDate: (d) => d ? String(d).slice(0, 10).split('-').reverse().join('.') : '–', getKW: () => 25, svgIcon: () => '', Papa: {},
  wvArtLabel: (a) => ({ post_an_rp: 'Per Post ans RP', nachholung_naechste_durchsicht: 'Nachholung bis nächste Durchsicht' }[a] || a || '–'),
  // Kleine Attrappe von SheetJS: hält die Blätter als Zeilenlisten fest
  XLSX: {
    utils: {
      book_new: () => ({ SheetNames: [], Sheets: {} }),
      aoa_to_sheet: (aoa) => ({ aoa }),
      json_to_sheet: (rows) => ({ aoa: rows.length ? [Object.keys(rows[0]), ...rows.map(r => Object.values(r))] : [] }),
      book_append_sheet: (wb, ws, name) => { wb.SheetNames.push(name); wb.Sheets[name] = ws; },
      encode_range: (r) => `R${r.s.r}C${r.s.c}:R${r.e.r}C${r.e.c}`,
    },
    writeFile: (wb, name) => { geschrieben.push({ wb, name }); },
  },
  Views: {}, SchuelerView: { render() {} }, SchuelerAkte: { getCount: () => 0 }, GlobalSearch: {},
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/stammdaten.js', 'StammdatenTab'], ['src/js/modules/berichte.js', 'BerichteHandler'], ['src/js/modules/tabellen-export.js', 'TabellenExport']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, TabellenExport: TE, StammdatenTab, BerichteHandler } = sandbox;
App.db = db; App.toast = (m, t) => { toasts.push([m, t]); }; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
App.kopieren = async (t, m) => { kopiert.push({ t, m }); return true; };
App.currentUser = 'Test';
App.migrateDB();

// ── Testdaten ──
db.run("INSERT OR IGNORE INTO fachrichtungen (code,bezeichnung,typ) VALUES ('036','GaLaBau','Gärtner'),('034','Obstbau','Gärtner')");
const FR1 = App.scalar("SELECT id FROM fachrichtungen WHERE code='036'"), FR2 = App.scalar("SELECT id FROM fachrichtungen WHERE code='034'");
db.run("INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr,pruefungstermin) VALUES (10,'S2027','Sommer',2027,'2027-07-01'),(11,'S2028','Sommer',2028,'')");
db.run(`INSERT INTO berufsschulen (id,name,ort,ansprechpartner,telefon,email,email_cc,ansprechpartner_json) VALUES
  (1,'BS Freiburg','Freiburg','Fr. Lehr','0761 111','sekretariat@bs-fr.example','leitung@bs-fr.example','[{"name":"Herr Kurs","rolle":"Abteilungsleiter","email":"kurs@bs-fr.example","telefon":"0761 112","mobil":""}]'),
  (2,'BS Offenburg','Offenburg','','','','','kein json')`);
db.run(`INSERT INTO klassen (id,berufsschule_id,jahrgang_id,lehrjahr,fachrichtung_id,klassenbezeichnung) VALUES (101,1,10,2,${FR1},'GL S2027'),(102,1,11,1,${FR2},'OB S2028'),(201,2,10,2,${FR2},'OB S2027 OG')`);
db.run(`INSERT INTO betriebe (id,betriebsnummer,name,vorname,zusatzbezeichnung,firma,ansprechpartner,strasse,plz,ort,telefon,fax,email) VALUES
  (1,'4711','Müller','Gärtnerei','Garten- und Landschaftsbau','Müller GmbH','Herr Müller','Hauptstr. 1','79098','Freiburg','0761 208-0','0761 208-9','info@mueller.example'),
  (2,'0815','Baumschule Weber','','','','','Am Feld 3','01067','Dresden','+49 351 123','','Info@Weber.example; buero@weber.example'),
  (3,'0816','Obsthof Ohne','','','','','','77933','Lahr','','','')`);
db.run("INSERT INTO ausbilder (id,betrieb_id,nachname,vorname,telefon,email,mobil,funktion) VALUES (1,1,'Müller','Max','0761 1','max@mueller.example','0170 1','Ausbilder'),(2,1,'Grün','Gabi','','gabi@mueller.example','','Meisterin'),(3,2,'Weber','Willi','','','','')");
db.run(`INSERT INTO schueler (id,ibykus_id,nachname,vorname,ausbildungsstaette,fachrichtung_id,betrieb_id,klasse_id,jahrgang_id,aktiv,status,ausbildungsbeginn,ausbildungsende,email,telefon,schulklasse) VALUES
  (1,'A1','Eins','Anna','',${FR1},1,101,10,1,'aktiv','2024-09-01','2027-08-31','anna@example.org','0151 1','G2a'),
  (2,'A2','Zwei','Bernd','',${FR1},1,101,10,1,'aktiv','2024-09-01','2027-08-31','','',''),
  (3,'A3','Drei','Clara','',${FR2},2,102,11,1,'aktiv','2025-09-01','2028-08-31','','',''),
  (4,'A4','Vier','Dora','',${FR2},2,201,10,0,'inaktiv','2024-09-01','2027-08-31','','',''),
  (5,'A5','Fuenf','Emil','Freier Betrieb',${FR2},NULL,102,11,1,'aktiv','2025-09-01','2028-08-31','','','')`);
db.run("INSERT INTO pruefer (id,name,email,telefon,aktiv) VALUES (1,'Hannes Pix','pix@example.org','0761 208-1356',1),(2,'Alt Prüfer','','',0)");
db.run(`INSERT INTO kontrolltermine (id,jahrgang_id,berufsschule_id,geplant_datum,durchgefuehrt_datum,pruefer,status,typ,bemerkung,archiviert_am) VALUES
  (500,10,1,'2026-06-17','2026-06-17','Hannes Pix','durchgefuehrt','schulkontrolle','Aula','2026-10-01'),
  (501,11,NULL,'2026-12-03','','Hannes Pix','geplant','einsendung','','')`);
db.run("UPDATE kontrolltermine SET ort='Büro des RP' WHERE id=501");
db.run("INSERT INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (500,101)");
db.run("INSERT INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (501,3),(501,5)");
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,ergebnis,bemerkung) VALUES (900,500,1,'post_an_rp','fehlt'),(901,500,2,'in_ordnung','')`);
db.run(`INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status,versand_datum,versand_art,mahnstufe,erledigt_datum,erledigt_bemerkung,erstellt_am) VALUES
  (800,900,1,'post_an_rp','2026-07-15','ueberfaellig','2026-06-20','E-Mail',1,'','','2026-06-17 10:00:00'),
  (801,NULL,5,'nachholung_naechste_durchsicht','','offen','','',0,'','','2026-06-18 09:00:00'),
  (802,900,1,'post_an_rp','2026-05-01','erledigt','','',0,'2026-05-02','Nachweis da','2026-04-01 08:00:00')`);
try { App._tkCache = {}; } catch (e) {}

const blatt = (art, ids, n = 0) => TE.blaetter(art, ids)[n];
const spalte = (b, name) => b.zeilen.map(r => r[b.kopf.indexOf(name)]);

console.log('══ Betriebe als Adressliste ══');
{
  const bl = TE.blaetter('betriebe', [2, 1, 3]);
  const b = bl[0];
  check(b.name === 'Betriebe' && b.kopf.join('|') === 'Betriebsnummer|Betrieb|Zusatzbezeichnung|Firma|Ansprechpartner|Straße|PLZ|Ort|Telefon|Fax|E-Mail|Aktive Azubis|Ausbilder|E-Mail (Ausbilder)', 'Kopf der Adressliste: Anschrift in eigenen Spalten');
  check(spalte(b, 'Betrieb').join('|') === 'Baumschule Weber|Gärtnerei Müller|Obsthof Ohne', 'Reihenfolge wie am Bildschirm (Reihenfolge der Kennungen), Name mit Vornamen');
  const m = b.zeilen[1];
  check(m[0] === '4711' && m[2] === 'Garten- und Landschaftsbau' && m[3] === 'Müller GmbH' && m[4] === 'Herr Müller' && m[5] === 'Hauptstr. 1' && m[6] === '79098' && m[7] === 'Freiburg' && m[8] === '0761 208-0' && m[9] === '0761 208-9' && m[10] === 'info@mueller.example', 'Alle Adress- und Kontaktfelder des Betriebs');
  check(typeof b.zeilen[0][6] === 'string' && b.zeilen[0][6] === '01067' && b.zeilen[0][0] === '0815', 'PLZ und Betriebsnummer bleiben Text (führende Null)');
  check(m[11] === 2 && b.zeilen[0][11] === 1 && b.zeilen[2][11] === 0, 'Aktive Azubis je Betrieb (inaktive zählen nicht)');
  check(m[12] === 'Gabi Grün; Max Müller' && m[13] === 'gabi@mueller.example; max@mueller.example' && b.zeilen[2][12] === '', 'Ausbilder und ihre E-Mail-Adressen in einer Zelle');
  check(bl[1].name === 'Ausbilder' && bl[1].zeilen.length === 3 && bl[1].zeilen[0].join('|') === 'Baumschule Weber|Dresden|Weber|Willi||||' && bl[1].zeilen[2].join('|') === 'Gärtnerei Müller|Freiburg|Müller|Max|Ausbilder|0761 1|0170 1|max@mueller.example', 'Zweites Blatt: Ausbilder je Betrieb');
  check(bl[2].name === 'Azubis' && bl[2].zeilen.length === 3 && bl[2].zeilen.map(r => r[2]).join(',') === 'Drei,Eins,Zwei' && bl[2].zeilen[1].join('|') === 'Gärtnerei Müller|Freiburg|Eins|Anna|GaLaBau|S2027|BS Freiburg|GL S2027|01.09.2024|31.08.2027|0151 1|anna@example.org', 'Drittes Blatt: aktive Azubis je Betrieb');
  const nur = TE.blaetter('betriebe', [3]);
  check(nur.length === 1 && nur[0].zeilen.length === 1, 'Auswahl: nur die gewählten Betriebe, leere Zusatzblätter entfallen');
  App.filterFachrichtungen = [FR2];
  check(blatt('betriebe', [1, 2]).zeilen.map(r => r[11]).join(',') === '0,1', 'Azubi-Zahlen folgen dem globalen Berufsfilter – wie in der Liste');
  App.filterFachrichtungen = [];
  check(TE.blaetter('betriebe', []).length === 1 && TE.blaetter('betriebe', [])[0].zeilen.length === 0 && TE.blaetter('betriebe', ['x; DROP TABLE betriebe']).length === 1 && App.scalar('SELECT COUNT(*) FROM betriebe') === 3, 'Leere oder unbrauchbare Kennungen: leere Liste, kein SQL aus der Kennung');
}

console.log('\n══ E-Mail-Adressen ══');
{
  const r = TE.emailAdressen('betriebe', [1, 2, 3]);
  check(r.adressen.join('|') === 'info@mueller.example|Info@Weber.example|buero@weber.example' && r.ohne === 1, 'Adressen der Auswahl, mehrere je Betrieb getrennt, Betriebe ohne Adresse gezählt');
  db.run("UPDATE betriebe SET email='INFO@mueller.example' WHERE id=3");
  check(TE.emailAdressen('betriebe', [1, 3]).adressen.length === 1, 'Doppelte Adressen nur einmal (Groß-/Kleinschreibung egal)');
  db.run("UPDATE betriebe SET email='' WHERE id=3");
  check(TE.emailAdressen('schulen', [1, 2]).adressen.join() === 'sekretariat@bs-fr.example' && TE.emailAdressen('klassen', [101]).adressen.length === 0, 'Berufsschulen ebenso; andere Arten haben keine Adressen');
  check(TE.EXPORTE.betriebe.mail && TE.EXPORTE.schulen.mail && !TE.EXPORTE.azubis.mail && /Feld „Bcc“ einfügen/.test(TE_SRC), 'Knopf „E-Mail-Adressen“ nur bei Betrieben und Berufsschulen, Hinweis auf Bcc');
}

console.log('\n══ Berufsschulen, Klassen, Jahrgänge, Prüfer ══');
{
  const bl = TE.blaetter('schulen', [1, 2]);
  check(bl[0].kopf.join('|') === 'Berufsschule|Ort|Ansprechpartner|Telefon|E-Mail|E-Mail (CC)|Klassen|Aktive Azubis' && bl[0].zeilen[0].join('|') === 'BS Freiburg|Freiburg|Fr. Lehr|0761 111|sekretariat@bs-fr.example|leitung@bs-fr.example|2|4' && bl[0].zeilen[1].join('|') === 'BS Offenburg|Offenburg|||||1|0', 'Berufsschulen mit Kontakt, Klassen und aktiven Azubis');
  check(bl[1].name === 'Ansprechpartner' && bl[1].zeilen.length === 1 && bl[1].zeilen[0].join('|') === 'BS Freiburg|Freiburg|Herr Kurs|Abteilungsleiter|0761 112||kurs@bs-fr.example', 'Blatt Ansprechpartner (kaputtes JSON stört nicht)');
  check(bl[2].name === 'Klassen' && bl[2].zeilen.length === 3, 'Blatt Klassen der gewählten Schulen');
  const k = blatt('klassen', [201, 101]);
  check(k.kopf.join('|') === 'Berufsschule|Ort|Jahrgang|Lehrjahr|Fachrichtung|Bezeichnung|Azubis aktiv|Azubis gesamt' && k.zeilen[0].join('|') === 'BS Offenburg|Offenburg|S2027|2|Obstbau|OB S2027 OG|0|1' && k.zeilen[1].join('|') === 'BS Freiburg|Freiburg|S2027|2|GaLaBau|GL S2027|2|2', 'Klassen mit Schule, Jahrgang, Fachrichtung, aktiv/gesamt');
  const j = blatt('jahrgaenge', [10, 11]);
  check(j.zeilen[0].join('|') === 'S2027|Sommer|2027|01.07.2027|2|3' && j.zeilen[1].join('|') === 'S2028|Sommer|2028||2|2', 'Jahrgänge mit Prüfungstermin und Azubi-Zahlen');
  const p = blatt('pruefer', [1, 2]);
  check(p.kopf.join('|') === 'Name|E-Mail|Telefon|Status' && p.zeilen[0].join('|') === 'Hannes Pix|pix@example.org|0761 208-1356|Aktiv' && p.zeilen[1][3] === 'Inaktiv', 'Prüfer mit Kontakt und Status (ohne Signatur)');
}

console.log('\n══ Azubi-Liste ══');
{
  StammdatenTab._lastAzubiWhere = 's.aktiv=1'; StammdatenTab._lastAzubiParams = [];
  StammdatenTab._getActiveFilterLabels = () => ['Jahrgang: S2027'];
  const alle = TE.blaetter('azubis', null);
  check(alle[0].zeilen.length === 4 && alle[0].kopf[0] === 'Nachname' && alle[0].kopf.includes('Klasse (Berufsschule)') && alle[0].zeilen[1][alle[0].kopf.indexOf('Klasse (Berufsschule)')] === 'G2a', 'Ohne Auswahl die ganze gefilterte Liste (nicht nur die Seite), mit Klasse an der Berufsschule');
  check(alle[1] && alle[1].name === 'Filter-Info' && alle[1].zeilen[0][0] === 'Jahrgang: S2027' && alle[1].ohneFilter, 'Blatt Filter-Info nennt die aktiven Filter');
  const wahl = TE.blaetter('azubis', [3, 1]);
  check(wahl[0].zeilen.length === 2 && wahl[0].zeilen.map(r => r[0]).join() === 'Drei,Eins', 'Mit Auswahl nur die angehakten Azubis');
  check(/data-export="azubis" data-export-alle data-export-anzahl="\$\{azubis\.length\}"/.test(ST) && /_azubiExportDaten\(ids\) \{/.test(ST) && /const d = this\._azubiExportDaten\(ids\);/.test(ST), 'Tabelle meldet die Gesamtzahl; „Liste → Als Excel exportieren“ nutzt dieselben Daten');
  geschrieben.length = 0;
  StammdatenTab._exportAzubiExcel();
  check(geschrieben.length === 1 && geschrieben[0].name === 'Azubi-Liste_2026-11-19.xlsx' && geschrieben[0].wb.Sheets.Azubis.aoa.length === 5, 'Bisheriger Export aus dem Menü „Liste“ unverändert');
}

console.log('\n══ Termine und Wiedervorlagen ══');
{
  const t = blatt('termine', [501, 500]);
  check(t.kopf.join('|') === 'Datum|KW|Wochentag|Art|Ort|Stadt|Klassen|Fachrichtung|Jahrgang|Azubis|Bewertet|Prüfer|Status|Stand|Durchgeführt am|Nachbereitet am|Archiviert am|Bemerkung', 'Kopf der Terminliste');
  const e = t.zeilen[0], s = t.zeilen[1];
  check(e[0] === '03.12.2026' && e[2] === 'Do' && e[3] === 'Einsendung / Einzeltermin' && e[4] === 'Büro des RP' && e[9] === 2 && e[10] === 0 && e[12] === 'Geplant', 'Einzeltermin mit freiem Ort, Azubi-Zahl, Status');
  check(s[0] === '17.06.2026' && s[3] === 'Schultermin' && s[4] === 'BS Freiburg' && s[5] === 'Freiburg' && s[6] === 'GL S2027' && s[7] === 'GaLaBau' && s[8] === 'S2027' && s[9] === 2 && s[10] === 2 && s[11] === 'Hannes Pix' && s[12] === 'Durchgeführt' && s[14] === '17.06.2026' && s[16] === '01.10.2026' && s[17] === 'Aula', 'Schultermin mit Klassen, bewertet, durchgeführt, archiviert, Bemerkung');
  const w = blatt('wiedervorlagen', [800, 801, 802]);
  check(w.kopf.join('|') === 'Nachname|Vorname|Betrieb|E-Mail (Betrieb)|Telefon (Betrieb)|Berufsschule|Klasse|Jahrgang|Art|Frist|Status|Mahnstufe|Anschreiben am|Versandart|Erledigt am|Erledigt-Bemerkung|Durchsicht am|Angelegt am', 'Kopf der Wiedervorlagen');
  check(w.zeilen[0].join('|') === 'Eins|Anna|Gärtnerei Müller|info@mueller.example|0761 208-0|BS Freiburg|GL S2027|S2027|Per Post ans RP|15.07.2026|Überfällig|1|20.06.2026|E-Mail|||17.06.2026|17.06.2026', 'Wiedervorlage mit Betrieb, Frist, Status, Versandnachweis, Datum der Durchsicht');
  check(w.zeilen[1][2] === 'Freier Betrieb' && w.zeilen[1][9] === 'nächste Durchsicht' && w.zeilen[1][10] === 'Offen' && w.zeilen[2][10] === 'Erledigt' && w.zeilen[2][14] === '02.05.2026' && w.zeilen[2][15] === 'Nachweis da', 'Ohne Datum „nächste Durchsicht“, Betrieb aus dem Freitext, erledigte mit Datum und Bemerkung');
}

console.log('\n══ Arbeitsmappe ══');
{
  const wb = TE.mappe([{ name: 'Betriebe: A/B [alt]', kopf: ['A', 'B'], zeilen: [['x', 1], ['yy', 2]] }, { name: 'betriebe  a b  alt', kopf: ['A'], zeilen: [] }, { name: 'Info', kopf: ['A'], zeilen: [['z']], ohneFilter: true }]);
  check(wb.SheetNames.length === 3 && wb.SheetNames[0] === 'Betriebe A B alt' && wb.SheetNames[1] === 'betriebe a b alt 2' && wb.SheetNames.every(n => n.length <= 31 && !/[\\\/?*\[\]:]/.test(n)), 'Blattnamen ohne verbotene Zeichen, eindeutig, höchstens 31 Zeichen');
  check(wb.Sheets[wb.SheetNames[0]]['!autofilter'].ref === 'R0C0:R2C1' && !wb.Sheets[wb.SheetNames[1]]['!autofilter'] && !wb.Sheets.Info['!autofilter'], 'Autofilter auf der Kopfzeile (nicht bei leeren und Info-Blättern)');
  check(wb.Sheets[wb.SheetNames[0]]['!cols'].length === 2 && wb.Sheets[wb.SheetNames[0]]['!cols'].every(c => c.wch >= 8 && c.wch <= 62), 'Spaltenbreiten nach Inhalt, begrenzt');
  check(TE._text_tsv({ kopf: ['A', 'B'], zeilen: [['x\ty', 'z\n1'], [null, 0]] }) === 'A\tB\nx y\tz 1\n\t0', 'Kopieren: Tabulator-getrennt, Umbrüche in Zellen entschärft');
  check(TE._wert('12') === 12 && TE._wert('01067') === '01067' && TE._wert('0') === 0 && TE._wert('12 %') === '12 %' && TE._wert('0761 208') === '0761 208' && TE._wert('123456789012') === '123456789012', 'Tabellenansicht: ganze Zahlen als Zahl, alles andere als Text');
  check(TE._anzahlText({ anzahl: 1, einheit: ['Betrieb', 'Betriebe'], auswahl: false }) === '1 Betrieb' && TE._anzahlText({ anzahl: 3, einheit: ['Betrieb', 'Betriebe'], auswahl: true }) === '3 Betriebe (Auswahl)', 'Meldung nennt Zahl und Auswahl');
  let fehler = ''; try { TE.blaetter('gibtsnicht', [1]); } catch (e) { fehler = e.message; }
  check(/Unbekannte Export-Art/.test(fehler), 'Unbekannte Art wird abgewiesen');
}

console.log('\n══ Durchsicht: Ergebnisliste nur für die Auswahl ══');
{
  geschrieben.length = 0; toasts.length = 0;
  BerichteHandler.exportTerminExcel(500);
  BerichteHandler.exportTerminExcel(500, [2]);
  check(geschrieben.length === 2 && geschrieben[0].wb.Sheets.Ergebnisse.aoa.length === 3 && geschrieben[1].wb.Sheets.Ergebnisse.aoa.length === 2 && geschrieben[1].wb.Sheets.Ergebnisse.aoa[1][0] === 'Zwei', 'exportTerminExcel(termin, ids) liefert nur die gewählten Azubis');
  check(/_Auswahl\.xlsx$/.test(geschrieben[1].name) && !/Auswahl/.test(geschrieben[0].name) && /1 Azubi \(Auswahl\) exportiert/.test(toasts[1][0]), 'Dateiname und Meldung kennzeichnen die Auswahl');
  check(/onclick="KontrolleHandler\.uebExcelAuswahl\(\)"/.test(K) && /uebExcelAuswahl\(\) \{\n    const ids = this\._uebAuswahlIds\(\);/.test(K) && /BerichteHandler\.exportTerminExcel\(this\.currentTerminId, ids\)/.test(K), 'Sammelleiste der Übersicht: „⬇ Excel“ für die Auswahl');
  check(/<table class="data-table ueb-tabelle" data-sort-eigen="1" data-kein-export>/.test(K), 'Die Übersicht selbst bekommt keine zweite Leiste (eigener Export im Menü „Termin“)');
}

console.log('\n══ Verdrahtung ══');
{
  for (const [art, src, name] of [['jahrgaenge', ST, 'Jahrgänge'], ['schulen', ST, 'Berufsschulen'], ['klassen', ST, 'Klassen'], ['pruefer', ST, 'Prüfer'], ['betriebe', ST, 'Betriebe'], ['termine', V, 'Termine'], ['wiedervorlagen', V, 'Wiedervorlagen']]) {
    check(new RegExp(`<table class="data-table" data-export="${art}">`).test(src) && typeof TE['_' + art] === 'function' && !!TE.EXPORTE[art], `Tabelle ${name} trägt data-export="${art}" und hat eine Datenquelle`);
  }
  check(/<tr data-id="\$\{r\.id\}">\n          <td><strong>\$\{esc\(r\.bezeichnung\)\}/.test(ST) && /rows\.map\(r => `<tr data-id="\$\{r\.id\}">\n          <td><strong>\$\{esc\(r\.name\)\}<\/strong><\/td>\n          <td>\$\{esc\(r\.email\)\}/.test(ST), 'Zeilen ohne Häkchen (Jahrgänge, Prüfer) tragen ihre Kennung');
  check(/class="chk-betr" value="\$\{b\.id\}" aria-label=/.test(ST) && /id="chkAllBetr" aria-label="Alle angezeigten Betriebe wählen"/.test(ST) && /_betriebeAlle\(an\) \{/.test(ST) && /if \(c && \(!an \|\| r\.style\.display !== 'none'\)\) c\.checked = !!an;/.test(ST), 'Betriebe: Häkchen je Zeile, „alle“ wählt nur die angezeigten');
  check(/id="bulkBarBetriebe"/.test(ST) && /TabellenExport\.fuer\('betriebe','xlsx'\)/.test(ST) && /TabellenExport\.fuer\('betriebe','mail'\)/.test(ST) && /_betriebeBulk\(\) \{/.test(ST), 'Betriebe: Auswahl-Leiste oben mit Excel-Adressliste, Kopieren, E-Mail-Adressen');
  check(/TabellenExport\.fuer\('schulen','xlsx'\)/.test(ST) && /TabellenExport\.fuer\('klassen','xlsx'\)/.test(ST) && /TabellenExport\.fuer\('azubis','xlsx'\)/.test(ST) && /TabellenExport\.fuer\('wiedervorlagen','xlsx'\)/.test(V), 'Auswahl-Leisten von Schulen, Klassen, Azubis und Wiedervorlagen haben „⬇ Excel“');
  check(/<script src="src\/js\/modules\/tabellen-export\.js"><\/script>/.test(INDEX) && /"src\/js\/modules\/tabellen-export\.js"/.test(BUILD) && /if \(typeof TabellenExport !== 'undefined'\) TabellenExport\.init\(\);/.test(UTILS), 'Modul in index.html, build.sh und beim Start');
  check(/MIN_ZEILEN: 3,/.test(TE_SRC) && /AUS_ANSICHTEN: \['dashboard'\],/.test(TE_SRC) && /t\.dataset\.keinExport != null \|\| t\.closest\('\[data-kein-export\]'\)/.test(TE_SRC), 'Leiste: ab drei Zeilen, nicht auf der Startseite, abschaltbar mit data-kein-export');
  check(/new MutationObserver\(plan\)\.observe\(document\.body, \{ childList: true, subtree: true \}\)/.test(TE_SRC) && /if \(zahl && zahl\.textContent !== text\) zahl\.textContent = text;/.test(TE_SRC) && /bar\.previousElementSibling !== bar\._teTabelle\) bar\.remove\(\)/.test(TE_SRC), 'Leiste hängt sich selbst an neue Tabellen, schreibt nur bei Änderung, räumt verwaiste Leisten weg');
  check(/\.tab-export \{[^}]*font-size: 12px/.test(CSS) && /@media print \{\n  \.tab-export \{ display: none !important; \}/.test(CSS) && /bar\.setAttribute\('aria-label', 'Diese Tabelle exportieren'\)/.test(TE_SRC), 'CSS: Schrift 12 px, nicht im Druck; Leiste ist beschriftet');
  check(!/fetch\(|https?:\/\//.test(TE_SRC) && !/Schüler/.test(TE_SRC), 'Kein Netzzugriff, kein „Schüler“ in der Oberfläche');
  TE.init();
  check(TE._init === true, 'init() ohne echten Browser bleibt still');
}

console.log(`\n${failed ? '✗' : '✓'} ${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
