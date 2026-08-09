# Gesamt-Audit Berichtsheftkontrolle

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
