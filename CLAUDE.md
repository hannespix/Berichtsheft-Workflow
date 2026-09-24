# Berichtsheftkontrolle – Entwicklungs-Guide

## Was ist das?
Verwaltungstool für Ausbildungsberater Gärtner (RP Freiburg) zur Planung, Durchführung und Nachverfolgung von Berichtsheftdurchsichten. Läuft komplett lokal im Browser (Chrome/Edge) mit SQLite-Datenbank auf dem Netzlaufwerk.

## Architektur
- **Keine Build-Tools** – reines HTML/CSS/JS, direkt im Browser lauffähig
- **Offline-fähig** – alle Libraries liegen in `libs/`, kein Internet nötig
- **File System Access API** – liest/schreibt SQLite direkt auf dem Netzlaufwerk
- **Multi-User** – 2–3 Personen können gleichzeitig arbeiten (Auto-Save + Conflict Detection)

## Build (All-in-One HTML)
```bash
./build.sh    # → dist/berichtsheftkontrolle.html
```
Baut eine einzelne, offline-fähige HTML-Datei mit allen Libraries, CSS, JS und Fonts inline.
Diese Datei kann direkt auf das Netzlaufwerk kopiert werden – fertig.

**WICHTIG**: Nach jeder Code-Änderung `./build.sh` ausführen und `dist/` mit committen!

## Projektstruktur
```
├── index.html                       ← Entwicklungs-Einstiegspunkt (modulare Version)
├── build.sh                         ← Build-Script für All-in-One HTML
├── dist/
│   └── berichtsheftkontrolle.html   ← Produktionsdatei (All-in-One)
├── src/
│   ├── css/styles.css               ← Alle Styles
│   └── js/
│       ├── app-core.js              ← App-Kern: DB, Navigation, Save/Load
│       ├── utils.js                 ← Hilfsfunktionen + Init
│       └── modules/
│           ├── views.js             ← Dashboard, Sidebar-Rendering
│           ├── kontrolle.js         ← Kontrolldurchführung
│           ├── stammdaten.js        ← Stammdaten-Verwaltung
│           ├── workflows.js         ← Workflow-Engine
│           ├── import-handler.js    ← CSV/IBYKUS Import
│           ├── planung.js           ← Kontrolltermin-Planung
│           ├── berichte.js          ← Berichte & Statistiken
│           ├── kw-nav.js            ← KW-Raster Navigation
│           ├── pdf-export.js        ← PDF-Durchsichtsbogen Export
│           ├── schueler-view.js     ← Einzelschüler-Ansicht
│           ├── nacherfassung.js     ← Nacherfassung
│           ├── wiedervorlagen.js    ← Wiedervorlagen-Handler
│           ├── global-search.js     ← Ctrl+K Suche
│           ├── keyboard-shortcuts.js ← Tastaturkürzel
│           ├── bulk-schueler.js     ← Bulk-Operationen Schüler
│           ├── bulk-wv.js           ← Bulk-Operationen WV
│           ├── table-sort.js        ← Tabellen-Sortierung
│           └── undo-manager.js      ← Undo/Redo
├── libs/                            ← Externe Libraries (offline)
│   ├── sql-wasm.js + .wasm          ← SQLite im Browser
│   ├── papaparse.min.js             ← CSV-Parser
│   ├── xlsx.full.min.js             ← Excel-Export
│   ├── jspdf.umd.min.js             ← PDF-Erzeugung
│   ├── jspdf.plugin.autotable.min.js
│   ├── pizzip.js + docxtemplater.js ← DOCX-Erzeugung
│   ├── FileSaver.min.js             ← Datei-Download
│   └── chart.umd.min.js            ← Diagramme
├── fonts/                           ← Schriften BaWue Sans/Serif (Landes-CI, lizenzpflichtig – fonts/LIZENZ.md)
├── assets/logo/                     ← RPF-Logo (geschützt – assets/logo/LIZENZ.md)
├── backups/                         ← Automatische DB-Backups
├── CLAUDE.md                        ← Diese Datei
└── README.md                        ← Projekt-Übersicht
```

## Module und ihre Verantwortlichkeiten

| Modul | Globales Objekt | Verantwortung |
|---|---|---|
| app-core.js | `App` | DB-Verbindung, Save/Load, Navigation, Filter, Toast-Messages |
| views.js | `Views` | Dashboard-Rendering, Sidebar, View-Dispatching; Einstellungen in Reitern (`_einstellungenTeile` liefert die Karten, `einstellungen()` und `wartung()` verteilen sie) |
| stammdaten.js | `StammdatenTab` | CRUD für Prüfer, Schulen, Jahrgänge, Fachrichtungen |
| import-handler.js | `ImportHandler` | IBYKUS-CSV Import mit Auto-Erkennung |
| planung.js | `PlanungHandler` | Kontrolltermine anlegen, bearbeiten, zuweisen |
| kontrolle.js | `KontrolleHandler` | Kernstück: KW-Raster, Mängel-Codes, Live-Sync |
| kw-nav.js | `KWNav` | Keyboard-Navigation im KW-Raster |
| pdf-export.js | `PDFExport` | Durchsichtsbogen als PDF |
| workflows.js | `Workflows` | Workflow-Engine (Freisprechung, Briefe) |
| wiedervorlagen.js | `WiedervorlagenHandler` | Wiedervorlagen-Verwaltung |
| berichte.js | `BerichteHandler` | Statistiken und Berichte |
| schueler-view.js | `SchuelerView` | Nur noch Dialog „Jahrgang abschließen“ (die zweite Azubi-Liste auf der Import-Seite ist entfallen; `render()` frischt die Stammdaten-Liste auf) |
| nacherfassung.js | `NacherfassungHandler` | Nacherfassung von Kontrollen |
| global-search.js | `GlobalSearch` | Ctrl+K Suche + Tastenkürzel-Hilfe |
| keyboard-shortcuts.js | – | Globale Tastaturkürzel |
| phasen.js | `Phasen` | Ausbildungsverlauf je Azubi: Phasen-Mathematik (Enden, Vertragsende, Unterbrechungen, pauschale Fehltage) und Phasen-Editor |
| schueler-akte.js | `SchuelerAkte` | Bemerkungen je Azubi, Aktenvermerk als PDF (Datei-Upload entfernt) |
| db-tools.js | `DbTools` | Datenbank-Tools: Bestand, Verdichten, Jahrgang mit Archiv löschen/zurückholen, Aufräumen, VACUUM-Neuaufbau, Einstieg Stammdaten heilen |
| konsole.js | `Konsole` (= `window.bhk`) | Diagnosebefehle für die Browser-Konsole: Zustand, Ereignisspur, Ordnerinhalt, Verbindungstest (auch als Dialog unter Wartung → Verbindung), Zustandsbild kopieren |

## Wichtige Patterns

### DB-Zugriff
Alle Module nutzen `App.query(sql, params)` und `App.run(sql, params)`:
```js
const schueler = App.query('SELECT * FROM schueler WHERE id = ?', [id]);
App.run('UPDATE schueler SET name = ? WHERE id = ?', [name, id]);
```

### Views rendern
Jedes Modul hat eine `render()` Methode die von `App.renderCurrentView()` aufgerufen wird.

### Keine ES-Module
Alle Objekte sind global (`const Views = {...}`). Kein import/export.
Reihenfolge der `<script>`-Tags in `index.html` ist wichtig!

## Entwicklung

### Typische Aufgaben
1. **Neues Feature**: Neues Modul in `src/js/modules/` anlegen, `<script>` in `index.html` einfügen, in `build.sh` APP_MODULES ergänzen
2. **Bug Fix**: Betroffenes Modul lesen, Fix anwenden
3. **UI-Änderung**: `styles.css` + betroffenes View-Modul bearbeiten
4. **Neuer Report**: In `berichte.js` neue Methode, View in `views.js` registrieren

### Tests
```bash
for t in tests/*.mjs; do node "$t"; done   # alle Suiten
node tests/aj-test.mjs                     # einzeln
```
Die Suiten laufen ohne npm-Abhängigkeiten gegen sql.js aus `libs/`:

| Suite | Prüft |
|---|---|
| `aj-test.mjs` | Ausbildungsjahre, KW-Raster-Grenzen |
| `kontrolle-test.mjs` | Schreibziel, Mängel-Historie, Fehltage, AP-Zulassung |
| `sync-test.mjs` | Mehrbenutzer-Synchronisation (simuliert 3 Clients + Netzlaufwerk) |
| `sync-stress-test.mjs` | SMB-Störfälle (Lesefehler, Negativ-Cache, Snapshot-Tausch, Bulk-Import, Crash-Puffer) + Zufalls-Stresstest mit drei Clients; Harness in `_sync-harness.mjs` |
| `berichte-test.mjs` | Abdeckung, Erfolgsquote, Klassenübersicht, Diagramme |
| `import-test.mjs` | Datumsformate, Spaltenzuordnung, Betriebsanlage |
| `integritaet-test.mjs` | Lösch-Kaskaden, Migrations-Parität |
| `phasen-test.mjs` | Ausbildungsverlauf: Phasen-Mathematik (Enden, Vertragsende, Teilzeit, Konflikte, Validierung), Speicherung, Editor-Fenster; Kern, index.html und build.sh ohne Tarife, Vergütung, Dashboard, Datei-Upload und pdf.js |
| `search-test.mjs` | Fuzzy-Suche, Mehrwortsuche, Ranking |
| `dq-test.mjs` | Datenqualitäts-Regeln |
| `filter-test.mjs` | Globale Filter: Mehrfachauswahl, AP∪ZP-Vereinigung, Standortgruppen |
| `planung-test.mjs` | Schultermin-Workflow: gf(termine), Termin-Azubi-Menge, fremde Ämter, Lehrjahre, Kampagnenfenster/Kohorte, Stichtag-Lehrjahr, KW 53, Doppeltermine, Termin-Statuskette, ICS, Jahresablauf/Ferien, Kampagnen-Ausschluss, Nachholtermin, LFK-Regeln, Blockplan-Übernahme, Kontrolltag-Cockpit |
| `nacherfassung-test.mjs` | Nacherfassung: geprüft-bis-KW-Kaskade, pauschale Fehltage, AJ/KW-Zuordnung, Termin-Wiederverwendung |
| `workflow-test.mjs` | Vorlagen/Textbausteine, Dateinamen, Papierkorb (Azubi + Termin), Lösch-Logbuch, Nachbereitung (Betriebs-Vorlagen, fremde Ämter, Versandnachweis/Mahnstufe), WV-Nachweis, Akten-Dateien, Betriebs-/Schul-Ampel, Sammel-Erinnerung, Kontexthilfe, Rollen |
| `status-test.mjs` | Azubi-Status: Import-Ableitung (BAV/Beendigung), Neuverträge, fehlende Azubis, `setSchuelerStatus`, Import-Vorschau (Savepoint) |
| `kontrolltag-test.mjs` | Kontrolltag: Prüfer-Vorrang/Sperre, KW-Modal mit Undo, WV folgt dem Ergebnis, i.O. → geprüft bis Vorwoche, Nacherfassung schließt WV, Prüfer-Unterschrift, Prüferaufteilung, Ergebnis-Kürzel, Undo-Verlauf, 1.1/1.5 „geführt / nicht geführt“ mit automatischem Hinweis in der Bemerkung; UI-Paket 1 (Terminzeile, Aufklappmenüs, feste Ergebnisleiste, eingeklappte Jahre, Kürzel-Leiste, Hilfe-Inhaltsverzeichnis) |
| `feldmodus-test.mjs` | Verbindungsstufe „langsam“/Lag-Budget: Abgleich-Takt aus Netzqualität, Messung der Abgleichdauer, Log-Rotation nach Größe, Bereinigung nur bei Snapshot-Abdeckung |
| `dbtools-test.mjs` | Datenbank-Tools: Bestand/Jahrgangsübersicht, Verdichten-Kandidaten (offene WV, Frist), Jahrgang löschen (geteilte Termine bleiben, auch mit noch aktiven Azubis – Bestätigung „AKTIVE LÖSCHEN“), Archiv-DB + Rückholung, Aufräumen (Waisen, Log, Blockplan, Stempel, Betriebe), VACUUM, Indizes (Schema + beide Migrationen), Gruppierung statt Unterabfragen, Sperrgründe, Warten auf laufende Kompaktierung, längere Speicherversuche, Nachholung mit Nacharbeit, Zweit-Registerkarte gesperrt, Sperre lesen/freigeben, eigene verwaiste Sperre übernehmen/nachträglich freigeben, veraltete Zugriffspunkte erneuern |
| `stammdaten-test.mjs` | Stammdaten heilen: Normalisierung, Dubletten-Kandidaten, Aliase, Zusammenführen (Schulen mit UNIQUE-Klassen, Betriebe, Jahrgänge), Import-Wächter (Alias-Zuordnung, Vorschau-Auswahl) |
| `bestand-test.mjs` | Großer Bestand: Sicherungen (gemeinsam je Datenbank, Intervall-Einstellung, gzip, Wiederherstellung, Aufbewahrung über beide Endungen), Kompaktierung (Schwelle 10 %, 30-min-Abstand, Feldmodus/sehr langsame Leitung, Zeitlimit nach Größe), fremder Snapshot ohne Nachladen, Offline-Stand nur auf Wunsch, Schübe in einer Transaktion, Signatur-Cache, Netzqualität aus dem Anhängen |
| `schlank-test.mjs` | Schlanke Datei: kompakte Durchsichts-Snapshots (`App.snapshotKompakt/snapshotZeilen`, alte und neue Fassung, Schreiber in Kontrolle und Nacherfassung, Leser in Archiv-Ansicht und PDF), Aufräumen-Option „Snapshots verdichten“, kompakte Sync-Stempel als Text mit Obergrenze `STAMPS_MAX`, Änderungslog ohne Import-Flut |
| `verlust-test.mjs` | Verlustschutz: Absturzpuffer sofort und gebündelt (`_persistBald`), `sofortSpeichern` (Erfolg, Schreibfehler, offline), Kennzeichen „noch nicht auf dem Netzlaufwerk“ je Azubi (`_ungesichertAzubis`, Schnellnavigation, Kopf der Durchsicht), Abschluss/Azubi-Wechsel/Terminwechsel/Verlassen der Kontrolle schreiben sofort, Wächter gegen Hängen (Drift, verdecktes Fenster, letzte Aktion ohne Feldinhalt, localStorage, Zustandsbild), Liste der wartenden Änderungen |
| `langsam-test.mjs` | Sehr langsame Freigabe: Zeitlimit für das Anhängen wächst mit der letzten Dauer (30–180 s), hängender Versuch stapelt sich nicht (`_appendHaengt`), später Erfolg wird verbucht (`_appendSpaeterGelungen`), Zeitlimit = „sehr langsam“ mit wachsender Wartezeit statt Netzabriss, kein Anhängen/Abgleich während des Snapshot-Writes (`_snapshotSchreibt`) |
| `sparsam-test.mjs` | Sparsame Leitung: Änderungszeiger (ein Zugriff je Takt, Rundgang nur bei Änderung/eigenem Tipp/Sicherheitsnetz, Rennen, gescheiterter Tipp ohne Verlust), Verbindungsstufen auto/langsam/getaktet (Takte, Kompaktierung, Sicherung, alte Feldmodus-Einstellung), Sammelpause ohne Verhungern, Positionen im Rundgang, Positionsdatei mit Mindestabstand, Snapshot tippt an, Rotation 64 KB |
| `stau-test.mjs` | Stau-Nachwehen: großes eigenes Log wird vor dem Anhängen und beim Start rotiert (keine Kopie), automatische Kompaktierung (`groesse`/`start`) nie mit nicht angehängten eigenen Ops, Änderungslog mit `INSERT OR IGNORE` und globaler Kennung, UNIQUE-Doppel gesammelt gemeldet (`_doppelteOps`), dringende Kompaktierung ab `KOMPAKT_DRINGEND_BYTES` auch über langsame Leitung |
| `listen-test.mjs` | UI-Paket 2 „Listen“: `App.menue` (feste Positionierung, schließt bei Klick/Scroll), Planung/Wiedervorlagen/Stammdaten mit einem Hauptknopf je Zeile und ⋯-Menü (alle bisherigen Aktionen), Azubi-Liste nur in den Stammdaten mit Seiten à 50, Import-Seite ohne zweite Liste, `SchuelerView` nur noch „Jahrgang abschließen“, Azubi bearbeiten in einem Reiter (IBYKUS-Felder gesperrt, Schalter „trotzdem ändern“, alle `mS*`-Kennungen), Jahrgang-Löschen als Dialog, kein „Schüler“ in der Oberfläche |
| `a11y-test.mjs` | Zoom und Barrierefreiheit (plus Feinschliff der Durchsicht: gleitender Kopfblock, Randmaß-Variable, zweizeilige Ergebnisleiste, Speicherstatus-Punkt, Kürzel-Popover, kompakter Seitenkopf): Kontraste der Palette ≥ 4,5:1 (aus `:root` gerechnet), keine Schrift unter 12 px in CSS und Inline-Styles (Ausnahme Raster-Codes 11 px, Druck), feste Leisten nur bei genug Fensterhöhe/-breite, Ergebnisleiste bündig je Breakpoint, Bereichsauswahl nicht abgeschnitten, reduzierte Bewegung, sichtbarer Fokus, Jahreskopf per Tastatur, Beschriftungen (aria-label) für Symbolknöpfe und Menüs, Einstellung „Große Schrift“ |
| `rahmen-test.mjs` | UI-Paket 3 „Rahmen“: ein Filterbalken (immer sichtbar, `#filterReset`, `filterBadgeHtml()` leer, `App.filterZuruecksetzen`), schlanke Kopfzeile (Suche, Status, Person, Datenbank; Offline im Status-Dialog; Auto-Save/Zeitstempel/DB-Wechsel versteckt), Startseite ohne „Was steht an?“, Einstellungen in drei Reitern (`_einstellungenTeile`, `EINST_TABS`, `einstTab`), Ansicht `wartung` mit Menüpunkt und Kontexthilfe, Verweise auf Wartung, Hilfe in zwölf Kapiteln mit Abschnitten (`.help-abschnitt`), `HILFE_MAP` |
| `konsole-test.mjs` | Diagnose: Ereignisspur (`BhkSpur`: Fehlerarten, Zähler je Bereich, nurStat, langsame Vorgänge, Ringspeicher, gedrosselte Übersprungen-Einträge, Debug-Schalter), Sichtbarkeitswechsel, Gründe ausgesetzter Takte, Instrumentierung von Netz und Schreibwegen, Zustandsbild, Konsolenbefehle `bhk.*`, Verbindungstest (Schreibsperre, Uhrversatz, Zweit-Tab, ohne Ordner) |
| `anmeldung-test.mjs` | Anmeldung beim Start: Auswahl aus aktiven Prüfern, Merken im Browser, Vorauswahl mit „Weiter“, neuer Name, Wechsel; Kern, index.html, build.sh und Tastenkürzel ohne Chat, Meldungen und Präsenz |
| `offline-test.mjs` | Offline-Betrieb: Prüferaufteilung in der DB, Zusammenführung nach Offline-Phase (LWW je Feld) mit Konfliktliste, eine WV je Ergebnis, Änderungsdatei als Notausgang |
| `smoke-test.mjs` | Startet die gebaute App im echten Chromium (überspringt sich ohne Browser) |

**Nach jeder Änderung:** `./build.sh` und alle Suiten laufen lassen.

### Regeln
- **Build nach jeder Änderung** – `./build.sh` ausführen, `dist/` mit committen
- **Keine npm-Dependencies** – Libraries als einzelne Dateien in `libs/`
- **Datenschutz beachten** – Niemals `.sqlite`-Dateien committen!
- **File System Access API** – Nur Chrome/Edge, kein Firefox/Safari
- **Deutsche UI** – Alle Labels, Fehlermeldungen auf Deutsch

### Schema-Änderungen (WICHTIG!)
Die App nutzt eine In-Memory-SQLite-DB und synchronisiert per `mergeAndSave()` mit der Disk-Datei. Schema-Migrationen (ALTER TABLE ADD COLUMN, CREATE TABLE) laufen beim Start nur auf der In-Memory-DB. Die Disk-DB kann ein älteres Schema haben.

**Indizes:** Die Datenbank hatte lange KEINE Indizes – jede Abfrage `WHERE schueler_id=?` las die ganze Tabelle. Sie stehen jetzt als `INDIZES`-Konstante im `SCHEMA`, in `migrateDB()` und in `_migrateDiskDb()`. Neue Fremdschlüssel-Spalten immer dort ergänzen. Und: in Übersichten **eine Gruppierung je Tabelle** statt einer Unterabfrage je Zeile (die Jahrgangsübersicht brauchte so 10 s statt 25 ms).

**Bei jeder Schema-Änderung müssen DREI Stellen gepflegt werden:**
0. **`SCHEMA`-Konstante** – für neu angelegte Datenbanken (CREATE TABLE)
1. **`migrateDB()`** – Migration auf der In-Memory-DB (beim App-Start)
2. **`_migrateDiskDb(diskDb)`** – Dieselbe Migration auf der Disk-DB (vor jedem mergeAndSave-Replay)

Wird `_migrateDiskDb` vergessen, schlagen Dirty-Op-Replays still fehl (try/catch verschluckt den Fehler) und Änderungen gehen beim nächsten Reload verloren.

## Synchronisation (Sync-v3)
Im Normalbetrieb schreibt **kein** Client auf die geteilte Datenbankdatei:
jeder hängt seine Änderungen an sein **eigenes** Op-Log an
(`_bhk/oplog_<db>_<client>_g<n>.jsonl`), die anderen lesen sie im
3-Sekunden-Takt ab ihrer Leseposition. Die `.sqlite`-Datei ist nur noch der
Snapshot und wird selten und mit Sperre kompaktiert; `snapmeta_<db>.json`
hält Log-Offsets und Snapshot-Generation. Details: `TECHSTACK.md`.

**Verbindungsstufen und Offline-Betrieb:** Keine Bedienaktion wartet auf das Netzlaufwerk. Der Abgleich-Takt folgt der gemessenen Netzqualität (Speichern und Abgleichdauer): 3 s / 10 s / 30 s. Einstellung „Verbindung“ unter Wartung (`App.verbindungsStufe`, localStorage `bhk_verbindung`, `setVerbindung(stufe)`): `auto` · `langsam` (früher Feldmodus, `App.feldmodus` bleibt als Alias „nicht auto“; Takt 30 s, Anhängen gebündelt 10 s, keine Kompaktierung) · `getaktet` (`App.getaktet`; Takt und Anhängen 60 s, keine Sicherung, keine Kompaktierung, Positionsdatei höchstens je Minute). `navigator.connection.saveData` löst einmal einen Hinweis aus (`bhk_sparhinweis`). Das eigene Protokoll rotiert ab `LOG_ROTATE_BYTES` (64 KB) auf eine neue Generation (Chrome kopiert beim Anhängen die ganze Datei); alte Generationen werden nur gelöscht, wenn `snapmeta` sie vollständig abdeckt.

**Sparsame Leitung – Änderungszeiger statt Rundgang:** Der Takt (`_schedulePoll` → `_abgleichTakt()`) liest je Tick nur `_bhk/zeiger_<db>.txt` (`_zeigerLesen`, ein Zugriff). Jeder Schreiber tippt ihn an (`_zeigerAntippen(grund)`: nach dem Anhängen, nach der nachträglich gelungenen Anhänge, nach Positionsdatei schreiben/löschen, nach dem Snapshot; Inhalt `client ts grund`). Der volle Rundgang `_pollOplogs()` (snapmeta, Auflistung, Stände, fremde Protokolle, Positionen) läuft nur bei geändertem Zeiger, nach eigenem Antippen genau einmal (`_zeigerEigenOffen` – ein Kollege kann zwischen Lesen und Schreiben angetippt haben), auf Anforderung (`_rundgangNoetig`, z. B. „Kontrolle geöffnet“) und als Sicherheitsnetz alle `rundgangIntervallMs()` (60 s / 120 s / 300 s). Fehlt der Zeiger, legt der Leser ihn an (`start`); scheitert ein Tipp, kommen die Änderungen mit dem Sicherheitsnetz – **der Zeiger beschleunigt, er entscheidet nicht.** Positionsdateien der Kollegen liest der Rundgang aus derselben Auflistung mit (`_readPositionFiles(pruefer, handles)`, nur bei offener Kontrolle `_positionenGewuenscht()`) und stößt `KontrolleHandler.doLiveSync()` an; die Kontrolle hat keinen eigenen Netz-Timer mehr. `_writePositionFile` hält `posMindestabstandMs()` ein (nur der letzte Stand wird nachgeschrieben). `scheduleAutoSave` nutzt `appendMindestabstandMs()` (1,5 s / 10 s / 30 s / 60 s) mit Frist ab der ersten wartenden Änderung (`_wartetSeit`), damit laufendes Tippen das Anhängen nicht endlos verschiebt. Sicherungen nie bei `getaktet` oder `very-slow` (`_backupFaellig`). **Neue Netzschreibwege, die Kollegen sehen sollen, müssen den Zeiger antippen; neue Lesewege gehören in den Rundgang, nicht in einen eigenen Timer.** Offline-Modus (`App.offlineModusEinschalten()` / `startOffline()` / `wiederverbinden()`): lokaler Snapshot in IndexedDB (`snapshot`-Store), Änderungen im Puffer (30 Tage), Zusammenführung über den Crash-Restore-Pfad mit Konfliktliste (`_konflikte`), genau eine Wiedervorlage je Ergebnis (`_entdoppleWiedervorlagen`), Prüferaufteilung in `kontrolltermine.aufteilung`.

**Großer Bestand (mehrere tausend Azubis, Datenbank > 30 MB):** Rechenlast und Rendern skalieren gut (4900 Azubis: jede Ansicht < 300 ms); teuer sind ausschließlich Vorgänge mit der ganzen Datei. Deshalb gelten: (1) **Sicherungen** gemeinsam je Datenbank – `_backupFaellig()` prüft das Alter der neuesten `backup_*`-Datei im Ordner (Listing höchstens alle 10 min), Intervall aus `einstellungen.backup_intervall_min` (Standard 60), Datei als `.sqlite.gz` über `CompressionStream` (`_komprimieren/_dekomprimieren`, Rückfall unkomprimiert); `restoreBackup`, `listBackups`, `cleanOldBackups` kennen beide Endungen (`_istBackupDatei`). (2) **Kompaktierung**: Schwelle `kompaktSchwelle()` = max(1,5 MB, 10 % der Snapshotgröße), `KOMPAKT_MIN_ABSTAND_MS` 30 min ab `_letzteKompaktierung` (eigene oder `snapmeta.t`), nie automatisch im Feldmodus oder bei `very-slow` (`_kompaktGebremst()`), Zeitlimit `snapshotTimeoutMs(bytes)` = 120 s + 10 s/MB mit Sperren-Herzschlag alle 60 s während des Schreibens. (3) **Kein Nachladen ohne Grund**: `_snapshotSchonEnthalten(meta)` – deckt der eigene Lesestand alle Offsets des Snapshots ab und ist `grund` groesse/start, wird nur `_snapGen` übernommen; nach Import/Bereinigung/Wiederherstellung (anderer `grund`) wird immer nachgeladen, weil der Snapshot Daten außerhalb der Protokolle trägt. Divergenzen aus übersprungenen Ops (UNIQUE) heilen beim nächsten Start. (4) **Offline-Stand** in der IndexedDB nur bei `App.offlineStandAn` (localStorage `bhk_offline_stand`, je Rechner), dann stündlich. (5) **`_applyOps`** läuft je Schub in einem `SAVEPOINT` mit wiederverwendeten Prepared Statements; `_opSignatur` zerlegt jeden SQL-Text nur einmal (`_sigStruktur`, Cache 500). (6) Ein gelungenes Anhängen setzt `_lastSaveDurationMs` auf `_lastAppendMs` (vorher pinnte ein Fehlversuch die Netzqualität für die Sitzung auf 30 s).

**Schlanke Datei – was die Datenbank wirklich füllt (gemessen mit 4300 Azubis):** kw_status 33 MB, `durchsicht_snapshots` bis zu 120 MB (vorher: je Durchsicht das komplette Wochenraster als JSON), `bhk_stamps` 16 MB (50.000 JSON-Stempel), `aenderungslog` 13 MB (jede Import-Überschreibung). Deshalb: Snapshots schreiben `App.snapshotKompakt(kwRows)` = `{v:2,n,z:[[aj,kw,codes,fehltage,behoben,bemerkung?],…]}` nur mit Wochen, die Inhalt haben; `App.snapshotZeilen(snap|json)` liefert daraus (oder aus der alten Array-Fassung) kw_status-artige Zeilen – **Snapshots nie direkt mit `JSON.parse` lesen**. Aufräumen-Option `snapshots` (`DbTools._snapshotsVerdichten`) bringt alte Snapshots in die neue Fassung. Stempel liegen als Text `spalte=ts,client,seq;…` (`_stampText/_stampAusText`, JSON wird weiter gelesen), höchstens `STAMPS_MAX` (20.000) je Snapshot. Der Import loggt Überschreibungen nur, wenn das Feld vorher von Hand geändert wurde (`_logUeberschrieben`).

**Verlustschutz:** Jede Op geht über `markDirty()` → `_persistBald()` SOFORT in den Absturzpuffer (IndexedDB; parallele Läufe werden zu genau einem Nachlauf gebündelt) – nicht mehr erst nach 5 s. `App.sofortSpeichern(quelle)` löscht die Auto-Save-Wartezeit, schreibt den Puffer und hängt sofort an (Rückgabe true = nichts mehr offen); aufgerufen von `KontrolleHandler.saveAndReleaseExplicit` („Freigeben“), `microSave` (Azubi-Wechsel), `loadTermin` (Terminwechsel) und `stopLiveSync` (Kontrolle verlassen). Jede eigene Op trägt `sid` (`_azubiAusOp`), `App._ungesichertAzubis` hält die Azubis mit noch nicht angehängten Ops (`azubiGesichert(sid)`); `_saveV3` räumt sie nach dem Anhängen aus, `KontrolleHandler._gesichertAnzeigen()` färbt die Schnellnavigation (`.qn-ungesichert`) und `#keGesichert`. `App.wartendeAenderungenDialog()` (Klick auf `#dbStatusIndicator` oder `#keGesichert`) listet wartende Ops je Tabelle und Azubi mit „Jetzt schreiben“ und „Änderungen als Datei“. **Wächter:** `BhkSpur._waechterStarten()` misst einen Sekundentakt; Drift ≥ `HAENGER_MS` (4 s) bei sichtbarem Fenster → `BhkSpur.haenger(ms)` mit der letzten Bedienaktion (`_aktionMerken`: Element + `onclick`, bei Tasten nur der Tastenname, nie Feldinhalte) in der Spur, in localStorage `bhk_haenger` (max. 10, überlebt den Tab) und im Zustandsbild.

**Entfernt (nicht Teil der Berichtsheftkontrolle):** Tarife, Vergütung, Urlaub, Azubi-Rechner und Azubi-Dashboard (`azubi-rechner.js`, `azubi-dashboard.js`, Tarif-Karte, Spalten `beruf_id`/`brutto_lohn` bleiben leer), Datei-Upload der Akte (`schueler_dateien` bleibt als Tabelle, alte Dateien unter `_bhk/dateien/` liegen weiter), Nachweis-Dateien an Wiedervorlagen, die leeren Hüllen `blockplan-analyzer.js`/`llm-helper.js` und pdf.js. Die Phasen-Mathematik lebt in `phasen.js` (`Phasen.getPhasen/phasenMitEnden/vertragsendeAusPhasen/parseISO`, Editor `Phasen.editor(id)` aus Stammdaten, Azubi-Ansicht, Kontrolle und Bearbeiten-Fenster). Statistiken und Jahresbericht bleiben (`App.statsEnabled()`).

**Anmeldung:** `App.anmeldung()` (aus `showApp()`, nicht im Demo-Modus) zeigt vor der Arbeit die aktiven Prüfer aus `pruefer` als Knöpfe, hebt die im Browser gemerkte Person (`localStorage bhk_current_user`) hervor und bietet „Weiter als …“; `anmelden(name)` → `switchUser` (Einstellungen, Filter und letzte Ansicht sind personenbezogen über `App.uGet/uSet`), `anmeldenNeu()` legt einen Prüfer an. Wechsel jederzeit über `#topbarUserSelect`. **Präsenz („Wer ist online“), Chat und „Problem melden“ (F2) wurden entfernt** – der Weg zur Entwicklung ist das Zustandsbild (`bhk.kopieren()` oder Wartung → Verbindung → „Zustandsbild kopieren“).

**Fehlersuche:** `BhkLog` (oben in `app-core.js`, vor `const App`) schneidet Konsolenmeldungen in einem Ringspeicher mit und fängt `error`/`unhandledrejection` ab. `App.diagnose()`/`App.diagnoseText()` bauen daraus ein Zustandsbild ohne personenbezogene Daten; `App.schwaerzen()` ersetzt Wörter, die als Azubi-, Betriebs- oder Ausbildername in der eigenen Datenbank vorkommen, sowie SQL-Zeichenketten und E-Mail-Adressen. Weitergabe an die Entwicklung über `App.kopieren(App.diagnoseText())` (Konsole `bhk.kopieren()`, Knopf „Zustandsbild kopieren“ unter Wartung → Verbindung; Rückfallweg über ein Textfeld, weil `navigator.clipboard` auf `file://` fehlen kann).

**Sehr langsame Freigabe (Stau statt Netzabriss):** Auf einer langsamen Freigabe (VPN, SIM) kann ein `createWritable` minutenlang hängen; Chrome führt den Vorgang trotz unseres Zeitlimits weiter. Früher lief alle 45 s ein neuer Versuch an, die hängenden Schreiber stapelten sich (Speicher wuchs, Dateisperren, ganzer PC lahm), jedes Zeitlimit galt als Netzabriss und löste Probe und Sofort-Wiederholung aus. Jetzt: `appendTimeoutMs()` = 30 s … 3 × letzte Dauer + 10 s … 180 s. Läuft das Zeitlimit ab, wird der Versuch **nicht** abgebrochen, sondern als `_appendHaengt` gemerkt; die Ops liegen wieder im Puffer, kein weiterer Versuch startet, der Abgleich-Takt setzt aus („Anhängen hängt“). Kommt der Versuch später doch durch, verbucht `_appendSpaeterGelungen` Kennungen, Dateigröße und gesicherte Azubis und entfernt die Ops aus dem Puffer (kein Duplikat); scheitert er, bleiben sie im Puffer. Ein Zeitlimit ist kein Verbindungsfehler mehr (`_istVerbindungsFehler`), sondern setzt `_netzLangsam`/`_langsamStufe` (Statusanzeige „Langsam · n wartend“, ein Hinweis, Wiederholung nach `langsamWartezeitMs()` = 15 s · 2^(Stufe−1), höchstens 5 min). Während `_compact` den Snapshot schreibt (`_snapshotSchreibt`), warten Anhängen und Abgleich. **Neue Netzschreibwege nie mit eigenem `Promise.race`-Abbruch und Sofort-Wiederholung bauen – hängende Vorgänge merken, nicht stapeln.**

**Stau-Nachwehen (großes Log, Doppel-Einspielen):** Rotation nur nach gelungenem Anhängen hieß: nach Fehlversuchen blieb ein Megabyte-Log liegen und jeder weitere Versuch kopierte es ins Zeitlimit. Jetzt dreht `_saveV3` **vor** dem Anhängen auf eine neue Generation, wenn die Datei bereits `LOG_ROTATE_BYTES` erreicht (Lesestand der alten in `_logOffsets`), und `_bootstrapV3` ebenso beim Start. Eine Kompaktierung mit eigenen, noch nicht angehängten Ops (`_dirtyOps`, `_appendHaengt`) schriebe sie in den Snapshot, aber nicht in die Offsets – alle spielten sie später erneut ein (Symptom: Hunderte `UNIQUE constraint failed: aenderungslog.id` beim Start). Automatische Läufe (`groesse`, `start`) brechen deshalb ab (`_compactAbgelehnt`); Import/Bereinigung schreiben weiter. Das Änderungslog wird mit `INSERT OR IGNORE` geschrieben (Kennung bleibt global über `ID_TABLES`), `_applyOps` zählt UNIQUE-Doppel (`_doppelteOps`) und meldet sie in einer Zeile. `_compactionDue` zählt erst die ungedeckten Bytes: über `KOMPAKT_DRINGEND_BYTES` (8 MB) bremsen nur noch getaktete Verbindung und Mindestabstand (`_kompaktGebremst(dringend)`), sonst läse jeder Start Megabytes Protokoll nach.

**Ereignisspur und Konsole:** `BhkSpur` (direkt nach `BhkLog`) hält für jeden Netz- und Dateivorgang Dauer, Ergebnis und Fehlerart (`fehlerArt(e)`: safebrowsing, zustand, timeout, nicht-gefunden, verweigert, nicht-lesbar, gesperrt, abgebrochen) sowie Zähler je Bereich (anhaengen, abgleich, kompakt, sperre, snapshot, position, netz, heilung, takt, fenster, probe, backup, haenger). `notiere(kat, was, {ok, ms, fehler, info, nurStat})` – `nurStat` zählt unauffällige Erfolge nur (Abgleich alle 3 s), langsame Vorgänge (≥ 3 s) werden trotzdem aufgehoben und gewarnt. `uebersprungen(kat, grund)` notiert ausgesetzte Takte je Grund höchstens einmal je Minute mit Zähler; der Abgleich-Timer meldet so „Fenster verdeckt“, „Anhängen läuft“, „Speichern/Kompaktierung läuft“. Ein `visibilitychange`-Handler protokolliert verdeckte Fenster (Chrome zählt unter Windows ein vollständig überdecktes Fenster als hidden – dann setzt der Takt aus). `App.diagnoseText()` hängt `BhkSpur.text()` an, damit das Zustandsbild die Spur enthält. **Neue Netzschreibwege bitte mit `BhkSpur.notiere` oder `BhkSpur.messen` versehen.** `Konsole` (konsole.js) hängt als `window.bhk` in der Browser-Konsole: `bhk.hilfe()`, `bhk.status()`, `bhk.spur(bereich, n)`, `bhk.dateien()`, `bhk.test()` (Verbindungstest mit Schreibprobe `_bhk/probe_<db>_<client>.txt`, die sofort wieder gelöscht wird, Uhrversatz aus der mtime der Probedatei, Befunde in Klartext), `bhk.jetzt()`, `bhk.kopieren()`, `bhk.debug(true)` (jeden Vorgang sofort ausgeben, in localStorage `bhk_debug`). `Konsole.testDialog()` zeigt den Test unter Wartung → Verbindung.

**Kompaktierung schlägt fehl?** `App._compactGrund` hält den letzten Grund (Zweit-Registerkarte, Sperre belegt samt Halter/Alter, fremder Snapshot, Schreibfehler im Klartext inkl. Safe-Browsing-Hinweis); er steht in der Fehlermeldung, in der Nachhol-Warnung und in der Datenbank-Tools-Karte. Eine Zweit-Registerkarte (`_tabIsPrimary === false`) kann nie kompaktieren – Import und Datenbank-Tools sind dort gesperrt. Scheitert nach einem Schreibfehler auch die Freigabe der eigenen Sperre, merkt sich `_lockVerwaist` die Kennung: `_acquireLock` übernimmt eine Sperre mit eigener Kennung sofort (statt 150 s Staleness abzuwarten), `_sperreAufraeumen` holt die Freigabe im Abgleich-Takt nach. Fremde Sperren werden nie angefasst. Meldet Chromium einen **Zustandsfehler** (`state had changed since it was read from disk`, `_istZustandsFehler`), ist der Zugriffspunkt nach einer fremden Kompaktierung veraltet und dauerhaft unbrauchbar: `_handlesNeuHolen()` holt `_bhk`, `backups`, `Datenbanken` und die Datenbankdatei frisch aus dem Ordner und **prüft mit einem `getFile()`, ob sie danach wirklich lesbar ist** – ist der Ordner-Zugriffspunkt selbst veraltet, liefert er nur neue, ebenso tote Kinder. Sperre und Snapshot-Write wiederholen sich danach genau einmal; scheitert auch das, setzt `_neuladenNoetig` und der Grund sagt dem Nutzer, dass nur noch ein Neuladen (F5) hilft. Die Datenbank-Tools warten deshalb nur kurz (`SAVE_VERSUCHE`/`SAVE_PAUSE_MS`) und überlassen den Rest der Nachholung im Hintergrund; `App.showLoading()` zählt die Sekunden mit und `App.ladeText()` benennt die laufende Phase. Der Fehler trifft **jeden** Schreibweg, nicht nur die Kompaktierung: `App._zustandHeilen(quelle)` erneuert die Zugriffspunkte höchstens einmal je Minute, und nach drei vergeblichen Versuchen zeigt `App._neuladenHinweis()` einmalig ein Banner mit „Seite neu laden“. Neue Schreibwege sollten bei `_istZustandsFehler(e)` genau einmal über `_zustandHeilen()` wiederholen (Vorbild: `_writePositionFile`).

**Kontrolltag-Oberfläche (UI-Paket 1):** Nach `loadTermin` schrumpft die Terminwahl auf eine Zeile (`_terminZeile()`, Karte `#terminWahlCard` mit `#terminWahlKurz`/`#terminWahlVoll`; `#selKontrolltermin` bleibt im DOM, `terminWechseln()` klappt auf). Folgeaktionen zum Termin (Anfrage/Ergebnisse an Schule, Betriebe, fremde Ämter, alle PDFs, Druck) liefert `_terminAktionen(t, fremde)`; sie hängen als Menü an der Terminzeile und im Übersichts-Menü „Weitere Aktionen“ (Anwesenheit, offene → i.O., Azubi hinzufügen, FR-Gruppierung). Menüs baut `_menue(titel, eintraege, title, klasse)` als `<details class="aktionen-menue">` (Klasse `oben` öffnet nach oben, Klick daneben schließt). Einzelansicht: Prüfer-Karte entfällt (Prüfer steht in der Kopfzeile), Suche/`#livePrueferBar`/`#syncPulse` im Kopf; Kürzel-Leiste `#kwLegendBar` standardmäßig aus (`legend_hidden` Vorgabe '1'), „?“ im Sticky-Kopf → `legendeUmschalten()`. Raster: `.kw-cell` mit `aspect-ratio: 2/1`; frühere vollständig geprüfte und künftige unberührte Jahre (`kuenftig`) eingeklappt, Kopf `.aj-kopf` klickbar (`toggleAJ`). Ergebnis, Bemerkung und Wiedervorlage stehen in der festen Leiste `.ke-leiste` (`#lockableLeiste`, sticky unten; Radios `name="ergebnis"` als `.erg-pill`, `#keBemerkung`, `#wvSection`/`#wvDatum` unverändert – `setzeErgebnisKurz`/`saveField` funktionieren weiter), Fußzeile „‹ Zurück · ✓ Fertig, nächster offener (= `nextOffen`, schreibt sofort) · Weiter ›“, PDFs und „Freigeben ohne Wechsel“ im ⋯-Menü. Die Kollegen-Sperre in `doLiveSync` deckt `lockableContent` **und** `lockableLeiste` ab. Hilfe: Kapitel `help_0…help_24` fortlaufend, `HILFE_MAP` zeigt auf die neue Nummerierung – **beim Einfügen oder Entfernen eines Kapitels TOC, Kapitel-IDs und `HILFE_MAP` gemeinsam anpassen.**

**Listen (UI-Paket 2):** Jede Zeile in Planung, Wiedervorlagen und Stammdaten hat genau **einen Hauptknopf** (Planung: Starten / Nachbereiten / Öffnen nach Status; Wiedervorlagen: ✓ Erledigt bzw. Details; Stammdaten: Bearbeiten) und ein **⋯-Menü** mit allen weiteren Aktionen. Menüs baut `App.menue(titel, eintraege, title, klasse)` (Klasse `klein` = schmaler ⋯-Knopf, `oben` = nach oben); `App._menuePosition` setzt die Liste beim Öffnen auf `position:fixed`, damit sie in scrollenden Karten und am unteren Rand nicht abgeschnitten wird; Klick daneben, Scrollen und Resize schließen. Die **Azubi-Liste gibt es nur in den Stammdaten**, mit Seiten à `AZUBI_SEITE` (50, `_azubiSeite(n)`, `_azubiPage`); Excel-Export und Kopieren nehmen weiter die ganze gefilterte Liste (`_lastAzubiWhere`). Kopfzeile: „+ Azubi“ und Menü „Liste“ (Excel, Kopieren, Jahrgang abschließen = `SchuelerView.abschliessenJahrgang`, Jahrgang komplett löschen = `ImportHandler.deleteAllJahrgang()` mit Auswahl-Dialog). Die Import-Seite ist nur noch der Import (IBYKUS-Import aufgeklappt). **Azubi bearbeiten** (`ImportHandler.editSchueler`) hat einen Reiter: lokale Felder editierbar, IBYKUS-Felder (`App.IBYKUS_FELDER` + Name/Ident/BAV-Status) im Block `.ibykus-block` gesperrt (`class="ibykus-feld" disabled`), Schalter `#mSIbykusAendern` gibt sie frei; alle `mS*`-Kennungen und `updateSchueler` sind unverändert. **Begriffe:** In der Oberfläche heißt es „Azubi“ (nie „Schüler“, Ausnahmen: Bezeichner wie `enterSchüler`, der IBYKUS-Hinweis, Briefe/PDF); `listen-test` prüft das.

**Zoom und Barrierefreiheit:** Die Palette hält 4,5:1 (`--clr-green #3F6B0A`, `--clr-amber #A94E00`, `--clr-sage #6B6560`; `a11y-test` rechnet die Paare aus `:root` nach – neue Farben dort eintragen). **Keine Schrift unter 12 px** in CSS und Inline-Styles (einzige Ausnahme `.kw-cell .kw-codes` 11 px; PDF-Punktgrößen in jsPDF sind kein CSS und bleiben). Feste Leisten (`.azubi-sticky`, `.kw-legend`, `.ke-leiste`) werden ab `max-height: 720px` oder `max-width: 720px` statisch, damit die Seite bis 400 % Zoom bedienbar bleibt; die Ergebnisleiste überbrückt den unteren Seitenabstand je Breakpoint (`bottom: -32/-28/-20/-16/-12px` – bei Änderung des `.main-content`-Paddings mitziehen). Sichtbarer gelber Fokus (`:focus-visible`) auf Knöpfen, Reitern, Menüs, Links; Symbolknöpfe und `App.menue`-Knöpfe tragen `aria-label`, der Jahreskopf `.aj-kopf` ist `role="button" tabindex="0"` mit Enter/Leertaste. Einstellung **„Große Schrift“** je Rechner (`App.setGrosseSchrift`, localStorage `bhk_grosse_schrift`, `body.grosse-schrift { zoom: 1.2 }`). `prefers-reduced-motion` schaltet Animationen ab. **Neue Oberflächen: Schrift ≥ 12 px, Symbolknöpfe mit `aria-label`, keine neuen Sticky-Elemente ohne die 720-px-Regel.**

**Rahmen (UI-Paket 3):** Der **Filterbalken** unter der Kopfzeile ist die einzige Darstellung der globalen Filter: immer sichtbar (`.filter-panel { display: flex }`), aktive Chips schwarz, rechts `#filterReset` („Filter zurücksetzen“, sichtbar bei `_updateFilterCount() > 0`, ruft `App.filterZuruecksetzen()`). `App.filterBadgeHtml()` liefert `''` (bleibt, weil alle Ansichten es aufrufen); `toggleFilterPanel`/`_restoreFilterPanel` sind Leerfunktionen. **Kopfzeile:** Suche, `#dbStatusIndicator`, `#topbarUserSelect`, `#dbFileName`; `#autoSaveIndicator`, `#dbLastSaved` und `#btnSwitchDB` bleiben im DOM (JS schreibt hinein), sind aber versteckt; der Offline-Modus wird im Dialog `wartendeAenderungenDialog()` (Klick auf den Speicherstatus) umgeschaltet. **Startseite** ohne „Was steht an?“ (Arbeitsliste, „Wo stehen wir?“, vier Kennzahlen bleiben). **Einstellungen** (`Views.einstellungen`) in drei Reitern `EINST_TABS` (persoenlich: Darstellung + Sichtbare Menüpunkte · kontakt: Kontaktdaten, Ämter-E-Mails, Vorlagen, Word-Vorlage · regeln: LFK-Regeln, Ferien, Textbausteine; gewählter Reiter in `einst_tab`), **Wartung** (`Views.wartung`, Menüpunkt `data-view="wartung"`): Verbindung, Backups & Papierkorb, Datenbank-Tools, Änderungs-Logbuch, Import-Historie, Betrieb-Duplikate. Beide Ansichten holen ihre Karten aus `_einstellungenTeile()` – **neue Einstellungs-Karten dort als Baustein anlegen und dem passenden Reiter bzw. der Wartung zuordnen.** Texte verweisen auf „Wartung → …“ statt „Einstellungen → …“. **Hilfe:** zwölf Kapitel `help_0…help_11` entlang des Arbeitsablaufs; zusammengeführte frühere Kapitel stehen als `.help-abschnitt` mit `<h4 class="help-untertitel">` im Kapitel (Inhalte unverändert); `HILFE_MAP` zeigt je Ansicht ins Kapitel (wartung → help_10). Beim Einfügen eines Kapitels TOC (`helpSections`), IDs und `HILFE_MAP` gemeinsam anpassen.

**Feinschliff der Durchsicht (eine haftende Zeile):** Kopfzeile und Filterbalken liegen im `#kopfBlock` (`.kopf-block`); `App._kopfInit()` (aus `showApp`) hört auf das Scrollen von `#mainContent` und setzt `body.kopf-weg` beim Scrollen nach unten (Kopf gleitet per `margin-top: calc(-1 * var(--kopf-h))` weg), entfernt sie beim Hochscrollen oder oberhalb von 40 px; 350 ms Sperre nach jedem Wechsel, weil das Ein-/Ausblenden den Scrollbereich selbst verändert; `navigate()` ruft `kopfZeigen()`. **Randmaß:** `--gutter`, `--gutter-unten`, `--gutter-kopf` in `:root` mit vier Stufen (≥1400: 48/32/32 · Standard 32/28/24 · ≤1024: 20 · ≤768: 12/16 · ≤480: 8/12) – Inhalt, Azubi-Kopf und Ergebnisleiste benutzen ausschließlich diese Variablen, **keine Pixelabstände mehr in Breakpoints**. Die Ergebnisleiste hat zwei Zeilen (`.ke-ergebnis` Pillen + Wiedervorlage; `.ke-zeile2` Bemerkung, Textbaustein-Menü `textbausteinEinfuegen(i)`, Zurück · Fertig · Weiter, ⋯-Menü mit `autoWeiterUmschalten()`), ~77 px statt 122 px. Der Speicherstatus `#keGesichert` ist ein Punkt im Azubi-Kopf (`.as-gesichert`, Klasse `offen`, Text in `.sr-only`). Die Kürzel sind ein Popover (`.kw-legend-anker` sticky mit Höhe 0, `.kw-legend` absolut, `role="dialog"`, Klick daneben schließt über `_legendeZuHandler`). Mit geladenem Termin trägt `.page-header` die Klasse `kompakt` (`_terminZeile`/`terminWechseln`). Fester Anteil bei 125 % Zoom nach dem Scrollen ≈ 12 % (vorher 29 %).

**Pflichtteile 1.1 / 1.5 „geführt“:** `kontrollergebnisse.p_1_1_gefuehrt` und `p_1_5_gefuehrt` ('' | 'ja' | 'nein') ergänzen die Vorhanden-Auswahl. `App.bemerkungMitHinweis(bemerkung, feld, wert)` setzt bei 'nein' genau einmal den Satz aus `App.HINWEISE_NICHT_GEFUEHRT` auf eine eigene Zeile der Bemerkung und nimmt ihn sonst wieder heraus; von Hand geänderte Fassungen bleiben unberührt. `saveField` führt die Bemerkung samt Undo mit. Die Zulassungslogik (`pflichtOK`) wertet das Feld bewusst NICHT aus.

**Beim Ändern von Schreibpfaden beachten:**
- Schreibende IDs müssen global eindeutig sein → Tabelle in `App.ID_TABLES`
- `INSERT` auf Tabellen mit UNIQUE-Bedingung immer mit `ON CONFLICT … DO UPDATE`
- Löschen ausschließlich über `App.delete*Kaskade()`, Zusammenführen über `App.mergeSchulen/mergeBetriebe/mergeJahrgaenge` (verschmilzt UNIQUE-Klassen, legt Aliase in `stammdaten_aliase` an)

## Einsatzumgebung
- **Zielgruppe**: Ausbildungsberater im RP Freiburg (Verwaltung)
- **Rechner**: Zero-Trust Windows-PCs ohne Admin-Rechte
- **Daten**: IBYKUS-Export (CSV), SQLite auf Netzlaufwerk
- **Browser**: Chrome oder Edge (Pflicht wegen File System Access API)
- **Nutzer**: 2–3 Sachbearbeiter gleichzeitig
