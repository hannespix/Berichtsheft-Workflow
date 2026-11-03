// ═══════════════════════════════════════════════════════════════════
//  UI-Paket 3 „Rahmen“: ein Filterbalken (immer sichtbar, Zurücksetzen
//  rechts, keine zweite Zeile auf den Seiten), schlanke Kopfzeile (Suche,
//  Status, Person, Datenbank; Offline im Status-Dialog), Startseite ohne
//  den Streifen, Einstellungen in drei Reitern, neuer Menüpunkt Wartung,
//  Hilfe in zwölf Kapiteln entlang des Arbeitsablaufs mit Kontexthilfe
//  Ausführen:  node tests/rahmen-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };
const HTML = read('index.html'), APP = read('src/js/app-core.js'), V = read('src/js/modules/views.js'), CSS = read('src/css/styles.css');

console.log('══ Ein Filterbalken ══');
{
  check(!/filterPanelToggle/.test(HTML) && !/filterActiveCount/.test(HTML), 'Kein Filter-Knopf mehr in der Kopfzeile');
  check(/\.filter-panel \{\n  display: flex;/.test(CSS) && !/\.topbar-filter-toggle \{/.test(CSS), 'Filterbalken immer sichtbar, Umschalter-Stil entfernt');
  check(/id="filterReset"[^>]*onclick="App\.filterZuruecksetzen\(\);return false"/.test(HTML) && /const reset = document\.getElementById\('filterReset'\);\n    if \(reset\) reset\.style\.display = cnt > 0 \? '' : 'none';/.test(APP), '„Filter zurücksetzen“ rechts im Balken, nur bei aktiven Filtern');
  check(/filterBadgeHtml\(\) \{ return ''; \}/.test(APP) && /toggleFilterPanel\(\) \{\},/.test(APP), 'Keine zweite Filterzeile auf den Seiten, Umschalter sind Leerfunktionen');
  check(/filterZuruecksetzen\(\) \{\n    this\.filterFachrichtungen = \[\]; this\.filterJahrgang = \[\]; this\.filterAmt = \[\]; this\.filterZp = \[\]; this\.filterBavStatus = 'aktiv'; this\.extraFilters = \[\];/.test(APP), 'Zurücksetzen stellt alle Dimensionen auf die Vorgabe');
}

console.log('\n══ Schlanke Kopfzeile ══');
{
  check(!/App\.offlineUmschalten\(\)/.test(HTML) && /App\.closeModal\(\);App\.offlineUmschalten\(\)/.test(APP) && /Offline weiterarbeiten/.test(APP), 'Offline-Modus im Dialog hinter dem Speicherstatus');
  check(/id="autoSaveIndicator" style="display:none"/.test(HTML) && /id="dbLastSaved" style="display:none"/.test(HTML), '„Auto-Save“ und Zeitstempel nicht mehr in der Kopfzeile (Werte bleiben im Status-Dialog)');
  check(/#btnSwitchDB \{ display: none !important; \}/.test(CSS), 'Datenbankwechsel nur noch in der Seitenleiste');
  const topbar = HTML.split('<div class="topbar-status">')[1].split('</div>\n  </div>')[0];
  check(/GlobalSearch\.open\(\)/.test(topbar) && /id="dbStatusIndicator"/.test(topbar) && /id="topbarUserSelect"/.test(topbar) && /id="dbFileName"/.test(topbar), 'Kopfzeile: Suche, Speicherstatus, Person, Datenbankname');
  check(/id="btnVollbild"[^>]*onclick="App\.vollbildUmschalten\(\)"[^>]*aria-label=/.test(topbar) && /vollbildUmschalten\(\) \{/.test(APP) && /requestFullscreen/.test(APP) && /exitFullscreen/.test(APP) && /fullscreenchange/.test(APP), 'Vollbild-Knopf in der Kopfzeile (Fullscreen-API, funktioniert auch auf file://)');
}

console.log('\n══ Startseite ══');
{
  check(!/Was steht an\?/.test(V) && !/Morgen-Briefing/.test(V), 'Streifen „Was steht an?“ entfällt (die Zahl steht in Arbeitsliste, Kennzahl und Badge)');
  check(/Arbeitsliste – heute \/ diese Woche/.test(V) && /Wo stehen wir\?/.test(V) && (V.match(/class="stat-card /g) || []).length === 4, 'Arbeitsliste, Jahresablauf und vier Kennzahlen bleiben');
}

console.log('\n══ Einstellungen in Reitern, Wartung als Menüpunkt ══');
{
  check(/_einstellungenTeile\(\) \{/.test(V) && /EINST_TABS: \[\['persoenlich', 'Persönlich'\], \['kontakt', 'Kontakt & Vorlagen'\], \['regeln', 'Regeln & Textbausteine'\]\]/.test(V), 'Drei Reiter');
  check(/id="einstTab_persoenlich"[^>]*>\$\{t\.darstellung\}\$\{t\.menue\}/.test(V) && /id="einstTab_kontakt"[^>]*>\$\{t\.kontakt\}\$\{t\.briefkopf\}\$\{t\.aemter\}\$\{t\.vorlagen\}\$\{t\.word\}/.test(V) && /id="einstTab_regeln"[^>]*>\$\{t\.zulassung\}\$\{t\.uba\}\$\{t\.fristen\}\$\{t\.kampagnen\}\$\{t\.lfk\}\$\{t\.ferien\}\$\{t\.textbausteine\}/.test(V), 'Persönlich: Darstellung + Menü · Kontakt: Kontaktdaten, Briefbogen, Ämter, Vorlagen, Word · Regeln: Zulassung, ÜBA, Fristen, Kampagnen, LFK, Ferien, Textbausteine');
  check(/  wartung\(\) \{/.test(V) && /\$\{t\.verbindung\}\$\{t\.backups\}\$\{t\.dbtools\}\$\{t\.logbuch\}\$\{t\.historie\}\$\{t\.dupes\}/.test(V), 'Wartung: Verbindung, Sicherungen/Papierkorb, Datenbank-Tools, Logbuch, Import-Historie, Duplikate');
  check(!/Datenbank-Statistik<\/div>/.test(V) && !/Jetzt speichern<\/button>/.test(V) && !/PRAGMA integrity_check/.test(V.split('_einstellungenTeile() {')[1].split('EINST_TABS')[0]), 'Doppelte Datenbank-Statistik und die Knöpfe aus der Zeit vor dem Auto-Save entfallen');
  check(!/data-view="wartung"/.test(HTML) && /_einstTabsHtml\(aktiv\) \{/.test(V) && /onclick="App\.navigate\('wartung'\)"[^>]*>Wartung<\/button>/.test(V) && /\$\{this\._einstTabsHtml\('wartung'\)\}/.test(V) && /wartung: Views\.wartung,/.test(APP) && /wartung: 'help_10'/.test(APP), 'Wartung ist der vierte Reiter der Einstellungen (kein Menüpunkt), Ansicht registriert, Kontexthilfe');
  check(/einstTab\(k, btn\) \{/.test(V) && /App\.uSet\('einst_tab', k\)/.test(V), 'Gewählter Reiter wird gemerkt');
  for (const [f, alt] of [['src/js/app-core.js', 'Einstellungen → Verbindung'], ['src/js/modules/konsole.js', 'Einstellungen → Verbindung'], ['src/js/modules/import-handler.js', 'Einstellungen → Papierkorb'], ['src/js/modules/import-handler.js', 'Einstellungen → Datenbank-Tools']]) check(!read(f).includes(alt), `Verweis „${alt}“ zeigt jetzt auf Wartung (${f.split('/').pop()})`);
  check(/App\.uSet\('einst_tab','regeln'\);App\.navigate\('einstellungen'\)/.test(read('src/js/modules/kw-nav.js')), 'Textbaustein-Link öffnet den richtigen Reiter');
  check(/DbTools\.cardHtml\(\)/.test(V) && /DbTools\.renderCard\(\)/.test(V) && /value="getaktet"/.test(V) && /Views\._backupsLaden\(\)|this\._backupsLaden\(\)/.test(V), 'Datenbank-Tools, Verbindungsstufe und Sicherungen weiter angebunden');
}

console.log('\n══ UI-Vereinfachung Pakete 1–4: Wörter, Filterbalken, Menü, Termine-Kopf ══');
{
  const K = read('src/js/modules/kontrolle.js'), ST = read('src/js/modules/stammdaten.js');
  // Paket 1 – Wörter
  check(/        Termine\n      <\/button>/.test(HTML) && /        Durchsicht\n      <\/button>/.test(HTML) && !/Kontrollplanung\n/.test(HTML) && !/Durchführung\n      <\/button>/.test(HTML), 'Menü: „Termine“ und „Durchsicht“ statt „Kontrollplanung“ und „Durchführung“');
  check(/<h2>Termine<\/h2>/.test(V) && /<h2>Durchsicht<\/h2>/.test(V) && !/<h2>Kontrollplanung<\/h2>/.test(V) && !/<h2>Durchführung<\/h2>/.test(V), 'Seitentitel = Menüpunkt');
  check(/label: '▸ Durchsicht öffnen', onclick: oeffnen/.test(V) && /TerminSeite\.oeffnen\(\$\{t\.id\}\)[^>]*>Öffnen<\/button>/.test(V) && !/>Starten<\/button>/.test(V), 'Hauptknopf „Öffnen“ (Termin-Seite) und „Durchsicht öffnen“ im Menü statt „Starten“');
  check(/✓ Termin abschließen/.test(K) && !/Kontrolle abschließen \(/.test(K) && !/✓ Kontrolle abschließen/.test(K) && /Termin wieder öffnen<\/button>/.test(K) && !/Kontrolle wieder öffnen<\/button>/.test(K) && /'Termin abschließen – Nachbereitung'/.test(K), '„Termin abschließen“ / „Termin wieder öffnen“ (der Termin ist der Tag, die Durchsicht die Arbeit je Azubi)');
  check(/\+ Termin<\/a>/.test(ST) && !/\+ Prüfung<\/a>/.test(ST) && /Einzeltermin anlegen/.test(ST) && !/Einzelprüfung anlegen/.test(ST), 'Stammdaten: „+ Termin“ / „Einzeltermin“ statt „Prüfung“');
  check(/„Termine“ plant ihn, „Durchsicht“ führt ihn durch, „Termin abschließen“ beendet den Tag/.test(V), 'Glossar nennt die drei Wörter');
  // Paket 2 – Filterbalken nur in Listen, Standard als ein Chip
  check(/FILTER_ANSICHTEN: \['stammdaten', 'planung', 'kontrolle', 'nacherfassung', 'wiedervorlagen', 'berichte'\]/.test(APP) && /this\._filterbalkenAnpassen\(view\);/.test(APP) && /body\.ohne-filter \.filter-panel \{ display: none; \}/.test(CSS), 'Filterbalken nur in Listen (Dashboard, Einstellungen, Hilfe, Azubi-Seite ohne)');
  check(/renderUebersicht\(\) \{\n    App\._filterbalkenAnpassen\('kontrolle', false\);/.test(K) && /enterSchüler\(\) \{\n    App\._filterbalkenAnpassen\('kontrolle', true\);/.test(K), 'Einzelansicht der Durchsicht ohne Filterbalken, Übersicht mit');
  check(/id="filterKompaktBtn" class="fp-btn fp-kompakt" onclick="App\.filterAufklappen\(true\)"/.test(HTML) && /id="filterZuklappen"/.test(HTML) && /\.filter-panel\.kompakt > \* \{ display: none !important; \}/.test(CSS) && /\.filter-panel\.kompakt > \.fp-kompakt \{ display: inline-block !important; \}/.test(CSS), 'Standardzustand: ein Chip „Filter: … ▾“, aufklappbar');
  check(/_filterStandardMerken\(\) \{/.test(APP) && /this\._filterStandardMerken\(\);\n/.test(APP.split('Default-Filter: Zuständiges Amt')[1]) && /this\._filterKompaktAktualisieren\(\);\n  \},/.test(APP.split('_updateFilterCount() {')[1]), 'Standard = Stand nach dem Start; jede Filteränderung prüft ihn neu');
  // Paket 3 – Menü 11 → 8
  const menue = [...HTML.matchAll(/data-view="([a-z]+)"/g)].map(m => m[1]);
  check(menue.join(',') === 'dashboard,stammdaten,planung,kontrolle,nacherfassung,wiedervorlagen,berichte,einstellungen,hilfe' && !/App\.switchDB\(\)" style="opacity/.test(HTML), `Menü: ${menue.length} Einträge (Nacherfassung optional) – Import, Wartung, DB wechseln sind keine Menüpunkte mehr`);
  check(/MENUE_ZUORDNUNG: \{ azubi: 'stammdaten', import: 'stammdaten', wartung: 'einstellungen', termin: 'planung' \}/.test(APP), 'Import markiert Stammdaten, Wartung markiert Einstellungen');
  check(/_stammdatenTabsHtml\(aktiv\) \{/.test(V) && /onclick="App\.navigate\('import'\)"[^>]*>Import<\/button>/.test(V) && /\$\{this\._stammdatenTabsHtml\('import'\)\}/.test(V) && /import: Views\.importView,/.test(APP), 'Import ist ein Reiter der Stammdaten');
  check(!/import: \{ label: 'IBYKUS-Import'/.test(APP) && /kontrolle: \{ label: 'Durchsicht \(Kontrolltag\)'/.test(APP), 'Sichtbare Menüpunkte: kein Schalter mehr für Import');
  check(/onclick="App\.switchDB\(\)" title="Verbindung trennen[^"]*">↻ Datenbank wechseln<\/button>/.test(V), '„Datenbank wechseln“ steht unter Wartung → Verbindung');
  // Paket 4 – Termine-Kopf und -Tabelle
  const plan = V.split('<h2>Termine</h2>')[1].split('<!-- Kalender-Ansicht -->')[0];
  check(/class="split"/.test(plan) && /PlanungHandler\.addTermin\(\)/.test(plan) && /Kampagne: je Schule einen Termin anlegen …/.test(plan) && /PlanungHandler\._kontrollVorlagen\(\)\.map/.test(plan) && !/Kampagnen-Assistent<\/button>/.test(plan) && !/_vorlagenButtonHtml/.test(plan), 'Ein Hauptknopf „+ Neuer Termin“ mit Menü (Kampagne, Kontroll-Vorlagen)');
  check(/class="seg" role="group"/.test(plan) && /Views\.planAnsicht\('tabelle', this\)/.test(plan) && /Views\.planAnsicht\('kalender', this\)/.test(plan) && /Views\.planAnsicht\('jahr', this\)/.test(plan) && /ICS-Export \(Kalenderdatei\)/.test(plan) && !/Jahreskalender<\/button>/.test(plan), 'Ein Umschalter Tabelle | Kalender | Jahr, ICS-Export im ⋯-Menü');
  check(/planAnsicht\(art, btn\) \{/.test(V) && /jahreskalenderToggle\(\) \{\n    const box = document\.getElementById\('planJahreskalender'\);\n    if \(!box\) return;\n    this\.planAnsicht\(/.test(V), 'planAnsicht schaltet die drei Bereiche, jahreskalenderToggle bleibt als Abkürzung');
  const kopf = V.match(/<th>Datum<\/th><th>Ort<\/th>(?:<th>[^<]*<\/th>)+<th>Aktionen<\/th>/);
  check(kopf && (kopf[0].match(/<th>/g) || []).length === 8 && !/<th>Titel<\/th>/.test(kopf[0]) && !/<th>Fachrichtung<\/th>/.test(kopf[0]), 'Termine-Tabelle: 8 Spalten – Titel unter dem Datum, Fachrichtung unter den Klassen');
  check(/\$\{t\.bemerkung \? `<div style="font-size:12px;color:var\(--clr-text-light\);max-width:220px/.test(V) && /\$\{frStr !== '–' \? `<div style="font-size:12px;color:var\(--clr-text-light\)">\$\{esc\(frStr\)\}<\/div>` : ''\}/.test(V), 'Bemerkung und Fachrichtung als zweite Zeile');
}

console.log('\n══ UI-Vereinfachung Paket 6: Durchsicht-Übersicht ══');
{
  const K = read('src/js/modules/kontrolle.js');
  const ue = K.split('  renderUebersicht() {')[1].split('  // Einen Azubi direkt aus der Übersicht')[0];
  const kopf = ue.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)[1];
  check((kopf.match(/<th/g) || []).length === 7 && !/>FR<\/th>/.test(kopf) && !/↯/.test(kopf) && !/>Pfl\.<\/th>/.test(kopf) && !/>AP<\/th>/.test(kopf) && />Zulassung /.test(kopf), 'Übersicht: 7 Spalten (#, Azubi, Anw., Ergebnis, Fehl., Zulassung, Aktion) statt 12');
  check(/colspan="7"/.test(ue) && !/colspan="12"/.test(ue), 'Gruppenzeile über 7 Spalten');
  check(/class="zul-zelle"/.test(ue) && /const zulZeigen = this\._zulAlle \|\| imLetztenAJ \|\| isZulassung \|\| isPA/.test(ue) && /KontrolleHandler\._zulZeigen=KontrolleHandler\._zulZeigen\|\|\{\}\)\[\$\{s\.id\}\]=true/.test(ue) && /KontrolleHandler\._zulAlle=!KontrolleHandler\._zulAlle/.test(ue), 'Zulassung in einer Zelle (Pfl., Zul., PA, Befund) – voll im letzten Lehrjahr, sonst per „…“ oder „alle“');
  check(/KontrolleHandler\.toggleZulassung\(\$\{s\.id\},this\.checked\)/.test(ue) && /KontrolleHandler\.togglePA\(\$\{s\.id\},this\.checked\)/.test(ue) && /KontrolleHandler\.quickToggleAnwesend\(\$\{s\.id\}, this\.checked\)/.test(ue) && /KontrolleHandler\.quickMarkOK\(\$\{s\.id\}\)/.test(ue), 'Alle Schalter bleiben (Anwesend, i.O., Zulassung, PA)');
  check(/<span title="\$\{esc\(ampel\.label\)\}" aria-label="\$\{esc\(ampel\.label\)\}">\$\{ampel\.icon\}<\/span> \$\{esc\(s\.ausbildungsstaette\|\|''\)\}\$\{frName !== '–' \? ` · \$\{esc\(frName\)\}` : ''\}/.test(ue), 'Ampel und Fachrichtung stehen in der Azubi-Zelle');
  check(/class="fortschritt"/.test(ue) && /<strong>\$\{doneCount\} von \$\{nenner\}<\/strong>/.test(ue) && /✓ \$\{okCount\} in Ordnung/.test(ue) && /✗ \$\{mangelCount\} beanstandet/.test(ue) && /<strong>\$\{offen\} offen<\/strong>/.test(ue) && !/Statistik-Leiste/.test(ue) && /App\.kontrolltagCockpit\(terminId\)/.test(ue), 'Zähl-Chips sind zur Beschriftung des Fortschrittsbalkens geworden (Cockpit bleibt)');
  check(/class="seg" role="group" aria-label="Ansicht der Durchsicht"/.test(ue) && !/<strong style="font-size:16px;font-family:var\(--font-display\)/.test(ue), 'Umschalter Übersicht | Einzelansicht; kein zweiter Termin-Kopf in der Karte (der steht in der Terminzeile)');
  const tz = K.split('  _terminZeile() {')[1].split('  _terminMenue(termin) {')[0];
  check(/class="tz-sub"/.test(tz) && /App\._isoKW\(d\)/.test(tz) && /\$\{liste\.length\} Azubi/.test(tz) && /t\.pruefer \|\| ''\]/.test(tz), 'Terminzeile: Datum (KW) · Ort · Azubis · Prüfer in einer Zeile, Klassen leise darunter');
  check(/this\._terminZeile\(\);\n  \},\n\n  \/\/ Einen Azubi direkt aus der Übersicht/.test(K), 'Übersicht zieht die Terminzeile nach (Zahlen im Menü aktuell)');
  check(/\.zul-zelle \{ white-space: nowrap; font-size: 12px; \}/.test(CSS) && /\.fortschritt \.fs-balken \{/.test(CSS) && /\.termin-zeile \.tz-sub \{/.test(CSS), 'Stile für Zulassungszelle, Fortschritt und Terminzeile');
}

console.log('\n══ Hilfe in zwölf Kapiteln ══');
{
  const toc = [...V.match(/const helpSections = \[([^\]]*)\]/)[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
  const ids = [...V.matchAll(/id="help_(\d+)"/g)].map(m => +m[1]);
  check(toc.length === 12 && ids.length === 12 && ids.every((n, i) => n === i), `Zwölf Kapitel, fortlaufend nummeriert (${toc.length}/${ids.length})`);
  check(toc[0] === 'Start und Anmeldung' && toc[5].startsWith('Kontrolltag') && toc[11] === 'Datenschutz und FAQ', 'Reihenfolge entlang des Arbeitsablaufs');
  const abschnitte = (V.match(/class="help-abschnitt"/g) || []).length;
  check(abschnitte === 14 && (V.match(/<h4 class="help-untertitel">/g) || []).length === 14, `Zusammengeführte Kapitel behalten ihre Inhalte als Abschnitte (${abschnitte}; 14. = E-Mails an die Betriebe)`);
  for (const t of ['Ordnerstruktur', 'KW-Raster & Bulk-Editing', 'Tastenkürzel (vollständig)', 'Datensicherung', 'Nacherfassung (Übernahme von Altdaten)', 'Häufig gestellte Fragen (FAQ)']) check(new RegExp('<h4 class="help-untertitel">[^<]*' + t.replace(/[()&]/g, '\\$&') + '</h4>').test(V), `Abschnitt „${t}“ erhalten`);
  check(/id="help_neu"/.test(V) && /id="help_warning"/.test(V) && /id="help_glossar"/.test(V), 'Sonderkarten „Was ist neu“, Warnhinweis und Glossar bleiben');
  check(/HILFE_MAP: \{ dashboard: 'help_1', stammdaten: 'help_2', azubi: 'help_2', import: 'help_3', planung: 'help_4', termin: 'help_4', kontrolle: 'help_5', nacherfassung: 'help_3', wiedervorlagen: 'help_6', berichte: 'help_7', einstellungen: 'help_10', wartung: 'help_10', hilfe: 'help_0' \}/.test(APP), 'Kontexthilfe je Ansicht zeigt ins passende Kapitel');
  check(/\.help-abschnitt \{/.test(CSS) && /\.help-untertitel \{/.test(CSS), 'Stile für Abschnitte');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
