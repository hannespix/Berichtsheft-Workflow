# Fachlicher Logik-Audit – Berichtsheftkontrolle gegen BBiG, GärtnAusbV und Praxis in Baden-Württemberg

**Stand:** September 2026 · **Gegenstand:** alle fachlichen Regeln des Tools (Zulassung, Mängelcodes, Pflichtteile, Fehltage, Zeiten und Zeiträume, KW-Raster, Kampagnen, Wiedervorlagen, Ergebnisarten, Statusmodell, Anschreiben) · **Vorgehen:** Regel-Inventar aus dem Code (Fundstellen unten) gegen die Rechtsgrundlagen und die veröffentlichten Vorgaben der zuständigen Stellen.

> **Status: alle sieben Pakete umgesetzt.** Pakete 1–3 (Zulassung nach § 43 mit Übersteuerung und Meldung der fehlenden Voraussetzungen, Fehlzeiten sauber, Zusatzvereinbarung als Schalter; `tests/zulassung-test.mjs`) und Pakete 4–7 (Befund + Nachweisweg, Kampagnenwissen/ÜBA-Sollzahlen/Fristen als Einstellungen, Ergebnis-Mail an die Schule ohne Namensliste, Beratungsgespräch § 76 in der Akte, Namensvermerk statt „Signatur“, Rasterkopf Schuljahr/Lehrjahr/Vertragsjahr; `tests/vereinfachung-test.mjs`). Details in `CLAUDE.md` unter „Zulassung nach § 43“ und „Befund + Nachweisweg“. Ergänzung aus der Abstimmung: Die Zulassung bleibt **immer** manuell setzbar – ein Prüfungsausschuss kann auch bei nicht vollständig erfüllten Voraussetzungen zulassen; das Tool meldet dann die fehlenden Punkte nach § 43 BBiG und verlangt eine Begründung.

Legende: 🔴 Regel widerspricht der Rechtslage oder erzeugt eine falsche amtliche Aussage · 🟠 Regel geht über die Rechtslage hinaus oder ist nicht belegbar · 🟡 Vereinfachung oder Klarstellung sinnvoll · ✅ stimmig

---

## 0. Zusammenfassung

Das Tool bildet den Kern der Rechtslage richtig ab: Der Ausbildungsnachweis ist Zulassungsvoraussetzung (§ 43 Abs. 1 Nr. 2 BBiG), das Regierungspräsidium überwacht als zuständige Stelle (§ 76 BBiG), Beanstandungen gehen an den Ausbildenden (§ 14 Abs. 2 BBiG), die Übergabe an den Prüfungsausschuss bei Zweifeln (§ 46 Abs. 1 Satz 2 BBiG) ist als eigener Weg vorhanden, die 10-%-Fehlzeiten-Schwelle entspricht der Praxis der zuständigen Stellen in Baden-Württemberg, die Anmeldefristen 1. April / 1. November stecken in den Kampagnenfenstern.

Vier Punkte gehen über die Rechtslage hinaus und können in einer Zulassungskontrolle zu einer falschen „nicht erfüllt“-Aussage führen:

1. 🔴 **Witterungsangaben (Code D) blockieren die Zulassungsempfehlung.** Das Merkblatt zum Gärtner-Berichtsheft und die Hinweise des RP zum Ausbildungsvertrag sagen ausdrücklich: Wetterbeobachtungen sind *keine* Zulassungsvoraussetzung; Mindestanforderung sind die regelmäßig geführten Tagesberichte. Im Tool zählt jede Woche mit Code D als „offener Mangel“ und setzt `bedingungenOK` auf falsch.
2. 🟠 **Teil 1.4 „Der/die Auszubildende“ ist als Pflichtteil der Zulassung modelliert.** Das sind Angaben zur Person; dafür gibt es keine Rechtsgrundlage als Zulassungsvoraussetzung.
3. 🟠 **Sachberichte, Erfahrungsberichte, Pflanze der Woche** werden in Anschreiben, Textbausteinen und einer eigenen Ergebnisart („Sachberichte wegen Wetter per E-Mail“) wie Pflichtbestandteile behandelt. Sie sind nur verbindlich, wenn Betrieb und Azubi die *Zusatzvereinbarung zur Berichtsheftführung* unterschrieben haben (Teil 1.2). Das Tool kennt Teil 1.2 als „freiwillig“, nutzt es aber nicht als Schalter.
4. 🟠 **Die automatische „Zulassung“ heißt so, prüft aber nur das Berichtsheft.** Zwischenprüfungs-Teilnahme, Eintragung im Verzeichnis und das Vertragsende relativ zum Prüfungstermin (§ 43 Abs. 1 Nr. 1 und 3) kennt das Tool nicht. Fachlich ist das richtig so (das entscheidet die Prüfungsverwaltung), aber das Häkchen sollte „Berichtsheft-Voraussetzung erfüllt“ heißen.

Der Papier-Workflow ist an drei Stellen unnötig starr übertragen: sechs Ergebnisarten, die eigentlich zwei Fragen sind (Befund und Nachweisweg), hart codiertes Kampagnenwissen (Hersendungs-Schulen, Fachrichtungs-Ausnahmen, „Baumschule nur bis H25“) und die Pflichtteile-Karte, die das Registerblatt des Berichtshefts nachbaut statt die rechtliche Mindestanforderung. Vorschläge dazu in Abschnitt 6.

Was ich **nicht** belegen konnte: die Sollzahlen der ÜBA-Bescheinigungen (6 GaLaBau / 2 Produktion / 1 Fachwerker), die Fachrichtungs-Zuordnung der Zwischenprüfungen Herbst/Frühjahr im RP Freiburg und die Liste der Hersendungs-Schulen. Das ist Verwaltungspraxis des RP, die nicht öffentlich dokumentiert ist. Sie sollte als Einstellung im Tool stehen, nicht im Code.

---

## 1. Quellen

| Kürzel | Quelle | Was daraus verwendet wird |
|---|---|---|
| **BBiG** | Berufsbildungsgesetz in der Fassung seit 1.1.2020 | § 7a (Teilzeit), § 8 (Verkürzung, Verlängerung), § 13 Satz 2 Nr. 7 (Pflicht zum Ausbildungsnachweis), § 14 Abs. 2 (Anhalten und Durchsehen), § 20 (Probezeit), § 21 Abs. 3 (Verlängerung bei Nichtbestehen), § 37 Abs. 1 (zweimalige Wiederholung), § 43 (Zulassung), § 45 (vorzeitige Zulassung, Externe), § 46 (Entscheidung über die Zulassung), § 48 (Zwischenprüfung), § 71 Abs. 3 / § 76 (zuständige Stelle Landwirtschaft, Überwachung und Beratung) |
| **GärtnAusbV** | Verordnung über die Berufsausbildung zum Gärtner/zur Gärtnerin vom 6.3.1996 | § 2 Dauer 3 Jahre, § 8 Zwischenprüfung vor Ende des 2. Ausbildungsjahres, sieben Fachrichtungen |
| **BBiG-ZustV BW** | Berufsbildungsgesetz-Zuständigkeitsverordnung BW vom 3.7.2007 | Regierungspräsidien sind zuständige Stelle für die Gärtner-Berufe |
| **RP-Hinweise 2024** | Regierungspräsidien BW, „Wichtige Hinweise zur Einreichung der Berufsausbildungsunterlagen im Gartenbau“, Stand September 2024 | „Mindestanforderung für die Zulassung zur Abschlussprüfung sind die regelmäßig geführten Tagesberichte. Diese können elektronisch geführt werden, müssen aber ausgedruckt und vom Ausbilder und Auszubildenden unterschrieben werden.“ Zusatzvereinbarung für das vollständige Führen. Probezeit 1–4 Monate. Anlage ÜBA (AuGaLa bzw. DEULA) und betrieblicher Ausbildungsplan sind Vertragsanlagen. |
| **RPF-Zulassung 2022** | RP Freiburg, Referat 81 (Forst), Vortrag „Zulassung zur Abschlussprüfung“ (Ausbildendentagung 23.11.2022) | Alle vier Voraussetzungen kumulativ; „geringfügige Fehlzeiten, i.d.R. 10 % der Ausbildungszeit“ als Einzelfallentscheidung, verschuldet oder unverschuldet unerheblich; maßgeblich ist die Gefährdung des Ausbildungserfolgs; ZP-Teilnahme erforderlich (Ausnahme Krankheit ohne Wiederholungsmöglichkeit); Berichtsheft als Urkunde; vorzeitige Zulassung ab Notendurchschnitt besser als 2,49, höchstens 6 Monate; Externe nach 4,5 Jahren |
| **LRA-KA FAQ** | Landratsamt Karlsruhe, Ausbildungsberatung Gartenbau, „Häufige Fragen“ und „Zwischenprüfung“ | Fehlzeiten bis 10 % unberücksichtigt, darüber entscheidet der Prüfungsausschuss; Verkürzung ½ Jahr bei guten Leistungen (Antrag bis 1.12. bzw. 1.4.), Anrechnung höchstens 1 Jahr; Verlängerung bis 1 Jahr; Sachberichte keine Zulassungsvoraussetzung; ZP: dreijährig nach der Hälfte, zweijährig zu Beginn des 2. Jahres, Produktions-Fachrichtungen im Herbst des 2. Ausbildungsjahres; schriftlicher Teil erster Mittwoch im März / zweiter Mittwoch im Oktober |
| **Service-BW** | Leistung „Auszubildende im Obst- und Gartenbau zur Abschlussprüfung anmelden“ (Regierungspräsidien) | Vertrag endet höchstens zwei Monate nach dem Prüfungstermin; Anmeldeschluss 1. April (Sommer) / 1. November (Winter); Anmeldeformular wird vor der Zulassungskontrolle ins Berichtsheft geheftet |
| **LWK-Merkblatt** | Landwirtschaftskammer NRW (Herausgeber des bundesweiten Gärtner-Berichtshefts), „Ausbildungsnachweis Gärtner/in“ | Aufbau Teil 1.1–1.7, 2.1 Tagesberichte (Kopfzeile KW und Datum; persönlich ausgeführte Tätigkeiten = Zulassungsvoraussetzung; Ausfallzeiten Urlaub/Krankheit einzutragen; Berufsschul- und Lehrgangsthemen einzutragen; von Azubi und Ausbilder mit Datum zu unterschreiben), **Wetterbeobachtungen keine Zulassungsvoraussetzung**, Rückseite 2.2 keine Zulassungsvoraussetzung, Teile 3–6 (Pflanze der Woche, Erfahrungsberichte, Pflanzenschutz, Adressen) nur mit Zusatzvereinbarung; Ausbildungsplan vor Beginn, vor ZP und vor AP-Anmeldung zu besprechen und zu unterschreiben; Vorlage beim Ausbilder mindestens monatlich |
| **BIBB HA 2020** | Empfehlung des BIBB-Hauptausschusses vom 1.9.2020 für das Führen von Ausbildungsnachweisen (BAnz AT 02.10.2020 S1, ersetzt Nr. 156/2018) | Täglich oder wöchentlich, ca. eine DIN-A4-Seite je Woche; Name, Ausbildungsjahr, Berichtszeitraum; betriebliche Tätigkeiten und Unterweisungen; Berufsschulthemen **müssen** enthalten sein; Ausbilder prüft **mindestens monatlich** mit Datum und Unterschrift; Ausbildungsnachweis wird in Prüfungen nicht bewertet |
| **RPK AusbN-RL 2018** | RP Karlsruhe, Richtlinien für das Führen von Ausbildungsnachweisen (öffentlicher Dienst, 24.4.2018) | Gleiche Mindestanforderungen; Nr. 2.7: weitergehende Nachweise (Fachberichte) sind keine Zulassungsvoraussetzung; Nr. 3.5: abgeschlossener Nachweis insgesamt zu unterschreiben – als Vergleichsmaßstab einer zuständigen Stelle in BW |

**Nicht gefunden:** Eine eigene Verwaltungsvorschrift des Landes zur Ausbildungsberatung oder Berichtsheftkontrolle im Gartenbau. Die Vorgaben in BW bestehen aus der Zuständigkeitsverordnung, den Hinweisen und Formularen der Regierungspräsidien und der Praxis, die im Vortrag des RP Freiburg (Forst) und den FAQ des Landratsamts Karlsruhe dokumentiert ist. Wo unten „Praxis“ steht, ist das gemeint.

**Wortlaut § 43 Abs. 1 BBiG (seit 2020):** zuzulassen ist, wer (1) die Ausbildungsdauer zurückgelegt hat oder deren Ausbildungsdauer nicht später als zwei Monate nach dem Prüfungstermin endet, (2) an vorgeschriebenen Zwischenprüfungen teilgenommen **sowie einen schriftlichen oder elektronischen Ausbildungsnachweis nach § 13 Satz 2 Nummer 7 geführt hat** und (3) dessen Berufsausbildungsverhältnis im Verzeichnis eingetragen ist. Die Unterschriften von Azubi und Ausbilder folgen aus § 14 Abs. 2 BBiG, der BIBB-Empfehlung und den RP-Hinweisen („ausgedruckt und unterschrieben“); § 43 selbst verlangt nur „geführt“.

---

## 2. Zulassung zur Abschlussprüfung

### 2.1 Was das Tool prüft (Fundstellen)

`KontrolleHandler.renderUebersicht` (`src/js/modules/kontrolle.js:265-291`):

```
fehlWarn      = Fehltage gesamt / Arbeitstage ≥ 10 %
pflichtOK     = 1.1 = ja ∧ 1.4 = ja ∧ 1.5 = ja ∧ ÜBA-Zahl ≥ Soll ∧ 1.1 geführt ≠ nein ∧ 1.5 geführt ≠ nein
offeneMaengel = Wochen in kw_status mit Codes ≠ '' und ≠ 'H'
wvOffen       = Wiedervorlage offen/überfällig
bedingungenOK = ¬fehlWarn ∧ pflichtOK ∧ offeneMaengel = 0 ∧ ¬wvOffen ∧ Ergebnis = in Ordnung
autoZulassung = bedingungenOK ∧ im letzten Ausbildungsjahr  →  zulassung_ap = 1
```

Dazu `pruefungsausschuss` mit Begründung (`kontrolle.js:726-748`), manuelles Abwählen dauerhaft (`zulassung_manuell`), Stammdatum `schueler.ap_zugelassen` aus IBYKUS getrennt vom Kontrollergebnis, Zulassungsliste AP aus `ap_zugelassen` (`berichte.js:740`).

### 2.2 Abgleich

| Nr. | Tool-Regel | Rechtsgrundlage / Vorgabe | Bewertung |
|---|---|---|---|
| Z1 | Berichtsheft ordnungsgemäß = Zulassungsvoraussetzung; Anschreiben zitieren § 43 Abs. 1 Nr. 2 | § 43 Abs. 1 Nr. 2, § 13 S. 2 Nr. 7 BBiG | ✅ |
| Z2 | Bei nicht erfüllten Bedingungen: „Prüfungsausschuss“ mit Begründung, schließt Zulassung aus | § 46 Abs. 1 S. 2 BBiG: hält die zuständige Stelle die Voraussetzungen nicht für gegeben, entscheidet der Prüfungsausschuss | ✅ Genau der gesetzliche Weg. Empfehlung: den Hilfetext um § 46 ergänzen (steht nirgends). |
| Z3 | Automatisches Häkchen „Zulassung AP“ im letzten Ausbildungsjahr | § 43 Abs. 1 nennt vier kumulative Voraussetzungen; das Tool kennt nur das Berichtsheft (Nr. 2, zweiter Teil) und die Fehlzeiten (Nr. 1, Praxisauslegung) | 🟠 Bezeichnung zu weit. ZP-Teilnahme, Verzeichnis-Eintrag und Vertragsende relativ zum Prüfungstermin werden nicht geprüft und sollen das auch nicht (Prüfungsverwaltung/IBYKUS). **Empfehlung:** Häkchen und Spalte in „Berichtsheft-Voraussetzung erfüllt (§ 43 Abs. 1 Nr. 2)“ umbenennen; die Zulassungsliste AP weiter aus `ap_zugelassen` (IBYKUS) speisen. |
| Z4 | Jede Woche mit Codes ≠ H zählt als offener Mangel und blockiert | LWK-Merkblatt: Wetterbeobachtungen (Code D) **keine Zulassungsvoraussetzung**; RP-Hinweise 2024: Mindestanforderung sind die regelmäßig geführten Tagesberichte; RPK-RL 2.7 und LRA-KA: weitergehende Nachweise keine Zulassungsvoraussetzung | 🔴 **Code D darf die Zulassungsempfehlung nicht sperren.** Ebenso Code I („Sonstiges“) nur, wenn der Prüfer es ausdrücklich als zulassungsrelevant kennzeichnet. Zulassungsrelevant sind A, B (Unterschriften), C (Berufsschulthemen, BIBB HA 2020 Nr. 4 „müssen“), E, F (Inhalt/Fehlen der Tagesberichte), G (KW/Datum, LWK Kopfzeile). **Empfehlung:** Konstante `CODES_ZULASSUNG = A B C E F G`; `offeneMaengel` und die Ampel danach rechnen; D und I bleiben als Beanstandung sichtbar und in Anschreiben, gefährden aber nicht die Zulassung. |
| Z5 | Pflichtteil 1.4 „Der/die Auszubildende (ausgefüllt)“ | Keine Grundlage: Angaben zur Person, Betrieb und Schule; weder LWK noch RP-Hinweise nennen 1.4 als Voraussetzung | 🟠 **Empfehlung:** 1.4 in den Abschnitt „Hinweis“ (wie 1.2/1.6) verschieben; aus `pflichtteileOK` streichen. Bestehende Daten bleiben. |
| Z6 | Pflichtteil 1.1 Ausbildungsplan vorhanden und geführt | LWK: „lediglich der Ausbildungsplan und der folgende Nachweis [Tagesberichte] verbindlich“; Ausbildungsplan ist Anlage zum Ausbildungsvertrag (RP-Hinweise Nr. 4) und vor ZP und AP-Anmeldung zu unterschreiben; § 11 Abs. 1 Nr. 1 BBiG (sachliche und zeitliche Gliederung als Vertragsinhalt) | ✅ Belegt. Der Zusatz „geführt“ (laufend angekreuzt) entspricht dem Merkblatt („in regelmäßigen Abständen … durch Ankreuzen dokumentieren“). |
| Z7 | Pflichtteil 1.5 ÜBA-Bescheinigungen, Soll 6 / 2 / 1 nach Fachrichtung (`getRequiredUBA`, `app-core.js:7711`) | ÜBA ist Vertragsanlage (RP-Hinweise: „Anlage ÜBA (AuGaLa)“ für GaLaBau, „Anlage ÜBA (DEULA)“ für alle übrigen Fachrichtungen) → Nachweis ist prüfbar. Die **Anzahl** ist nirgends öffentlich festgelegt. | 🟠 Der Nachweis ist belegt, die Zahlen sind Praxis. **Empfehlung:** Sollzahlen als Einstellung „ÜBA-Bescheinigungen je Fachrichtung“ (wie LFK-Regeln, Zeilen `Code;Anzahl`), Standard wie heute. Zusätzlich: die Zahl je Lehrjahr staffeln (im 2. AJ sind noch nicht alle sechs GaLaBau-Kurse absolviert; heute blockiert die Gesamtzahl auch in der Nov./Dez.-Kontrolle). |
| Z8 | Fehlzeiten ≥ 10 % → Warnung, keine automatische Empfehlung | Praxis BW: „geringfügige Fehlzeiten, i.d.R. 10 %“, Einzelfall, verschuldet/unverschuldet unerheblich (RPF-Zulassung 2022, LRA-KA) | ✅ Schwelle richtig. Details zur Berechnung in Abschnitt 3. |
| Z9 | Offene Wiedervorlage blockiert | Praxis: solange ein Nachweis aussteht, ist das Berichtsheft nicht „ordnungsgemäß geführt“ | ✅ |
| Z10 | Vertragsende relativ zum Prüfungstermin nicht geprüft | § 43 Abs. 1 Nr. 1: Vertrag endet höchstens zwei Monate nach dem Prüfungstermin (Service-BW) | 🟡 Betrifft Verkürzer/Verlängerer, deren AP-Jahrgang in IBYKUS nicht nachgezogen wurde. **Empfehlung:** Datenqualitäts-Regel „Vertragsende liegt mehr als 2 Monate nach dem Prüfungszeitraum des Jahrgangs“ (Sommer ≈ Juli, Winter ≈ Januar) statt der heutigen groben Regel „Jahrgang ≠ Endjahr ± 1“. |
| Z11 | Zwischenprüfung: nur Kohorten-Kennung (H2026/F2027) | § 43 Abs. 1 Nr. 2, § 48 BBiG, § 8 GärtnAusbV: Teilnahme ist Voraussetzung; Ausnahme Ausfall ohne Wiederholungsmöglichkeit (RPF-Zulassung 2022) | ✅ Bewusst nicht im Tool (Prüfungsverwaltung). **Empfehlung:** In der Zulassungskontrolle (Kampagne apS/apW) einen Hinweis „ZP-Teilnahme und Verzeichnis-Eintrag prüft die Prüfungsverwaltung“ in der Hilfe; kein neues Feld. |
| Z12 | Vorzeitige Zulassung § 45 Abs. 1 als Checkbox | § 45 Abs. 1: auf Antrag, Anhörung Ausbildende und Berufsschule, Leistungen rechtfertigen es (Praxis: besser als 2,49, höchstens 6 Monate früher) | ✅ als Merkmal. 🟡 Das Merkmal wirkt nicht auf `imLetztenAJ` und die Kampagnen-Kohorten: ein vorzeitig Zugelassener im 2. Schuljahr bekommt keine automatische Berichtsheft-Empfehlung. **Empfehlung:** `vorzeitige_zulassung = 1` ⇒ wie letztes Ausbildungsjahr behandeln. |
| Z13 | Externe (§ 45 Abs. 2, 4,5 Jahre) | Kein Ausbildungsverhältnis, kein Berichtsheft | ✅ Nicht Gegenstand des Tools. |
| Z14 | Prüfungserfolg bestanden / nicht bestanden / WDH1 / WDH2 | § 37 Abs. 1 BBiG: zweimalige Wiederholung; § 21 Abs. 3: Verlängerung auf Verlangen bis zur nächsten Wiederholung, höchstens ein Jahr | ✅ Status „verlängert“ vorhanden. |
| Z15 | Pflichtteile aus der Vorkontrolle übernommen (1.1, 1.4, 1.5, Anzahl, 1.2, 1.6) | – | ✅ Sinnvoll; Hinweis: die ÜBA-Anzahl aus dem Vorjahr kann in der Zulassungskontrolle veraltet sein – die Karte sollte den Stand mit Datum der Vorkontrolle anzeigen. |

---

## 3. Fehlzeiten

### 3.1 Tool

`App.getFehltageGesamt` (`app-core.js:7607`): Summe `kw_status.fehltage` (0–5 je KW, Code H) + `fehltage_pauschal` des jüngsten Kontrollergebnisses. `App.calcArbeitstage` (`app-core.js:7681`): aktive Wochen **aller** Raster des Azubis × 5 − 11 Feiertage je Jahr (dreijährig ≈ 747 Arbeitstage). Schwelle 10 % (`kontrolle.js:269`), Textbaustein `TB_FEHLTAGE` „Reguläre Zulassung gefährdet bei mehr als 10 %“. Code H heißt je nach Modul „Fehltage (1–5 Tage pro KW)“ (Raster) und „Fehltage nicht eingetragen“ (Anschreiben, `workflows.js:54`).

### 3.2 Abgleich

| Nr. | Punkt | Vorgabe | Bewertung |
|---|---|---|---|
| F1 | 10 % der Ausbildungszeit | Praxis BW (RPF-Zulassung 2022, LRA-KA FAQ); IHK-Praxis ebenso; ≈ 25 Tage je Jahr bei 250 Arbeitstagen | ✅ Nenner 249/Jahr im Tool passt. |
| F2 | Nenner = gesamte Vertragsdauer, auch bei einer Kontrolle im 2. Ausbildungsjahr | Maßstab ist die *zurückgelegte* Ausbildungszeit; die Frage der Zulassung stellt sich am Ende, aber die Verlängerung nach § 8 Abs. 2 soll früh beantragt werden (LRA-KA: „sinnvoll, wenn bereits zu einem frühen Zeitpunkt abzusehen“) | 🟡 In der Nov./Dez.-Kontrolle des 2. AJ zeigt das Tool 30 Fehltage als 4 %, bezogen auf die bisherige Zeit sind es 8 %. **Empfehlung:** zwei Zahlen anzeigen: „bisher x % (Stand heute)“ und „Hochrechnung auf die Gesamtdauer“; die Warnung ab 10 % auf die bisherige Zeit beziehen, damit der Hinweis auf § 8 Abs. 2 rechtzeitig kommt. |
| F3 | Was zählt als Fehltag | RPF-Zulassung 2022: Zeiten ohne aktive Ausbildung, verschuldet oder unverschuldet; **Urlaub und Berufsschule sind Ausbildungszeit**, keine Fehlzeit. LWK-Merkblatt: im Tagesbericht sind „Ausfallzeiten (Urlaub bzw. Krankheit)“ einzutragen – der Prüfer sieht also beides im Heft. | 🟠 Das Tool sagt nirgends, dass Urlaub nicht mitzuzählen ist. **Empfehlung:** Beschriftung „Fehltage (Krankheit, unentschuldigt; **ohne Urlaub und Berufsschule**)“ im Raster, im Popover, in der Nacherfassung und in der Hilfe; Code-H-Label in allen Modulen vereinheitlichen. |
| F4 | Obergrenze 5 je KW | Fünf-Tage-Woche; Samstage im Gartenbau möglich | ✅ ausreichend. |
| F5 | Pauschale Fehltage (Nacherfassung, Phasen `pauschal_fehltage_e/_u`) zählen mit | Fehlzeiten aus Unterbrechungen (Krankheit über Wochen, Elternzeit) | ✅ Hinweis: Mutterschutz/Elternzeit als *Unterbrechung* verschieben das Vertragsende (§ 8 Abs. 2 auf Antrag) und sind dann keine Fehlzeit im Sinne der 10 % – das Tool macht beides richtig (inaktive Wochen im Raster, Vertragsende aus Phasen), nur die Hilfe sollte es so erklären. |
| F6 | Folge bei ≥ 10 % | Praxis: Einzelfall, Prüfungsausschuss entscheidet; Verlängerung nach § 8 Abs. 2 möglich, bis etwa ein Jahr | 🟡 **Empfehlung:** Textbaustein `TB_FEHLTAGE` um den Hinweis auf § 8 Abs. 2 (Verlängerungsantrag durch den Azubi) ergänzen; Schwelle als Einstellung `fehlzeiten_prozent` (Standard 10). |

---

## 4. Anforderungen an das Berichtsheft und Mängelcodes

| Code | Tool | Vorgabe | Zulassungsrelevant? |
|---|---|---|---|
| A | Unterschrift Azubi fehlt | LWK: Tagesberichte vom Azubi zu unterschreiben; RP-Hinweise: „vom Ausbilder und Auszubildenden unterschrieben“ | ✅ ja |
| B | Unterschrift Ausbilder fehlt | § 14 Abs. 2 BBiG; BIBB HA 2020 Nr. 7: mindestens monatlich mit Datum und Unterschrift; LWK: „mit Datum und Unterschrift geprüft“ | ✅ ja. Hinweis: Das Merkblatt verlangt die Unterschrift **mit Datum**; ein fehlendes Datum bei vorhandener Unterschrift ist heute nur über G oder I erfassbar. Kein eigener Code nötig, aber der Hilfetext zu B sollte „mit Datum“ sagen. |
| C | Berufsschulthemen fehlen | BIBB HA 2020 Nr. 4: „müssen … aufgenommen werden“; LWK: „ebenfalls einzutragen“ | ✅ ja |
| D | Witterungsangaben fehlen | LWK: **„keine Zulassungsvoraussetzung“**; nur mit Zusatzvereinbarung verbindlich | 🔴 **nein** – siehe Z4 |
| E | Inhaltlich lückenhaft | LWK: „persönlich ausgeführte Tätigkeiten (Zulassungsvoraussetzung)“; BIBB: stichwortartig, ca. eine Seite je Woche | ✅ ja |
| F | Berichte fehlen vollständig | dito | ✅ ja |
| G | Datum/KW fehlt | LWK: Kopfzeile KW und Datum Mo–Fr/Sa; BIBB: Berichtszeitraum und Ausbildungsjahr | ✅ ja |
| H | Fehltage | keine Beanstandung, sondern Erfassung | ✅ zählt nicht als Mangel (bereits so) |
| I | Sonstiges mit Bemerkung | – | 🟡 nur zulassungsrelevant, wenn der Prüfer es sagt: Häkchen „zulassungsrelevant“ im I-Dialog, sonst Hinweis |

**Weitere Bestandteile:**

| Bestandteil | Tool | Vorgabe | Bewertung |
|---|---|---|---|
| Sachberichte / Erfahrungsberichte (Teil 4), Pflanze der Woche (Teil 3), Pflanzenschutz (Teil 5), Rückseite 2.2 | Feld `sachberichte_anzahl`, Ergebnisart „Sachberichte wegen Wetter per E-Mail“, Textbausteine „Sachberichte fehlen teilweise“, „Zeichnungen/Skizzen fehlen“; Anschreiben nennen „Sachberichte / Wochenberichte (lückenlos geführt)“ als Prüfumfang | LWK: nur mit **Zusatzvereinbarung** (Teil 1.2) verbindlich; RPK-RL 2.7 / LRA-KA: keine Zulassungsvoraussetzung; RP-Hinweise: Zusatzvereinbarung macht das „vollständige Führen“ rechtsverbindlich | 🟠 Das Tool behandelt sie überall wie Pflicht. **Empfehlung (Paket 3):** Teil 1.2 heißt künftig „Zusatzvereinbarung Berichtsheftführung liegt vor“; nur dann sind Wetter, Sachberichte, Pflanze der Woche usw. als *Mangel* beanstandbar, sonst als *Hinweis* (Bemerkung, kein Code, keine Frist). Anschreiben-Vorlagen: „Sachberichte/Wochenberichte“ → „Tagesberichte“; Zusatz „bei Zusatzvereinbarung auch …“. |
| Monatliche Vorlage beim Ausbilder | nicht abgebildet | BIBB HA 2020 Nr. 7; LWK „mind. 1 mal pro Monat“ | ✅ Über B (Unterschrift je Woche mit Datum) ausreichend abgedeckt; kein eigener Code. |
| Elektronische Führung | Papierkontrolle | RP-Hinweise 2024: elektronisch möglich, aber ausgedruckt und unterschrieben; RPF (Forst) 2022: komplett elektronische Form nicht zulässig | ✅ Hinweis in die Hilfe: Ausdrucke sind zu prüfen wie Handschrift. |
| Gesetzliche Vertreter bei Minderjährigen | nicht abgebildet | BIBB HA 2020 Nr. 9 „soll“ | ✅ keine Zulassungsrelevanz, nichts nötig. |
| Berichtsheft = Urkunde | Snapshot/Archiv je Durchsicht | RPF (Forst) 2022: § 267 StGB | ✅ Der unveränderliche Durchsichts-Snapshot ist dafür der richtige Nachweis. |

---

## 5. Zeiten, Zeiträume, Raster

| Nr. | Tool | Vorgabe | Bewertung |
|---|---|---|---|
| T1 | Regeldauer 36 Monate, `regulaerDauer` in Phasen | § 2 GärtnAusbV | ✅ |
| T2 | Verkürzung 0–18 Monate (`import-handler.js:1133`), Phasen mindestens 6 Monate Soll | § 8 Abs. 1 BBiG; Praxis BW: Anrechnung höchstens 12 Monate (Hochschulreife, Berufsausbildung), zusätzlich ½ Jahr bei guten Leistungen (Antrag bis 1.12./1.4.) → zusammen bis 18 Monate | ✅ 18 passt zur Praxis. 🟡 `max(6, …)` in `phasen.js:51` widerspricht dem Feldmaximum nicht, ist aber unnötig locker; Vorschlag: mindestens 18 Monate Restdauer als Warnung in der Datenqualität. |
| T3 | Verlängerung: Status „verlängert“, AJ 4 im Raster | § 8 Abs. 2 (Ausbildungsziel), § 21 Abs. 3 (Nichtbestehen, höchstens 1 Jahr); Praxis „i.d.R. ein Jahr“ | ✅; Raster bis 5 reicht auch für Teilzeit. |
| T4 | Teilzeit 25–100 % je Phase; DQ-Warnung Dauer > 54 Monate | § 7a Abs. 2 BBiG: Dauer verlängert sich entsprechend, **höchstens auf das Eineinhalbfache** (54 Monate) | ✅ Die 54-Monats-Warnung ist genau das Gesetz. 🟡 Der Phasen-Editor lässt 25 % zu, was rechnerisch 144 Monate ergäbe; Vorschlag: Untergrenze 50 % oder Warnung im Editor, wenn das berechnete Ende über 54 Monate liegt. |
| T5 | Probezeit nicht abgebildet | § 20 BBiG 1–4 Monate | ✅ Nicht nötig: Kontrollen finden nach der Probezeit statt (Kampagnen ab 2. AJ), Vertragslösungen kommen über IBYKUS-Status. |
| T6 | Zwischenprüfung: Kohorte H/F aus IBYKUS; Kampagnen zpH (1.9.–20.11.) und zpF (20.1.–10.3.) mit Fachrichtungs-Hinweisen | § 8 GärtnAusbV: vor Ende des 2. Ausbildungsjahres; LRA-KA: dreijährig nach der Hälfte (Frühjahr, schriftlich erster Mittwoch im März), Produktions-Fachrichtungen Herbst des 2. AJ (zweiter Mittwoch im Oktober), zweijährig zu Beginn des 2. Jahres | ✅ Zeitfenster stimmen. 🟠 Welche Fachrichtung wann geprüft wird („GaLaBau immer, Zierpflanzenbau ab F27, Baumschule nur bis H25“) ist Praxis des RP Freiburg, im Code hart verdrahtet und wird veralten. **Empfehlung (Paket 5):** Hinweislisten der Kontroll-Vorlagen als Einstellung. |
| T7 | Verkürzer beginnen im Raster mit AJ 2 (24 Monate) bzw. 3 (12 Monate) | Verkürzer besuchen die Berufsschulklasse des 2. Lehrjahres („Verkürzer + Dreijährige in derselben Klasse“, Import); ZP „zu Beginn des 2. Jahres“ | ✅ konsistent mit Schule und ZP. 🟡 Begriff: Das Raster ist ein **Schuljahr**, das Berichtsheft zählt **Vertragsjahre** (Ausbildungsplan-Spalten „1., 2., 3. Ausb.-Jahr“). Ein Verkürzer sieht im Tool „AJ 2“, in seinem Heft „1. Ausbildungsjahr“. **Empfehlung:** Rasterkopf „Schuljahr 2025/26 · 2. Lehrjahr (Schule) · 1. Vertragsjahr“ und Hilfe entsprechend. |
| T8 | Anmeldeschluss AP: Kampagnen apS 1.3.–30.4., apW 1.10.–15.11. | Service-BW: 1. April (Sommer), 1. November (Winter); Berichtsheft wird **mit der Anmeldung** vorgelegt (RPK-RL 1.5, Service-BW „Anmeldeformular ins Berichtsheft heften“) | ✅ Fenster liegen richtig. 🟡 Für die Winterprüfung endet die Kontrolle rechnerisch nach dem Anmeldeschluss (15.11. > 1.11.); das ist Praxis (Hefte kommen per Post mit der Anmeldung), sollte aber in der Vorlage stehen: „Eingang der Hefte bis 1.11., Durchsicht bis 15.11.“ |
| T9 | Nov./Dez.-Kontrolle 2.+3. AJ | Praxis; entspricht § 76 (Überwachung während der Ausbildung) und dem Ziel, Mängel vor der Zulassungskontrolle zu heilen | ✅ |
| T10 | KW 53 → 52; Schuljahr KW 36–35; August zum kommenden Schuljahr | Berichtsheft läuft nach Kalenderwochen (LWK Kopfzeile) | ✅ (PR #44) |
| T11 | Ferien BW als Richtwerte bis 2028 im Code | – | 🟡 Einstellung vorhanden; die Standardwerte sollten jährlich gepflegt werden (Hinweis in der Hilfe „Ferien prüfen“ im August). |
| T12 | Verdichten nach 24 Monaten Inaktivität; Papierkorb 90 Tage | Aufbewahrung: Zulassungsentscheidungen sind Verwaltungsakte; Berichtsheft-Befunde sind Grundlage der Entscheidung | ✅ Wochendaten verdichten ist unkritisch, da der Durchsichts-Snapshot bleibt. |

---

## 6. Workflow: Ergebnisarten, Wiedervorlagen, Nachbereitung

### 6.1 Rechtlicher Rahmen des Verfahrens

Das RP hat zwei Rollen (§ 76 Abs. 1 BBiG): **Überwachung** und **Förderung durch Beratung**. Ausbildende müssen Auskunft geben und Unterlagen vorlegen (§ 76 Abs. 2). Die Pflicht, den Azubi zum Führen anzuhalten und den Nachweis durchzusehen, liegt beim Ausbildenden (§ 14 Abs. 2) – deshalb ist der **Betrieb** der richtige Adressat der Mängelmitteilung, nicht der Azubi. Das Tool macht das durchgehend richtig (Betriebsanschreiben, Sammel-Erinnerung je Betrieb, Betriebs-Ampel, keine Azubi-Vorlage). Die Berufsschule darf im Rahmen der Lernortkooperation Kenntnis nehmen (BIBB HA 2020 Nr. 8). Eine Eskalationsleiter ist gesetzlich nicht vorgegeben; die letzte Stufe ist die Übergabe an den Prüfungsausschuss (§ 46).

### 6.2 Bewertung der sechs Ergebnisarten

| Ergebnis | Was es fachlich ist | Bewertung |
|---|---|---|
| in Ordnung | Befund | ✅ |
| Nachholung bis zur nächsten Durchsicht | Befund „Mängel“ + Nachweisweg „nächste Durchsicht“ | ✅ |
| Sachberichte wegen Wetter per E-Mail | Befund „Mängel“ + Nachweisweg „E-Mail“ + Inhalt „Wetter/Sachberichte“ | 🟠 Inhalt ist ohne Zusatzvereinbarung nicht beanstandbar (Abschnitt 4). Als eigene Ergebnisart erzeugt sie Fristen und Anschreiben für etwas, das die Zulassung nicht berührt. |
| Berichte bis Termin per E-Mail | Befund „Mängel“ + Nachweisweg „E-Mail“ | ✅ |
| Persönliche Vorlage im RP | Befund „Mängel“ + Nachweisweg „persönlich“ (Eskalation) | ✅ |
| Per Post ans RP | Befund „Mängel“ + Nachweisweg „Post“ | ✅ |

Die sechs Pillen kodieren also **zwei Fragen**: *Wie ist das Heft?* (in Ordnung / Mängel) und *Wie kommt der Nachweis?* (nächste Durchsicht / E-Mail / Post / persönlich). Das Papier-Formular hatte sechs Kästchen, weil es kein zweites Feld hatte. Alle Folgeregeln des Tools hängen tatsächlich nur an diesen zwei Dimensionen: Frist (14/21/28 Tage) am Weg, Betriebsvorlage am Befund, Ampel am Weg (persönlich/Post = rot), Adresse im PDF am Weg.

**Vorschlag Paket 4 (optional, größer):** Ergebnisleiste mit „✓ In Ordnung“ / „✗ Mängel“ und daneben ein Nachweisweg (Standard „nächste Durchsicht“). Die Datenbank behält die bisherigen Werte (Mapping Befund × Weg → alter Wert), Berichte, PDF und Tests bleiben lauffähig. Nutzen: eine Frage weniger je Azubi, „Wetter“ verschwindet als Ergebnis, Tastenkürzel ⇧1/⇧2 statt ⇧1–6. Risiko: Umgewöhnung im laufenden Kontrolljahr; die Kollegen kennen die sechs Kästchen. **Empfehlung:** erst nach der Winterkampagne, und nur wenn das Team es will.

### 6.3 Wiedervorlagen, Fristen, Mahnstufen

| Punkt | Tool | Bewertung |
|---|---|---|
| Fristen 14 / 21 / 28 Tage je Weg, Erinnerung +14, Nachholung +21 | Praxis, keine Rechtsvorgabe | ✅ 🟡 als Einstellungen `wv_frist_*` führen, Standard wie heute. |
| Mahnstufe 1 = Mitteilung, je Erinnerung +1; Betriebs-Ampel rot ab Wiederholer | Keine Rechtsvorgabe; § 76 Abs. 1 verlangt Beratung | 🟡 Es fehlt der Schritt **„Beratungsgespräch / Betriebsbesuch“** (§ 76), der in der Praxis vor der Übergabe an den Prüfungsausschuss liegt. **Empfehlung:** Wiedervorlage-Art „Beratung Betrieb (§ 76)“ mit Ergebnisnotiz; im Aktenvermerk sichtbar. Kleine Änderung, großer Nutzen für die Akte. |
| Automatische Erledigung bei „in Ordnung“ und bei Ausbildungsende | – | ✅ |
| Nachweis-Arten E-Mail/Post/persönlich/telefonisch/sonstig | – | ✅ „telefonisch bestätigt“ ist für eine Urkunde schwach; Hilfe sollte „nur mit anschließender Vorlage“ sagen. |

### 6.4 Nachbereitung: Anschreiben und Datenweitergabe

| Punkt | Tool | Bewertung |
|---|---|---|
| Ergebnis-Mail an die Schule mit Namensliste je Ergebnisart | `schule_ergebnis` | 🟡 BIBB HA 2020 Nr. 8 erlaubt Kenntnisnahme; Datenminimierung (Art. 5 Abs. 1 lit. c DSGVO) spricht gegen Mängeldetails je Azubi an die Schule. **Empfehlung:** Standard: Zahlen je Ergebnis + Namen nur der Abwesenden (Nachholung an der Schule); Namensliste als Option. |
| Betriebsanschreiben: Prüfumfang „Individueller Ausbildungsplan, Sachberichte/Wochenberichte (lückenlos), ÜBA-Bescheinigungen, Unterschriften“ | `betrieb_bcc`, `betrieb_ankuendigung` | 🟠 „Sachberichte“ → „Tagesberichte (Teil 2.1)“; Zusatz „Wetter, Sachberichte und Pflanze der Woche nur bei Zusatzvereinbarung“. Rechtsgrundlage im Text: § 14 Abs. 2 (Pflicht des Ausbildenden) zusätzlich zu § 43. |
| Übergabe an fremde Ämter (RP Stuttgart/Karlsruhe/Tübingen, Landratsämter) | `amt_uebergabe` | ✅ Zuständigkeit ist territorial (Sitz der Ausbildungsstätte); Weiterverfolgung liegt beim zuständigen Amt. |
| Hersendung ans RP für Schulen ohne Kontrolle vor Ort | Typ `einsendung` | ✅ |
| Prüfer-Signatur „Digitale Signatur · Referat 31“ im PDF | `pdf-export.js:452` | 🟡 Es ist keine Signatur im Rechtssinn (§ 126a BGB / eIDAS), sondern ein Namensvermerk. **Empfehlung:** „gez. Name, Ausbildungsberatung“ ohne das Wort „Signatur“. |

### 6.5 Statusmodell Azubi

| Status | Vorgabe | Bewertung |
|---|---|---|
| aktiv / AP zugelassen / verlängert / AP bestanden / beendet | § 21 (Beendigung mit Bestehen bzw. Ablauf), § 22 (Kündigung), § 21 Abs. 3 (Verlängerung) | ✅ vollständig für den Zweck. |
| Import: BAV ENDE → bestanden oder beendet | – | ✅ |
| „Jahrgang abschließen“ trotz offener WV | – | ✅ mit Warnung; rechtlich unkritisch, da die Zulassung bereits entschieden ist. |

---

## 7. Ist der Papier-Workflow überall sinnvoll?

**Wo er richtig ist:** Kontrolle vor Ort an der Schule (Hefte sind Papier-Urkunden, das RP darf sie einsehen, die Azubis sind versammelt), Nov./Dez.-Kontrolle des 2.+3. AJ als Frühwarnung vor der Zulassungskontrolle, Betrieb als Adressat, Prüfungsausschuss als letzte Stufe, KW-Raster mit „geprüft bis KW“ (das ist die Nachweisfunktion nach BIBB Nr. 3 in Reinform), Snapshot je Durchsicht als Aktenstück.

**Wo er zu starr ist:**

1. **Pflichtteile-Karte** bildet das Registerblatt des Berichtshefts nach (1.1, 1.2, 1.4, 1.5, 1.6) statt der rechtlichen Mindestanforderung (Tagesberichte, Unterschriften, Ausbildungsplan, ÜBA-Nachweis als Vertragsanlage). Abhilfe: 1.4 zu Hinweis, 1.2 zum Schalter, Sollzahlen als Einstellung.
2. **Sechs Ergebnisse** statt Befund + Weg (Abschnitt 6.2).
3. **Wetter als eigener Arbeitsstrang** (Code D, Ergebnisart, Textbausteine, Zählfeld Sachberichte) für etwas, das die Zulassung nicht berührt.
4. **Kampagnenwissen im Code** (Hersendungs-Schulen, Fachrichtungs-Ausnahmen, ZP-Zuordnung, Jahreszahlen wie „bis H25“). Das gehört in Einstellungen, damit die Beratung es selbst pflegt.
5. **Zulassungshäkchen** suggeriert eine Entscheidung, die das Tool nicht treffen kann und nicht treffen soll.

**Was das Tool nicht braucht:** Probezeit, Vergütung, Urlaub, Freistellung, JArbSchG-Nachuntersuchung (nur als DQ-Hinweis), gesetzliche Vertreter. Das ist Prüfungsverwaltung bzw. Vertragsverwaltung in IBYKUS.

---

## 8. Vorschlagspakete

| Paket | Inhalt | Aufwand | Wirkung |
|---|---|---|---|
| **1 · Zulassung nach § 43** | `CODES_ZULASSUNG` (A B C E F G); D und I sperren nicht; 1.4 → Hinweis; Häkchen heißt „Berichtsheft-Voraussetzung erfüllt (§ 43 Abs. 1 Nr. 2)“; vorzeitige Zulassung = letztes AJ; DQ-Regel Vertragsende vs. Prüfungszeitraum; Hilfe mit § 43, § 46, § 14 Abs. 2, § 76; I-Dialog mit Häkchen „zulassungsrelevant“ | klein–mittel (kontrolle.js, kw-nav.js, berichte.js, views.js, Tests) | 🔴 behebt die falsche Sperre durch Wetter, saubere Begriffe |
| **2 · Fehlzeiten sauber** | Label „ohne Urlaub und Berufsschule“ überall; zwei Prozentwerte (bisher / Gesamtdauer), Warnung auf „bisher“; Einstellung `fehlzeiten_prozent`; `TB_FEHLTAGE` mit Hinweis auf § 8 Abs. 2; Code-H-Label vereinheitlicht; Teilzeit-Warnung > 54 Monate im Phasen-Editor | klein | 🟠 rechtzeitige Verlängerungshinweise, keine Fehlinterpretation von Urlaub |
| **3 · Zusatzvereinbarung als Schalter** | 1.2 = „Zusatzvereinbarung liegt vor“; ohne Zusatzvereinbarung: D, Sachberichte, Pflanze der Woche als Hinweis (Bemerkung) statt Mangel; Anschreiben-Vorlagen und Textbausteine auf „Tagesberichte“ umgestellt; Ergebnisart „Sachberichte wegen Wetter“ bleibt, aber nur bei Zusatzvereinbarung angeboten | mittel | 🟠 keine Fristen und Mahnungen für Unverbindliches |
| **4 · Befund + Nachweisweg** (optional) | Ergebnisleiste „In Ordnung / Mängel“ + Weg; Mapping auf die alten Werte; Tastenkürzel; Hilfe | groß (kontrolle.js, pdf, workflows, berichte, Tests, Hilfe) | 🟡 Vereinfachung; nur mit dem Team, nach der Winterkampagne |
| **5 · Kampagnenwissen als Einstellung** | Hinweislisten der Kontroll-Vorlagen, Hersendungs-Schulen, ZP-Fachrichtungszuordnung, ÜBA-Sollzahlen je Fachrichtung (auch je Lehrjahr), WV-Fristen als Einstellungen mit heutigen Standards; Hinweis „Ferien prüfen“ | mittel | 🟠 kein Code-Release für Praxisänderungen |
| **6 · Schule bekommt weniger** | Ergebnis-Mail an die Schule standardmäßig ohne Namensliste (außer Abwesende); Option für die volle Liste | klein | 🟡 Datenminimierung |
| **7 · Beratung § 76 in der Akte** | WV-Art „Beratungsgespräch Betrieb“, Nachweis-Art „persönlich“ bevorzugt, „Signatur“ → „gez.“ im PDF, Rasterkopf mit Schuljahr/Lehrjahr/Vertragsjahr | klein | 🟡 vollständige Akte, korrekte Begriffe |

Reihenfolge nach Nutzen: **1 → 2 → 3 → 5 → 7 → 6**, Paket 4 nach Entscheidung des Teams.

---

## 9. Fundstellen (Regel-Inventar, Auszug)

- Zulassung: `src/js/modules/kontrolle.js:184-191` (`pflichtteileOK`), `:265-296` (Bedingungen, Auto-Häkchen), `:707-748` (manuell, Prüfungsausschuss); `src/js/modules/berichte.js:716-797` (Zulassungsliste aus `ap_zugelassen`).
- Fehltage: `src/js/app-core.js:7607-7614`, `:7681-7706`; `kontrolle.js:266-269`, `:3066-3085`; `src/js/modules/kw-nav.js:259-277`; `app-core.js:8681` (`TB_FEHLTAGE`).
- Codes: `kw-nav.js:2-3`, `src/js/modules/views.js:2488-2509`, `src/js/modules/workflows.js:54`, `src/js/modules/pdf-export.js:7`; Zählung ohne H: `app-core.js:293, 8607, 8640`, `kontrolle.js:272, 1531`, `berichte.js:347`.
- Pflichtteile/ÜBA: `app-core.js:1418-1425` (Schema), `:7708-7718` (`getRequiredUBA`), `:8664-8677` (Hinweise „nicht geführt“); `kontrolle.js:1475-1517` (Karte), `pdf-export.js:258-297`.
- Ergebnisarten und Fristen: `kontrolle.js:605-622`, `:1663-1668`, `:1820-1854`, `:2597-2799` (Abschluss-Assistent); `workflows.js:181-210`, `:513`, `:555-566`, `:613-657`.
- Zeiten: `app-core.js:7474-7484` (Verkürzer), `:7505-7567` (Raster, Schuljahr), `:8477-8561` (aktive Wochen); `src/js/modules/phasen.js:51-109`, `:135-142`; `src/js/modules/import-handler.js:1133-1135`; DQ `berichte.js:935-1039`.
- Kampagnen: `src/js/modules/planung.js:33-88` (Vorlagen mit Hinweisen), `:1229-1242` (Fenster), `:1121-1225` (Assistent); LFK `app-core.js:7750-7776`, `:7858`.
- Anschreiben: `app-core.js:8696-8921` (`VORLAGEN`), Adressen `:1726-1728`; Signatur `pdf-export.js:452-467`.
- Rechtsgrundlagen in der Hilfe: `views.js:2738-2739` (§ 43, § 76), `:2737` (DSGVO/LDSG).
