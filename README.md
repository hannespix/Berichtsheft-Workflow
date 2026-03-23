# Berichtsheftkontrolle

## Ausbildungsberater Gärtner – RP Freiburg

Verwaltungstool zur Planung, Durchführung und Nachverfolgung von Berichtsheftdurchsichten.

### Schnellstart

1. **Ordner** komplett auf ein gemeinsames Netzlaufwerk kopieren
2. **`index.html`** in Chrome oder Edge öffnen
3. Arbeitsordner auswählen - fertig!

### Systemanforderungen

- **Browser**: Chrome 86+ oder Edge 86+ (File System Access API)
- **Netzwerk**: Kein Internet nötig (alle Libraries lokal eingebettet)
- **Installation**: Keine - läuft auf Zero-Trust-Rechnern ohne Adminrechte

### Projektstruktur

```
├── index.html              ← Einstiegspunkt
├── src/
│   ├── css/styles.css      ← Styles
│   └── js/
│       ├── app-core.js     ← App-Kern (DB, Navigation, Save/Load)
│       ├── utils.js        ← Hilfsfunktionen
│       └── modules/        ← 20 Feature-Module
├── libs/                   ← Externe Libraries (offline-fähig)
└── backups/                ← Automatische Sicherungen
```

### Entwicklung

Siehe [CLAUDE.md](CLAUDE.md) für den vollständigen Entwicklungs-Guide.

**Kein Build-Prozess nötig** – Änderungen an `.js`/`.css`-Dateien sind sofort wirksam. Einfach im Browser neu laden.

### Datenschutz

- Alle Daten bleiben lokal auf dem Netzlaufwerk
- Kein Server, keine Cloud, kein Netzwerkverkehr
- SQLite-Datenbank wird nie committed (`.gitignore`)

---
Regierungspräsidium Freiburg - Abteilung 3 / Referat 31
