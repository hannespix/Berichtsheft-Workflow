# Berichtsheftkontrolle

**Verwaltungstool für Ausbildungsberater Gärtner** zur Planung, Durchführung und Nachverfolgung von Berichtsheftdurchsichten.
Regierungspräsidium Freiburg – Abteilung 3 / Referat 31

## Funktionsumfang

- **Schülerverwaltung** – Import aus IBYKUS (CSV), Stammdaten pflegen, Klassen & Jahrgänge
- **Kontrollplanung** – Termine anlegen, Prüfer zuweisen, Kalenderwochen-Raster
- **Kontrolldurchführung** – KW-basierte Einzelkontrolle mit Mängel-Codes (A–I), Live-Sync zwischen Prüfern
- **Workflows** – Freisprechung, Brieferzeugung, Wiedervorlagen
- **Berichte & Export** – Statistiken, PDF-Durchsichtsbögen, Excel-Export
- **Globale Suche** – Ctrl+K zum schnellen Finden von Schülern, Betrieben, Terminen

## Schnellstart

### Variante 1: All-in-One HTML (empfohlen)

1. `dist/berichtsheftkontrolle.html` auf das Netzlaufwerk kopieren
2. Datei in **Chrome** oder **Edge** öffnen
3. Arbeitsordner auswählen – fertig

### Variante 2: Modulare Entwicklungsversion

1. Gesamten Ordner auf ein Netzlaufwerk kopieren
2. `index.html` in Chrome oder Edge öffnen
3. Arbeitsordner auswählen

## Systemanforderungen

| Anforderung | Details |
|---|---|
| **Browser** | Chrome 86+ oder Edge 86+ (File System Access API) |
| **Internet** | Nicht nötig – alle Libraries lokal eingebettet |
| **Installation** | Keine – läuft auf Zero-Trust-Rechnern ohne Adminrechte |
| **Mehrbenutzerbetrieb** | 2–3 Personen gleichzeitig (Auto-Save + Konflikterkennung) |
| **Datenquelle** | IBYKUS-Export (CSV), SQLite auf Netzlaufwerk |

> **Hinweis:** Firefox und Safari werden nicht unterstützt (fehlende File System Access API).

## Projektstruktur

```
berichtsheftkontrolle/
├── index.html                 ← Entwicklungs-Einstiegspunkt (modulare Version)
├── build.sh                   ← Build-Script → dist/berichtsheftkontrolle.html
├── dist/
│   └── berichtsheftkontrolle.html  ← Produktionsdatei (All-in-One)
├── src/
│   ├── css/styles.css         ← Alle Styles
│   └── js/
│       ├── app-core.js        ← App-Kern: DB, Navigation, Save/Load
│       ├── utils.js           ← Hilfsfunktionen + Init
│       └── modules/           ← 20 Feature-Module (siehe unten)
├── libs/                      ← Externe Libraries (offline-fähig)
├── fonts/                     ← Eingebettete Schriften (BaWue Sans/Serif, lizenzpflichtig – siehe fonts/LIZENZ.md)
├── assets/logo/               ← RPF-Logo (geschützt – siehe assets/logo/LIZENZ.md)
├── backups/                   ← Automatische DB-Sicherungen
├── CLAUDE.md                  ← Entwicklungs-Guide (für KI-gestützte Entwicklung)
└── README.md                  ← Diese Datei
```

## Build

```bash
./build.sh    # → dist/berichtsheftkontrolle.html
```

Baut eine einzelne, offline-fähige HTML-Datei (~5.7 MB) mit allen Libraries, CSS, JS und Fonts inline. Diese Datei kann direkt auf das Netzlaufwerk kopiert werden.

## Tastaturkürzel

| Kürzel | Funktion |
|---|---|
| `Ctrl+K` | Globale Suche |
| `Ctrl+S` | Datenbank speichern |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+←` / `Ctrl+→` | Vorheriger / Nächster Schüler (Kontrolle) |
| `/` | Schüler suchen (Kontrolle) |
| `Alt+1–8` | Schnellnavigation (Dashboard, Stammdaten, …) |
| `F1` oder `?` | Tastenkürzel-Hilfe |
| `F5` | Datenbank von Disk neu laden |
| `Escape` | Modal / Sidebar schließen |

## Datenschutz

- Alle Daten bleiben lokal auf dem Netzlaufwerk
- Kein Server, keine Cloud, kein Netzwerkverkehr
- SQLite-Datenbanken werden nie committed (`.gitignore`)

## Entwicklung

Siehe **[CLAUDE.md](CLAUDE.md)** für den vollständigen Entwicklungs-Guide mit Architektur, Modulübersicht und Coding-Patterns.
