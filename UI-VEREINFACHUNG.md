# UI-Vereinfachung – Bestandsaufnahme und Vorschlag

Stand: November 2026. Anlass: Rückmeldung der Sachbearbeitung, die Oberfläche
sei insgesamt komplex geworden und man finde sich schwer zurecht. Ziel ist
**weniger Oberfläche bei gleicher Funktion** – nichts entfällt, es wird nur
zusammengelegt, versteckt bis gebraucht oder einheitlich benannt.

Grundlage: Screenshots aller Ansichten im Demo-Modus (1366 × 860), Zählung der
Bedienelemente im Code.

## 1. Woher die Komplexität kommt

| Befund | Zahlen |
|---|---|
| **Vier Orte für denselben Termin.** Ein Termin wird in der Planung angelegt (Starten, ⋯-Menü), in der Durchführung bearbeitet („Termin ▾“, „Weitere Aktionen ▾“, ⋯ in der Einzelansicht), in Berichte & Export exportiert („Durchsichtsbögen pro Kontrolltermin“) und in Dialogen nachbereitet (Kontrolle abschließen, Betriebe anschreiben, Ämter). Wer eine Aktion sucht, muss wissen, in welcher Phase sie „wohnt“. | 3 Menüs + 2 Listen + 4 Dialoge je Termin |
| **Der Filterbalken ist immer da** – auch unter Einstellungen, Wartung, Hilfe, auf der Azubi-Seite und in der Einzelansicht, wo er nichts filtert. Fünf Chips (Alle Jahrgänge · Gärtner · § 93 · Aktive BAV · + Filter) belegen dauerhaft eine Zeile. | auf 11 von 11 Ansichten sichtbar, sinnvoll auf 5 |
| **Planung-Kopf:** Listen-Auswahl, + Neuer Termin, Kontroll-Vorlagen ▾, Kampagnen-Assistent, Tabelle, Kalender, Jahreskalender, ICS-Export – zwei Zeilen Knöpfe vor der Tabelle; die Tabelle hat 10 Spalten, „Titel“ ist fast immer „–“. | 9 Bedienelemente, 10 Spalten |
| **Dialog „Neuer Kontrolltermin“** zeigt alles auf einmal: zwei Typ-Reiter, sechs Filterchips, Klassenliste, Einzel-Azubis, Ort, Datum, Prüfer, Bemerkung, KW-Kalender – bei 860 px Höhe muss man scrollen, der Speichern-Knopf liegt außerhalb des Sichtfelds. | 10 Blöcke |
| **Durchführung-Übersicht:** Termin-Karte mit allen Klassen in der Titelzeile, Status-Badge, zwei Knöpfe; darunter zweite Karte mit Übersicht/Einzelansicht, vier Zähl-Chips, Fortschrittsbalken und einer Tabelle mit 12 Spalten (#, Name, FR, Anw., ↯, Ergebnis, Fehl., Pfl., Zul., PA, AP, Aktionen). Die Symbol-Spalten ↯/Pfl./Zul./PA/AP braucht man nur im letzten Lehrjahr. | 12 Spalten |
| **Menü:** 11 Einträge in fünf Gruppen; „Import“ (einmal im Jahr) und „Wartung“ (selten) stehen gleichrangig neben der täglichen Arbeit; „Einstellungen“ und „Wartung“ sind zwei Einträge für Konfiguration; „DB wechseln“ ist ein grauer Eintrag ohne Zählung. | 11 Einträge |
| **Dialoge:** 39 verschiedene Dialogfenster; die Azubi-Seite hat gezeigt, dass eine Seite mit Abschnitten ruhiger ist als drei Dialoge. Betrieb, Schule, Klasse, Termin werden weiter in Dialogen bearbeitet. | 39 Dialoge |
| **Benennung:** Dasselbe heißt je nach Stelle „Kontrolle“, „Durchsicht“, „Prüfung“, „Termin“ (Kontrollplanung · Durchführung · „Kontrolle abschließen“ · „Durchsichtsbogen“ · „+ Prüfung“ in den Stammdaten · „Einzelprüfung“). | 4 Wörter für eine Sache |

## 2. Vorschlag – sieben Pakete, nach Nutzen/Aufwand geordnet

### Paket 1 · Einheitliche Wörter (klein, sofort)
Ein Glossar, überall gleich: **Termin** (geplant), **Durchsicht** (die Tätigkeit
am Termin, auch im Büro oder Betrieb), **Ergebnis** (je Azubi), **Wiedervorlage**.
Menü: „Kontrollplanung“ → **Termine**, „Durchführung“ → **Durchsicht**.
Knöpfe: „Starten“ → „Durchsicht öffnen“, „+ Prüfung“ (Stammdaten) → „+ Termin“,
„Kontrolle abschließen“ → „Durchsicht abschließen“. Hilfe und Texte folgen.
*Kein Funktionsverlust, nur Wörter.*

### Paket 2 · Filterbalken nur, wo er filtert (klein)
Der Balken erscheint nur in Listen (Stammdaten, Termine, Durchsicht-Übersicht,
Wiedervorlagen, Berichte). Dashboard, Azubi-Seite, Einzelansicht, Einstellungen,
Wartung, Hilfe laufen ohne. Im Standardzustand (Gärtner · § 93 · aktive BAV)
verdichten sich die Chips zu **einem** Chip „Filter: Gärtner · § 93 ▾“, der sich
aufklappt; nur abweichende Filter stehen einzeln und schwarz. „Prüfer wählen“
bleibt oben rechts (ist schon das Benutzer-Menü).

### Paket 3 · Menü von 11 auf 8 (klein)
- **Stammdaten** bekommt den Reiter **Import** (IBYKUS, LFK, Ausbilder) – der
  Menüpunkt entfällt; die Import-Historie bleibt unter Wartung.
- **Einstellungen** bekommt den Reiter **Wartung** (Verbindung, Sicherungen,
  Papierkorb, Datenbank-Tools, Logbuch) – ein Menüpunkt weniger; „DB wechseln“
  steht dort unter Verbindung (ist schon so) und verschwindet aus dem Menü.
- **Nacherfassung** bleibt optional ausblendbar (wie heute).
Ergebnis: Dashboard · Stammdaten · Termine · Durchsicht · Wiedervorlagen ·
Berichte · Einstellungen · Hilfe.

### Paket 4 · Termine-Kopf und -Tabelle (klein)
- Ein Hauptknopf **„+ Neuer Termin ▾“** mit Untereinträgen „aus Vorlage …“ und
  „Kampagne (mehrere Schulen) …“ statt drei Knöpfen.
- **Ein** Umschalter Tabelle | Kalender | Jahr statt drei Knöpfen; ICS-Export in
  das Listen-Menü „⋯“ neben dem Umschalter.
- Tabelle: „Titel“ entfällt als Spalte (steht als zweite Zeile unter dem Datum,
  wenn gesetzt), Fachrichtung in die Klassen-Spalte, Ort/Schule mit Ortsangabe
  als zweite Zeile → 10 → 8 Spalten, mehr Luft je Zeile.
Von 9 auf 4 Bedienelemente über der Tabelle.

### Paket 5 · Dialog „Neuer Termin“ in zwei Schritten (mittel)
Schritt 1 **Wo und wann**: Art (Schule / Büro-Betrieb-Prüfung), Ort (Schule aus
der Liste oder freier Ort), Datum mit KW-Kalender als Aufklapper am Datumsfeld,
Prüfer. Schritt 2 **Wer**: Klassen (Filterchips eingeklappt hinter „Klassen
eingrenzen ▾“, Standard: Schule aus Schritt 1 vorgewählt) **oder** einzelne
Azubis. Bemerkung am Ende. Jeder Schritt passt ohne Scrollen auf den Bildschirm,
„Speichern“ bleibt sichtbar. Alle Felder bleiben erhalten.

### Paket 6 · Durchsicht-Übersicht entrümpeln (mittel)
- Termin-Kopf als **eine Zeile**: `Do 14.01.2026 · Edith-Stein-Schule · 35 Azubis · Zilz` – die
  Klassen als zweite, leise Zeile; Status rechts.
- Die vier Zähl-Chips werden zur Beschriftung des Fortschrittsbalkens
  („34 von 35 bewertet · 14 in Ordnung · 20 beanstandet · 1 offen“).
- Tabelle 12 → 7 Spalten: #, Azubi (Betrieb, FR und ↯ als Punkt in der Zelle),
  Anwesend, Ergebnis, Fehltage, Zulassung (Pfl./Zul./PA/AP **zusammen** als ein
  Symbol mit Tooltip, voll nur bei Klick oder im letzten Lehrjahr), Aktion.
  Die Einzelansicht zeigt weiter alle Details.
- „Termin ▾“ und „Weitere Aktionen ▾“ werden **ein** Menü „Termin ▾“ (Anfrage,
  Ergebnisse, Betriebe, Ämter, Bögen, Druck, Anwesenheit, Azubi hinzufügen).

### Paket 7 · Termin-Seite statt vier Orte (groß, größter Gewinn)
Analog zur Azubi-Seite eine **Seite je Termin** mit den Phasen als Abschnitte:
1. **Vorbereitung** – Termin-Daten bearbeiten, Anfrage an die Schule, Betriebe
   ankündigen (Briefe/E-Mails), Teilnehmer.
2. **Durchsicht** – die heutige Übersicht/Einzelansicht (unverändert).
3. **Nachbereitung** – Abschluss, Ergebnisse an Schule/Betriebe/Ämter, Nachhol-
   Aufforderungen, Wiedervorlagen dieses Termins.
4. **Bögen & Export** – Durchsichtsbögen, Übersichtstabelle, Gesamtpaket.
Die Termine-Liste hat einen Hauptknopf „Öffnen“, der auf die Seite führt; die
Phase, die dran ist, ist aufgeklappt, die anderen zeigen nur den Stand („✓ 12
Betriebe angeschrieben am 03.11.“). Damit verschwinden die Menüs „Termin ▾“ /
„Weitere Aktionen“ und die Export-Liste unter Berichte; die Dialoge bleiben,
werden aber von einer Stelle aus geöffnet. Dashboard-„Wo stehen wir“ und Hilfe
folgen denselben vier Phasen.

## 3. Was bewusst bleibt
- Einzelansicht der Durchsicht (Raster, Kürzel-Leiste, Ergebnisleiste) – sie ist
  nach Nutzerwunsch so, und sie ist das Werkzeug am Kontrolltag.
- Dashboard mit Arbeitsliste – der beste Einstieg; wird durch Paket 1/7 nur
  klarer beschriftet.
- Die Azubi-Seite als Muster für Seiten statt Dialoge.

## 4. Stand
- **Pakete 1–4 umgesetzt** (November 2026): Wörter, Filterbalken nur in Listen mit
  Standard-Chip, Menü mit 8 Einträgen (Import als Reiter der Stammdaten, Wartung als
  Reiter der Einstellungen), Termine-Kopf mit einem Hauptknopf und einem Umschalter,
  Tabelle 10 → 8 Spalten (Datum mit Bemerkung, Ort, Klassen mit Fachrichtung, Jahrgang,
  Azubis, Prüfer, Status, Aktionen).
- **Paket 6 umgesetzt** (November 2026): eine Terminzeile mit leiser Unterzeile, ein Menü
  „Termin ▾“ (Sammelaktionen und Termin-Aktionen zusammen, „Weitere Aktionen“ entfällt),
  Zähl-Chips als Beschriftung des Fortschrittsbalkens, Tabelle 12 → 7 Spalten mit einer
  zusammengefassten Zulassungszelle (ausgeklappt nur im letzten Lehrjahr, bei gesetzter
  Zulassung/PA oder per Klick; Kopf „alle / nur letztes Jahr“).
- **Pakete 5 und 7 offen.**

## 5. Reihenfolge und Aufwand
| Paket | Aufwand | Risiko | Wirkung |
|---|---|---|---|
| 1 Wörter | ½ Tag | gering (Tests prüfen Begriffe) | Orientierung |
| 2 Filterbalken | ½ Tag | gering | ruhigere Seiten |
| 3 Menü 11 → 8 | ½ Tag | gering (Einstellungen/Wartung teilen schon `_einstellungenTeile`) | weniger Suchen |
| 4 Termine-Kopf | ½ Tag | gering | weniger Knöpfe |
| 5 Dialog in 2 Schritten | 1 Tag | mittel (Kampagne/Vorlagen nutzen den Dialog) | Termin anlegen ohne Scrollen |
| 6 Übersicht entrümpeln | 1 Tag | mittel (Tests der Übersicht) | Kontrolltag übersichtlich |
| 7 Termin-Seite | 2–3 Tage | mittel–hoch | ein Ort je Termin |

Pakete 1–4 lassen sich in einem Schritt umsetzen und ändern keine Abläufe.
Paket 7 ist der eigentliche Hebel gegen „vier Orte für denselben Termin“.
