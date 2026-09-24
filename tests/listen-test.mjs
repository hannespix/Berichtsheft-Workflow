// ═══════════════════════════════════════════════════════════════════
//  UI-Paket 2 „Listen“: ein Hauptknopf je Zeile + ⋯-Menü (Planung,
//  Wiedervorlagen, Stammdaten), gemeinsamer Menü-Helfer im Kern mit fester
//  Positionierung, Azubi-Liste nur in den Stammdaten mit Seiten à 50,
//  Import-Seite nur Import, Azubi bearbeiten in einem Reiter (IBYKUS-Felder
//  lesend, auf Wunsch änderbar), Jahrgang-Löschen als Dialog, Begriffe
//  Ausführen:  node tests/listen-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const APP = read('src/js/app-core.js'), V = read('src/js/modules/views.js'), ST = read('src/js/modules/stammdaten.js'), IH = read('src/js/modules/import-handler.js'), SV = read('src/js/modules/schueler-view.js'), K = read('src/js/modules/kontrolle.js'), CSS = read('src/css/styles.css');

console.log('══ Menü-Helfer im Kern ══');
{
  check(/  menue\(titel, eintraege, title, klasse\) \{/.test(APP) && /ontoggle="App\._menuePosition\(this\)"/.test(APP) && /_menuePosition\(d\) \{/.test(APP), 'App.menue baut das <details>-Menü und positioniert es beim Öffnen');
  check(/l\.style\.position = 'fixed'/.test(APP) && /r\.bottom \+ h \+ 8 > window\.innerHeight/.test(APP), 'Feste Positionierung, öffnet nach oben, wenn unten kein Platz ist (kein Abschneiden in scrollenden Karten)');
  check(/document\.addEventListener\('scroll', \(\) => zu\(null\), true\)/.test(APP) && /document\.addEventListener\('click', zu\)/.test(APP), 'Klick daneben und Scrollen schließen offene Menüs');
  check(/_menue\(titel, eintraege, title, klasse\) \{ return App\.menue\(/.test(K), 'Kontrolle nutzt denselben Helfer');
  check(/\.aktionen-menue\.klein > summary/.test(CSS) && /\.azubi-pager/.test(CSS) && /\.ibykus-block \.form-control:disabled/.test(CSS), 'CSS: schmaler ⋯-Knopf, Seitenleiste, IBYKUS-Block');
}

console.log('\n══ Planung: ein Hauptknopf je Termin ══');
{
  const tabelle = V.split("<tbody id=\"planTableBody\">")[1].split('</tbody>')[0];
  check(/Starten<\/button>/.test(tabelle) && /Nachbereiten<\/button>/.test(tabelle) && /Öffnen<\/button>/.test(tabelle) && /abg && !t\.nachbereitet_am/.test(tabelle), 'Hauptknopf folgt dem Status: Starten · Nachbereiten · Öffnen');
  check((tabelle.match(/<button /g) || []).length === 3, 'Genau drei Knopf-Varianten in der Zeile (Hauptknopf), alles Weitere im Menü');
  for (const f of ['PlanungHandler.editTermin(${t.id})', 'Workflows.emailSchule(${t.id})', 'Workflows.seriendruckBetriebe(${t.id})', 'PlanungHandler.exportTerminPDF(${t.id})', 'PlanungHandler.fremdeAemter(${t.id})', 'KontrolleHandler.printUebersicht(${t.id})', 'PlanungHandler.nachholterminAnlegen(${t.id})', 'PlanungHandler.deleteTermin(${t.id})']) check(tabelle.includes(f), `Menü enthält ${f.split('(')[0]}`);
  check(/App\.menue\('⋯', \[/.test(tabelle) && /'klein'\)/.test(tabelle), 'Menü als schmaler ⋯-Knopf');
}

console.log('\n══ Wiedervorlagen: Erledigt als Hauptknopf ══');
{
  const tabelle = V.split("<tbody id=\"wvTableBody\">")[1].split('</tbody>')[0];
  check(/WiedervorlagenHandler\.erledigenDirekt\(\$\{w\.id\}\)" title="Nachweis eingegangen/.test(tabelle) && /✓ Erledigt<\/button>/.test(tabelle), 'Offene Wiedervorlage: Hauptknopf „Erledigt“');
  check(/: `<button class="btn btn-sm btn-secondary" onclick="WiedervorlagenHandler\.details\(\$\{w\.id\}\)"/.test(tabelle), 'Erledigte: Hauptknopf „Details“');
  for (const f of ['WiedervorlagenHandler.erledigen(${w.id})', 'Workflows.emailBetriebWV(${w.id})', 'PDFExport.generateSingle(${w.kontrolltermin_id},${w.schueler_id})', 'WiedervorlagenHandler.details(${w.id})']) check(tabelle.includes(f), `Menü enthält ${f.split('(')[0]}`);
  check(/<th>Azubi<\/th><th>Betrieb<\/th>/.test(V), 'Spalte heißt Azubi');
}

console.log('\n══ Stammdaten: Seiten à 50, Hauptknopf Bearbeiten, Menü ══');
{
  check(/AZUBI_SEITE: 50,/.test(ST) && /_azubiSeite\(n\) \{/.test(ST) && /const sichtbar = azubis\.slice\(this\._azubiPage \* this\.AZUBI_SEITE/.test(ST) && /\$\{sichtbar\.map\(s => \{/.test(ST), 'Liste rendert nur die aktuelle Seite');
  check(/class="azubi-pager"/.test(ST) && /StammdatenTab\._azubiSeite\(0\)/.test(ST) && /StammdatenTab\._azubiSeite\(\$\{seiten - 1\}\)/.test(ST) && /Seite \$\{this\._azubiPage \+ 1\}\/\$\{seiten\}/.test(ST), 'Seitenleiste und Trefferzähler mit Seite');
  check(/this\._lastAzubiWhere = where;/.test(ST) && /_getFilteredAzubis\(\) \{/.test(ST), 'Excel-Export und Kopieren nehmen weiterhin die ganze gefilterte Liste');
  check(/onclick="ImportHandler\.editSchueler\(\$\{s\.id\}\)" title="Stammdaten bearbeiten">Bearbeiten<\/button> \$\{App\.menue\('⋯', \[/.test(ST), 'Zeile: Hauptknopf „Bearbeiten“ + ⋯-Menü');
  for (const f of ['Phasen.editor(${s.id})', 'SchuelerAkte.open(${s.id})', 'StammdatenTab.quickEinsendung([${s.id}])', 'StammdatenTab.showAzubiSnapshots(${s.id})', 'ImportHandler.deleteSchueler(${s.id})']) check(ST.includes(f), `Zeilenmenü enthält ${f.split('(')[0]}`);
  check(/onclick="ImportHandler\.addManually\(\)"[^>]*>\+ Azubi<\/button>/.test(ST) && /App\.menue\('Liste', \[/.test(ST) && /StammdatenTab\._exportAzubiExcel\(\)/.test(ST) && /StammdatenTab\._copyAzubiTable\(\)/.test(ST) && /SchuelerView\.abschliessenJahrgang\(\)/.test(ST) && /ImportHandler\.deleteAllJahrgang\(\)/.test(ST), 'Kopf: „+ Azubi“ und Listen-Menü mit Excel, Kopieren, Jahrgang abschließen, Jahrgang löschen');
}

console.log('\n══ Import-Seite nur noch Import, Azubi-Liste einmal ══');
{
  check(!/schuelerViewContainer/.test(V) && !/SchuelerView\.render\(\)/.test(V) && !/SchuelerView\.init\(\)/.test(V), 'Import-Seite ohne zweite Azubi-Liste');
  check(/<div id="csvSection">/.test(V) && /IBYKUS-Import \(CSV \/ Excel\)/.test(V) && /Die Azubi-Liste steht unter/.test(V), 'IBYKUS-Import aufgeklappt, Hinweis auf die Stammdaten');
  check(/onclick="App\.navigate\('stammdaten'\)" title="Klick/.test(V) || /stat-card stat-info" style="cursor:pointer" onclick="App\.navigate\('stammdaten'\)"/.test(V), 'Startseiten-Kennzahl führt in die Stammdaten');
  check(!/getFilteredData\(\) \{/.test(SV) && /abschliessenJahrgang\(\) \{/.test(SV) && /ImportHandler\.ausbildungBeenden\(ids/.test(SV) && /StammdatenTab\._renderAzubiTable\(c\)/.test(SV), 'SchuelerView: nur noch „Jahrgang abschließen“, render() frischt die Stammdaten-Liste auf');
  check(/deleteAllJahrgang\(\) \{\n    const jahrgaenge = App\.query/.test(IH) && /doDeleteAllJahrgang\(\) \{/.test(IH) && /id="mDelJG"/.test(IH) && !/SchuelerView\.filters\.jahrgang/.test(IH), 'Jahrgang komplett löschen: eigener Dialog mit Auswahl statt Filter der alten Liste');
  check(/App\.deleteSchuelerKaskade\(x\.id\)/.test(IH) && /App\.deleteKlasseKaskade\(k\.id\)/.test(IH), 'Löschen weiter über die Kaskaden');
}

console.log('\n══ Azubi bearbeiten: ein Reiter, IBYKUS lesend ══');
{
  const dlg = IH.split('  editSchueler(id) {')[1].split('  updateSchueler(id) {')[0];
  check(!/modal-tabs/.test(dlg) && !/_switchModalTab/.test(dlg), 'Keine Reiter mehr');
  const ids = ['mSNach','mSVor','mSIbykus','mSBetriebId','mSBetrieb','mSFR','mSKlasse','mSJG','mSBeginn','mSEnde','mSZP','mSAmt','mSLFK','mSBAV','mSStatus','mSAPZu','mSAPBe','mSInaktivDatum','mSInaktivGrund','mSTelefon','mSEmail','mSGeburt','mSGeschlecht','mSSchulabschluss','mSDauer','mSVerk','mSVorzeitig','mSPE','mSPEW1','mSPEW2'];
  check(ids.every(i => dlg.includes(`id="${i}"`)), `Alle ${ids.length} Feldkennungen vorhanden (updateSchueler unverändert)`);
  const ibykus = ['mSNach','mSVor','mSIbykus','mSBetriebId','mSBetrieb','mSFR','mSKlasse','mSJG','mSBeginn','mSEnde','mSZP','mSAmt','mSLFK','mSBAV','mSStatus','mSAPZu','mSAPBe','mSInaktivDatum','mSInaktivGrund'];
  check(ibykus.every(i => new RegExp(`class="[^"]*ibykus-feld" id="${i}"[^>]*disabled`).test(dlg) || new RegExp(`id="${i}"[^>]*disabled`).test(dlg)), 'IBYKUS-Felder sind zunächst gesperrt');
  const lokal = ['mSTelefon','mSEmail','mSGeburt','mSGeschlecht','mSSchulabschluss','mSDauer','mSVerk','mSVorzeitig','mSPE','mSPEW1','mSPEW2'];
  check(lokal.every(i => !new RegExp(`id="${i}"[^>]*disabled`).test(dlg)), 'Lokale Felder bleiben editierbar');
  check(/id="mSIbykusAendern"/.test(dlg) && /\.ibykus-feld'\)\.forEach\(e=>e\.disabled=!this\.checked\)/.test(dlg) && /wird beim nächsten Import überschrieben/.test(dlg), 'Schalter „trotzdem ändern“ gibt die IBYKUS-Felder frei');
  check(/Phasen\.editor\(\$\{id\}\)/.test(IH.split('  editSchueler(id) {')[1].split('  updateSchueler(id) {')[0] + IH.split('_makeModalWide();')[0].slice(-1200)) && /Ausbildung beenden<\/button>/.test(IH), 'Fußzeile: Ausbildungsverlauf, Akte, Ausbildung beenden, Speichern');
  check(/const status = document\.getElementById\('mSStatus'\)\.value;/.test(IH) && /parseInt\(document\.getElementById\('mSDauer'\)\?\.value\) \|\| 36/.test(IH), 'updateSchueler liest dieselben Felder wie zuvor');
}

console.log('\n══ Begriffe: Azubi statt Schüler ══');
{
  const dateien = ['src/js/modules/views.js','src/js/modules/planung.js','src/js/modules/stammdaten.js','src/js/modules/kontrolle.js','src/js/modules/import-handler.js','src/js/modules/bulk-schueler.js','src/js/modules/berichte.js','src/js/app-core.js','src/js/modules/schueler-view.js','src/js/modules/wiedervorlagen.js'];
  const reste = [];
  for (const d of dateien) read(d).split('\n').forEach((z, i) => { if (/Schüler/.test(z) && !/enterSchüler|IBYKUS „Schüler/.test(z)) reste.push(`${d}:${i + 1}`); });
  check(reste.length === 0, `Kein „Schüler“ mehr in der Oberfläche${reste.length ? ' – Reste: ' + reste.slice(0, 5).join(', ') : ''}`);
  check(/enterSchüler\(\) \{/.test(K), 'Bezeichner unangetastet');
  check(/Azubi-Akte/.test(V) && /Termin auswählen<\/div>/.test(V) && /<h2>Durchführung<\/h2>/.test(V), 'Azubi-Akte, „Termin auswählen“, Seitentitel unverändert');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
