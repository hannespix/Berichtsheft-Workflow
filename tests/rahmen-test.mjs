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
  check(/id="einstTab_persoenlich"[^>]*>\$\{t\.darstellung\}\$\{t\.menue\}/.test(V) && /id="einstTab_kontakt"[^>]*>\$\{t\.kontakt\}\$\{t\.aemter\}\$\{t\.vorlagen\}\$\{t\.word\}/.test(V) && /id="einstTab_regeln"[^>]*>\$\{t\.zulassung\}\$\{t\.uba\}\$\{t\.fristen\}\$\{t\.kampagnen\}\$\{t\.lfk\}\$\{t\.ferien\}\$\{t\.textbausteine\}/.test(V), 'Persönlich: Darstellung + Menü · Kontakt: Kontaktdaten, Ämter, Vorlagen, Word · Regeln: Zulassung, ÜBA, Fristen, Kampagnen, LFK, Ferien, Textbausteine');
  check(/  wartung\(\) \{/.test(V) && /\$\{t\.verbindung\}\$\{t\.backups\}\$\{t\.dbtools\}\$\{t\.logbuch\}\$\{t\.historie\}\$\{t\.dupes\}/.test(V), 'Wartung: Verbindung, Sicherungen/Papierkorb, Datenbank-Tools, Logbuch, Import-Historie, Duplikate');
  check(!/Datenbank-Statistik<\/div>/.test(V) && !/Jetzt speichern<\/button>/.test(V) && !/PRAGMA integrity_check/.test(V.split('_einstellungenTeile() {')[1].split('EINST_TABS')[0]), 'Doppelte Datenbank-Statistik und die Knöpfe aus der Zeit vor dem Auto-Save entfallen');
  check(/data-view="wartung" onclick="App\.navigate\('wartung'\)"/.test(HTML) && /wartung: Views\.wartung,/.test(APP) && /wartung: 'help_10'/.test(APP), 'Menüpunkt Wartung, Ansicht registriert, Kontexthilfe');
  check(/einstTab\(k, btn\) \{/.test(V) && /App\.uSet\('einst_tab', k\)/.test(V), 'Gewählter Reiter wird gemerkt');
  for (const [f, alt] of [['src/js/app-core.js', 'Einstellungen → Verbindung'], ['src/js/modules/konsole.js', 'Einstellungen → Verbindung'], ['src/js/modules/import-handler.js', 'Einstellungen → Papierkorb'], ['src/js/modules/import-handler.js', 'Einstellungen → Datenbank-Tools']]) check(!read(f).includes(alt), `Verweis „${alt}“ zeigt jetzt auf Wartung (${f.split('/').pop()})`);
  check(/App\.uSet\('einst_tab','regeln'\);App\.navigate\('einstellungen'\)/.test(read('src/js/modules/kw-nav.js')), 'Textbaustein-Link öffnet den richtigen Reiter');
  check(/DbTools\.cardHtml\(\)/.test(V) && /DbTools\.renderCard\(\)/.test(V) && /value="getaktet"/.test(V) && /Views\._backupsLaden\(\)|this\._backupsLaden\(\)/.test(V), 'Datenbank-Tools, Verbindungsstufe und Sicherungen weiter angebunden');
}

console.log('\n══ Hilfe in zwölf Kapiteln ══');
{
  const toc = [...V.match(/const helpSections = \[([^\]]*)\]/)[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
  const ids = [...V.matchAll(/id="help_(\d+)"/g)].map(m => +m[1]);
  check(toc.length === 12 && ids.length === 12 && ids.every((n, i) => n === i), `Zwölf Kapitel, fortlaufend nummeriert (${toc.length}/${ids.length})`);
  check(toc[0] === 'Start und Anmeldung' && toc[5].startsWith('Kontrolltag') && toc[11] === 'Datenschutz und FAQ', 'Reihenfolge entlang des Arbeitsablaufs');
  const abschnitte = (V.match(/class="help-abschnitt"/g) || []).length;
  check(abschnitte === 13 && (V.match(/<h4 class="help-untertitel">/g) || []).length === 13, `Zusammengeführte Kapitel behalten ihre Inhalte als Abschnitte (${abschnitte})`);
  for (const t of ['Ordnerstruktur', 'KW-Raster & Bulk-Editing', 'Tastenkürzel (vollständig)', 'Datensicherung', 'Nacherfassung (Übernahme von Altdaten)', 'Häufig gestellte Fragen (FAQ)']) check(new RegExp('<h4 class="help-untertitel">[^<]*' + t.replace(/[()&]/g, '\\$&') + '</h4>').test(V), `Abschnitt „${t}“ erhalten`);
  check(/id="help_neu"/.test(V) && /id="help_warning"/.test(V) && /id="help_glossar"/.test(V), 'Sonderkarten „Was ist neu“, Warnhinweis und Glossar bleiben');
  check(/HILFE_MAP: \{ dashboard: 'help_1', stammdaten: 'help_2', azubi: 'help_2', import: 'help_3', planung: 'help_4', kontrolle: 'help_5', nacherfassung: 'help_3', wiedervorlagen: 'help_6', berichte: 'help_7', einstellungen: 'help_10', wartung: 'help_10', hilfe: 'help_0' \}/.test(APP), 'Kontexthilfe je Ansicht zeigt ins passende Kapitel');
  check(/\.help-abschnitt \{/.test(CSS) && /\.help-untertitel \{/.test(CSS), 'Stile für Abschnitte');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
