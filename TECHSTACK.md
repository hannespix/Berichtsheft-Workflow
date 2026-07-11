# Tech-Stack Referenz: Browser-basierte Verwaltungstools

> Referenzdokument fuer zukuenftige Projekte am Regierungspraesidium Freiburg.
> Basierend auf der Berichtsheftkontrolle (Ausbildungsberater Gaertner).

## 1. Architektur-Uebersicht

### Warum Single-HTML-Datei?
- **Zero-Trust Windows-PCs** ohne Admin-Rechte: Kein `npm install`, kein Node.js, kein Build-Server
- **Netzlaufwerk-Deployment**: Eine Datei kopieren = fertig. Kein Webserver noetig.
- **Offline-faehig**: Alle Libraries, Fonts, WASM inline eingebettet
- **Update**: Datei ueberschreiben, F5 druecken

### Warum Plain JS statt React/Vue?
- Kein Build-Tooling moeglich (kein npm auf Dienstrechnern)
- Keine Transpiler-Abhaengigkeit (kein Babel, kein Webpack)
- Globale Objekte (`const App = {...}`) statt ES-Module
- Direkt im Browser debugbar (DevTools → Sources)

### Warum SQLite im Browser?
- Relationale Datenbank mit SQL — maechtig, bekannt, zuverlaessig
- `sql-wasm.js` = SQLite kompiliert nach WebAssembly (~640KB)
- In-Memory DB mit File System Access API fuer Persistenz
- Multi-User moeglich (Polling + Merge statt Live-Sync)

### Warum File System Access API?
- Direkter Lese-/Schreibzugriff auf Netzlaufwerk-Dateien
- User muss Ordner explizit freigeben (Sicherheit)
- Kein Upload/Download — Datei wird direkt geschrieben
- Nur Chrome/Edge (kein Firefox/Safari)

---

## 2. Technologie-Stack

| Library | Zweck | Groesse | Warum gewaehlt |
|---------|-------|---------|----------------|
| **sql-wasm.js** + `.wasm` | SQLite im Browser | ~640KB | Einzige produktionsreife Browser-SQLite |
| **PapaParse** | CSV-Parser | ~50KB | Schnell, robust, Auto-Delimiter-Erkennung |
| **SheetJS (xlsx)** | Excel-Export | ~400KB | .xlsx Erzeugung ohne Server |
| **jsPDF** + autoTable | PDF-Erzeugung | ~300KB | DIN A4 PDFs direkt im Browser |
| **PizZip + docxtemplater** | Word/DOCX-Templates | ~200KB | Serienbriefe mit Platzhaltern |
| **FileSaver.js** | Datei-Download | ~5KB | Cross-Browser Blob-Download |
| **pdf.js** | PDF-Lesen/Analyse | ~1.1MB | Blockplan-PDFs einlesen |
| **Chart.js** | Diagramme | ~200KB | Einfache, responsive Charts |

**Alle Libraries liegen als einzelne Dateien in `libs/`** — kein CDN, kein Internet noetig.

---

## 3. Datenbank-Architektur

### 3.1 In-Memory SQLite + File System

```
              ┌─────────────────┐
              │   Browser-Tab   │
              │                 │
              │  ┌───────────┐  │
              │  │ In-Memory │  │     File System
              │  │  SQLite   │◄─┼──── Access API ────► Netzlaufwerk
              │  │   (RAM)   │  │                      /Datenbanken/
              │  └───────────┘  │                      bhk.sqlite
              └─────────────────┘
```

**Ablauf:**
1. User waehlt Arbeitsordner (File System Access API)
2. App liest `.sqlite` Datei als `Uint8Array`
3. `new SQL.Database(bytes)` laedt DB in den RAM
4. Alle Queries laufen gegen die In-Memory DB (schnell!)
5. Aenderungen werden periodisch zurueck auf die Datei geschrieben

### 3.2 Laden der Datenbank

```javascript
// File System Access API: Ordner oeffnen
const dirHandle = await window.showDirectoryPicker();

// SQLite-Datei lesen
const dbDir = await dirHandle.getDirectoryHandle('Datenbanken');
const fileHandle = await dbDir.getFileHandle('bhk.sqlite');
const file = await fileHandle.getFile();
const bytes = new Uint8Array(await file.arrayBuffer());

// In-Memory DB erstellen
const SQL = await initSqlJs({ locateFile: f => 'libs/' + f });
const db = new SQL.Database(bytes);
```

### 3.3 Speichern (mergeAndSave)

Zwei Speicher-Strategien:

**fullSave()** — Komplette DB auf Disk schreiben:
```javascript
const bytes = db.export(); // Uint8Array
const writable = await fileHandle.createWritable();
await writable.write(bytes);
await writable.close();
```

**mergeAndSave()** — Intelligent mergen (Multi-User):
```javascript
// 1. Disk-DB frisch laden
const diskBytes = await fileHandle.getFile().arrayBuffer();
const diskDb = new SQL.Database(new Uint8Array(diskBytes));

// 2. Schema-Migration auf Disk-DB anwenden
this._migrateDiskDb(diskDb);

// 3. Dirty-Ops (eigene Aenderungen seit letztem Save) auf Disk-DB abspielen
this._dirtyOps.forEach(op => {
  try { diskDb.run(op.sql, op.params); } catch(e) {}
});

// 4. Disk-DB zurueck schreiben
const merged = diskDb.export();
await writable.write(merged);

// 5. Disk-DB in den RAM importieren (Aenderungen anderer User uebernehmen)
this._importFromDisk(diskDb);

// 6. Dirty-Ops leeren
this._dirtyOps = [];
```

### 3.4 Dirty-Ops Pattern

Jedes `App.run(sql, params)` speichert den Befehl:

```javascript
run(sql, params) {
  this.db.run(sql, params);
  // Dirty-Op merken (fuer naechsten mergeAndSave)
  if (!this._bulkImport) {
    this._dirtyOps.push({ sql, params, t: Date.now() });
  }
}
```

Dirty-Ops werden beim naechsten `mergeAndSave()` auf die Disk-DB replayed und dann geleert.

### 3.5 Schema-Migrationen (WICHTIG!)

**Bei jeder Schema-Aenderung muessen ZWEI Stellen gepflegt werden:**

```javascript
// 1. migrateDB() — Auf der In-Memory DB (beim App-Start)
migrateDB() {
  try {
    this.db.run("ALTER TABLE schueler ADD COLUMN neues_feld TEXT DEFAULT ''");
  } catch(e) {} // Ignoriert "duplicate column" Fehler
}

// 2. _migrateDiskDb(diskDb) — Auf der Disk-DB (vor jedem mergeAndSave)
_migrateDiskDb(diskDb) {
  const run = (sql) => {
    try { diskDb.run(sql); } catch(e) {}
  };
  run("ALTER TABLE schueler ADD COLUMN neues_feld TEXT DEFAULT ''");
}
```

**Warum beides?** Die In-Memory DB hat das neue Schema (durch migrateDB beim Start). Aber die Disk-DB auf dem Netzlaufwerk kann aelter sein (anderer User hat noch nicht aktualisiert). Wenn mergeAndSave die Dirty-Ops auf die Disk-DB replayed, muss die Disk-DB das gleiche Schema haben.

### 3.6 Multi-User Synchronisation (Sync-v3: Append-only Op-Logs)

**Architekturprinzip: Ein Writer pro Datei.** Kein Client schreibt im
Normalbetrieb auf eine geteilte Datei — damit sind Lost Updates, Locks und
Schreib-Races konstruktionsbedingt eliminiert:

```
    Client A                    Netzlaufwerk                   Client B
    ┌──────────┐    append     ┌────────────────────┐  append  ┌──────────┐
    │ In-Memory│ ─────────────►│ oplog_db_A.jsonl   │◄──────── │ In-Memory│
    │  SQLite  │               │ oplog_db_B.jsonl   │          │  SQLite  │
    │          │◄──── poll ────│                    │─ poll ──►│          │
    └──────────┘  (fremde Logs)│ db.sqlite=SNAPSHOT │          └──────────┘
                               │ snapmeta_db.json   │
                               └────────────────────┘
```

- **Schreiben** = eigene Ops (SQL + Parameter + UID + Zeitstempel) als
  JSONL-Zeilen an die EIGENE Log-Datei anhängen (`oplog_<db>_<clientId>.jsonl`)
- **Lesen** = alle 3s fremde Logs ab gemerktem Byte-Offset einlesen und die
  Ops zeitstempel-geordnet auf die eigene In-Memory-DB anwenden (LWW-Guard
  verhindert, dass verspätete Offline-Ops neuere Daten überschreiben)
- **Snapshot** = die `.sqlite`-Datei; wird nur bei der KOMPAKTIERUNG
  beschrieben (Logs > 1,5 MB, nach IBYKUS-Import, nach dem Start) — dann mit
  Lock, Timeout und Zombie-Write-Abort. `snapmeta_<db>.json` merkt sich, bis
  zu welchem Byte-Offset jedes Log im Snapshot enthalten ist
- **Log-Rotation**: deckt der Snapshot das eigene Log vollständig ab, leert
  der Besitzer seine Datei selbst (weiterhin: nur der Besitzer schreibt sie)
- **Start** = Snapshot laden + alle Logs ab snapmeta-Offsets anwenden
- **Id-Divergenz unmöglich**: INSERTs tragen global eindeutige zeitbasierte
  IDs; Ops auf die Hotspot-Tabellen adressieren per natürlichem Schlüssel;
  FK-Verweise auf Kontrollergebnisse reisen als Natural-Key-Subselect und
  werden beim Empfänger gegen DESSEN lokale Zeile aufgelöst
- Verifiziert durch `node tests/sync-test.mjs` (3 simulierte Clients + Fake-
  Netzlaufwerk, 28 Assertions: Races, Löschungen, Doppel-Apply, Kompaktierung,
  Rotation, Bootstrap)

Der ältere Merge-Pfad (v2: Dirty-Op-Replay auf die geteilte Datei mit Lock +
Marker) bleibt als Fallback erhalten, wenn kein Ordner-Handle verfügbar ist,
und liefert die Schreib-Maschinerie für die Kompaktierung.

### 3.6b Multi-User Synchronisation (Legacy v2 — Fallback)

```
    User A (Chrome)              Netzlaufwerk              User B (Chrome)
    ┌──────────┐                ┌──────────┐               ┌──────────┐
    │ In-Memory│   mergeAndSave │          │  mergeAndSave  │ In-Memory│
    │    DB    │ ──────────────►│ bhk.sqlite│◄──────────────│    DB    │
    │          │◄────────────── │          │ ──────────────►│          │
    │          │  _importFromDisk│          │ _importFromDisk│          │
    └──────────┘                │ _bhk/    │               └──────────┘
                                │ sync_*   │
                                │ pos_*    │
                                │ lock_*   │
                                └──────────┘
```

**Polling-Zyklus (alle 8 Sekunden):**
1. Sync-Marker pruefen (`_bhk/sync_<pruefer>`)
2. Wenn Marker neuer als letzter Import → `mergeAndSave()`
3. Eigene Aenderungen schreiben + fremde Aenderungen importieren
4. Eigenen Sync-Marker aktualisieren

**Sperrsystem:**
- `_bhk/pos_<pruefer>.json` — Welchen Schueler bearbeitet User gerade
- Andere User sehen ein Lock-Symbol bei gesperrten Datensaetzen
- Locks verfallen nach 30 Minuten (Timeout)

**Conflict Resolution:**
- Letzte Aenderung gewinnt (Last-Writer-Wins)
- Schueler-spezifisch: Dirty-Ops eines Users werden nicht ueberschrieben wenn der User gerade den Schueler bearbeitet
- Kein echtes Locking auf DB-Ebene (SQLite = Single-Writer, aber wir schreiben sequentiell)

**Schutzmechanismen im Schreibpfad (Stand Audit Juli 2026):**
- Lock-Datei mit Nonce + Doppel-Verify (Jitter) gegen gleichzeitigen Lock-Gewinn;
  Staleness 150s bewertet Client-Timestamp UND Datei-mtime (Clock-Skew-Schutz);
  Heartbeat frischt das Lock vor der Schreibphase auf; fail-closed bei Lock-Fehlern
- Write-Timeout ruft `writable.abort()` auf (verwirft die Swap-Datei) — sonst
  koennte ein haengender "Zombie-Write" spaeter den Save eines anderen Nutzers ersetzen
- `fullSave()` (nach IBYKUS-Import) faehrt dasselbe Lock+Marker-Protokoll wie `mergeAndSave()`
- Marker-Retry uebernimmt das fremde Token vor dem Neuversuch (kein Livelock);
  Retries laufen via `setTimeout` NACH dem finally (Lock-Ownership bleibt konsistent)
- Sync-Marker wird awaited VOR dem Lock-Release geschrieben
- `datetime('now')` wird beim Erfassen von Dirty-Ops als Literal eingefroren
  (Replay wuerde sonst abweichende Zeitstempel erzeugen und die LWW-Aufloesung kippen)
- kw_status-Schreiber nutzen UPSERT (`ON CONFLICT ... DO UPDATE`) — Replay ist
  idempotent gegen den UNIQUE-Index, auch wenn ein anderer Nutzer die Zeile zuerst anlegte

**Sync-v2 (Juli 2026) — strukturelle Absicherung, per Zwei-Client-Testharness verifiziert:**
- **Globale IDs**: INSERTs auf allen relevanten Tabellen bekommen eine clientseitig
  vergebene, zeitbasierte eindeutige INTEGER-ID (`App.newId()`, ~1.7e15 « 2^53) —
  parallele INSERTs zweier Nutzer koennen nicht mehr dieselbe ID belegen
- **Natural-Key-Replay**: UPDATE/DELETE-Ops auf kontrollergebnisse/kw_status werden
  im Replay ueber den natuerlichen Schluessel adressiert (id-divergenzfest)
- **KE-Id-Reconciliation**: verliert ein Client das Auto-Anlage-Race (INSERT OR
  IGNORE), uebernimmt er die Disk-id lokal inkl. aller FK-Verweise + pendenter Ops
- **Tombstones** (`bhk_tombstones`): Loeschungen propagieren zu allen Clients und
  geloeschte Zeilen werden nicht durch den additiven Import re-animiert (60 Tage TTL)
- **Idempotenz-Ledger** (`bhk_applied_ops`): jede Op traegt eine UUID; nach Crash/
  Retry werden bereits angewendete Ops beim Replay uebersprungen (kein Doppel-Apply)
- **Retry-Schleife statt Rekursion**: mergeAndSave/fullSave behalten await-Semantik;
  Lock-Ownership gilt exakt pro Versuch
- **Tab-Guard** (Web Locks API): Zweit-Tab derselben DB wird gewarnt und vom
  IndexedDB-Crash-Store (jetzt pro DB-Datei namespaced) ausgeschlossen
- Testharness: `node tests/sync-test.mjs` — simuliert 2 Clients + Netzlaufwerk in
  Node (Fake File System Access API) und fährt die komplette Pipeline durch

**Bekannte Grenzen (dokumentiert, bewusst nicht behoben):**
- Stammdaten-Sync ist minimal: `schueler` nur als INSERT (neue Zeilen, alle Spalten),
  UPDATEs an schueler/betriebe/klassen/berufsschulen/ausbilder werden nicht gemerged —
  letzter Formular-Save gewinnt zeilenweise
- Einstellungs-JSONs (Textbausteine, Tarife) werden als Ganzes ersetzt (kein Feld-Merge)
- Loeschung vs. paralleler Edit: die Loeschung gewinnt (Tombstone), der Edit geht verloren

### 3.7 Datei-Struktur auf dem Netzlaufwerk

```
Arbeitsordner/
├── Datenbanken/                    ← SQLite-Dateien (eine pro Datenbank)
│   └── bhk.sqlite                  ← Aktive Datenbank
├── _bhk/                           ← App-Daten (nicht manuell aendern!)
│   ├── sync_hannes_pix             ← Sync-Marker (wer hat zuletzt gespeichert)
│   ├── sync_christoph_zilz
│   ├── pos_hannes_pix.json         ← Position (welcher Schueler wird bearbeitet)
│   ├── lock_hannes_pix.json        ← Lock-File
│   └── backups/                    ← Automatische DB-Backups (max 10)
│       └── bhk_2026-04-27T14-30.sqlite
├── dateien/                        ← Datei-Anhaenge (pro Schueler-ID)
│   ├── 42/                         ← Dateien fuer Schueler ID 42
│   └── 87/
└── berichtsheftkontrolle.html      ← Die App (Single-File)
```

---

## 4. Build-Prozess

```bash
#!/bin/bash
# build.sh — Erzeugt dist/berichtsheftkontrolle.html

# 1. CSS einbetten (Base64 oder inline)
# 2. Fonts als Base64 Data-URLs
# 3. WASM als Base64
# 4. PDF-Worker als Base64
# 5. Alle JS-Libraries zusammenfuegen
# 6. Alle App-Module in korrekter Reihenfolge
# 7. HTML-Huelle drumherum

APP_MODULES=(
  "src/js/app-core.js"          # Muss ERSTE sein (definiert App-Objekt)
  "src/js/utils.js"             # Muss VOR allen Modulen (esc(), todayStr())
  "src/js/modules/views.js"     # Views (Dashboard, Hilfe etc.)
  "src/js/modules/stammdaten.js"
  "src/js/modules/import-handler.js"
  # ... weitere Module ...
  "src/js/modules/azubi-rechner.js"   # VOR azubi-dashboard (Abhaengigkeit)
  "src/js/modules/azubi-dashboard.js" # Nutzt AzubiRechner
)
```

**WICHTIG: Reihenfolge der Script-Tags bestimmt Abhaengigkeiten!**
- `app-core.js` definiert das `App`-Objekt → muss zuerst
- `utils.js` definiert `esc()`, `todayStr()` → muss vor allen Modulen
- Module die andere Module nutzen → muessen danach kommen

---

## 5. Modul-Architektur

### Pattern: Globales Objekt

```javascript
// src/js/modules/mein-modul.js
const MeinModul = {

  // Daten rendern (wird von App.renderCurrentView() aufgerufen)
  render() {
    const mc = document.getElementById('mainContent');
    mc.innerHTML = `<div class="fade-in">
      <div class="page-header">
        <h2>Mein Feature</h2>
        <p>Beschreibung</p>
      </div>
      ${App.filterBadgeHtml()}
      <!-- Inhalt hier -->
    </div>`;
  },

  // Daten aus DB lesen
  loadData() {
    return App.query('SELECT * FROM meine_tabelle WHERE aktiv=1');
  },

  // Daten in DB schreiben (wird als Dirty-Op getrackt)
  saveItem(id, name) {
    App.run('UPDATE meine_tabelle SET name=? WHERE id=?', [name, id]);
    App.toast('Gespeichert', 'success');
  },
};
```

### Pattern: DB-Zugriff

```javascript
// Lesen (kein Dirty-Tracking)
const rows = App.query('SELECT * FROM schueler WHERE id=?', [42]);
const count = App.scalar('SELECT COUNT(*) FROM schueler');

// Schreiben (wird als Dirty-Op gespeichert → Multi-User safe)
App.run('INSERT INTO tabelle (feld) VALUES (?)', ['wert']);
App.run('UPDATE tabelle SET feld=? WHERE id=?', ['wert', 42]);
App.run('DELETE FROM tabelle WHERE id=?', [42]);
```

### Pattern: Modal mit CRUD

```javascript
editItem(id) {
  const item = App.query('SELECT * FROM items WHERE id=?', [id])[0];
  App.openModal('Item bearbeiten', `
    <div class="form-group">
      <label>Name</label>
      <input class="form-control" id="mName" value="${esc(item.name)}">
    </div>
  `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
      <button class="btn btn-primary" onclick="MeinModul.saveItem(${id})">Speichern</button>`);
},

saveItem(id) {
  const name = document.getElementById('mName').value.trim();
  if (!name) return App.toast('Name ist Pflicht', 'error');
  App.run('UPDATE items SET name=? WHERE id=?', [name, id]);
  App.closeModal();
  App.toast('Gespeichert', 'success');
  this.render(); // View aktualisieren
},
```

### Pattern: Filter-System

```javascript
render() {
  // Jahrgang-Filter (aus globaler Topbar)
  const jf = App.jgWhere('s.jahrgang_id');

  // Globale Zusatzfilter (Berufsschule, Fachrichtung etc.)
  const gf = App.gf('schueler'); // oder 'klassen', 'kontrolltermine'

  const data = App.query(`SELECT s.* FROM schueler s
    WHERE s.aktiv=1 ${jf.where} ${gf}
    ORDER BY s.nachname`, jf.params);
}
```

---

## 6. Sicherheitsarchitektur

### 6.1 Content Security Policy

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self' blob: data:;
           script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;
           style-src 'self' 'unsafe-inline';
           img-src 'self' blob: data:;
           font-src 'self' data:;
           connect-src 'self' blob:">
```

- `unsafe-inline`: Noetig fuer Template-Literals und onclick-Handler
- `unsafe-eval`: Noetig fuer sql-wasm.js (WASM-Instantiation)
- `blob:`: Noetig fuer PDF-Worker und Datei-Downloads
- Kein `connect-src` zu externen URLs → kein Datenabfluss moeglich

### 6.2 Datenschutz

- **Keine Daten verlassen das Intranet** — alles lokal im Browser + Netzlaufwerk
- **Kein Internet noetig** — alle Libraries offline eingebettet
- **Kein Server** — keine Angriffsoberfläche fuer Remote-Exploits
- **File System Access API** — User muss Ordner explizit freigeben
- **Keine Cookies, kein Tracking** — kein localStorage fuer personenbezogene Daten

### 6.3 Eingabevalidierung

```javascript
// XSS-Schutz: IMMER esc() fuer User-Daten in HTML
function esc(str) {
  if (str === null || str === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// SQL-Injection: IMMER parametrisierte Queries
App.run('UPDATE schueler SET name=? WHERE id=?', [name, id]);
// NIEMALS:
// App.run(`UPDATE schueler SET name='${name}' WHERE id=${id}`);

// Feld-Whitelist fuer dynamische Updates
_saveField(id, field, value) {
  const allowed = ['name', 'email', 'telefon'];
  if (!allowed.includes(field)) return; // Ablehnen!
  App.run(`UPDATE tabelle SET ${field}=? WHERE id=?`, [value, id]);
}
```

### 6.4 Datum/Timezone

```javascript
// RICHTIG: Lokale Zeit fuer Datumsberechnungen
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// FALSCH: UTC kann einen Tag daneben liegen!
// new Date().toISOString().split('T')[0]  ← NICHT verwenden!
```

---

## 7. Patterns fuer neue Projekte

### 7.1 Neues Modul erstellen

1. Datei anlegen: `src/js/modules/mein-feature.js`
2. Script-Tag in `index.html` einfuegen (Reihenfolge beachten!)
3. Modul in `build.sh` APP_MODULES ergaenzen
4. Globales Objekt definieren: `const MeinFeature = { ... };`

### 7.2 Neue DB-Tabelle anlegen

1. In `SCHEMA` (app-core.js): `CREATE TABLE IF NOT EXISTS ...`
2. In `migrateDB()`: `this.db.run('CREATE TABLE IF NOT EXISTS ...')`
3. In `_migrateDiskDb()`: `run('CREATE TABLE IF NOT EXISTS ...')`
4. Neue Spalten: `try { this.db.run("ALTER TABLE ... ADD COLUMN ..."); } catch(e) {}`

### 7.3 PDF-Export mit jsPDF

```javascript
exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Titel
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Mein Report', 20, 25);

  // Tabelle mit autoTable
  doc.autoTable({
    startY: 35,
    head: [['Name', 'Wert']],
    body: [['Zeile 1', '100'], ['Zeile 2', '200']],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [45, 80, 22] },
  });

  // Emojis entfernen (jsPDF kann sie nicht rendern)
  const clean = (s) => s.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').trim();

  doc.save(`report_${todayStr()}.pdf`);
}
```

### 7.4 Excel-Export mit SheetJS

```javascript
exportExcel(data) {
  const ws = XLSX.utils.json_to_sheet(data.map(row => ({
    'Nachname': row.nachname,
    'Vorname': row.vorname,
    'Betrieb': row.betrieb,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Daten');
  XLSX.writeFile(wb, `export_${todayStr()}.xlsx`);
}
```

### 7.5 Aenderungs-Logbuch (fuer Rueck-Sync)

Wenn Daten in einem fuehrenden System (z.B. IBYKUS) nachgetragen werden muessen:

```javascript
// Aenderung loggen
App.logChange(schuelerId, 'status', 'aktiv', 'inaktiv', 'manuell_geaendert');

// Export als CSV fuer Assistenz
const logs = App.query("SELECT * FROM aenderungslog WHERE ibykus_relevant=1 AND exportiert=0");
// → CSV erzeugen und herunterladen
```

---

## 8. Bekannte Einschraenkungen

| Einschraenkung | Grund | Workaround |
|----------------|-------|------------|
| Nur Chrome/Edge | File System Access API | Pflicht-Browser am Arbeitsplatz |
| Max 2-3 User gleichzeitig | SQLite = Single-Writer | Sequentielles Schreiben via Polling |
| Keine Echtzeit-Sync | Polling alle 8 Sekunden | Akzeptabel fuer Verwaltungsarbeit |
| Erster Start ~2s | WASM laden (640KB) | Danach aus Browser-Cache |
| Keine Smartphones | File System Access API | Desktop-only Anwendung |
| Emojis nicht in PDFs | jsPDF helvetica-Font | clean() Funktion entfernt sie |

---

## 9. Vorlage fuer CLAUDE.md (neue Projekte)

```markdown
# Projektname – Entwicklungs-Guide

## Was ist das?
[Kurzbeschreibung, Zielgruppe, Einsatzumgebung]

## Architektur
- Keine Build-Tools – reines HTML/CSS/JS
- Offline-faehig – alle Libraries in libs/
- File System Access API – SQLite auf Netzlaufwerk
- Multi-User – 2-3 Personen gleichzeitig

## Build
./build.sh    # → dist/projektname.html

## Projektstruktur
[Verzeichnisbaum mit Erklaerungen]

## Module und Verantwortlichkeiten
[Tabelle: Modul | Globales Objekt | Aufgabe]

## Wichtige Patterns
### DB-Zugriff
App.query(sql, params) und App.run(sql, params)

### Views rendern
render() Methode pro Modul

### Keine ES-Module
Alle Objekte global. Reihenfolge der Script-Tags wichtig!

## Entwicklung
### Regeln
- Build nach jeder Aenderung
- Keine npm-Dependencies
- Deutsche UI
- File System Access API: Nur Chrome/Edge

### Schema-Aenderungen
migrateDB() UND _migrateDiskDb() pflegen!
```

---

## 10. Referenz-Implementierung

Die Berichtsheftkontrolle (`berichtsheftkontrolle.html`) ist die Referenz-Implementierung dieses Tech-Stacks. Quellcode auf GitHub unter `hannespix/Berichtsheft-Workflow`.

**Kennzahlen:**
- ~26.000 Zeilen (gebaut)
- ~15.000 Zeilen Quellcode (25 Module)
- 10 externe Libraries (alle offline)
- SQLite-DB mit 15+ Tabellen
- Multi-User mit Sync + Locking
- PDF/Excel/Word/CSV Export
- IBYKUS-CSV Import mit Konflikt-Erkennung

---

*Erstellt: April 2026 | Regierungspraesidium Freiburg, Abt. 3, Ref. 31*
