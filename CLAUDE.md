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
│   ├── css/styles.css               ← Alle Styles (~1170 Zeilen)
│   └── js/
│       ├── app-core.js              ← App-Kern: DB, Navigation, Save/Load (~3670 Zeilen)
│       ├── utils.js                 ← Hilfsfunktionen + Init (~95 Zeilen)
│       └── modules/
│           ├── views.js             ← Dashboard, Sidebar-Rendering (~2350 Zeilen)
│           ├── kontrolle.js         ← Kontrolldurchführung (~2410 Zeilen) ← GRÖSSTER
│           ├── stammdaten.js        ← Stammdaten-Verwaltung (~1210 Zeilen)
│           ├── workflows.js         ← Workflow-Engine (~750 Zeilen)
│           ├── import-handler.js    ← CSV/IBYKUS Import (~710 Zeilen)
│           ├── planung.js           ← Kontrolltermin-Planung (~600 Zeilen)
│           ├── berichte.js          ← Berichte & Statistiken (~545 Zeilen)
│           ├── kw-nav.js            ← KW-Raster Navigation (~530 Zeilen)
│           ├── pdf-export.js        ← PDF-Durchsichtsbogen Export (~470 Zeilen)
│           ├── schueler-view.js     ← Einzelschüler-Ansicht (~270 Zeilen)
│           ├── nacherfassung.js     ← Nacherfassung (~250 Zeilen)
│           ├── wiedervorlagen.js    ← Wiedervorlagen-Handler (~220 Zeilen)
│           ├── blockplan-analyzer.js ← Blockplan-PDF-Analyse (~210 Zeilen)
│           ├── global-search.js     ← Ctrl+K Suche (~200 Zeilen)
│           ├── keyboard-shortcuts.js ← Tastaturkürzel (~155 Zeilen)
│           ├── bulk-schueler.js     ← Bulk-Operationen Schüler (~80 Zeilen)
│           ├── llm-helper.js        ← KI-Integration (~80 Zeilen)
│           ├── bulk-wv.js           ← Bulk-Operationen WV (~55 Zeilen)
│           ├── table-sort.js        ← Tabellen-Sortierung (~50 Zeilen)
│           └── undo-manager.js      ← Undo/Redo (~40 Zeilen)
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
├── fonts/                           ← Schriften (DM Sans, Fraunces)
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

### Regeln
- **Build nach jeder Änderung** – `./build.sh` ausführen, `dist/` mit committen
- **Keine npm-Dependencies** – Libraries als einzelne Dateien in `libs/`
- **Datenschutz beachten** – Niemals `.sqlite`-Dateien committen!
- **File System Access API** – Nur Chrome/Edge, kein Firefox/Safari
- **Deutsche UI** – Alle Labels, Fehlermeldungen auf Deutsch

### Schema-Änderungen (WICHTIG!)
Die App nutzt eine In-Memory-SQLite-DB und synchronisiert per `mergeAndSave()` mit der Disk-Datei. Schema-Migrationen (ALTER TABLE ADD COLUMN, CREATE TABLE) laufen beim Start nur auf der In-Memory-DB. Die Disk-DB kann ein älteres Schema haben.

**Bei jeder Schema-Änderung müssen ZWEI Stellen gepflegt werden:**
1. **`migrateDB()`** – Migration auf der In-Memory-DB (beim App-Start)
2. **`_migrateDiskDb(diskDb)`** – Dieselbe Migration auf der Disk-DB (vor jedem mergeAndSave-Replay)

Wird `_migrateDiskDb` vergessen, schlagen Dirty-Op-Replays still fehl (try/catch verschluckt den Fehler) und Änderungen gehen beim nächsten Reload verloren.

## Einsatzumgebung
- **Zielgruppe**: Ausbildungsberater im RP Freiburg (Verwaltung)
- **Rechner**: Zero-Trust Windows-PCs ohne Admin-Rechte
- **Daten**: IBYKUS-Export (CSV), SQLite auf Netzlaufwerk
- **Browser**: Chrome oder Edge (Pflicht wegen File System Access API)
- **Nutzer**: 2–3 Sachbearbeiter gleichzeitig
