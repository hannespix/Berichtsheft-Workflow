# Gesamt-Audit Berichtsheftkontrolle

> **Status: abgearbeitet.** Alle hier beschriebenen Befunde wurden in acht
> Meilensteinen behoben (M1–M8, siehe Git-Historie) und mit 207 automatisierten
> Prüfungen in zehn Testsuiten abgesichert. Dieses Dokument bleibt als
> Befund-Dokumentation und Begründung der Änderungen erhalten.

**Stand:** August 2026 · Grundlage: Code-Audit über alle Module (7 Prüfbereiche) + Laufzeittests im echten Browser (Chromium, Demo-Bestand 605 Azubis)

**Gesamtbild:** Die Anwendung läuft technisch stabil — alle Ansichten, Tabs, Modals und die Kontrolldurchführung wurden im Browser durchgefahren, **null Konsolenfehler**, Build byte-identisch zu den Quellen, alle 58 automatisierten Tests grün. Die Probleme liegen nicht in der Technik, sondern in der **Fachlogik**: mehrere Rechen- und Zuordnungsfehler führen zu falschen Zahlen in Berichten und in Einzelfällen zu Datenverlust.

Legende: 🔴 kritisch (Datenverlust/falsche amtliche Zahlen) · 🟠 hoch · 🟡 mittel

---

## 1. Ausbildungsjahre werden falsch berechnet 🔴

**`src/js/app-core.js:4398` (`getSchuelerAJs`)**

Zwei unabhängige Ursachen, beide im Laufzeittest reproduziert:

**(a) Schuljahresgrenze steht auf September.** Jede Ausbildung, die *nicht* im September beginnt, bekommt ein Lehrjahr zu viel:

| Beginn | Ende | Dauer | berechnet | korrekt |
|---|---|---|---|---|
| 01.09.2023 | 31.08.2026 | 3 J | [1,2,3] | ✔ |
| **01.08.2023** | 31.07.2026 | 3 J | **[1,2,3,4]** | [1,2,3] |
| **01.08.2023** | 31.07.2025 | 2 J | **[1,2,3]** | [1,2] |
| **01.03.2024** | 28.02.2027 | 3 J | **[1,2,3,4]** | [1,2,3] |

Im Demo-Bestand betrifft das **rund ein Drittel aller Azubis**. Folgen: ein überflüssiges leeres KW-Raster in jeder Einzelkontrolle, falsche Arbeitstage-Berechnung, und `nacherfassung.js:200` (`.pop()`) schreibt nacherfasste Mängel in das nicht existierende 4. Lehrjahr. Das ist derselbe Fehler, der früher als „4 Lehrjahre werden angezeigt" gemeldet wurde — der damalige Fix hat nur den Sonderfall „Ende am 1.9." behoben.

*Fix:* Grenze einheitlich auf den 1. August legen (`getMonth() >= 7`) — `getAJFromJahrgang:4496` macht es bereits so. Besser: Anzahl aus der Vertragsdauer ableiten statt aus überspannten Schuljahren.

**(b) Verkürzung wird ignoriert.** Zeile 4379 selektiert nur `ausbildungsbeginn, ausbildungsende`, Zeile 4391 verwendet aber `s.regulaer_dauer_monate` und `s.verkuerzung_monate` → beide immer `undefined` → immer 36 Monate / 0 Verkürzung. Bei Azubis mit gepflegten Phasen überschreibt das berechnete Ende zusätzlich ein korrekt gepflegtes `ausbildungsende`, der Fehler ist also nicht über die Stammdaten heilbar.

*Fix:* Spalten in den SELECT aufnehmen.

**Nebenbefund:** Das 4. Lehrjahr ist per Tastatur nicht erreichbar (`kw-nav.js:159` bricht bei `aj > 3` ab), und `getCurrentAJ` ist auf 3 gedeckelt — Kopfzeile zeigt „AJ 3", das Raster daneben „Ausbildungsjahr 4".

---

## 2. Eintrag landet beim falschen Azubi 🔴

**`src/js/modules/kw-nav.js:376` (`trackSessionKW`)**

`persistCodes()` bekommt die Schüler-ID korrekt übergeben, ruft am Ende aber `trackSessionKW()` auf — und die holt sich den Schüler erneut über `currentSchuelerList[currentIndex]`, also den *gerade angezeigten*. Der frühere Fix wurde nur zur Hälfte umgesetzt.

**Im Browser reproduziert:** Eintrag für Azubi „Günther" (Position 1), während Position 2 angezeigt wird → Azubi „Baumann" bekam **34 Kalenderwochen als „geprüft" markiert**, ohne dass er je kontrolliert wurde. Auslöser im Alltag: Undo (Strg+Z) nach dem Weiterblättern zum nächsten Azubi.

*Fix:* `sid` bis in `trackSessionKW` durchreichen.

---

## 3. Jahresbericht rechnet falsch 🔴

**`src/js/modules/berichte.js:313-319`**

„Kontrolliert" zählt **alle** Azubis inklusive der inaktiven, „Gesamt" nur die aktiven. Solange nichts archiviert ist, fällt das nicht auf. **Nachgestellt:** Nach dem Abschließen *eines* Jahrgangs (185 Azubis) springt die ausgewiesene Abdeckung von 27 % auf 39 % — ohne eine einzige zusätzliche Kontrolle. Nach zwei bis drei Jahrgängen stehen Werte über 100 % und ein negatives „noch offen" im offiziellen PDF.

Zusätzlich mischt die „Erfolgsquote" (Zeile 446) Ergebnis-*Zeilen* mit Azubi-*Köpfen*: Bei mehreren Durchsichten pro Azubi entstehen Werte weit über 100 %.

*Fix:* `JOIN schueler … AND s.aktiv=1` in beiden Zählungen; Erfolgsquote auf dieselbe Basis stellen.

---

## 4. Klassenübersicht-PDF vervielfacht Azubis 🔴

**`src/js/modules/berichte.js:14`** — Der JOIN auf `kontrollergebnisse` erzeugt eine Zeile *pro Kontrolle* statt pro Azubi. Im Demo-Bestand: **37 Zeilen für 34 Azubis**; mit jeder weiteren Durchsicht wächst der Fehler (bei 3 Durchsichten: 102 Zeilen). Inaktive Azubis fehlen im `WHERE` und stehen mit drin. Die Anzahl im Dateinamen ist entsprechend falsch.

---

## 5. Sync-v3: Op-Logs verlieren Daten 🔴

Der neue Op-Log-Sync hat fünf reproduzierte Defekte. Die automatisierten Tests (28/28 grün) treffen keinen davon.

- **Log-Rotation ohne Generationsmarke** (`app-core.js:3218`): Nach dem Leeren beginnt das Log wieder bei 0; der Leser erkennt das nur, wenn die Datei *kleiner* geworden ist. Wächst sie zwischen zwei Abfragen über die alte Größe hinaus, liest er ab der falschen Stelle. Reproduziert: **30 von 53 Änderungen dauerhaft verloren.**
- **Kompaktierung merkt sich zu viel als „erledigt"** (`:3176`): Änderungen, die während der Kompaktierung geschrieben werden, gelten als im Snapshot enthalten, sind es aber nicht — und werden anschließend weggeräumt.
- **Bulk-Import überlebt die nächste Kompaktierung nicht** (`:2817`): Der IBYKUS-Import umgeht das Op-Log und landet nur im Snapshot. Kompaktiert danach ein *anderer* Rechner, überschreibt er den Snapshot mit seinem Speicherstand — **der komplette Import ist weg.**
- **Reihenfolge innerhalb einer Sekunde ist zufällig** (`:3060`): Alle Änderungen eines Speichervorgangs tragen denselben Zeitstempel, entschieden wird per Zufallswert. In 9 von 30 Testläufen ging das direkt folgende UPDATE beim Empfänger verloren.
- **`kw_maengel`, `pruefer`, `abschlussjahrgaenge` haben keine globalen IDs** (`:2605`): Ihre Änderungen werden per lokaler ID repliziert und treffen beim Kollegen die *falsche* Zeile. Reproduziert: Mängel wurden dem falschen Azubi zugeschrieben.

*Fix-Richtung:* Rotation über Dateinamen-Generationen; Offsets aus dem eigenen Lesestand statt neu vom Dateisystem; Zeitstempel beim Erfassen (nicht beim Speichern) plus laufende Nummer je Client; die drei Tabellen in `ID_TABLES` aufnehmen.

---

## 6. Import: Datenverlust und Fehlzuordnungen 🟠

- **Betriebe ohne Betriebsnummer** (`import-handler.js:383`, `stammdaten.js:1114/1166`): `betriebsnummer` ist `UNIQUE` mit Vorgabewert `''` — es kann also nur **einen** Betrieb ohne Nummer geben. Jeder weitere Versuch scheitert; beim Import wird der zugehörige **Azubi komplett verworfen**, in den Stammdaten bricht die Verknüpfungs-Automatik kommentarlos ab. (Mit `NULL` statt `''` wäre es zulässig — verifiziert.)
- **Spaltenerkennung vergibt dieselbe Spalte doppelt** (`:136`): Eine Spalte „Nr" wird gleichzeitig als Betriebsnummer *und* als BAV-Ident erkannt → jeder Azubi bekommt einen eigenen Betrieb (300 Azubis = 300 Betriebe). Beide Zuordnungen erscheinen im Dialog grün als erkannt.
- **Datumsparser akzeptiert Unsinn** (`:269`): `01.02.24` wird zu **2024-01-02** (Tag/Monat vertauscht), `31.02.2024` zu `2024-02-31`. Keiner dieser Fälle landet in der Fehlerliste. Verifiziert.
- **Import-Abbruch = stiller Totalverlust** (`:578`): Während des Imports ist die Änderungsverfolgung aus; gespeichert wird nur am Ende. Bricht etwas vorher ab, existieren die Daten nur im Speicher und sind beim nächsten Speichern weg — die Erfolgsmeldung erscheint trotzdem.
- **Name und BAV-Ident werden beim Re-Import nie aktualisiert** (`:464`): Namensänderungen (Heirat) erreichen das Tool nicht; ein über den Namen gefundener Datensatz bekommt seine ID nie nachgetragen.
- **BAV-Status „ENDE" überschreibt „bestanden" mit „abgebrochen"** (`:433`) — auch bei regulärem Abschluss.

---

## 7. Fehlende Kaskaden: Datenleichen 🟠

`PRAGMA foreign_keys` wird nirgends gesetzt, die `ON DELETE CASCADE` im Schema feuern also nie. Alles muss von Hand aufgeräumt werden — an mehreren Stellen fehlt das. **Verifiziert:**

- **Kontrolltermin löschen** (`planung.js:708`): 29 Kontrollergebnisse blieben verwaist zurück.
- **Einzelnen Azubi löschen** (`import-handler.js:938`): löscht *nur* die Stammdatenzeile — KW-Daten, Kontrollergebnisse, Wiedervorlagen, Phasen, Bemerkungen und Dateien bleiben liegen. Der Bulk-Löschpfad macht es teilweise richtig, der Einzelpfad gar nicht.
- **Jahrgang löschen** (`import-handler.js:1261`): verwaiste KW-Daten verfälschen anschließend die Top-Mängelcodes im Jahresbericht.

---

## 8. Kaputte oder tote Bedienelemente 🟠

- **„Aktenvermerk exportieren"** (`schueler-akte.js:216`): Die Abfrage nutzt `kt.name` — diese Spalte existiert nicht. Verifiziert: `no such column: kt.name`. Der Button tut nichts, ohne Fehlermeldung.
- **„Löschen" in der Bulk-Leiste der Schülerliste** (`schueler-view.js:220`): ruft `BulkSchueler.deleteSelected()` — diese Funktion existiert nicht.
- **„Adressen kopieren"** (`workflows.js:266`) und **„Betriebe zusammenführen"** (`views.js:1425`): brechen bei einem Apostroph im Namen/in der E-Mail (z. B. `O'Brien`).
- **Bulk-Zuordnungen aus dem Import-View** (`bulk-schueler.js:30/50/71`): ändern die Daten, melden Erfolg — und stürzen danach beim Aktualisieren ab, sodass die Liste alte Werte zeigt.

---

## 9. Kontrolldurchführung: fachliche Inkonsistenzen 🟠

- **„Behoben"-Historie geht je nach Bedienweg verloren** (`kw-nav.js:299` vs. `kontrolle.js:1434/1492`): Nur die Entf-Taste schreibt entfernte Mängel nach `behobene_codes`. Über „Leeren", „Speichern mit abgehakten Codes" oder die O-Taste wird die Zeile gelöscht bzw. geleert — die Behebung ist nicht mehr dokumentiert.
- **Gesamt-Fehltage werden nicht nachgeführt** (`kw-nav.js:558`): Trägt man Fehltage über das KW-Modal ein (der dokumentierte Weg), bleibt `fehltage_gesamt` auf dem alten Wert — und genau dieser Wert steht im Durchsichtsbogen-PDF, während Übersicht und Berichte frisch rechnen. Zwei widersprüchliche Zahlen.
- **Manuelle Abwahl der AP-Zulassung hält nicht** (`kontrolle.js:169`): Die Abwahl steht nur im Arbeitsspeicher. Nach einem Neuladen — oder sobald ein *Kollege* dieselbe Übersicht öffnet — wird die Zulassung automatisch wieder gesetzt und verteilt.
- **Nacherfassung schreibt ins letzte statt ins aktuelle Lehrjahr** (`nacherfassung.js:200`) und übernimmt die **Gesamt**-Fehltage als Fehltage *einer* Woche (`:81/154`) — die Summe schaukelt sich bei jeder Nacherfassung auf.
- **Ergebnisse landen nach Tabellensortierung beim falschen Azubi** (`nacherfassung.js:148`): Das Ergebnis wird über die DOM-Position gelesen, die übrigen Felder über den Original-Index.
- **Tastaturkontext bleibt hängen** (`app-core.js:5493`): `closeModal()` räumt den KW-Modal-Kontext nicht auf. Nach „Abbrechen" kann ein späterer Tastendruck in einem *fremden* Modal stillschweigend auf die zuletzt betrachtete Woche schreiben.

---

## 10. Vergütungsrechner 🟡

- **Lehrjahr-Wechsel verschiebt sich um einen Monat**, sobald mehr als eine Phase existiert (Betriebswechsel, Unterbrechung) — Ursache: Phasenende wird inklusiv gespeichert, aber exklusiv gerechnet. Wirkung im Beispiel: 240 € zu wenig über die Ausbildung.
- **Lücken zwischen Phasen werden als bezahlte Zeit verschmolzen** (`azubi-rechner.js:408`): im Testfall 6.600 € Phantom-Vergütung und 13 Phantom-Urlaubstage.
- **„Aktuelle Vergütung" fällt auf die letzte Periode zurück** (`:504`): Ein Azubi in Elternzeit oder mit noch nicht begonnener Ausbildung wird mit dem Satz des 3. Lehrjahrs angezeigt.
- **Mindestvergütungs-Warnung nutzt den neuesten Satz** statt dem zum Ausbildungsbeginn (`azubi-dashboard.js:200`) — widerspricht der neu eingeführten Regel. Fachwerker bekommen dadurch **immer** eine Falschmeldung, obwohl §17 BBiG für sie gar nicht gilt.
- **Prüfungstermin-Automatik ist an der Kante instabil**: Vertragsende 30.06. → Februar-Termin, 01.07. → Juli-Termin (5 Monate Unterschied bei einem Tag).

---

## 11. Datenqualitäts-Prüfung (neu) 🟡

- **Absturz bei bestimmten IDs**: Eine BAV-Ident `constructor` oder `__proto__` lässt die gesamte Prüfung abbrechen (`berichte.js:864`) — verifiziert. Ursache: einfache Objekte als Sammler.
- **Der Qualitäts-Score ist verzerrt**: Im Demo-Bestand zeigt er **3 %**, obwohl er ohne die eine Regel „Geburtsdatum fehlt" (die auf *alle* 605 Azubis zutrifft, weil das Feld im Export gar nicht geliefert wird) bei **90 %** läge. Eine Regel, die auf fast alle Datensätze zutrifft, ist keine Qualitätsaussage — sie sollte einmal gebündelt als strukturelle Lücke gemeldet werden statt 605-mal einzeln.
- **Nenner enthält inaktive Azubis** (`:966`): Der Score steigt allein durchs Archivieren. Zudem wird nach *Namen* dedupliziert — zwei gleichnamige Azubis zählen als einer.

---

## 12. Weitere bestätigte Punkte 🟡

- **Dashboard-Diagramme zählen doppelt** (`views.js:533`, `293`): Ein Azubi mit einer OK- und einer Mängel-Kontrolle zählt in beiden Mengen; im Demo-Bestand betrifft das 18 Azubis. Der Ring zeigt zu wenig „offen", die Jahrgangs-Balken können über 100 % laufen.
- **Berichte-Seite mischt gefiltert und ungefiltert**: Zulassungsliste und Terminliste respektieren die globalen Filter, Excel-Dashboard, Klassenübersicht und Jahresbericht nicht — und als einzige Hauptansicht zeigt sie die aktiven Filter nicht an.
- **Schülerliste-Kopfzeile ignoriert globale Filter** (`schueler-view.js:148`): Header sagt „612", die Tabelle zeigt 47.
- **Jahresbericht-Tabellen laufen unten aus dem Blatt** (`berichte.js:490`): kein Seitenumbruch in den Fachrichtungs-/Schulschleifen; die letzten Zeilen fehlen im PDF.
- **Tabellensortierung zerschießt Gruppenüberschriften** in der gruppierten Kontrollübersicht; die Zeilennummern bleiben stehen.
- **Kalenderansicht zeigt pro Tag nur einen Termin** (`views.js:960`).
- **KW 53 existiert nirgends im Raster**, obwohl das Datenmodell sie erlaubt — Schuljahr 2026/27 enthält sie.
- **`localStorage` ohne Absicherung** (`views.js:1291`): Sind Site-Daten per Gruppenrichtlinie gesperrt, bricht die **gesamte Einstellungen-Seite** ab.
- **Ladeoverlay bleibt bei Fehlern hängen** (Jahresbericht, LFK-Import, Ausbilder-Import, Jahrgang abschließen): kein `finally`, die Oberfläche wirkt eingefroren.
- **`wiedervorlage_notizen` fehlt in beiden Migrationen** — auf gewachsenen Datenbanken schlagen die zugehörigen Abfragen fehl.
- **Statistik-Ausblendung ist nur optisch**: Die Abfragen und Diagramme laufen weiter, und das Excel-Dashboard exportiert die Zahlen ungefiltert.

---

## Was geprüft wurde und in Ordnung ist ✅

- **Laufzeit:** alle 10 Ansichten, 7 Stammdaten-Tabs, 4 Modals, Kontrolldurchführung — **0 Konsolenfehler, 0 Warnungen**
- **Build:** `dist/` ist byte-identisch zur Quell-Konkatenation, alle 25 Module in `index.html` und `build.sh`, keine doppelten globalen Namen
- **Dashboard-Kennzahlen:** gegen unabhängig gerechnete SQL-Zahlen geprüft — exakt gleich (253/81/25/6, Abdeckung 32 %)
- **Spalten-Parität** zwischen Schema, `migrateDB()` und `_migrateDiskDb()`: 0 Abweichungen
- **CHECK-Constraints:** kein Wert im Code verletzt eine Einschränkung
- **SQL-Injection:** Filterlisten sind über `_safeIntList`/`_safeStrList` abgesichert; `esc()` maskiert auch Anführungszeichen
- **Datumsarithmetik:** sommerzeitsicher, Monatsenden und Schaltjahre korrekt; keine UTC-Umrechnung mehr in Datumsberechnungen
- **Tarifregel „Stand zum Ausbildungsbeginn"** ist korrekt umgesetzt und wird durchgehalten
- **Speicherverbrauch** ist überall begrenzt; der Live-Sync-Timer wird beim Verlassen der Ansicht gestoppt
- **Browser-Kompatibilität:** keine Verwendung zu neuer Schnittstellen; alle optionalen APIs sind abgesichert
- **Automatisierte Tests:** 58/58 grün (Sync 28, Suche 16, Datenqualität 14)

---

## Empfohlene Reihenfolge

1. **Lehrjahr-Berechnung** (1) — betrifft ein Drittel der Azubis und wirkt in Raster, Nacherfassung und Berichte hinein
2. **Falscher-Azubi-Schreibzugriff** (2) — stiller Datenschaden im Kerngeschäft
3. **Sync-v3-Defekte** (5) — Datenverlust im Mehrbenutzerbetrieb; bis dahin Kompaktierung und Bulk-Import nur zu Zeiten, in denen niemand sonst arbeitet
4. **Berichtszahlen** (3, 4, 12) — die Werte gehen in amtliche Dokumente
5. **Import-Härtung** (6) und **Kaskaden** (7)
6. **Tote Bedienelemente** (8) — schnell behebbar, hohe gefühlte Qualität
7. Rest nach Aufwand

> **Hinweis zur Dokumentation:** `CLAUDE.md` ist nicht mehr aktuell — es fehlen die Module `azubi-dashboard.js`, `azubi-rechner.js` und `schueler-akte.js`, das Testverzeichnis `tests/`, die Sync-v3-Architektur; die Zeilenangaben stammen aus einem früheren Stand und die Schema-Regel nennt zwei statt drei Pflegestellen.


---

## Abarbeitung (August 2026)

| Meilenstein | Inhalt | Test |
|---|---|---|
| M1 | Lehrjahr-Berechnung: Dauer statt Kalender-Schuljahr; Verkürzung wird gelesen; Tastaturnavigation und Nacherfassung folgen der Raster-Anzahl | `aj-test.mjs` |
| M2 | Schreibziel aus dem Kontrollergebnis statt aus der Ansicht; Mängel-Historie auf allen Bedienwegen; Fehltage-Summe; AP-Zulassung dauerhaft | `kontrolle-test.mjs` |
| M3 | Op-Reihenfolge, Log-Rotation über Generationen, Kompaktierungs-Offsets, Snapshot-Generation, globale IDs für drei weitere Tabellen | `sync-test.mjs` |
| M4 | Jahresbericht und Diagramme zählen Köpfe über den aktiven Bestand; Klassenübersicht eine Zeile je Azubi; Seitenumbrüche | `berichte-test.mjs` |
| M5 | Betriebsnummer-Sperre, Spaltenzuordnung, Datumsprüfung, Speicher-Rückmeldung, Re-Import von Namen und Ident | `import-test.mjs` |
| M6 | Zentrale Lösch-Kaskaden für alle Pfade; tote Bedienelemente; Migrations-Parität | `integritaet-test.mjs` |
| M7 | Apostroph-Fallen, hängende Ladeanzeigen, abgesicherter Speicherzugriff, Tastenkürzel; Vergütungsperioden und Mindestvergütung | `rechner-test.mjs` |
| M8 | Datenqualität: Absturzschutz, Sammelmeldungen, Score-Basis; Suchindex-Zwischenspeicher; Dokumentation | `dq-test.mjs`, `search-test.mjs` |

**Bewusst nicht geändert** (Architekturentscheidungen, keine Fehler):

- Der erste Ausbildungsmonat vor September ist im Schuljahres-Raster nicht
  abbildbar. Ein Vertrag ab 1.8. hat drei volle Raster ab September; die
  Augustwochen des ersten Jahres liegen davor. Alternative wäre ein Raster
  je Vertragsjahr statt je Schuljahr – ein Umbau der gesamten Kontrollansicht.
- Löschungen gewinnen gegen gleichzeitige Änderungen (Tombstone-Prinzip).
- Stammdaten-Änderungen (Betriebe, Klassen, Schulen) werden zeilenweise
  übernommen, nicht feldweise zusammengeführt.

---

# Audit 2: Multi-User-Schreiben, Netzordner, Datenbank (August 2026)

> **Status: abgearbeitet.** Vier parallele Prüfbereiche (Schreibpfad,
> Lese-/Apply-Pfad, Kompaktierung/Locking, Schema/Schreibregeln) plus eigene
> Verifikation. 31 Befunde, davon 8 hoch. Alle Reparaturen mit Regressionstests
> in `sync-test.mjs` (T13–T16, jetzt 60 Prüfungen) und `integritaet-test.mjs`
> abgesichert; 11 Suiten grün.

## Behobene Hoch-Befunde (Datenverlust-Szenarien)

| # | Befund | Reparatur |
|---|---|---|
| H1 | **Rotation → Selbst-Replay:** Nach dem Log-Rotieren galt die alte eigene Datei als „fremd" ohne Lesestand; die komplette eigene Historie wurde erneut angewendet und überschrieb neuere Änderungen der Kollegen. | Lesestand vor Generationswechsel eintragen, `_ownLogUids` nicht mehr leeren (auch im InvalidStateError-Pfad). Test T13. |
| H2 | **Snapshot-Tausch verlor eigene Nachzügler-Ops:** Ops, die während einer fremden Kompaktierung angehängt wurden, verschwanden vom eigenen Bildschirm und nach der eigenen nächsten Kompaktierung überall. | Nach dem Tausch werden die eigenen Logs ab dem meta-Offset nachgespielt; ungespeicherte Puffer-Ops werden auf die frische DB angewendet. Test T14. |
| H3 | **Snapshot-Generation nicht monoton:** Zwei Clients konnten dieselbe gen schreiben; der jeweils andere lud den neuen Snapshot nie (Import konnte von der Platte verschwinden). | `_compact` liest snapmeta frisch unter Lock, bricht bei nicht übernommenem fremden Snapshot ab, `gen = max(disk, lokal)+1`. Test T15. |
| H4 | **Kein Lock-Heartbeat in `_compact`:** Auf langsamem Laufwerk lief die 150s-Staleness ab → zwei parallele Kompaktierer, Offsets passten nicht zum Snapshot. | `_refreshLock()` vor Snapshot- und vor snapmeta-Write. |
| H5 | **`_saveV3` verwarf Speicheraufträge still** bei laufendem Append und meldete danach grün „Gespeichert". | Aufschub + erneuter Auto-Save; Status zeigt „Geändert…", solange Ops offen sind. |
| H6 | **„Neu laden"/Reload zerstörte den v3-Zustand:** Snapshot ohne Log-Replay, veraltete Offsets – die nächste Kompaktierung schrieb den alten Stand für alle. | `reloadFromFile` macht vollständigen Re-Bootstrap (+ `migrateDB`). |
| H7 | **`bulkDeleteSchulen` löschte Klassen an der Kaskade vorbei** → verwaiste `klasse_id`-Verweise bei allen Nutzern. | Direktes DELETE entfernt; nur noch `deleteSchuleKaskade`. |
| H8 | **Replay-INSERTs ohne Konfliktbehandlung** (kw_status-Nacherfassung, Klassen, Jahrgänge, Prüfer, Betriebe) scheiterten beim Empfänger still am UNIQUE – dauerhafte Divergenz. | Alle Anlagepfade auf `ON CONFLICT … DO UPDATE` bzw. `OR IGNORE` umgestellt. |

## Behobene Mittel-/Niedrig-Befunde

- **Crash-Puffer:** sichert jetzt auch Ops, die in einem hängenden Append stecken (`_opsInFlight`); speichert `ts`/`seq` mit (wiederhergestellte Ops gewinnen kein falsches Last-Write-Wins mehr); Restore MERGT statt zu überschreiben; Restore läuft nie mehr mit halb gefülltem uid-Set (60s-Wartefenster, sonst Auslassung).
- **Spaltenbewusster LWW-Guard:** Spaltenstempel je `kontrollergebnisse`-Zeile aus eigenen und fremden Ops; ältere Ops auf *andere* Spalten werden gemergt, auf *dieselbe* Spalte verworfen. Test T16.
- **Uhren-Versatz:** Lamport-Stempel (`ts ≥ max(gesehen)+1`) + zweiter Anwendungs-Durchlauf für im Batch falsch einsortierte abhängige Ops; `SELECT MAX(id)`-Falle in der Einzelprüfungs-Anlage durch `last_insert_rowid()` ersetzt.
- **Bootstrap:** Offsets = konsumierte Bytes (halbe Zeilen werden nachgelesen); endet das eigene Log in einer angerissenen Zeile, wird sauber auf eine neue Generation gedreht.
- **v2-Fallback-Fenster:** Vor Bootstrap-Ende wird nie mehr direkt in die geteilte .sqlite geschrieben (Aufschub); `fullSave` wartet/versucht awaited und wirft bei Misserfolg (Import zeigt ehrlich „NICHT gespeichert"); `_dirtyOps` werden nach dem Import-Snapshot nicht mehr pauschal verworfen.
- **Zwei Tabs:** Zweit-Tab erhält eine eigene Log-Identität und kompaktiert/rotiert nie mehr (vorher: gemeinsame Log-Datei → Korruption, Prune löschte die aktive Datei des anderen Tabs).
- **Aufräumen/Last:** `_compactionDue` zählt nur ungedeckte Bytes; vollständig abgedeckte Logs verwaister Clients werden nach 3 Tagen gelöscht (vorher: Kompaktierungs-Dauerschleife alle 5 Minuten).
- **beforeunload** gibt das Lock nicht mehr frei, während `_compact`/`_append` laufen; sichert auch in-flight-Ops.
- **Backups:** Client-Kürzel im Dateinamen (keine Kollision in derselben Sekunde), Aufbewahrung 30 statt 20 (geteilt durch 2–3 Nutzer).
- **Schema-Parität:** `schueler_bemerkungen`/`schueler_dateien`/`ausbilder` jetzt auch in SCHEMA; `kw_maengel` auch in `migrateDB()` (ein ungeschützter COUNT riss sonst die Anlage der Akten-Tabellen mit); `pruefer`-Tabelle+Unique-Index auch auf der Disk-DB; `blockplan`/`durchsicht_snapshots`-Definitionsdrift beseitigt; `_reconcileKeIds` zieht `kw_status.erstellt_bei/behoben_bei` mit um.
- **Determinismus:** `date('now')` wird im Replay-Op eingefroren (wie `datetime('now')`); der Import-Historie-Cap löscht über eine feste Zeitschwelle statt `NOT IN (… LIMIT 100)` (lief beim Empfänger sonst auseinander).
- **Kleinvieh:** Reentranz-Guard für parallele Polls (Timer + BroadcastChannel), Dedupe-Set-Schwelle 200k statt 50k, Append-Fehler aktualisieren den Crash-Puffer sofort.

**Bewusst so gelassen:**

- Crash exakt zwischen Snapshot- und snapmeta-Write führt beim nächsten Bootstrap zu einem Doppel-Replay bereits enthaltener Ops. Die Reihenfolge (erst Snapshot, dann meta) ist die sichere Richtung: Doppel-Replay konvergiert (Ops werden in ts-Ordnung erneut angewendet), die umgekehrte Reihenfolge könnte Ops als abgedeckt markieren, die nie geschrieben wurden.
- Backups sind Speicher-Exporte des jeweiligen Clients (kein Disk-Kopieren) – bewusst, damit auch bei kaputter Snapshot-Datei ein konsistenter Stand existiert.
- Divergente globale IDs bei ZEITGLEICHER Anlage desselben Jahrgangs/Betriebs auf zwei Rechnern bleiben möglich (die Zeile selbst wird jetzt per ON CONFLICT zusammengeführt, nur die id des Unterlegenen verweist ins Leere). Voll-Reconciliation wie bei Kontrollergebnissen wäre unverhältnismäßig.

---

# Audit 3: Kontrollplanung – Logik & Workflow (August 2026)

> **Status: abgearbeitet.** Zwei Prüfbereiche (Planungslogik; Datenfluss
> Termin→Kontrolle→Export) + eigene Verifikation. Leitbild lt. Nutzer:
> **Termin = Berufsschule**, dort werden ALLE anwesenden Azubis kontrolliert
> (maßgeblich 2.+3. Lehrjahr, inkl. Landesfachklassen-Gäste und Azubis
> fremder Ämter); deren Ergebnisse gehen danach an die zuständigen
> Ausbildungsberater. Neue Suite `planung-test.mjs` (29 Prüfungen),
> End-to-End im Browser verifiziert (15 Prüfungen).

## Kernbefunde und Reparaturen

| Befund | Reparatur |
|---|---|
| Globale Filter (Amt-Auto-Default '93', Fachrichtungs-Vorbelegung) blendeten im Termin-Dialog genau die Azubis/Klassen aus, die mitkontrolliert werden sollen; Klassen mit fachrichtung_id NULL waren strukturell unerreichbar. | Termin-Dialog lädt Klassen und Azubis UNGEFILTERT; eingegrenzt wird nur über die Dialog-Filter (Kohorten werden aus dem globalen Filter vorbelegt, Amt/Fachrichtung bewusst nicht). |
| `gf('termine')` lief nur über kontrolltermin_klassen → reine Einsendungs-/Einzelschüler-Termine verschwanden bei JEDEM aktiven Filter aus Planung und Kontrolle. | Termin matcht, wenn irgendeine Klasse ODER irgendein Einzelschüler passt. |
| „Schule" eines Termins war überall die Stammschule der ersten Klasse – die Terminankündigung eines LFK-Termins ging an die falsche Schule. | Neue Spalte `kontrolltermine.berufsschule_id` (Ort des Termins, im Dialog wählbar, 3 Schema-Stellen) + `App.getTerminSchule()`; E-Mail/Tabelle/PDF nutzen sie. |
| Standortgruppen-Klick hakte die STAMMklassen an (holte ganze Klassen anderer Schulen herein) und löschte die bisherige Auswahl. | Übernimmt nur noch die Azubis der Gruppe als Einzel-Zuordnung, mergt, Klassen bleiben unangetastet. |
| „+ Schüler hinzufügen" in der Kontrolle erzeugte nur ein Kontrollergebnis ohne Termin-Zuordnung → fehlte in ALLEN Exporten, und die nächste Termin-Bearbeitung löschte das erfasste Ergebnis als „verwaist". | Bindet als kontrolltermin_schueler; `getTerminSchueler` nimmt zusätzlich alle Azubis mit Kontrollergebnis auf; das Aufräumen schützt Bögen mit Inhalt (bindet sie statt zu löschen) und löscht nur leere. |
| `aktiv`-Inkonsistenz: Terminliste zählte inaktive mit, Aufräumen löschte deren dokumentierte Ergebnisse. | Einheitlich aktiv=1 für Klassenmitglieder; Kontrollierte bleiben über den Ergebnis-Zweig erhalten. |
| Legacy `klasse_id` wurde beim Abwählen aller Klassen nicht geleert → gelöschte Klasse kam über den Fallback zurück. | Wird immer gesetzt (auch NULL). |
| „2.+3. Lehrjahr" war als Planungsbegriff nicht abbildbar; die Kohorten-Vorlage verlor Winter-Jahrgänge, Azubis ohne ZP-Eintrag und Verkürzer. | Lehrjahr-Mehrfachauswahl im Dialog + `getStandortgruppen({lehrjahre})`: primär aus dem AKTUELLEN Ausbildungsjahr des Azubis berechnet (Verkürzer korrekt), Fallback Klassen-Lehrjahr, Unbestimmbare bleiben sichtbar. |
| Jahresplanungs-Assistent: 1 Termin pro KLASSE, übers Jahr verstreut, ohne Schulen/LFK/Ämter/Blockplan. | Ersetzt durch den **Kampagnen-Assistenten**: Vorlage wählen → Standortgruppen je Schule (Azubis, fremde Ämter, LFK ausgewiesen) → Datum je Schule (mit KW-/Blockplan-Hinweis) → je Schule EIN Termin mit exakter Azubi-Menge. Funktioniert für ALLE Vorlagen. |
| Kontroll-Vorlagen ließen den Amt-Filter '93' aktiv – im Widerspruch zum Workflow. | Vorlagen schalten den Amt-Filter aus. |
| KEINE Weitergabe-Funktion für Ergebnisse fremder Ämter. | Neu: „§ Ämter" am Termin – gruppiert die Azubis fremder Zuständigkeit je Amt, erzeugt PDF-Bögen und Excel-Übergabeliste; Amt-Badge (§ 94 …) in der Kontroll-Schülerliste. |
| Durchsichtsbogen trug pauschal Schule/Klasse des TERMINS – der Bogen eines LFK-Gasts wurde mit falschen Angaben weitergegeben. | Kopfzeile je Azubi: tatsächliche Schule (inkl. „(LFK)") + eigene Klasse. |
| Nacherfassung ohne Klassenwahl verknüpfte ALLE Klassen der Schule (120 leere Bögen). | Verknüpft nur explizit gewählte Klassen; erfasste Azubis werden einzeln gebunden; Ort (Schule) wird am Termin gespeichert. |

**Bewusst so gelassen:** `kontrolltermine.jahrgang_id` bleibt die erste
Klasse (nach dem gf-Umbau ohne Schadwirkung, nur Anzeige). Ein expliziter
Azubi-AUSSCHLUSS aus einem Klassen-Termin existiert weiterhin nicht – der
empfohlene Weg ist der Kampagnen-Assistent/Standort-Klick mit exakter
Einzel-Zuordnung statt Klassen-Verknüpfung.

---

# Audit 4: Nacherfassung – Logik & Datenfluss (August 2026)

> **Status: abgearbeitet.** Neue Suite `nacherfassung-test.mjs` (33 Prüfungen), End-to-End im Browser verifiziert.

| Befund | Reparatur |
|---|---|
| Nur die EINE eingetragene KW wurde als geprüft markiert – alle Wochen davor (und frühere Ausbildungsjahre) blieben im KW-Raster offen. | „Geprüft bis KW" läuft jetzt über `KWNav.persistCodes`/`trackSessionKW` – exakt die Kaskade der Live-Kontrolle (inkl. `geprueft_kws`-Session-Tracking). |
| Fehltage wurden mit `Math.min(7, …)` gekappt, in EINE Kalenderwoche geschrieben und beim nächsten KW-Eintrag von `autoUpdateFehltage` überschrieben. | Neue Spalte `kontrollergebnisse.fehltage_pauschal` (3 Schema-Stellen); `fehltage_gesamt = KW-Summe + pauschal`; Eingabe = Gesamtstand laut Berichtsheft (kein Maximum), Pauschalanteil wird so gesetzt, dass Gesamt = Eingabe; wird in Folge-Kontrollen mitübernommen und ist im Raster korrigierbar; Statistik nutzt den Wert des letzten Kontrollergebnisses. |
| KW wurde immer dem HEUTIGEN Ausbildungsjahr zugeordnet – „bis KW 30" bei einer Durchsicht im September landete im falschen Raster; Codes ohne KW landeten auf KW 1/36. | `App.ajKwFuerStichtag()`: Ausbildungsjahr zum Stichtag der Durchsicht; KW-Nummern hinter der Durchsichtswoche → Vorjahr. Codes ohne KW → Woche vor dem Durchsichtsdatum. |
| Kontrollergebnis ohne Durchsichtsnummer/Pflichtteil-Übernahme/Snapshot; UTC-Zeitstempel; jedes Speichern erzeugte einen neuen Termin; Ergebnisse doppelten sich. | Übernahme aus der letzten Durchsicht wie in der Live-Kontrolle, Archiv-Snapshot, `localtime`; EIN Nacherfassungs-Termin je Schule + Datum (wird ergänzt); erneutes Speichern aktualisiert. |
| Globale Filter (Amt '93') blendeten Azubis fremder Ämter und deren Schulen aus. | Nacherfassung nutzt ausschließlich ihre eigenen Filter; §-Kennzeichen an fremden Azubis; „Noch nicht kontrolliert" gruppiert nach tatsächlichem Standort (LFK). |
| UI ohne Erklärung: KW-Feld mit ALTEM Stand vorbelegt, Fehltage-Feld mehrdeutig. | KW-Vorschlag = Woche vor dem Durchsichtsdatum (folgt Datumsänderungen), Spalte „Bisher" (letzte Kontrolle, geprüft bis, Fehltage), Erläuterungsbox, Schnellaktionen „Alle offenen → In Ordnung" / „KW-Vorschlag für alle", Hilfe aktualisiert. |
