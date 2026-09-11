# Roadmap – Ergebnis des Gesamt-Workflow-Audits (Audit 7, September 2026)

> **Stand:** Stufe 1 (Pakete A–E) ist umgesetzt – siehe Git-Historie sowie `tests/status-test.mjs`, `tests/kontrolltag-test.mjs`, Abschnitt Paket D in `tests/planung-test.mjs` und Abschnitt Paket E in `tests/workflow-test.mjs`. Offen aus Stufe 1: Hilfe-Tab-Namen im Detail (E6) – siehe Stufe 2 „Glossar/Hilfe".

> Grundlage: fünf parallele Prüfbereiche entlang des Jahresablaufs (Stammdaten/Import,
> Planung, Durchführung, Nachbereitung/Berichte, Querschnitt/Bedienung), alle hohen
> Befunde im Code nachverifiziert. Audits 2–6 (Sync, Planung, Nacherfassung,
> Bedienfluss, Netzlaufwerk) sind abgearbeitet und hier nicht wiederholt.
> Detailtabellen mit Datei:Zeile stehen in `AUDIT.md`, Abschnitt „Audit 7".

## Gesamtbild

Das Werkzeug deckt den kompletten Jahresablauf ab und ist im Kern (Sync, KW-Raster,
Kampagnen, Vorlagen, Papierkorb) belastbar. Die verbleibenden Probleme liegen an den
**Nahtstellen zwischen den Phasen**: dieselbe Zahl wird an drei Stellen verschieden
berechnet (Fehltage, Lehrjahr, Überfällige), ein Status wird an fünf Stellen
unterschiedlich gesetzt (aktiv/inaktiv/beendet), Zähler und Kalender kennen das neue
Termin-Modell aus Audit 3 noch nicht, und nach der Kontrolle fehlt ein durchgehender
Faden (Anfrage → Bestätigung → Durchführung → Betriebe → Nachweis → Schule).

Priorität: **Stufe 1** sind falsche Zahlen, stille Datenverluste und Blockaden im
Alltag – vor jeder Erweiterung. **Stufe 2** sind Workflow-Brüche, die Klicks und
Fehler kosten. **Stufe 3** ist Ausbau für unkompliziertes Arbeiten.

---

## Stufe 1 – Muss (falsche Zahlen, Datenverlust, Blockaden)

### Paket A – Eine Wahrheit je Kennzahl
| # | Befund | Stelle |
|---|---|---|
| A1 | **Fehltage** dreimal verschieden: Übersicht/Druck/Auto-Zulassung summieren nur `kw_status`, Einzelansicht/PDF nutzen `fehltage_gesamt` (inkl. pauschal), Azubi-Dashboard nur Phasen-Pauschale. Ein per Nacherfassung mit 40 pauschalen Fehltagen erfasster Azubi bekommt in der Übersicht „0 %" und die automatische AP-Zulassung. | kontrolle.js:156/524, azubi-rechner.js:473, import-handler.js:938 |
| A2 | **Lehrjahr** statisch aus `klassen.lehrjahr` (Filter, Schülerliste, DQ-Regel) – ab dem zweiten Schuljahr ein Jahr zu niedrig; Dialog rechnet Kalenderjahre; drei Verkürzer-Definitionen. | app-core.js:34, schueler-view.js:60, import-handler.js:947 |
| A3 | **Überfällige Wiedervorlagen**: Sidebar-Badge zählt nur `offen`+Frist, die WV-Ansicht setzt genau diese Zeilen auf `ueberfaellig` → Badge 0, Dashboard n. | app-core.js:7089 vs. views.js:1101 |
| A4 | **Excel-Dashboard** Blatt 2–5 zählt Ergebnis-Zeilen statt Azubis (Gesamt = Klassenstärke × Durchsichten). | berichte.js:129–207 |
| A5 | **Jahresbericht** ohne Zeitraum (kumuliert seit DB-Anlage), „In Ordnung" nur für Azubis, die nie einen Mangel hatten, Schulstatistik zählt Azubis mehrfach. | berichte.js:322–395 |
| A6 | **Schülerzahl der Termine** aus dem Klassen-Cache: Kampagnen-Termine zeigen „0", Klassen-Termin mit Gast zählt den Gast nicht (Planung, Kontrolle-Dropdown, Berichte). | app-core.js:5450/5541 |
| A7 | **Fehltage-Wochen fehlen im Durchsichtsbogen-PDF** (H-only-Zellen leer). | pdf-export.js:130–183 |

### Paket B – Ein Status-Modell für Azubis
| # | Befund | Stelle |
|---|---|---|
| B1 | Sammelaktion „Inaktiv setzen" schreibt `status='inaktiv'` – im Dialog unbekannt → nächstes Speichern reaktiviert still. | stammdaten.js:363, import-handler.js:1070–1093 |
| B2 | BAV „ENDE" + Prüfungserfolg „bestanden" wird „abgebrochen"; `ap_bestanden` nie aus dem Import gesetzt, Jahresbericht zählt aber darauf. | import-handler.js:616/677/723 |
| B3 | Azubis, die im Export fehlen, werden nie erkannt (Anleitung empfiehlt Filter „Nicht Ende") – Abbrecher bleiben aktiv. | import-handler.js, views.js:802 |
| B4 | Namens-Fallback beim Re-Import trifft trotz abweichender BAV-Ident (Betriebswechsel = Neuvertrag) → Fehlzuordnung oder falscher ENDE-Status. | import-handler.js:638–651 |
| B5 | „Ausbildung beenden" schließt offene Wiedervorlagen nicht; „Jahrgang abschließen" setzt alle pauschal auf „bestanden" ohne Log. | import-handler.js:1140, stammdaten.js:363, schueler-view.js:125–141 |
| B6 | Tote Bulk-Leiste der Schülerliste nach Besuch des Stammdaten-Tabs (Selektor-Override); Bulk-Klasse/Jahrgang/FR rendern in ein nicht vorhandenes Element. | stammdaten.js:296, bulk-schueler.js:49–91 |

### Paket C – Kontrolltag ohne Stolperfallen
| # | Befund | Stelle |
|---|---|---|
| C1 | Zwei Prüfer öffnen denselben Termin → beide landen beim ersten offenen Azubi → **gegenseitige Sperre** ohne Vorrang; „Sperre aufheben" hält 8 s. | kontrolle.js:1863–1873, 2031 |
| C2 | Modal-Pfad (Leertaste/Enter) umgeht Mängel-Historie und Fehltage-Neuberechnung; kein Undo für Modal, Sonstiges, Bereichs-Markierung. | kontrolle.js:1586–1649, kw-nav.js:550 |
| C3 | Ergebniswechsel aktualisiert die Wiedervorlage-Art nicht; erneuter Mangel nach „in Ordnung" öffnet keine WV. | kontrolle.js:1473–1525 |
| C4 | „✓ i.O."-Schnellweg markiert keine Kalenderwochen als geprüft. | kontrolle.js:357–408 |
| C5 | Auto-AP-Zulassung ohne Bezug zum Ausbildungsjahr (auch im 1. Lehrjahr). | kontrolle.js:167–175 |
| C6 | Nacherfassung schließt die alte Wiedervorlage nicht; rückdatierte Codes erscheinen als offene Mängel. | nacherfassung.js:248–262 |
| C7 | „PDFs für mangelhafte Schüler" erzeugt alle Bögen; Unterschrift im PDF = letzter Schreiber statt Prüfer. | kontrolle.js:2362, pdf-export.js:438 |

### Paket D – Planung im neuen Termin-Modell
| # | Befund | Stelle |
|---|---|---|
| D1 | Kohortenjahr und Kampagnenfenster laufen auseinander (z. B. im Januar: AP S2026 mit Fenster Nov/Dez 2026). | planung.js:30–33, 1115–1123 |
| D2 | Lehrjahr-Filter des Assistenten nutzt das heutige AJ statt das AJ zum Termindatum – Juli-Planung verfehlt alle künftigen 2.-Lehrjahre. | app-core.js:5896, planung.js:1078 |
| D3 | Dashboard und Kalender: Stammschule der ersten Klasse statt `getTerminSchule`, Kampagnen-Termine als „Einsendung –", nur ein Termin pro Tag im Kalender. | views.js:188, 975–983 |
| D4 | Terminanfrage für Kampagnen-Termine mit leerem Betreff-Teil („– – –"), Gruppen nur aus Klassen. | workflows.js:49–65 |
| D5 | Blockplan: Datumsvorschlag ohne Schuljahr/Lehrjahr; Raster zeigt KW 53 in 52-Wochen-Jahren; KW-Kalender im Dialog nur über Klassen. | planung.js:1137/1163, stammdaten.js:1072, planung.js:618 |
| D6 | Keine Doppeltermin-Prüfung; Standort-Klick setzt keinen Ort → Terminanfrage bricht ab. | planung.js:509–520, 712–807 |

### Paket E – Nachbereitung und Bedienung
| # | Befund | Stelle |
|---|---|---|
| E1 | Betriebe ohne E-Mail bekommen nach der Kontrolle einen Brief mit Terminankündigung; Abwesende werden als „ohne Beanstandung" bestätigt. | workflows.js:227/265/294/414 |
| E2 | Dialog schließt sich sofort wieder (History-Race bei `closeModal(); open…()`), betrifft Stammdaten, Datenqualität, Azubi-Dashboard, Import. | app-core.js:7157–7172, 6483 |
| E3 | „Ansicht nach Reload" greift nie (liest vor dem Benutzer-Restore); „Verbindung trennen" verwirft ungespeicherte Änderungen (kein `await`). | app-core.js:6441/6497, 1648–1661 |
| E4 | Durchsicht ohne gewählten Prüfer möglich (`geaendert_von=''`, keine Positionsdatei). | kontrolle.js:46 |
| E5 | Kein Versandnachweis, keine Mahnstufe; Nachholungs-WV aus der Liste bekommt Mahn-Text; fremde Ämter erhalten WV und Seriendruck. | workflows.js:444–485, kontrolle.js:2327 |
| E6 | Hilfe widerspricht dem Verhalten (8 s/Sperrsystem vs. 3 s/LWW, Tab-Namen, Terminstatus, feste Versionsangabe); Klarnamen-Prüfer werden bei jedem Start neu angelegt. | views.js:1977–2532, app-core.js:6847 |

---

## Stufe 2 – Sollte (Workflow-Brüche, Konsistenz)

- **Termin-Statuskette** angefragt → bestätigt → durchgeführt → nachbereitet mit Zeitstempeln; Schul-Mail hinterlässt heute keine Spur, zwei Kollegen können doppelt anfragen.
- **Arbeitsliste „Heute/diese Woche"** (Dashboard + WV-Seite): fällig heute, überfällig, ohne Versandnachweis, Termine ohne Prüfer, durchgeführte Termine ohne Abschluss; WV-Filter „unerledigt" statt „offen".
- **Import als Diff-Vorschau** (Neu / Geändert mit Feldern / Fehlend / Konflikte) vor dem Schreiben, mit Sammelaktion „Ausbildung beenden" für Fehlende und Betriebswechsel-Assistent.
- **Dialog „Ausbildung beenden"** (Grund, Datum, WV schließen, Log) als einzige Funktion für Zeile, Dialog, Bulk, Jahrgang abschließen und Import.
- **Wiedervorlage-Nachweis** mit Typ (E-Mail/Post/persönlich), Datei in der Akte und optionalem Mini-Kontrollergebnis, damit Ampel und Zulassungsliste „nachgewiesen" erkennen.
- **Prüferaufteilung am Termin** statt gegenseitiger Sperre („Ich nehme #1–20"); `nextOffen` überspringt fremde Zuteilungen; Positionsdatei nur überschreiben, nie löschen beim Azubi-Wechsel.
- **Ergebnis-Tastenkürzel** und „i.O. impliziert geprüft bis Vorwoche"; Sprung zur aktuellen KW; frühere Ausbildungsjahre eingeklappt.
- **Konsistente Zahlenbasis** in allen Berichten: „letztes Ergebnis im Zeitraum", Schuljahr wählbar, Vorjahresvergleich.
- **Standardfilter als „Standard"-Chip** ohne ✕; Filter beim DB-Wechsel vollständig zurücksetzen; expliziter Hash vor `last_view`.
- **Modal-Infrastruktur**: `App.confirm()/App.prompt()` als Promise-Dialoge, Fokus-Trap, `aria-live` für Toasts, Buttons statt klickbarer `div`.
- **Undo** nur in der Kontrolle annehmen und beim Termin-/Ansichtswechsel leeren; Beschreibung mit Azubi-Name.
- **ICS** mit stabilen UIDs (`bhk-termin-<id>`), DTSTAMP/DTEND/LOCATION; Wiedervorlagen als Aufgaben.
- **Dateien der Akte** beim endgültigen Löschen mit entfernen (Datenschutz).
- **Begriffs-Glossar** (Azubi · Ausbildungsberater · Durchsicht) für UI, Hilfe und PDF; Sidebar-Label = Seitentitel.

## Stufe 3 – Ausbau für unkompliziertes Arbeiten

1. **Jahresablauf-Startseite**: „Wo stehen wir?" (letzter Import → Kampagne → offene Termine → Nachbereitung → Berichte) mit „Nächster Schritt"-Knopf; Schnellstart-Assistent bei leerer Datenbank (Prüfer → Import → Kampagne).
2. **Jahreskalender mit Kampagnenfenstern**, Blockwochen je Schule, Ferien BW, „Diese Woche"-Kasten.
3. **Hersendung-Workflow** für Post-Schulen (Eingangsliste Heft da/fehlt, Erinnerung an Betriebe) statt Merkzettel in der Vorlage.
4. **„Bereits kontrolliert"-Ausschluss** im Kampagnen-Assistenten (z. B. ZP-Herbst-Azubis) und Nachholtermine aus Abwesenden je Schule.
5. **Mahnstufen und Versandprotokoll** (Stufe 1 Mängelmitteilung, 2 Erinnerung, 3 Vorlage im RP), Sammel-Erinnerung je Betrieb, Aktenvermerk mit Versandhistorie.
6. **Betriebs- und Schul-Ampel** (Wiederholungsbetriebe, Ø Tage bis Nachweis, Abdeckung je Schule) im Dashboard und in den Stammdaten.
7. **Eine Azubi-Detailseite** statt drei Modale (Stammdaten, Akte, Dashboard) mit einer Fehltage-Zahl, Kontrollhistorie, WV, Phasen.
8. **Blockplan-Import** (CSV/Excel je Schule, Schuljahr kopieren) und LFK als Schul-Referenz statt Freitext; LFK-Regeln als Tabelle statt Code.
9. **Kontextbezogene Hilfe** (F1 je Ansicht, ?-Icons an Karten), Version/Stand aus dem Build, „Was ist neu".
10. **Kontrolltag-Cockpit** (Startzeit, Ø Minuten, Prognose Ende), Tablet-Tap-Leiste, Foto/Anhang je Durchsicht, Begründung für Prüfungsausschuss.
11. **Rollenprofile** (Ausbildungsberater / Assistenz) über die vorhandenen Sidebar-Schalter; Prüfer-Pflicht beim Start.
12. **Offline am Kontrollort** (lokales Op-Log, Nachspielen beim Wiederverbinden) – Sync-v3 ist dafür strukturell vorbereitet.

## Empfohlene Reihenfolge

1. Paket A + B (Zahlen und Status konsistent) – kleine Eingriffe, große Wirkung auf Vertrauen in Anzeigen und Berichte.
2. Paket C + E1/E2/E3/E4 – der Kontrolltag mit zwei Prüfern und die Nachbereitung dürfen keine stillen Verluste haben.
3. Paket D – Planung vollständig auf das Termin-Modell aus Audit 3 heben.
4. Stufe 2 in der Reihenfolge Termin-Statuskette → Arbeitsliste → Import-Diff → „Ausbildung beenden" → Nachweis.
5. Stufe 3 nach Nutzen: Startseite/Schnellstart, Jahreskalender, Hersendung, Mahnstufen.

## Nicht anfassen (gut gelöst)

Sync-v3 mit Stempeln und Papierkorb, kumulatives KW-Modell mit Mängel-Historie,
Kampagnen-Assistent mit Standortgruppen, Vorlagen-System mit mailto-Schutz,
Datumsformat-Erkennung und Spaltenzuordnung im Import, Datenqualitäts-Prüfung mit
Excel-Abarbeitungsliste, globale Suche, Abschluss-Assistent.
