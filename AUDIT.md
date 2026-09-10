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

---

# Audit 5: Bedienfluss, Exporte & Textbausteine, Sicherheit (September 2026)

> **Status: abgearbeitet.** Neue Suite `workflow-test.mjs` (41 Prüfungen), Browser-Verifikation der neuen Bedienelemente (Kontroll-Übersicht, Vorlagen-Editor, Papierkorb, Kampagnen-Datumsvorschlag, Übergabeschreiben) ohne Konsolenfehler.

Leitfrage: Ist der komplette Weg *Planung → Kontrolle → Nachbereitung → Wiedervorlage* so
unkompliziert, einheitlich und sicher wie möglich – und werden an allen geeigneten Stellen
fertige Schreiben und Exporte angeboten?

## Bedienfluss

| Befund | Reparatur |
|---|---|
| Kontroll-Übersicht war eine reine Liste: für „in Ordnung" musste jeder Azubi einzeln geöffnet, das Ergebnis gesetzt und zurücknavigiert werden. | „✓ i.O." direkt in der Zeile, Sammelleiste („Alle offenen → i.O.", „Nächster offener Azubi"), Fortschritt „offen / abwesend / fremde Ämter"; Abschluss-Block in der Übersicht. |
| Nach „In Ordnung" blieb man im Bogen stehen; „Nächster" sprang auch auf bereits erledigte Azubis. | Auto-Weiter zum nächsten OFFENEN Azubi (abschaltbar), Schnellnavigation färbt sich mit. |
| Ansichtswechsel (z.B. zu den Wiedervorlagen) warf die laufende Kontrolle weg – Termin musste neu gewählt werden. | Kontroll-Ansicht öffnet den zuletzt geöffneten Termin wieder. |
| Abschluss-Assistent kannte weder Abwesende noch fremde Ämter; Nachholungen mussten von Hand als Wiedervorlage angelegt werden. | Assistent listet offene Azubis (klickbar), legt für Abwesende Nachholungs-Wiedervorlagen mit Frist an, öffnet auf Wunsch die Nachholungs-E-Mail und den Ämter-Dialog. |
| Einzelzellen-Aktionen im KW-Raster (`O`, `1–5`, `0`, Fehltage-Popover, Sammel-„OK") hatten KEINEN Undo-Eintrag – Strg+Z sprang unbemerkt an eine ältere Aktion. | Alle Zellaktionen erzeugen Undo-Einträge; Sammel-OK als EIN aggregierter Eintrag. |
| Fehltage-Popover übernahm bei Fokusverlust (Klick daneben) stillschweigend den halbfertigen Wert. | Übernahme nur mit Enter; Fokusverlust verwirft. Größere automatische „geprüft bis"-Sprünge werden per Hinweis gemeldet. |
| Kampagnen-Assistent verlangte je Schule ein Datum von Hand. | „📅 Datumsvorschläge für alle": erster Dienstag im Kampagnen-Zeitfenster mit Blockplan-Treffer (sonst erster Dienstag), vorhandene Eingaben bleiben. |
| Wiedervorlage ohne Durchsicht (Nachweis per Post/E-Mail) ließ sich nur über den Umweg „→ Durchsicht" schließen. | „✓ Erledigt" in der Zeile mit Datum/Bemerkung; Hinweis, wann die Durchsicht der bessere Weg ist. |

## Exporte & Textbausteine

| Befund | Reparatur |
|---|---|
| E-Mail-Texte waren im Code verstreut und fest verdrahtet (Schule, Betrieb, Wiedervorlage) – ohne gemeinsame Absenderdaten, ohne Anpassbarkeit. | Zentrales Vorlagen-System (`App.VORLAGEN`, 11 Typen: Terminanfrage/Ergebnis Schule, Betrieb BCC/Ankündigung/Mängel/i.O./Brief, Wiedervorlage Mahnung/Erinnerung, Nachholung, Übergabe an anderes Amt). Editor in den Einstellungen mit Platzhalter-Chips, Vorschau mit Beispieldaten, Standardtext wiederherstellbar; gilt für alle Nutzer der Datenbank. |
| Absender/Funktions-E-Mail fehlten; Prüfer-E-Mail wurde nirgends genutzt. | Einstellung `rp_email` (An-Adresse bei BCC-Sammelmails, Platzhalter), Prüfer-E-Mail aus den Stammdaten (`absenderCtx`), RP-Postadresse in allen Schreiben. |
| Betriebe ohne E-Mail fielen bei Sammelmails stumm heraus. | Zähler „Briefe für n Betriebe ohne E-Mail" → PDF-Anschreiben nur für diese; „✎ E-Mail nachtragen" direkt aus dem Dialog. |
| `mailto:` wurde bei langen Texten abgeschnitten (Ergebnislisten). | Über ~1900 Zeichen: Text in die Zwischenablage, Mail mit Betreff öffnet sich, Hinweis zum Einfügen. |
| Fremde Ämter: nur PDF + Excel, kein Anschreiben, Adressen nicht hinterlegbar. | „✉︎ Übergabeschreiben" je Amt (Vorlage `amt_uebergabe`), Ämter-E-Mails in den Einstellungen (werden beim ersten Versand gemerkt). |
| Dateinamen uneinheitlich (Umlaute, Leerzeichen, Kommas), ICS-Export ohne Ort/Anzahl und mit falscher Schule bei LFK-Terminen. | `App.safeFilename()` für alle Downloads; ICS mit Kontrollort, Prüfer, Azubi-Anzahl, Bemerkung; RFC-5545-Maskierung. |
| Keine tabellarische Ergebnisliste je Termin; Gesamtpaket-Dialog mit kaputtem Markup und irreführendem „Excel-Dashboard". | „▤ Excel" je Termin (Ergebnis, Fehltage, offene Mängel je AJ/KW, WV-Frist, Amt) – auch im Gesamtpaket; Dialog bereinigt; PDF-Anschreiben mit einheitlicher Fußzeile (`PDFExport.footer`). |

## Sicherheit / Datenverlust

| Befund | Reparatur |
|---|---|
| Löschen von Azubi, Termin, Jahrgang, Schule, Klasse, Prüfer, Betrieb, Wiedervorlagen: nackte `confirm()`-Abfragen ohne Angabe, was mitgelöscht wird. | Rückfragen nennen die betroffenen Mengen (Ergebnisse, Wiedervorlagen, Notizen, Zuordnungen) und Alternativen („Ausbildung beenden" statt löschen); Erfolgsmeldungen. |
| Gelöschte Azubis/Termine waren unwiederbringlich weg (nur über Datei-Backups). | **Papierkorb** (`bhk_papierkorb`, 3 Schema-Stellen, 90 Tage): Kaskaden legen die Hauptzeile samt ALLER abhängigen Zeilen als JSON ab; Wiederherstellung mit unveränderten IDs (Verknüpfungen intakt), hebt Tombstones auf, verweigert Doppelanlage; Größenschutz (Snapshots werden bei Bedarf weggelassen). |
| Löschungen tauchten nicht im Änderungs-Logbuch auf; Re-Import überschrieb manuell korrigierte Felder spurlos. | Löschung/Wiederherstellung mit Name + IBYKUS-ID im Logbuch; überschriebene Felder als `import_ueberschrieben` protokolliert. |
| Import schaltete den aktiven Jahrgang FÜR ALLE NUTZER stillschweigend um (Nachimport eines älteren Jahrgangs → Kollegen arbeiten plötzlich in der falschen Kohorte). | Umschaltung nur nach Rückfrage, mit Angabe des bisher aktiven Jahrgangs. |
| Backups ließen sich nur über den Dateimanager zurückspielen – ohne Rücksicht auf Op-Logs/Snapshot-Generation (andere Rechner hätten weitergearbeitet, als wäre nichts passiert). | Backup-Liste in den Einstellungen; `App.restoreBackup()`: Integritätsprüfung, eigene Änderungen wegschreiben, aktuellen Stand als `…_vor-wiederherstellung` sichern, Backup als neue Snapshot-Generation kompaktieren → alle Clients übernehmen ihn beim nächsten Abgleich. Doppelte Bestätigung (Tippwort). |
| F5 (Neu-Laden von der Platte) und „Word-Vorlage entfernen" ohne Rückfrage; Sammel-Löschen von Wiedervorlagen ließ Notizen als Datenleichen zurück. | Rückfragen; Notizen werden mitgelöscht und mitgezählt. |

**Bewusst so gelassen:** Der Papierkorb speichert ein JSON-Paket pro Löschung (kein
Zeilen-Versionierung); sehr große Termin-Pakete (>400 KB) werden ohne PDF-Snapshots abgelegt.
Die Backup-Wiederherstellung ist absichtlich ein „harter" Schnitt für alle Nutzer – ein
selektives Zurückholen einzelner Datensätze läuft über den Papierkorb.


---

# Audit 6: Parallelzugriff auf dem Windows-Netzlaufwerk (September 2026)

> **Status: abgearbeitet.** Vollständige Code-Lektüre des Sync-v3-Pfads (Append, Poll,
> Bootstrap, Kompaktierung, Lock, Snapshot-Tausch, Crash-Puffer, Bulk-Import) gegen die
> Eigenheiten eines Windows-SMB-Laufwerks. Neuer Harness `tests/_sync-harness.mjs`
> (Fake-Netzlaufwerk mit Lesefehlern, Negativ-Cache, Schreibfehlern) und Suite
> `sync-stress-test.mjs` (36 Prüfungen: 10 Störfall-Szenarien + Zufalls-Stresstest mit
> drei Clients unter 8 % Lesefehlern, mehrere Seeds). Jeder Befund wurde zuerst als
> fehlschlagender Test nachgestellt und dann repariert; 30 zusätzliche Zufalls-Seeds
> ohne Divergenz.

Ausgangsfrage: Funktioniert die gleichzeitige Arbeit von drei Nutzern in derselben
Datenbank auf einem Windows-Netzlaufwerk sauber? **Antwort nach dem Audit: Die
Architektur (ein Schreiber pro Datei, Snapshot nur unter Lock) ist tragfähig; im Detail
gab es aber acht Wege, auf denen Änderungen verloren gehen oder die Rechner dauerhaft
verschiedene Stände zeigen konnten. Alle sind behoben.**

## Behobene Hoch-Befunde (Datenverlust / dauerhafte Divergenz)

| # | Befund | Reparatur |
|---|---|---|
| H1 | **Lesefehler mitten im Poll verschluckte Ops.** Chrome meldet `NotReadableError`, wenn ein Kollege sein Log zwischen `getFile()` und dem Lesen per Swap-Datei ersetzt hat – auf SMB an der Tagesordnung. `_pollOplogs` hatte die Offsets der bereits gelesenen Logs schon vorgerückt, warf dann aber den ganzen Batch weg. Die Ops galten als gelesen, wurden nie angewendet, und die nächste eigene Kompaktierung erklärte sie für „enthalten“: **endgültiger Verlust bei allen Nutzern.** Dasselbe Muster im Bootstrap und beim Snapshot-Tausch. | Jede Log-Datei wird für sich gelesen (`_leseLogDatei`); Offsets werden erst NACH dem Anwenden übernommen; eine unlesbare Datei behält ihren Lesestand. Bootstrap: Lesestand bleibt auf dem snapmeta-Offset. Snapshot-Tausch: ist das EIGENE Log gerade nicht lesbar, wird der Tausch verschoben. Test S1. |
| H2 | **Kontrollergebnis-IDs nach Snapshot-Tausch:** Öffnen zwei Prüfer denselben Termin, legen beide alle Ergebnis-Zeilen an (`INSERT OR IGNORE`, verschiedene globale IDs). Kompaktiert danach jemand, übernimmt der andere Prüfer den Snapshot mit den FREMDEN IDs – seine geöffnete Durchsicht schreibt aber weiter mit den IDs, die sie beim Rendern kannte: `UPDATE … WHERE id=?` traf keine Zeile, der Natural-Key-Umbau fand die Zeile nicht, die Op kam nirgends an. **Jede weitere Eingabe dieses Prüfers ging still verloren** – genau im Hauptanwendungsfall (zwei Prüfer, ein Termin). | `_keIdsLokalHalten`: nach dem Tausch werden Zeilen mit gleichem fachlichem Schlüssel auf die bisherige LOKALE ID zurückgeschrieben (samt FK-Verweisen). Lokale IDs sind Privatsache – alle Ops reisen ohnehin über den fachlichen Schlüssel. Test S2. |
| H3 | **Reihenfolge nach Snapshot-Tausch:** Der Tausch spielte erst die eigenen Nachzügler-Ops nach und der folgende Poll danach die fremden – eine ÄLTERE fremde Op überschrieb so die NEUERE eigene. Ebenso wurden ungespeicherte Puffer-Ops nach dem Tausch bedingungslos angewendet. | Eigene und fremde Nachzügler werden vor dem Tausch eingesammelt und GEMEINSAM in Zeitstempel-Ordnung angewendet; Puffer-Ops laufen durch den LWW-Guard. Test S3. |
| H4 | **Last-Write-Wins nur für Kontrollergebnisse.** Alle anderen Tabellen (KW-Raster `kw_status`, Stammdaten, Wiedervorlagen, Termine) übernahmen stur die zuletzt EMPFANGENE Op. Zwei Nutzer, die dieselbe Zeile innerhalb des Poll-Fensters änderten, sahen danach dauerhaft verschiedene Stände; der Stresstest zeigte das zuverlässig. | Generischer, spaltenbewusster LWW-Guard für alle `UPDATE … WHERE k=?`- und UPSERT-Ops: Stempel (ts, Client, Sequenz – exakt die Sortierordnung des Replays) je Zeile und Spalte aus eigenen und fremden Ops. Deterministisch auch bei gleichen Millisekunden. Test S9. |
| H5 | **Stempel gingen mit dem Snapshot verloren:** Nach Tausch oder Neustart wusste ein Client nichts über die Aktualität der Zeilen im Snapshot – sein eigener älterer Nachzügler überschrieb den neueren Wert des Kollegen. | Der Kompaktierer schreibt seine Stempel in die Snapshot-Tabelle `bhk_stamps`; Bootstrap und Tausch laden sie, bevor Log-Ops angewendet werden. Test S10. |
| H6 | **Bulk-Import ohne Kompaktierung:** IBYKUS-Import umgeht das Op-Log und wird als Snapshot kompaktiert. Scheiterte das (Lock belegt, Schreibfehler), lag der Import NUR im Speicher – kein Log, kein Crash-Puffer. Die nächste fremde Kompaktierung löschte ihn beim Tausch; Browser zu = Import weg. Zudem Sackgasse: die eigene Kompaktierung verweigerte sich, solange der fremde Snapshot nicht übernommen war. | Bulk-Anweisungen werden im Speicher mitgeschrieben (`_bulkOps`); nach einem Tausch werden sie auf der frischen DB wiederholt; die Kompaktierung wird alle 30 s nachgeholt (`_nachholenBulk`), Status „Import nicht gespeichert“ + Warnung, das Fenster offen zu lassen. Test S6. |
| H7 | **Lock-Race durch Windows-Negativ-Cache:** Der SMB-Redirector cacht „Datei nicht vorhanden“ 5 s (FileNotFoundCacheLifetime). Ein `create:false`-Lookup meldete das Lock als fehlend, obwohl der Kollege es gerade angelegt hatte – beide kompaktierten gleichzeitig (Snapshot und snapmeta konnten sich kreuzen). | Lookup über `create:true` (OPEN_ALWAYS geht immer zum Server; leere Datei = frei), zweite Prüfung erst nach 1,2–2,0 s, Lock-Besitz wird vor dem snapmeta-Write nochmals verifiziert; die Start-Kompaktierung streut zufällig 20–80 s. Test S5. |
| H8 | **Crash-Puffer verfiel nach einer Stunde.** Netzausfall am Feierabend + zugeklappter Laptop: am nächsten Morgen wurden die ungespeicherten Änderungen still verworfen. | 7 Tage; die Ops tragen ihren Original-Zeitstempel, der LWW-Guard ordnet sie korrekt ein. Test S4. |

## Behobene Mittel-/Niedrig-Befunde

- **Verschwundenes eigenes Log** (nach 3 Tagen Stillstand aufgeräumt, Ordner zurückgespielt): Der Schreiber begann dieselbe Datei leer neu, Leser hielten einen Lesestand hinter dem neuen Dateiende. Jetzt: neue Generation. Test S7.
- **Abgeschnittener Snapshot** (SMB liefert bei laufendem Write Teilinhalte): `PRAGMA quick_check` vor dem Tausch; Schema-Header allein reichte nicht. Test S8.
- **Offline-Erkennung im v3-Pfad:** Fehlgeschlagene Appends zeigten nur einen roten Punkt und probierten stumm alle 5 s. Nach drei Fehlversuchen erscheint das Banner „Verbindung getrennt – Erneut verbinden“ (holt die Datei-Handles neu).
- **Getrennt-Anzeige** entstand auch, wenn nur EINE Log-Datei dauerhaft unlesbar war – und der Client bekam gar keine fremden Änderungen mehr. Jetzt laufen die anderen Dateien weiter.
- **Offene Durchsicht bleibt aktuell:** Ändert ein Kollege genau den geöffneten Azubi (Raster, Ergebnis), wird die Ansicht neu gezeichnet, sobald hier nicht getippt wird – vorher arbeitete man bis zum nächsten Azubi-Wechsel auf einem veralteten Raster.
- **Crash-Restore** läuft durch den LWW-Guard (Bootstrap-Ops können neuer sein).

## Betriebsvoraussetzungen (aus dem Audit abgeleitet, in Hilfe und TECHSTACK dokumentiert)

- Der Arbeitsordner muss auf **einem** Dateiserver liegen: kein DFS-Replikat, kein OneDrive/SharePoint-Sync, keine Windows-**Offlinedateien** (Client-Side-Caching) für die Freigabe – sonst arbeiten die Rechner auf Kopien.
- Virenscanner: Ausnahme für `_bhk/` (die `.crswap`-Zwischendateien werden sonst blockiert → `InvalidStateError`-Rotationen).
- Uhren der Rechner per Domäne synchron (Lamport-Stempel fangen Versatz ab, aber Anzeige-Zeitstempel folgen der Rechneruhr).
- Pro Datenbank nur **ein** Browser-Tab pro Nutzer (Zweit-Tab ist nur lesend sinnvoll).
- Latenz: Änderungen der Kollegen erscheinen nach 3–13 s (Poll 3 s + SMB-Metadaten-Cache bis 10 s). Das ist kein Fehler.

**Bewusst so gelassen:** Löschung gewinnt weiterhin gegen einen parallelen Edit
derselben Zeile (Tombstone). Bei einer Op, deren Spalten teils neuer, teils älter
sind als der lokale Stand, wird die ganze Op angewendet (kein spaltenweises
Zerlegen von SQL) – lieber ein älterer Wert in einer Nebenspalte als eine verlorene
Änderung. Die 3-Tage-Bereinigung fremder Logs bleibt; der Schreiber erkennt das
inzwischen selbst.


---

# Audit 7: Gesamt-Workflow – Logik, Bedienfluss, Ausbau (September 2026)

> **Status: Befunde erhoben, priorisierte Roadmap in `ROADMAP.md`.** Fünf parallele
> Prüfbereiche entlang des Jahresablaufs; alle hohen Befunde im Code nachverifiziert.
> Reparaturen folgen paketweise (siehe Roadmap, Stufe 1 Pakete A–E).

## 7.1 Stammdaten, Import, Akte

| Nr | Schwere | Befund | Vorschlag |
|---|---|---|---|
| 1 | hoch | Namens-Fallback beim Re-Import ignoriert eine abweichende BAV-Ident (`import-handler.js:638-651`): Betriebswechsel/Neuvertrag trifft dieselbe Zeile, Status/Betrieb je nach Zeilenreihenfolge falsch. | Fallback nur bei leerer Ident; Namenstreffer mit anderer Ident als „Neuvertrag/Dublette" melden. |
| 2 | hoch | Azubis, die im Export fehlen, werden nie erkannt; Anleitung empfiehlt Filter „Nicht Ende" → ENDE-Logik greift praktisch nie. | Lauf-Kennung je Azubi, Nachlauf-Liste „fehlen im Export" mit Sammelaktion „Ausbildung beenden". |
| 3 | hoch | Bulk „Inaktiv setzen" schreibt `status='inaktiv'` (`stammdaten.js:363`), im Dialog unbekannt → nächstes Speichern reaktiviert (`import-handler.js:1093`). | Einheitliches Status-Enum, zentrale Funktion. |
| 4 | hoch | BAV „ENDE" + Prüfungserfolg „bestanden" → „abgebrochen" (`import-handler.js:616/677/723`); `ap_bestanden` nie aus Import. | ENDE+bestanden → `ap_bestanden`; `inaktiv_datum = ausbildungsende`. |
| 5 | hoch | Bulk-Leiste der Schülerliste nach Besuch des Stammdaten-Tabs tot (`stammdaten.js:296` überschreibt `getSelected`); Bulk-Klasse/Jahrgang/FR rendern in `stammdatenContent` (`bulk-schueler.js:49-91`). | Override entfernen, `_refresh()` überall. |
| 6 | hoch | `klassen.lehrjahr` statisch (Filter `app-core.js:34`, Liste `schueler-view.js:60`, DQ-Regel `berichte.js:1023`) – ab dem 2. Schuljahr ein Jahr zu niedrig. | Überall `getCurrentAJ`; Klassen-LJ nur Fallback. |
| 7 | hoch | Betrieb bearbeiten ohne Betriebsnummer: `''` statt `NULL` → UNIQUE-Fehler ohne Meldung (`stammdaten.js:1411`). | `\|\| null` + Dublettenprüfung wie `saveBetrieb`. |
| 8 | mittel | Status-/aktiv-Übergänge an fünf Stellen unterschiedlich (Dialog `ap_bestanden` ohne Grund, „verlängert" → `aktiv=0`, kein Log bei Bulk/Jahrgang). | `App.setSchuelerStatus()` + Dialog „Ausbildung beenden". |
| 9 | mittel | Aktenvermerk-PDF liest `w.typ/w.frist/w.beschreibung` – Spalten existieren nicht (`schueler-akte.js:387-392`). | `art`/`frist_datum`. |
| 10 | mittel | Drei Fehltage-Zahlen je Azubi (Dialog KW-Summe, Dashboard Phasen-Pauschale, Kontrolle `fehltage_gesamt`). | Eine Quelle. |
| 11 | mittel | „Jahrgang abschließen" setzt pauschal alle auf „AP bestanden" (`schueler-view.js:125-141`). | Vorschau mit Ausnahmen, Ergebnis aus `pruefungserfolg`. |
| 12 | mittel | „Alle löschen" (Jahrgang) löscht Termine samt Ergebnissen fremder Jahrgänge (`import-handler.js:1521`). | Nur Verknüpfungen lösen. |
| 13 | mittel | Amt-Standardfilter versteckt Azubis ohne Amt (manuelle Anlage ohne Amt-Feld). | Amt-Feld mit Vorbelegung 93, DQ-Regel, Hinweis-Badge. |
| 14 | mittel | Vergütungs-Dashboard rechnet ohne `beruf_id` immer GaLaBau (`azubi-rechner.js:434`). | Mapping Fachrichtungs-Code → Beruf. |
| 15 | mittel | Jahrgangswechsel im Dashboard legt zweiten aktiven Jahrgang an, Klasse bleibt (`azubi-dashboard.js:313-318`). | `aktiv=0`; Klasse vorschlagen. |
| 16 | mittel | Betriebe-Tab verknüpft beim Öffnen automatisch per Teilstring ohne Rückfrage (`stammdaten.js:1175/1240`). | Nur auf Klick mit Vorschau. |
| 17 | mittel | LFK-Import: Text verspricht Namens-Zuordnung, Code kann nur Ident; LFK als Freitext statt Schul-Referenz. | Namens-Fallback; `berufsschule_id`. |
| 18 | mittel | DQ-Duplikatregel wirkungslos (Geburtsdatum nicht importierbar, `import-handler.js:105-134`). | Geburtsdatum in Spaltenzuordnung. |
| 19 | mittel | Schul-Zuordnung per beidseitigem Teilstring (`import-handler.js:491`). | Exakt/normalisiert, Teilstring nur Vorschlag. |
| 20–24 | niedrig | LJ im Dialog ohne Phasen; Akten-Dateien bleiben nach Löschung auf dem Laufwerk; Import-Zusammenfassung zählt falsch; Azubi-Tabelle 4 Abfragen/Zeile; Dateinamen ohne `safeFilename`. | Kleinkram. |

Fehlende DQ-Regeln: `aktiv=1` mit Endstatus, unbekannter Statuswert, `aktiv=0` ohne Datum, ENDE bei aktiv, `ap_bestanden` bei nicht bestanden, Amt leer, Vertragsdauer ≠ Regel−Verkürzung, LFK-Text ohne Schule, Klasse mit fremder Fachrichtung.

## 7.2 Kontrollplanung

| Nr | Schwere | Befund | Vorschlag |
|---|---|---|---|
| 1 | hoch | Schülerzahl der Kampagnen-Termine = 0: Cache zählt nur Klassenmitglieder (`app-core.js:5450/5541`); Planung, Kontrolle-Dropdown, Berichte zeigen falsche Zahlen. | Einzel-Zuordnung + KE-Zweig in den Preload. |
| 2 | hoch | Kohortenjahr (`planung.js:30-33`) und Kampagnenfenster (`:1115-1123`) laufen auseinander (Jan: AP S2026 mit Fenster Nov/Dez 2026). | Erst Fenster, dann Jahre aus dem Fensterjahr. |
| 3 | mittel | Lehrjahr-Filter des Assistenten mit heutigem AJ statt AJ zum Termin (`app-core.js:5896`). | `getAJAtDate(…, fenster.von)`. |
| 4 | mittel | Blockplan-Vorschlag ohne Schuljahr/Lehrjahr (`planung.js:1137/1163`). | Schuljahr aus Zieldatum, Lehrjahre einschränken. |
| 5 | mittel | Blockplan-Raster zeigt KW 53 in 52-Wochen-Jahren (`stammdaten.js:1072`). | ISO-Regel. |
| 6 | mittel | KW-Kalender im Termin-Dialog nur über Klassen-Checkboxen, nur heutiges Schuljahr (`planung.js:618-661`). | Ort-Select und Einzel-Azubis als Quellen. |
| 7 | mittel | Standort-Klick setzt keinen Ort → Terminanfrage bricht ab (`planung.js:509-520`, `workflows.js:82`). | Ort vorbelegen, ohne Ort warnen. |
| 8 | mittel | LFK-Standorte finden keine Berufsschule (Freitext vs. `name=?`, `planung.js:1136/1160/1180`). | Fuzzy oder Referenz; ohne Ort nicht anlegen. |
| 9 | mittel | Keine Doppeltermin-Prüfung (Assistent doppelt alle Termine beim zweiten Lauf). | Vorhandene Termine ±14 Tage anzeigen. |
| 10 | mittel | Dashboard/Kalender: `kl[0].schule` statt `getTerminSchule`, ein Termin pro Tag (`views.js:188/975-983`). | Überall `getTerminSchule`, Array je Tag. |
| 11 | mittel | Terminanfrage für Kampagnen-Termine: Betreff „– – –", Gruppen nur aus Klassen (`workflows.js:49-65`). | Gruppen aus Azubis (FR + AJ zum Termin). |
| 12 | mittel | Status-Modell: `abgesagt` ohne Bedienweg; vergangene geplante Termine verschwinden vom Dashboard. | Absagen/Verschieben; Hinweiszeile. |
| 13 | mittel | Schul-Kommunikation ohne Spur (kein „angefragt/bestätigt am"). | Felder + Badge. |
| 14–21 | niedrig | ICS nicht idempotent (UID, DTSTAMP); `jahrgang_id='null'`; Platzhalter-Chips unvollständig; alle Prüfer vorbelegt; FR-Filter nach Vorlage; Amt-Excel mit Rohcodes; Nachholungs-Frist = beliebiger Termin; `BlockplanAnalyzer` toter Code. | siehe Roadmap. |

## 7.3 Kontrolldurchführung

| Nr | Schwere | Befund | Vorschlag |
|---|---|---|---|
| 1 | hoch | Fehltage-Wochen (H-only) fehlen im Durchsichtsbogen-PDF (`pdf-export.js:130-183`); `geprueft` nicht in `kwData`. | Wie am Bildschirm rendern. |
| 2 | hoch | Übersicht, Druckliste, Auto-AP-Zulassung ignorieren `fehltage_pauschal` (`kontrolle.js:156/524`). | `App.getFehltageGesamt(sid)` überall. |
| 3 | hoch | Gegenseitige Sperre beim gleichzeitigen Öffnen desselben Azubis (beide beim ersten offenen, `kontrolle.js:67-72/335/1863`). | Tie-Break per Positions-Zeitstempel oder nur Warnung. |
| 4 | hoch | „Sperre aufheben" hält 8 s (`kontrolle.js:2031`, `doLiveSync:1864`). | Override-Merker; Positionen > 5 min ignorieren. |
| 5 | mittel | Modal-Pfad `saveKWOk` umgeht `behobene_codes`/`autoUpdateFehltage`, nutzt `currentIndex` (`kontrolle.js:1586-1605`). | `KWNav.persistCodes(...)`. |
| 6 | mittel | Kein Undo für Modal, Sonstiges, Bereichs-Markierung. | Vorzustand einfrieren, aggregiert pushen. |
| 7 | mittel | WV-Art folgt nicht dem Ergebnis; erledigte WV wird nicht wieder geöffnet (`kontrolle.js:1473-1525`). | `saveWV` bei jeder Ergebnisänderung inkl. Status-Reset. |
| 8 | mittel | „Nachholung bis nächste Durchsicht" nimmt nächsten beliebigen Termin (`:1406/2215`). | Termin derselben Schule/des Azubis. |
| 9 | mittel | „✓ i.O."-Schnellweg markiert keine Wochen als geprüft (`:357-408`). | `persistCodes` bis Vorwoche. |
| 10 | mittel | Nacherfassung „In Ordnung" schließt offene WV nicht; rückdatierte Codes als offene Mängel (`nacherfassung.js:248-262`). | Wie `_markOK`; jüngere Durchsicht → `behobene_codes`. |
| 11 | mittel | Auto-AP-Zulassung ohne Bezug zum Ausbildungsjahr (`:167-175`). | Nur im letzten AJ. |
| 12 | mittel | Ergebnis-Radios feuern bei Pfeil-Navigation Nebenwirkungen (`:1323-1331/1481`). | Entprellen, Kürzel. |
| 13 | mittel | Sperre nach Azubi-Wechsel bis 2 min unsichtbar (Delete/Write-Race, `:1700-1757`). | Nur überschreiben; Heartbeat 30 s. |
| 14 | mittel | PDF-Unterschrift = letzter Schreiber (`pdf-export.js:438`). | Feld `pruefer` am KE. |
| 15 | mittel | „PDFs für mangelhafte Schüler" erzeugt alle Bögen (`:2362-2371`). | Gefilterte Liste. |
| 16–25 | niedrig | AJ-Kopf bei Verkürzern; Schuljahr-Label bei 1.8.-Verträgen; Prüfmarkierung wird wieder aufgefüllt; „diese Sitzung" nicht unterscheidbar; Fehltage-Obergrenzen 5/7; Strg+←/→ außerhalb der Kontrolle; `reopenKontrolle`-Ansicht; Fokus unsichtbar; KW 53 fehlt; Anlage-Block 5× kopiert. | siehe Roadmap. |

## 7.4 Nachbereitung, Berichte, Dashboard

| Nr | Schwere | Befund | Vorschlag |
|---|---|---|---|
| 1 | hoch | Nacherfassung schließt die alte Wiedervorlage nicht (`nacherfassung.js:249-252`). | Wie `_markOK`. |
| 2 | hoch | Betrieb ohne E-Mail erhält nach der Kontrolle einen Brief mit Terminankündigung (`workflows.js:414`, Aufrufe `:227/265/519`, `berichte.js:290`). | Brief nach Vorlagentyp. |
| 3 | hoch | Abwesende werden als „ohne Beanstandung" bestätigt (`workflows.js:294-298`). | Ohne Ergebnis ausschließen. |
| 4 | hoch | Excel-Dashboard Blatt 2–5 zählt Ergebnis-Zeilen statt Azubis (`berichte.js:129-207`). | `COUNT(DISTINCT)`, letztes Ergebnis; Test. |
| 5 | hoch | Sidebar-Badge „überfällig" ≠ Dashboard (`app-core.js:7089` vs. `views.js:1101`). | Gemeinsame Zählfunktion. |
| 6 | hoch | Jahresbericht ohne Zeitraum, inkonsistente Erfolgsquote, Schulstatistik zählt mehrfach (`berichte.js:322-395`). | Schuljahresgrenzen, „letztes Ergebnis im Zeitraum". |
| 7 | mittel | Nachweis ohne Durchsicht lässt Azubi dauerhaft rot (Ampel/Zulassung nutzen letztes Ergebnis). | „nachgewiesen"-Zustand oder Mini-Nacherfassung. |
| 8 | mittel | „→ Durchsicht" überschreibt das historische Ergebnis (`wiedervorlagen.js:15-18`). | Auf Nacherfassung verlinken. |
| 9 | mittel | Wieder-Mangel nach „In Ordnung" erzeugt keine offene WV (`kontrolle.js:1475/1525/2345`). | Status-Reset. |
| 10 | mittel | Falsche Vorlage für Nachholungs-WVs (`workflows.js:448`); WV-Art kein Platzhalter. | Nach `w.art` verzweigen. |
| 11 | mittel | Kein Versandnachweis, keine Mahnstufe (nur Erinnerung schreibt Notiz). | Versandprotokoll, `mahnstufe`. |
| 12 | mittel | Fremde Ämter: WV angelegt, gemahnt, Seriendruck (`kontrolle.js:2327-2350`, `workflows.js:141`). | Standardmäßig ohne WV, §-Badge/Filter. |
| 13 | mittel | Ausbildung beenden lässt offene WVs stehen; Listen ohne `aktiv`-Filter. | Beim Inaktivsetzen schließen. |
| 14 | mittel | ICS: UID-Kollision Termine/WV, WV-Export mit Termin-Dateinamen (`app-core.js:7186`, `wiedervorlagen.js:225`). | UID aus Entität+ID. |
| 15 | mittel | „PDFs für mangelhafte Schüler" = alle Bögen (`kontrolle.js:2364-2370`). | Gefiltert / je Betrieb. |
| 16 | mittel | Gesamtpaket: Label irreführend, Stammschule statt Termin-Ort, Ladeanzeige endet vorzeitig (`berichte.js:243/257`, `workflows.js:386`). | Korrigieren. |
| 17 | mittel | Vorlagen-Vorschau meldet gültige Platzhalter als unbekannt (`views.js:1555-1565`); Chip-Listen unvollständig. | Beispielkontext vervollständigen, Chips aus Text ableiten. |
| 18–22 | niedrig | `checkAutoErledigt` schreibt datetime statt date und zählt `H` als Mangel; Bulk-Frist reaktiviert Erledigte; Word-Brief nur eine Frist; `emailBetriebWV` Prüfer = letzter Bearbeiter; Dateinamen/Zulassungs-Excel. | siehe Roadmap. |

## 7.5 Querschnitt und Bedienung

| Nr | Schwere | Befund | Vorschlag |
|---|---|---|---|
| 1 | hoch | Dialog schließt sich sofort wieder: `closeModal()` → `history.back()`, verzögertes `popstate` schließt den neu geöffneten Dialog (`app-core.js:7157-7172, 6483`); betrifft Stammdaten, Datenqualität, Azubi-Dashboard, Import. | `event.state` prüfen / `App.replaceModal()`. |
| 2 | hoch | Sidebar-Badge ≠ Dashboard ≠ Liste (siehe 7.4 Nr. 5). | Gemeinsame Funktion. |
| 3 | hoch | „Ansicht nach Reload" liest `last_view` vor dem Benutzer-Restore (`app-core.js:6441` vs. `6497`) → greift nie. | Benutzer-Restore vorziehen. |
| 4 | hoch | „Verbindung trennen" ruft `doAutoSave()` ohne `await` und leert danach (`app-core.js:1648-1661`). | `await`; Rückfrage bei Fehler. |
| 5 | mittel | Standardfilter erscheinen als Nutzerfilter mit ✕; `_cleanupDB` setzt Amt/ZP/Extra nicht zurück. | „Standard"-Chip; vollständiger Reset. |
| 6 | mittel | Durchsicht ohne gewählten Prüfer möglich (`kontrolle.js:46`). | Auswahl erzwingen. |
| 7 | mittel | Drei Klarnamen-Prüfer bei jedem Start neu angelegt (`app-core.js:6847-6851`). | Seed nur bei Neuanlage. |
| 8 | mittel | Undo ansichtsübergreifend und unsichtbar. | Stack leeren, Name im Toast. |
| 9 | mittel | WV-Notiz „Erstellt von" ignoriert `currentUser` (`wiedervorlagen.js:155`). | Vorbelegen. |
| 10 | mittel | Doppelte Toasts „Jetzt speichern"/„Neu laden", Neu laden ohne Rückfrage (`views.js:1290`). | Bereinigen. |
| 11 | mittel | WV-Ansicht schreibt bei jedem Öffnen eine Op (`views.js:1101`). | Nur bei Treffern / rein berechnen. |
| 12 | mittel | Hilfe widerspricht dem Verhalten (8 s/Sperrsystem, Tab-Namen, Terminstatus, feste Version). | Hilfe bereinigen, Version aus Build. |
| 13 | mittel | F1 nur Tastenkürzel, keine Kontext-Hilfe. | F1 → Kapitel der Ansicht. |
| 14 | mittel | Barrierefreiheit: Modal ohne `role/Fokus`, Toasts ohne `aria-live`, klickbare `div/span`, 9-px-Schrift. | Buttons, Fokus-Trap, `aria-live`. |
| 15 | mittel | Kein geführter Erststart (6–7 unverbundene Schritte). | Leerzustand-Checkliste. |
| 16–25 | niedrig | Modal-Titel unescaped; Begriffe uneinheitlich; Scrollposition bleibt; Hash vs. `last_view`; Fehlermeldungen ohne Ursache; native `prompt/confirm`; Dark-Mode-Flackern; Statusanzeigen; Auswertungen hinter Passwort; WV-Filter „offen" ohne Überfällige. | siehe Roadmap. |
