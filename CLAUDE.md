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
│           ├── blockplan-analyzer.js ← Blockplan-PDF-Analyse
│           ├── global-search.js     ← Ctrl+K Suche
│           ├── keyboard-shortcuts.js ← Tastaturkürzel
│           ├── bulk-schueler.js     ← Bulk-Operationen Schüler
│           ├── llm-helper.js        ← KI-Integration
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
│   ├── pdf.min.js + pdf.worker.min.js ← PDF-Lesen (Blockplan)
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
| views.js | `Views` | Dashboard-Rendering, Sidebar, View-Dispatching |
| stammdaten.js | `StammdatenTab` | CRUD für Prüfer, Schulen, Jahrgänge, Fachrichtungen |
| import-handler.js | `ImportHandler` | IBYKUS-CSV Import mit Auto-Erkennung |
| planung.js | `PlanungHandler` | Kontrolltermine anlegen, bearbeiten, zuweisen |
| kontrolle.js | `KontrolleHandler` | Kernstück: KW-Raster, Mängel-Codes, Live-Sync |
| kw-nav.js | `KWNav` | Keyboard-Navigation im KW-Raster |
| pdf-export.js | `PDFExport` | Durchsichtsbogen als PDF |
| workflows.js | `Workflows` | Workflow-Engine (Freisprechung, Briefe) |
| wiedervorlagen.js | `WiedervorlagenHandler` | Wiedervorlagen-Verwaltung |
| berichte.js | `BerichteHandler` | Statistiken und Berichte |
| schueler-view.js | `SchuelerView` | Einzelschüler-Detailansicht |
| nacherfassung.js | `NacherfassungHandler` | Nacherfassung von Kontrollen |
| global-search.js | `GlobalSearch` | Ctrl+K Suche + Tastenkürzel-Hilfe |
| keyboard-shortcuts.js | – | Globale Tastaturkürzel |
| blockplan-analyzer.js | `BlockplanAnalyzer` | Blockplan-PDF-Analyse |
| llm-helper.js | `LLMHelper` | KI-Integration |
| azubi-rechner.js | `AzubiRechner` | Phasen-Mathematik, Tarife, Vergütungsperioden |
| azubi-dashboard.js | `AzubiDashboard` | Per-Azubi-Dashboard, Phasen-Editor |
| schueler-akte.js | `SchuelerAkte` | Bemerkungen, Dateianhänge, Aktenvermerk |
| melden.js | `Melden` | Problem melden: Zustandsbild, Konsolenprotokoll, Bildschirmfoto, Ablage in `_bhk/meldungen/`, Übersicht und Export |
| chat.js | `Chat` | Kurznachrichten zwischen gleichzeitig arbeitenden Rechnern (eigene JSONL-Datei je Client, Toast, Verlauf) |
| db-tools.js | `DbTools` | Datenbank-Tools: Bestand, Verdichten, Jahrgang mit Archiv löschen/zurückholen, Aufräumen, VACUUM-Neuaufbau, Einstieg Stammdaten heilen |
| konsole.js | `Konsole` (= `window.bhk`) | Diagnosebefehle für die Browser-Konsole: Zustand, Ereignisspur, Präsenz, Chat, Ordnerinhalt, Verbindungstest (auch als Dialog unter Einstellungen → Verbindung) |

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
| `rechner-test.mjs` | Vergütungsperioden, Mindestvergütung |
| `search-test.mjs` | Fuzzy-Suche, Mehrwortsuche, Ranking |
| `dq-test.mjs` | Datenqualitäts-Regeln |
| `filter-test.mjs` | Globale Filter: Mehrfachauswahl, AP∪ZP-Vereinigung, Standortgruppen |
| `planung-test.mjs` | Schultermin-Workflow: gf(termine), Termin-Azubi-Menge, fremde Ämter, Lehrjahre, Kampagnenfenster/Kohorte, Stichtag-Lehrjahr, KW 53, Doppeltermine, Termin-Statuskette, ICS, Jahresablauf/Ferien, Kampagnen-Ausschluss, Nachholtermin, LFK-Regeln, Blockplan-Übernahme, Kontrolltag-Cockpit |
| `nacherfassung-test.mjs` | Nacherfassung: geprüft-bis-KW-Kaskade, pauschale Fehltage, AJ/KW-Zuordnung, Termin-Wiederverwendung |
| `workflow-test.mjs` | Vorlagen/Textbausteine, Dateinamen, Papierkorb (Azubi + Termin), Lösch-Logbuch, Nachbereitung (Betriebs-Vorlagen, fremde Ämter, Versandnachweis/Mahnstufe), WV-Nachweis, Akten-Dateien, Betriebs-/Schul-Ampel, Sammel-Erinnerung, Kontexthilfe, Rollen |
| `status-test.mjs` | Azubi-Status: Import-Ableitung (BAV/Beendigung), Neuverträge, fehlende Azubis, `setSchuelerStatus`, Import-Vorschau (Savepoint) |
| `kontrolltag-test.mjs` | Kontrolltag: Prüfer-Vorrang/Sperre, KW-Modal mit Undo, WV folgt dem Ergebnis, i.O. → geprüft bis Vorwoche, Nacherfassung schließt WV, Prüfer-Unterschrift, Prüferaufteilung, Ergebnis-Kürzel, Undo-Verlauf, 1.1/1.5 „geführt / nicht geführt“ mit automatischem Hinweis in der Bemerkung |
| `feldmodus-test.mjs` | Feldmodus/Lag-Budget: Abgleich-Takt aus Netzqualität, Messung der Abgleichdauer, Log-Rotation nach Größe, Bereinigung nur bei Snapshot-Abdeckung |
| `dbtools-test.mjs` | Datenbank-Tools: Bestand/Jahrgangsübersicht, Verdichten-Kandidaten (offene WV, Frist), Jahrgang löschen (geteilte Termine bleiben, auch mit noch aktiven Azubis – Bestätigung „AKTIVE LÖSCHEN“), Archiv-DB + Rückholung, Aufräumen (Waisen, Log, Blockplan, Stempel, Betriebe), VACUUM, Indizes (Schema + beide Migrationen), Gruppierung statt Unterabfragen, Sperrgründe, Warten auf laufende Kompaktierung, längere Speicherversuche, Nachholung mit Nacharbeit, Zweit-Registerkarte gesperrt, Sperre lesen/freigeben, eigene verwaiste Sperre übernehmen/nachträglich freigeben, veraltete Zugriffspunkte erneuern |
| `stammdaten-test.mjs` | Stammdaten heilen: Normalisierung, Dubletten-Kandidaten, Aliase, Zusammenführen (Schulen mit UNIQUE-Klassen, Betriebe, Jahrgänge), Import-Wächter (Alias-Zuordnung, Vorschau-Auswahl) |
| `melden-test.mjs` | Problem melden: Ringspeicher für Konsolenmeldungen, globale Fehlerabfänge, Diagnose, Schwärzung gegen die Namen der eigenen Datenbank, Ablage/Benachrichtigung, Übersicht, Export, Aufbewahrung (60 Tage), Fallback ohne Netzlaufwerk |
| `chat-test.mjs` | Chat: Anhängen an die eigene Datei, Lesen ab Leseposition, Direktnachrichten, Toast/Verlauf, Ungelesen-Stand, Aufbewahrung (7 Tage) und Dateigröße, Sperren (offline/Netzabriss), Zugriffspunkt-Erneuerung, nichts in der Datenbank |
| `praesenz-test.mjs` | Präsenz „Wer arbeitet gerade?“: Lebenszeichen-Datei je Rechner, Online-Erkennung (3 min), Drosselung (30/60 s, Ansichtswechsel nach 5 s), Aufräumen (24 h), Sperren (Netzabriss/offline), Kopfzeile + Dialog |
| `bestand-test.mjs` | Großer Bestand: Sicherungen (gemeinsam je Datenbank, Intervall-Einstellung, gzip, Wiederherstellung, Aufbewahrung über beide Endungen), Kompaktierung (Schwelle 10 %, 30-min-Abstand, Feldmodus/sehr langsame Leitung, Zeitlimit nach Größe), fremder Snapshot ohne Nachladen, Offline-Stand nur auf Wunsch, Schübe in einer Transaktion, Signatur-Cache, Netzqualität aus dem Anhängen |
| `konsole-test.mjs` | Diagnose: Ereignisspur (`BhkSpur`: Fehlerarten, Zähler je Bereich, nurStat, langsame Vorgänge, Ringspeicher, gedrosselte Übersprungen-Einträge, Debug-Schalter), Sichtbarkeitswechsel, Gründe ausgesetzter Takte, Instrumentierung von Präsenz/Netz/Chat, Zustandsbild, Konsolenbefehle `bhk.*`, Verbindungstest (Schreibsperre, Uhrversatz, Zweit-Tab, ohne Ordner) |
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

**Feldmodus und Offline-Betrieb:** Keine Bedienaktion wartet auf das Netzlaufwerk. Der Abgleich-Takt folgt der gemessenen Netzqualität (Speichern und Abgleichdauer): 3 s / 10 s / 30 s, der Feldmodus (`App.feldmodus`, Einstellungen) erzwingt 30 s und bündelt das Speichern. Das eigene Protokoll rotiert ab `LOG_ROTATE_BYTES` auf eine neue Generation (Chrome kopiert beim Anhängen die ganze Datei); alte Generationen werden nur gelöscht, wenn `snapmeta` sie vollständig abdeckt. Offline-Modus (`App.offlineModusEinschalten()` / `startOffline()` / `wiederverbinden()`): lokaler Snapshot in IndexedDB (`snapshot`-Store), Änderungen im Puffer (30 Tage), Zusammenführung über den Crash-Restore-Pfad mit Konfliktliste (`_konflikte`), genau eine Wiedervorlage je Ergebnis (`_entdoppleWiedervorlagen`), Prüferaufteilung in `kontrolltermine.aufteilung`.

**Großer Bestand (mehrere tausend Azubis, Datenbank > 30 MB):** Rechenlast und Rendern skalieren gut (4900 Azubis: jede Ansicht < 300 ms); teuer sind ausschließlich Vorgänge mit der ganzen Datei. Deshalb gelten: (1) **Sicherungen** gemeinsam je Datenbank – `_backupFaellig()` prüft das Alter der neuesten `backup_*`-Datei im Ordner (Listing höchstens alle 10 min), Intervall aus `einstellungen.backup_intervall_min` (Standard 60), Datei als `.sqlite.gz` über `CompressionStream` (`_komprimieren/_dekomprimieren`, Rückfall unkomprimiert); `restoreBackup`, `listBackups`, `cleanOldBackups` kennen beide Endungen (`_istBackupDatei`). (2) **Kompaktierung**: Schwelle `kompaktSchwelle()` = max(1,5 MB, 10 % der Snapshotgröße), `KOMPAKT_MIN_ABSTAND_MS` 30 min ab `_letzteKompaktierung` (eigene oder `snapmeta.t`), nie automatisch im Feldmodus oder bei `very-slow` (`_kompaktGebremst()`), Zeitlimit `snapshotTimeoutMs(bytes)` = 120 s + 10 s/MB mit Sperren-Herzschlag alle 60 s während des Schreibens. (3) **Kein Nachladen ohne Grund**: `_snapshotSchonEnthalten(meta)` – deckt der eigene Lesestand alle Offsets des Snapshots ab und ist `grund` groesse/start, wird nur `_snapGen` übernommen; nach Import/Bereinigung/Wiederherstellung (anderer `grund`) wird immer nachgeladen, weil der Snapshot Daten außerhalb der Protokolle trägt. Divergenzen aus übersprungenen Ops (UNIQUE) heilen beim nächsten Start. (4) **Offline-Stand** in der IndexedDB nur bei `App.offlineStandAn` (localStorage `bhk_offline_stand`, je Rechner), dann stündlich. (5) **`_applyOps`** läuft je Schub in einem `SAVEPOINT` mit wiederverwendeten Prepared Statements; `_opSignatur` zerlegt jeden SQL-Text nur einmal (`_sigStruktur`, Cache 500). (6) Ein gelungenes Anhängen setzt `_lastSaveDurationMs` auf `_lastAppendMs` (vorher pinnte ein Fehlversuch die Netzqualität für die Sitzung auf 30 s).

**Präsenz:** Standardmäßig AUS – gemeinsam mit dem Chat über `einstellungen.kollegen_anzeige` ('1') schaltbar (`App.kollegenAn()`, Cache 30 s, `setKollegenAnzeige`); ausgeschaltet schreibt niemand Lebenszeichen, `onlineNutzer()` ist leer, das Chat-Symbol zeigt nur „⚑ Problem melden“. Tests, die Präsenz oder Chat brauchen, setzen die Einstellung. Eingeschaltet: Jeder Rechner schreibt im Abgleich-Takt (30 s, Feldmodus 60 s, nach Ansichts-/Prüferwechsel frühestens nach 5 s) `_bhk/praesenz_<db>_<client>.json` und liest die der anderen (`App._praesenzTakt`, `App.onlineNutzer()`); online = Lebenszeichen jünger als 3 Minuten, Dateien älter als 24 h werden beim Lesen entfernt. Anzeige in der Kopfzeile (`#onlineNutzer`) und unter Einstellungen → Verbindung.

**Chat:** Standardmäßig AUS (siehe Präsenz, `Chat.an()`; ausgeschaltet führt `Chat.oeffnen()` zum Melden). Eingeschaltet: `Chat` (chat.js) hängt Nachrichten an die EIGENE Datei `_bhk/chat_<db>_<client>.jsonl` an; `Chat.abholen()` läuft im selben Abgleich-Takt und liest fremde Dateien ab der Leseposition. Direktnachrichten filtert der Empfänger über `an` (Client-Kennung), der gemeinsame Ordner bleibt für alle lesbar – das ist ausdrücklich **keine** Vertraulichkeit. Nichts davon landet in der Datenbank; Dateien älter als 7 Tage und eigene Dateien über `DATEI_MAX_BYTES` werden ersetzt. Gelesen-Stand nur lokal (`App.uSet`). Das Symbol `#chatBadge` bleibt immer sichtbar (blass, wenn der Chat ruht) und enthält den Link zum Melden eines Problems.

**Fehlersuche:** `BhkLog` (oben in `app-core.js`, vor `const App`) schneidet Konsolenmeldungen in einem Ringspeicher mit und fängt `error`/`unhandledrejection` ab. `App.diagnose()`/`App.diagnoseText()` bauen daraus ein Zustandsbild ohne personenbezogene Daten; `App.schwaerzen()` ersetzt Wörter, die als Azubi-, Betriebs- oder Ausbildername in der eigenen Datenbank vorkommen, sowie SQL-Zeichenketten und E-Mail-Adressen. `Melden` (F2) legt daraus eine Meldung in `_bhk/meldungen/<zeit>_<rechner>/` ab (JSON, Textfassung, optional Bild), kündigt sie über den Chat an und exportiert alles als eine Textdatei für die Weitergabe. Zustellwege zur Betreuung: Zähler `#meldungBadge` in der Kopfzeile (`Melden.pruefeNeue()` am Abgleich-Takt, höchstens alle 5 Minuten, Klick öffnet `Melden.uebersicht()`), Chat-Ankündigung, Karte in den Einstellungen und optional `mailto` an die Einstellung `meldung_email`. Das Chat-Symbol ist immer sichtbar und führt ebenfalls zum Melden. `Melden.kopiereEine()/kopiereAlle()` legen den Text über `App.kopieren()` in die Zwischenablage (mit Rückfallweg über ein Textfeld, weil `navigator.clipboard` auf `file://` fehlen kann). Schreibfehler werden HÖCHSTENS einmal wiederholt, mit stabiler Kennung und Aufräumen des angefangenen Ordners – sonst entstand je Versuch eine neue Meldung.

**Ereignisspur und Konsole:** `BhkSpur` (direkt nach `BhkLog`) hält für jeden Netz- und Dateivorgang Dauer, Ergebnis und Fehlerart (`fehlerArt(e)`: safebrowsing, zustand, timeout, nicht-gefunden, verweigert, nicht-lesbar, gesperrt, abgebrochen) sowie Zähler je Bereich (praesenz, chat, anhaengen, abgleich, kompakt, sperre, snapshot, position, netz, heilung, takt, fenster, probe). `notiere(kat, was, {ok, ms, fehler, info, nurStat})` – `nurStat` zählt unauffällige Erfolge nur (Abgleich alle 3 s), langsame Vorgänge (≥ 3 s) werden trotzdem aufgehoben und gewarnt. `uebersprungen(kat, grund)` notiert ausgesetzte Takte je Grund höchstens einmal je Minute mit Zähler; der Abgleich-Timer meldet so „Fenster verdeckt“, „Anhängen läuft“, „Speichern/Kompaktierung läuft“. Ein `visibilitychange`-Handler protokolliert verdeckte Fenster (Chrome zählt unter Windows ein vollständig überdecktes Fenster als hidden – dann setzt der Takt aus). `App.diagnoseText()` hängt `BhkSpur.text()` an, damit jede Fehlermeldung (F2) die Spur enthält. **Neue Netzschreibwege bitte mit `BhkSpur.notiere` oder `BhkSpur.messen` versehen.** `Konsole` (konsole.js) hängt als `window.bhk` in der Browser-Konsole: `bhk.hilfe()`, `bhk.status()`, `bhk.spur(bereich, n)`, `bhk.praesenz()`, `bhk.chat()`, `bhk.dateien()`, `bhk.test()` (Verbindungstest mit Schreibprobe `_bhk/probe_<db>_<client>.txt`, die sofort wieder gelöscht wird, Uhrversatz aus der mtime der Probedatei, Befunde in Klartext), `bhk.jetzt()`, `bhk.kopieren()`, `bhk.debug(true)` (jeden Vorgang sofort ausgeben, in localStorage `bhk_debug`). `Konsole.testDialog()` zeigt den Test unter Einstellungen → Verbindung.

**Kompaktierung schlägt fehl?** `App._compactGrund` hält den letzten Grund (Zweit-Registerkarte, Sperre belegt samt Halter/Alter, fremder Snapshot, Schreibfehler im Klartext inkl. Safe-Browsing-Hinweis); er steht in der Fehlermeldung, in der Nachhol-Warnung und in der Datenbank-Tools-Karte. Eine Zweit-Registerkarte (`_tabIsPrimary === false`) kann nie kompaktieren – Import und Datenbank-Tools sind dort gesperrt. Scheitert nach einem Schreibfehler auch die Freigabe der eigenen Sperre, merkt sich `_lockVerwaist` die Kennung: `_acquireLock` übernimmt eine Sperre mit eigener Kennung sofort (statt 150 s Staleness abzuwarten), `_sperreAufraeumen` holt die Freigabe im Abgleich-Takt nach. Fremde Sperren werden nie angefasst. Meldet Chromium einen **Zustandsfehler** (`state had changed since it was read from disk`, `_istZustandsFehler`), ist der Zugriffspunkt nach einer fremden Kompaktierung veraltet und dauerhaft unbrauchbar: `_handlesNeuHolen()` holt `_bhk`, `backups`, `Datenbanken` und die Datenbankdatei frisch aus dem Ordner und **prüft mit einem `getFile()`, ob sie danach wirklich lesbar ist** – ist der Ordner-Zugriffspunkt selbst veraltet, liefert er nur neue, ebenso tote Kinder. Sperre und Snapshot-Write wiederholen sich danach genau einmal; scheitert auch das, setzt `_neuladenNoetig` und der Grund sagt dem Nutzer, dass nur noch ein Neuladen (F5) hilft. Die Datenbank-Tools warten deshalb nur kurz (`SAVE_VERSUCHE`/`SAVE_PAUSE_MS`) und überlassen den Rest der Nachholung im Hintergrund; `App.showLoading()` zählt die Sekunden mit und `App.ladeText()` benennt die laufende Phase. Der Fehler trifft **jeden** Schreibweg, nicht nur die Kompaktierung: `App._zustandHeilen(quelle)` erneuert die Zugriffspunkte höchstens einmal je Minute, und nach drei vergeblichen Versuchen zeigt `App._neuladenHinweis()` einmalig ein Banner mit „Seite neu laden“. Neue Schreibwege sollten bei `_istZustandsFehler(e)` genau einmal über `_zustandHeilen()` wiederholen (Vorbild: `_writePositionFile`).

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
