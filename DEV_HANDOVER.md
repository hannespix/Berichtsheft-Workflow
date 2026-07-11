# Ausbildungs-Dashboard V6 — Handover-Dokumentation

**Zweck dieses Dokuments:** Dies ist die Übergabe-Dokumentation des _Ausbildungs-Dashboards V6_ an ein anderes Projekt (Berichtsheftkontroll-Tool in Claude Code). Das Dokument beschreibt, **was das Tool ist**, **wie es funktioniert**, **warum bestimmte Architektur-Entscheidungen getroffen wurden** und **welche Teile für das Übernahmeziel relevant sind**.

Der primäre Integrations-Fokus liegt auf dem **Beratungsmodus** mit dem **Phasenmodell** — dem Kernstück für die Verwaltung komplexer Ausbildungsverläufe.

---

## 1. Was ist dieses Tool?

Ein Single-File-HTML-Dashboard, das die Gärtner-Ausbildung in Baden-Württemberg abbildet. Entwickelt für zwei unterschiedliche Zielgruppen:

**1. Auszubildende selbst** (Modus: `vollstaendig`) — komplettes Tool mit Kalender, Berichtsheft, Wetter, Prüfungsterminen, Vergütungsberechnung.

**2. Ausbildungsberater (hier: RP Freiburg)** (Modus: `beratung`) — reduziertes Tool zur **Verwaltung komplexer Beratungsfälle**: Mehrphasen-Verläufe, Betriebswechsel, Unterbrechungen, Teilzeit ab Datum x, pauschale Fehltage. Kein Berichtsheft, kein Tageskalender.

Die Datei läuft **lokal im Browser** — kein Server, kein Deployment, keine Installation. Alle Daten liegen in einer **SQLite-Datenbank im Browser-Storage** (IndexedDB mit LocalStorage-Fallback), können aber auch als `.db`-Datei exportiert und mit externen Tools (DB Browser for SQLite) geöffnet werden.

### Dateigröße & Tech-Stack
- **~191 KB Single-File-HTML**, ~4100 Zeilen
- **React 18.3.1** via esm.sh + **Babel Standalone 7.26** (JSX wird zur Laufzeit im Browser transformiert)
- **sql.js 1.10.3** (WebAssembly-SQLite) via CDN
- **Tailwind CSS** via Play-CDN, **recharts** für Charts, **lucide-react** für Icons
- **Google Fonts**: Fraunces (Display) + IBM Plex Sans/Mono

Das Tool funktioniert auch offline (nach erstem Laden, CDN-Ressourcen werden gecacht), und der User kann die HTML-Datei per Doppelklick öffnen. Bei Nutzung über `file://` (Chrome blockiert IndexedDB dort manchmal) gibt es einen LocalStorage-Fallback und klare UI-Warnungen, wenn kein persistenter Speicher verfügbar ist.

---

## 2. Entstehungsgeschichte (V1 → V6)

Kurze Evolution, damit du den Kontext hast:

**V1–V3**: Einfacher Ausbildungsrechner (React-Komponente), berechnete statisch Vergütung und Urlaub aus Tarifdaten. Keine Persistenz.

**V4**: React-JSX-Einzelkomponente mit vollständiger Onboarding-UI, Kalender, Berichtsheft. Erste Tarif-Matrix für 7 Gärtner-Fachrichtungen + GaLaBau. Datenhaltung über `window.storage` (proprietäre Claude-Umgebung).

**V5**: Umstieg auf Single-File-HTML mit sql.js + IndexedDB. Alle Features lokal lauffähig. Wetter-Connector (Open-Meteo), Kalender-Berichtsheft-Verknüpfung, Prüfungstermin-Logik mit Feb/Juli-Terminen.

**V6 (aktuell)**: Phasenmodell + Beratungsmodus + robuste Storage-Persistenz. Die _strukturellen_ Änderungen, die V6 von V5 abheben:

1. **Phasenmodell**: Eine Ausbildung ist jetzt eine Liste zeitlicher Abschnitte (Ausbildungsphasen + Unterbrechungen). Alle Berechnungen (Vertragsende, Vergütung, Urlaub, Lehrjahr, Fehltagsbudget) sind _phasen-bewusst_.

2. **Beratungsmodus**: Reduziertes UI ohne Berichtsheft/Kalender, optimiert für schnelle Fallverwaltung.

3. **Robustes Storage**: IndexedDB + LocalStorage-Fallback + explizite UI-Warnung, wenn kein Speicher verfügbar. `beforeunload`-Schutz gegen versehentlichen Tab-Schluss bei ausstehenden Saves.

4. **Konflikt-Erkennung beim Phasen-Anlegen**: Wenn eine neue Phase mit einer bestehenden kollidiert, bietet das System Auflösungs-Optionen (Kürzen / Splitten / Überlappung akzeptieren) plus Undo.

5. **V5→V6-Migration**: Beim ersten Öffnen mit V5-DB wird automatisch eine Initial-Phase aus der alten statischen Config abgeleitet.

---

## 3. Kernkonzept: Das Phasenmodell

**Dies ist der für dein Übernahmeprojekt wichtigste Teil.** Das Phasenmodell ersetzt die frühere statische Vorstellung von "Ausbildung = (Start, Dauer, Teilzeit%)" durch eine _geordnete Liste von Zeitabschnitten_ mit jeweils eigenen Eigenschaften.

### Datenstruktur

```sql
CREATE TABLE phasen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  von TEXT NOT NULL,                  -- ISO-Datum YYYY-MM-DD
  bis TEXT,                            -- ISO-Datum, NULL = "läuft noch"
  typ TEXT NOT NULL CHECK (typ IN ('ausbildung','unterbrechung')),
  betrieb TEXT,                        -- nur bei Ausbildung relevant
  teilzeit_prozent INTEGER,            -- 50..100, nur bei Ausbildung
  grund TEXT,                          -- bei Unterbrechung: "Mutterschutz"/"Krankheit"/...
  pauschal_fehltage_e INTEGER DEFAULT 0,   -- entschuldigte Fehltage (Beratungsmodus)
  pauschal_fehltage_u INTEGER DEFAULT 0,   -- unentschuldigte
  anmerkung TEXT
);
```

### Zwei Phasentypen

**`ausbildung`** — ein Zeitabschnitt, in dem die Ausbildung regulär voranschreitet. Hat einen Betrieb und einen Beschäftigungsumfang (Teilzeit-%). Trägt zur _effektiven Ausbildungszeit_ bei, skaliert mit der Teilzeit-Quote.

**`unterbrechung`** — ein Zeitabschnitt, in dem die Ausbildung _ruht_ (Mutterschutz, Elternzeit, Langzeitkrankheit, Pflegezeit). Trägt **nicht** zur Ausbildungszeit bei, schiebt aber das Vertragsende nach hinten.

### Die offene Phase

Die letzte Phase darf `bis = NULL` haben ("läuft noch"). Ihr Ende wird **automatisch berechnet**: Die Funktion `phasenMitEnden()` addiert die Vollzeit-äquivalente Zeit aller abgeschlossenen Ausbildungsphasen und berechnet dann, wieviel Restzeit (mit der aktuellen TZ-Quote gestreckt) noch nötig ist, um die Soll-Dauer (`regulaer_dauer_monate - verkuerzung_monate`) zu erreichen.

### Beispielverlauf

Jemand startet Ausbildung 1.9.2024, geht Anfang 2026 in Mutterschutz + Elternzeit, kommt Juli 2026 in Teilzeit 75% zurück, wechselt im Januar 2027 den Betrieb:

```
1 | ausbildung  | 2024-09-01 → 2026-01-15 | Betrieb Müller | 100%
2 | unterbrechung | 2026-01-16 → 2026-06-30 | Mutterschutz + Elternzeit
3 | ausbildung  | 2026-07-01 → 2026-12-31 | Betrieb Müller | 75%
4 | ausbildung  | 2027-01-01 → NULL (läuft) | Gartenbau Weber | 75%
```

Das System berechnet automatisch: bisher erbracht 16,5 Monate Vollzeit + 4,5 Monate TZ75 = 19,875 VZ-Monate. Bei 36 Soll-Monaten bleiben 16,125 VZ-Monate, mit TZ75 = 21,5 reale Monate. Also endet Phase 4 automatisch ca. 15.10.2028.

### Zentrale Phasenmathematik

Alle Funktionen in `v6_app.jsx`:

| Funktion | Zweck |
|---|---|
| `phasenSortiert(phasen)` | Nach `von` ISO-lexikografisch sortiert |
| `phasenMitEnden(phasen, regulaerDauer, verkuerzung)` | Berechnet `_berechnetesEnde` und `_vzAequivalent` für jede Phase, löst die offene Phase auf |
| `vertragsendeAusPhasen(phasenMit)` | Sucht das Ende der letzten Ausbildungsphase |
| `aktivePhaseAm(phasenMit, datum)` | Welche Phase ist am Stichtag aktiv? |
| `tatsaechlicheAusbildungsTage(phasenMit)` | Kalendertage in Ausbildungsphasen (ohne Unterbrechungen) — Basis für Fehltagsbudget |
| `pauschaleFehltage(phasen)` | Summiert die pauschalen Fehltage aus allen Phasen |
| `phasenValidieren(phasen)` | Findet Lücken und Überlappungen |
| `phasenKonflikt(alle, neu)` | Prüft beim Anlegen/Bearbeiten, ob eine bestehende Phase vom `von`-Datum betroffen ist, und bietet Auflösungs-Strategien |

### Konflikt-Auflösung beim Phasenanlegen

Wenn eine neue Phase mit einer bestehenden kollidiert, prüft `phasenKonflikt()` und erzeugt bis zu drei Optionen:

1. **Kürzen** (empfohlen): Die bestehende Phase wird auf `neu.von - 1 Tag` gesetzt. Der Standardfall beim nachträglichen Einschub einer neuen Phase.

2. **Splitten**: Wird nur angeboten, wenn die bestehende Phase ein festes `bis` hat, das _nach_ der neuen Phase liegt. Dann wird die bestehende in zwei Teile geteilt, die neue kommt dazwischen. Zum Beispiel für einen befristeten Teilzeit-Einschub mit Rückkehr zu Vollzeit.

3. **Überlappen akzeptieren**: Nichts ändern — die Überlappung wird als Warnung in `phasenValidieren()` angezeigt, aber die Berechnung läuft weiter. Sinnvoll bei noch-unvollständiger Dateneingabe.

Zusätzlich: **Undo-Snapshot**. Nach jeder strukturellen Phasenänderung wird der Zustand davor gespeichert; ein Rückgängig-Button erscheint. Der Snapshot ist session-lokal (verloren nach Reload).

---

## 4. Beratungsmodus vs. Vollständiger Modus

Der Modus wird in `config.modus` gespeichert (`"vollstaendig"` oder `"beratung"`), änderbar im Onboarding (Schritt 1) und in den Einstellungen.

**Unterschiede:**

| Bereich | Vollständig | Beratung |
|---|---|---|
| Onboarding-Schritte | 6 (Modus, Name, Start, Anpassungen, Prüfungen, Standort) | 3 (Modus, Name, Start) |
| Tabs | Übersicht, Kalender, Berichtsheft, Statistik, Einstellungen | Übersicht, Statistik, Einstellungen |
| Heatmap in Übersicht | Ja | Nein |
| Wetter-Connector | Ja | Nein (keine Berichte) |
| Fehltage-Quelle | Tageskalender-Einträge + pauschale Phasen-Fehltage | nur pauschale Phasen-Fehltage |
| Badge im Header | — | Gelber "Beratungsmodus"-Badge |

Für das Übernahmeprojekt (Berichtsheftkontroll-Tool in Claude Code) ist der **Beratungsmodus die primäre Referenz**. Die Bereiche, die dort wichtig sind:

- Onboarding (Modus, Name, Start)
- Einstellungen (Stammdaten, Phasen-Editor)
- Übersicht (Hero-Status, Phasen-Streifen, Vergütung, Fehltage-Gauges)
- Statistik (Export als .db)

---

## 5. Datenmodell im Detail

### SQLite-Schema

```sql
-- Konfiguration (Stammdaten, eine Zeile id=1)
CREATE TABLE config (
  id INTEGER PRIMARY KEY CHECK (id=1),
  name TEXT, beruf_id TEXT, geburtsdatum TEXT, start_datum TEXT,
  regulaer_dauer_monate INTEGER, verkuerzung_monate INTEGER,
  vorzeitige_zulassung INTEGER,     -- § 45 BBiG (0/1)
  teilzeit_prozent INTEGER,         -- Legacy-Feld, Default für erste Phase
  vollzeit_wochenstunden REAL,      -- aus Tarifvertrag
  berufsschule_modus TEXT,          -- 'regulaer' | 'lerntag' | 'keine'
  zp_monat TEXT, ap_monat TEXT,     -- 'YYYY-MM' überschreibt Auto-Vorschlag
  standort_name TEXT, standort_lat REAL, standort_lng REAL,
  modus TEXT                        -- 'vollstaendig' | 'beratung'
);

-- Phasen (s.o.)
CREATE TABLE phasen ( ... );

-- Tageskalender (nur im vollständigen Modus relevant)
CREATE TABLE arbeitstage (
  datum TEXT PRIMARY KEY,           -- ISO
  status TEXT,                       -- 'anwesend'|'urlaub'|'krank'|'berufsschule'|'lerntag'|'ueba'|'feiertag'|'frei'
  stunden REAL,
  bemerkung TEXT
);

-- Tagesberichte (Berichtsheft, nur vollständiger Modus)
CREATE TABLE tagesberichte (
  datum TEXT PRIMARY KEY,
  titel TEXT, taetigkeiten TEXT, lerninhalte TEXT, unterweisung TEXT,
  wetter INTEGER, temperatur REAL, temp_min REAL, temp_max REAL, niederschlag REAL,
  ort TEXT, personen TEXT, werkzeuge TEXT, besonderheiten TEXT,
  stundenvon TEXT, stundenbis TEXT
);

-- Bilder (separat wegen Größe, Base64 als TEXT)
CREATE TABLE bilder (
  id TEXT PRIMARY KEY, bericht_datum TEXT,
  data TEXT,    -- Base64 Original
  thumb TEXT,   -- Base64 Thumbnail ~300px
  name TEXT
);
```

### Warum Base64-TEXT für Bilder statt BLOB?
sql.js kann zwar BLOBs, aber die Interop mit JSON-Transport und Browser-UI wird einfacher, wenn die Bilder als Data-URL-Strings vorliegen. Die ~33% Größenaufschlag sind bei Berichtsheft-Mengen akzeptabel.

---

## 6. Storage-Architektur (kritisch für File-Öffnung)

Das war ein nicht-triviales Problem: Wenn der User die HTML-Datei per Doppelklick öffnet (`file://`-URL), verhält sich der Browser anders als bei `http://`. Chrome/Edge blockieren IndexedDB oft bei `file://`. Lösung:

```javascript
// Dreistufige Backend-Wahl (init im initDatabase):
// 1. Versuche IndexedDB — idbProbe() testet mit Mini-Operation, 2s Timeout
// 2. Fallback LocalStorage (~5 MB Limit, aber zuverlässig bei file://)
// 3. Fallback "none" — UI zeigt rotes Warn-Badge, beforeunload warnt
```

Die abstrahierten Funktionen `storageLoadDb()`, `storageSaveDb()`, `storageLoadMeta()`, `storageSaveMeta()` kapseln die Backend-Wahl — der Rest des Codes merkt davon nichts.

### Auto-Save-Mechanik

Nach jeder Änderung (`dbSaveConfig`, `dbSaveTag`, `dbAddPhase` etc.) wird `persistDb()` aufgerufen. Diese Funktion:

1. Setzt `_pendingSave = true`
2. Debounced 300ms (damit nicht bei Tipp-Events mehrfach serialisiert wird)
3. Exportiert DB zu Bytes, schreibt in gewähltes Backend
4. Notifiziert UI-Listener über den Status (`pending` → `saved` oder `error`)

Der Header rechts oben zeigt je nach Status `"speichere …"`, `"✓ gespeichert"`, `"zuletzt: 14:23"` oder (bei Fehlern) `"Speicherfehler"` / `"Nicht gespeichert"` als rotes Badge.

### beforeunload-Schutz

```javascript
window.addEventListener("beforeunload", e => {
  if (_pendingSave || _storageBackend === "none") {
    e.preventDefault();
    e.returnValue = "Es gibt ungespeicherte Änderungen.";
  }
});
```

---

## 7. Algorithmen: Was wird aus den Phasen berechnet?

Die zentrale Funktion ist `computeKennzahlen(cfg, tage, phasen)` in `v6_app.jsx`. Sie gibt ein Objekt mit allen Dashboards-Kennzahlen zurück.

### Effektives Vertragsende

```javascript
const phasenMit = phasenMitEnden(phasen, cfg.regulaer_dauer_monate, cfg.verkuerzung_monate);
const ende = vertragsendeAusPhasen(phasenMit);
```

### Lehrjahr-Berechnung

Basierend auf **erbrachter VZ-äquivalenter Ausbildungszeit**, nicht mehr auf Kalendermonaten:

```javascript
const erbrachtVZ = phasenMit
  .filter(p => p.typ === "ausbildung" /* geschlossene Phase oder bis heute */)
  .reduce((s, p) => s + (diffMonths(von, heute/bis) * (p.teilzeit_prozent/100)), 0);
const aktLehrjahr = Math.floor((erbrachtVZ + verkuerzung_monate) / 12) + 1;
```

Das ist wichtig bei Teilzeit: Jemand, der mit 50% Teilzeit 12 reale Monate trainiert, ist erst am Ende des 1. Lehrjahres, nicht des 2.

### Fehltagsbudget (§ 43 BBiG-Zulassung)

Gewichtetes Mittel über alle Ausbildungsphasen:

```javascript
const ausbildungsTageGes = tatsaechlicheAusbildungsTage(phasenMit);  // ohne Unterbrechungen
const tzMittel = /* gewichtetes Mittel der TZ-Quoten über alle Ausb.phasen */;
const atGes = Math.round((ausbildungsTageGes / 7) * 5 * tzMittel);   // erwartete Arbeitstage
const fehltageSoft = Math.round(atGes * 0.10);  // 10% Richtwert
const fehltageHart = Math.round(atGes * 0.15);  // 15% kritischer Wert
```

Die tatsächlich genommenen Fehltage kommen aus `tage` (Tageskalender) + `pauschaleFehltage(phasen).summe`.

### Vergütungsperioden mit Phasen

`berechneVerguetungsUebersichtPhasen(cfg, phasenMit)` durchläuft alle Phasen:

- **Unterbrechungsphasen** erzeugen Perioden-Zeilen mit `vergEff = 0` und `grund` (z.B. "Mutterschutz").
- **Ausbildungsphasen** werden an den Breakpoints (Lehrjahres-Wechsel basierend auf erbrachter VZ-Zeit, Tariftermine, Mindestvergütungs-Stichtage, Jahreswechsel) in Unter-Perioden zerlegt.
- Jede Unter-Periode bekommt Lehrjahr, Tarif-Vergütung (aus der Tariftabelle), Teilzeit-Quote der Phase, Betrieb der Phase, anteiligen Urlaub.
- Anschließend werden benachbarte Perioden mit gleichen Werten gemerged.

Das Ergebnis: Eine korrekte zeitliche Aufschlüsselung der Brutto-Vergütung über die gesamte Ausbildung, auch bei Betriebs- und Teilzeitwechseln.

### Prüfungstermine (ZP, AP)

Baden-Württembergische Landwirtschafts-Zuständige-Stelle prüft **zwei Mal jährlich**: Februar (Winterprüfung) und Juli (Sommerprüfung).

- `zpTerminAuto(start, dauer)` — Feb/Juli-Termin, der der Ausbildungsmitte (14/36 der Dauer) am nächsten liegt.
- `apTerminAuto(vertragsende, vorzeitig)` — letzter Feb/Juli-Termin, der `<= Vertragsende + 14 Tage` liegt. Bei vorzeitiger Zulassung (§ 45 BBiG) der Termin davor.

Der User kann diese Auto-Vorschläge im Onboarding und in den Einstellungen überschreiben (`zp_monat`, `ap_monat` in `config`), die Auto-Logik merkt sich mittels useRef den zuletzt gesetzten Vorschlag und aktualisiert nur dann, wenn der aktuelle Wert noch dem letzten Vorschlag entspricht (also nicht manuell überschrieben wurde).

### Tarifvergütung-Matrix

In `v6_app.jsx` als `const BERUFE = [...]`. Jeder Eintrag hat eine `tarife`-Liste mit `{ ab: "YYYY-MM-DD", lj1, lj2, lj3 }` — die Vergütung gilt ab dem Stichtag (Ausbildungsbeginn entscheidet). Fachrichtungen: Zierpflanzen, Staudengärtner, Baumschule, Obstbau, Gemüsebau, Friedhofsgärtner, Produktion+GaLaBau, GaLaBau separat.

**Mindestvergütung § 17 BBiG**: `const MINDESTVERGUETUNG = [...]` mit jährlich aktualisierten Sätzen pro Lehrjahr, greift wenn Tarif darunter liegt.

### Urlaub § 19 JArbSchG

Bei Jugendlichen mehr Urlaub: `getJahresurlaub(beruf_id, geburtsdatum, jahr)` — Altersstichtag ist der 1.1. des betreffenden Jahres. 18 Jahre: 27 Tage, 17: 28, 16: 29, 15: 30.

---

## 8. UI-Architektur

React-Single-Page-App mit einer zentralen `App`-Komponente (Zeile ~1113). State-Management:

```javascript
const [config, setConfig] = useState(null);
const [phasen, setPhasen] = useState([]);
const [tage, setTage] = useState({});
const [berichte, setBerichte] = useState([]);
const [tab, setTab] = useState("uebersicht");
const [persistInfo, setPersistInfo] = useState({ backend: "unknown", ... });
// ... weitere States für Save-Status, Navigation, etc.
```

### Komponenten-Hierarchie (Beratungs-relevanter Teil)

```
App
├── Header           — Titel, Fach, Name, Save-Status-Badge
├── Nav              — Tabs (Kalender/Berichte ausgeblendet im Beratungsmodus)
└── main
    ├── Onboarding (wenn config == null)
    │   ├── ModusAuswahl
    │   ├── Willkommen (Name)
    │   ├── FachrichtungStart
    │   ├── AnpassungsPanel (voll)
    │   ├── PruefungsPanel (voll)
    │   └── StandortFeld (voll)
    │
    ├── Uebersicht (tab: uebersicht)
    │   ├── HeroStatus         — Fortschritt, aktuelles Lehrjahr, nächster Meilenstein
    │   ├── PhasenStreifen     — horizontaler Bar-Chart der Phasen, mit Betriebswechsel-Markern
    │   ├── PhasenFlow         — Flowchart der Lehrjahr-Meilensteine
    │   ├── TimelineErweitert  — Zeitstrahl mit ZP, AP, Prüfungen
    │   ├── GaugeCards         — Urlaub, Fehltage, Zeit
    │   ├── RisikoRadar        — mehrdimensionale Risiken
    │   ├── VerguetungsPerioden — Tabelle mit Unterbrechungs-Zeilen, Betrieben
    │   └── Heatmap (nur vollst.) — 26-Wochen-Kalenderheatmap
    │
    ├── Statistik (tab: statistik)
    │   └── Export-Buttons (.db, JSON, SQL-Dump), DB-Info, Import, Reset
    │
    └── Einstellungen (tab: einstellungen)
        ├── Modus-Umschalter
        ├── Ausbildungsanpassungen (Verkürzung, Teilzeit-Default, vorzeitige Zulassung)
        ├── Stammdaten (Name, Fachrichtung, Start, Geburt, Dauer, Wochenstunden)
        ├── Berufsschule & Prüfungen (mit Auto-Vorschlag)
        ├── Standort (Wetter-Connector)
        └── PhasenEditor              ← zentral für Beratungsmodus
            ├── PhasenZeile (pro Phase)
            └── PhasenDialog (Add/Edit)
                ├── Typ-Auswahl (Ausbildung/Unterbrechung)
                ├── Datum von/bis
                ├── Konflikt-Erkennung + Auflösungs-Optionen
                ├── Betrieb, Teilzeit-Slider, Fehltage (bei Ausbildung)
                └── Grund-Dropdown (bei Unterbrechung)
```

### PhasenStreifen — die wichtigste Visualisierung

In der Übersicht zentral: ein horizontaler Balken vom Ausbildungsstart bis zum berechneten Ende. Jede Phase ist ein farbiger Block:

- **Dunkelgrün** (#2d5a3d) — Vollzeit
- **Hellgrün** (#7a9a5a) — Teilzeit (Balken kleiner in der Höhe, proportional zur TZ-Quote)
- **Grau-diagonal-gestreift** (#9a8a6a) — Unterbrechung
- **Goldene Vertikallinien mit 🏢-Icon** — Betriebswechsel zwischen aufeinanderfolgenden Phasen
- **Rote Vertikallinie mit "heute"-Label** — aktuelles Datum

Darüber steht der aktuelle Status (`"Aktuell: 75% · Gartenbau Müller GmbH"`). So sieht der Berater auf einen Blick den gesamten Verlauf.

---

## 9. Sitemap / Wichtige Code-Stellen

Für die Übernahme relevante Stellen in `v6_app.jsx` (Zeilennummern circa, können sich leicht verschieben):

| Zeile | Inhalt |
|---|---|
| ~17–120 | Storage-Layer (IndexedDB + LocalStorage-Fallback) |
| ~120–330 | SQLite-Initialisierung, Schema, Migrationen, persistDb |
| ~335–420 | Helper: Datums-Funktionen, Prüfungstermine-Logik |
| ~420–560 | **Phasen-Mathematik** — phasenMitEnden, vertragsendeAusPhasen, aktivePhaseAm, tatsaechlicheAusbildungsTage, pauschaleFehltage, phasenValidieren |
| ~660–720 | DEFAULT_CONFIG, BERUFE-Matrix |
| ~720–920 | Vergütungs- und Urlaubsberechnung (phasen-bewusst) |
| ~920–1080 | computeKennzahlen (die zentrale Aggregation) |
| ~1113–1250 | App-Komponente (State, useEffect, save/load-Funktionen) |
| ~1250–1450 | DbError, Loading, DbStatusBanner, WelcomeScreen, Header |
| ~1450–1520 | Nav |
| ~1250–1420 | Onboarding + ModusAuswahl |
| ~1610–2000 | **Übersicht + PhasenStreifen + HeroStatus** |
| ~2000–2100 | VerguetungsPerioden-Tabelle |
| ~2100–2400 | Heatmap, Statistik |
| ~2400–3000 | Kalender, TagDialog, Berichte, BerichtDialog (nur vollständiger Modus) |
| ~3009–3660 | **Einstellungen + alle Panels** |
| ~3665–3800 | **PhasenEditor** — Liste, Validierung, Undo |
| ~3800–3980 | **PhasenDialog + phasenKonflikt + beschreibPhase** |

---

## 10. Integrationshinweise für das Claude-Code-Projekt

### Was du wahrscheinlich übernehmen willst

Kern-Bausteine für die Beratungsfall-Verwaltung:

1. **SQLite-Schema `phasen` 1:1 übernehmen** — ist ausgereift, deckt alle Fälle ab.

2. **Phasen-Mathematik** (Helper-Funktionen ab ~420) **1:1 übernehmen** — diese sind reine Funktionen ohne UI-Abhängigkeiten, arbeiten auf einfachen JS-Objekten.

3. **PhasenEditor + PhasenDialog + phasenKonflikt** als Referenz-Implementation der Bedien-Logik. Das UI-Styling musst du an dein Tool anpassen, aber die Datenflüsse und Konflikt-Auflösung sind gut durchdacht.

4. **PhasenStreifen-Visualisierung** — die horizontale Bar-Grafik lässt sich gut isolieren. Abhängigkeiten: nur `phasenMitEnden`, `vertragsendeAusPhasen`, `fmtDE`, `parseISO`, `diffMonths`.

5. **Vergütungs-Mathematik** (`berechneVerguetungsUebersichtPhasen`) — falls du die Vergütungsdimension abbilden willst. Braucht die Tarifdaten (`BERUFE`, `MINDESTVERGUETUNG`).

### Was du vermutlich NICHT übernehmen willst

- Berichtsheft-Code (Tagesberichte, Bilder, Wetter-Connector, PrintWoche) — das ist dein eigenes Thema
- Tageskalender-UI (`Kalender`, `TagDialog`)
- Prüfungstermin-Auto-Berechnung — falls dein Tool andere Termine verwaltet
- Onboarding-UI — du hast eigenes

### Was aufpassen / anpassen

- **Keine Service Worker** — sql.js funktioniert nicht mit Service Workern (WASM-Loading).
- **Kein localStorage-Leak** — wenn du LocalStorage-Fallback übernimmst, die Keys namespacen.
- **Datum-Format**: alles ISO `YYYY-MM-DD` als Strings, `parseISO(s)` und `fmtISO(d)` für Konvertierung. Kein Luxon/Moment.
- **Konfliktlösung-Logik** ist bewusst session-lokal für Undo — wenn du persistente Undo brauchst, müsstest du eine History-Tabelle nachziehen.
- **Phasen-Reihenfolge**: Die Funktionen erwarten _sortierte_ Phasen (nach `von`). `phasenSortiert()` liefert das, alle anderen Funktionen rufen das intern auf oder bekommen bereits sortierte Listen.

### Dependencies aus dem Single-File-HTML

Falls du als React-Modul in Claude Code arbeitest, brauchst du:

- `react@18.3.1`, `react-dom@18.3.1`
- `lucide-react` (die in diesem Tool verwendeten Icons auflisten: Sprout, Calendar, NotebookPen, BarChart3, Settings, GraduationCap, Flag, AlertTriangle, Clock, Plus, Trash2, Edit3, X, MapPin, ChevronLeft, ChevronRight, RefreshCw, LinkIcon, FileText — etwa 30 Icons insgesamt)
- `recharts` (falls du die Charts übernimmst)
- `sql.js` (wenn du SQLite nutzt — alternativ IndexedDB direkt oder REST-Backend)
- Tailwind CSS

### Test-Beispiele für Phasen-Logik

Bevor du die Helper übernimmst, kannst du damit testen:

```javascript
// Minimaler Testfall: Einfache Vollzeit-Ausbildung
const phasen1 = [{ id: 1, von: "2024-09-01", bis: null, typ: "ausbildung", teilzeit_prozent: 100 }];
const mit1 = phasenMitEnden(phasen1, 36, 0);
// → Erwartet: _berechnetesEnde ca. "2027-09-01", _vzAequivalent ca. 36

// Mit Unterbrechung und Teilzeit:
const phasen2 = [
  { id: 1, von: "2024-09-01", bis: "2026-01-15", typ: "ausbildung", teilzeit_prozent: 100 },
  { id: 2, von: "2026-01-16", bis: "2026-06-30", typ: "unterbrechung", grund: "Mutterschutz" },
  { id: 3, von: "2026-07-01", bis: null, typ: "ausbildung", teilzeit_prozent: 75 },
];
const mit2 = phasenMitEnden(phasen2, 36, 0);
// → Erwartet: erbrachtVZ ~16.5, restVZ ~19.5, restRealMonate ~26, Ende ca. "2028-09-01"

// Konflikterkennung:
const neu = { von: "2025-05-01", bis: "", typ: "ausbildung", teilzeit_prozent: 75 };
const konflikt = phasenKonflikt(phasen1, neu);
// → Erwartet: konflikt.konflikt.id === 1, optionen enthält "kuerzen" (empfohlen) und "ueberlappen"
```

---

## 11. Bekannte Einschränkungen und TODOs

Dinge, die in V6 noch nicht drin sind, aber bei komplexeren Fällen auftauchen können:

- **§ 8 Abs. 2 BBiG Verlängerung** (nach langer Krankheit — aktuell über Unterbrechung+Verlängerung der offenen Phase abbildbar, aber kein dediziertes Feld)
- **§ 21 Abs. 3 BBiG Wiederholungsprüfung** — kein eigenes UI
- **Probezeit** (§ 20 BBiG, 1–4 Monate) als eigene Markierung
- **Fachrichtungswechsel** mit Tarifumstellung mitten in der Ausbildung
- **Stufenausbildung** Werker → Gärtner mit Anrechnung
- **Auslandsaufenthalt** nach § 2 Abs. 3 BBiG (Anrechnung bis 1/4 der Ausbildungszeit)
- **Mehrere Profile** — aktuell eine Config pro Browser-Storage; für Berater mit vielen Fällen wäre Multi-Profil nötig

Für den Claude-Code-Kontext empfehle ich, **Multi-Profil als erstes anzugehen**, weil das der Hauptgrund sein dürfte, warum du es integrierst. Eine Möglichkeit: statt `config (id=1)` eine `faelle (id, name, angelegt_am, ...)`-Tabelle, und Phasen/Tage/etc. per `fall_id` foreign-key.

---

## 12. Kontakt & Kontext

**Entwickler:** Hannes Pix, Ausbildungsberater Gartenbau beim RP Freiburg (Referat 31).

**Primärer Anwendungsfall:** Ausbildungsverträge prüfen, Zulassungsvoraussetzungen für § 43 BBiG-Prüfungen feststellen, Verläufe mit Unterbrechungen und Betriebswechseln nachvollziehen.

**Rechtliche Grundlagen, die das Tool abbildet:**
- BBiG §§ 7a (Teilzeit), 8 (Verkürzung), 17 (Mindestvergütung), 20 (Probezeit), 21 (Vertragsende), 43 (Zulassung), 45 (vorzeitige Zulassung)
- JArbSchG § 19 (Urlaub Jugendlicher)
- GärtnAusbV §§ 9–15 (Prüfungsstruktur, Bestehensregeln)
- Tarifverträge Landwirtschaft BW, Gartenbau BW, GaLaBau Bundesrahmen

**Infrastruktur am RP Freiburg** (für Kontext): das Tool muss mit vorhandenen Werkzeugen auskommen (keine neuen Software-Installationen möglich) — deshalb bewusst Single-File-HTML, das man einfach auf P-Laufwerk oder BW-Share (Nextcloud) ablegen kann.

---

**Viel Erfolg mit der Integration. Wenn Fragen zu einzelnen Berechnungen oder Edge-Cases auftreten, sind die reinen Helper-Funktionen in `v6_app.jsx` die beste Referenz — sie sind bewusst seiten-effektfrei und arbeiten auf einfachen JS-Objekten, lassen sich also isoliert testen.**
