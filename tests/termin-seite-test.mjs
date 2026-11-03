// Termin-Seite (UI-Vereinfachung Paket 7): ein Ort je Termin mit den Phasen
// Vorbereitung → Durchsicht → Nachbereitung → Bögen & Export.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TS = read('src/js/modules/termin-seite.js');
const APP = read('src/js/app-core.js');
const V = read('src/js/modules/views.js');
const K = read('src/js/modules/kontrolle.js');
const P = read('src/js/modules/planung.js');
const W = read('src/js/modules/workflows.js');
const CSS = read('src/css/styles.css');
const HTML = read('index.html');
const BUILD = read('build.sh');
let ok = 0, fail = 0;
const check = (c, name) => { if (c) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FEHLER: ' + name); } };

console.log('\n══ Registrierung ══');
check(/termin-seite\.js/.test(HTML) && /termin-seite\.js/.test(BUILD) && HTML.indexOf('azubi-seite.js') < HTML.indexOf('termin-seite.js'), 'Modul in index.html und build.sh (nach der Azubi-Seite)');
check(/termin: \(\) => TerminSeite\.render\(\)/.test(APP) && /termin: 'help_4'/.test(APP) && /termin: 'planung' \}/.test(APP), 'Ansicht „termin“ im Kern: Rendern, Hilfe-Kapitel Termine, Menüpunkt Termine bleibt markiert');
check(!/FILTER_ANSICHTEN: \[[^\]]*'termin'/.test(APP), 'Kein Filterbalken auf der Termin-Seite');

console.log('\n══ Aufbau der Seite ══');
check(/PHASEN: \[\s*\['vorbereitung', 'Vorbereitung'\],\s*\['durchsicht', 'Durchsicht'\],\s*\['nachbereitung', 'Nachbereitung'\],\s*\['export', 'Bögen & Export'\],\s*\]/.test(TS), 'Vier Phasen in fester Reihenfolge');
check(/oeffnen\(id, phase\) \{/.test(TS) && /App\.uSet\('termin_id'/.test(TS) && /App\.navigate\('termin'\)/.test(TS) && /App\.uGet\('termin_id'/.test(TS), 'oeffnen(id) merkt den Termin und navigiert; render holt ihn nach einem Neuladen zurück');
check(/id="tsSeite" class="ts-seite"/.test(TS) && /class="card ts-kopf"/.test(TS) && /<ol class="ts-phasen"/.test(TS) && /<details class="card ts-phase \$\{i === phasenIdx \? 'aktiv' : ''\}" id="tsPhase_\$\{k\}" \$\{offenIst\(k, i\) \? 'open' : ''\}/.test(TS), 'Kopf, Phasenleiste und je Phase ein Abschnitt; nur die aktuelle Phase ist aufgeklappt');
check(/const phase = t\.nachbereitet_am \? 'export' : abg \? 'nachbereitung' : \(bewertet > 0 \|\| t\.geplant_datum <= heute\) \? 'durchsicht' : 'vorbereitung';/.test(TS), 'Aktuelle Phase aus Stand: nachbereitet → Export, abgeschlossen → Nachbereitung, begonnen/fällig → Durchsicht, sonst Vorbereitung');
check(/_toggle\(phase, el\)/.test(TS) && /ontoggle="TerminSeite\._toggle\('\$\{k\}', this\)"/.test(TS) && /const merk = this\._offen\[t\.id\] \|\| \{\};/.test(TS), 'Von Hand auf-/zugeklappte Phasen überleben das Neuzeichnen');
check(/_standText\(k, t, st\)/.test(TS) && /class="ts-stand"/.test(TS), 'Zugeklappte Phasen zeigen eine Zeile Stand');
check(/▸ Durchsicht öffnen/.test(TS) && /durchsichtOeffnen\(\) \{/.test(TS) && /KontrolleHandler\.startKontrolle\(id\)/.test(TS), 'Durchsicht öffnen führt in die Übersicht der Durchsicht');
check(/PlanungHandler\.editTermin\(\$\{t\.id\}\)/.test(TS) && /TerminSeite\.loeschen\(\)/.test(TS) && /await PlanungHandler\.deleteTermin\(id\)/.test(TS), 'Bearbeiten und Löschen von der Seite aus');

console.log('\n══ Phasen ══');
check(/Workflows\.emailSchule\(\$\{id\}\)/.test(TS) && /PlanungHandler\.terminBestaetigen\(\$\{id\}\)/.test(TS) && /PlanungHandler\.terminAnfrageZuruecksetzen\(\$\{id\}\)/.test(TS) && /Workflows\.seriendruckBetriebe\(\$\{id\}\)/.test(TS), 'Vorbereitung: Anfrage, Zusage, zurücksetzen, Betriebe anschreiben');
check(/freier Ort – keine Schulanfrage nötig/.test(TS), 'Vorbereitung: freier Ort braucht keine Schulanfrage');
check(/class="fortschritt ts-fortschritt"/.test(TS) && /role="progressbar"/.test(TS) && /KontrolleHandler\.printUebersicht\(\$\{id\}\)/.test(TS), 'Durchsicht: Fortschritt mit Balken, Übersichtstabelle');
check(/Workflows\.emailBetriebIndividuell\(\$\{id\}\)/.test(TS) && /Workflows\.briefeBearbeiten\(\$\{id\}\)/.test(TS) && /PlanungHandler\.fremdeAemter\(\$\{id\}\)/.test(TS) && /PlanungHandler\.nachholterminAnlegen\(\$\{id\}\)/.test(TS) && /TerminSeite\.nachbereitetVermerken\(\)/.test(TS) && /App\.terminSchritt\(this\._id, 'nachbereitet'\)/.test(TS), 'Nachbereitung: Schule, E-Mails und Briefe an Betriebe, fremde Ämter, Nachholtermin, „Nachbereitung abgeschlossen“');
check(/Wiedervorlagen dieses Termins/.test(TS) && /JOIN kontrollergebnisse k ON w\.kontrollergebnis_id=k\.id/.test(TS) && /WiedervorlagenHandler\.details\(\$\{w\.id\}\)/.test(TS) && /'nächste Durchsicht'/.test(TS), 'Nachbereitung: Wiedervorlagen dieses Termins (ohne Datum = nächste Durchsicht)');
check(/PlanungHandler\.exportTerminPDF\(\$\{id\}\)/.test(TS) && /BerichteHandler\.exportTerminExcel\(\$\{id\}\)/.test(TS) && /BerichteHandler\.gesamtpaket\(\$\{id\}\)/.test(TS) && /Workflows\.exportSeriendruckCSV\(\$\{id\}\)/.test(TS) && /Workflows\.exportSeriendruckWord\(\$\{id\}\)/.test(TS), 'Bögen & Export: PDF, Excel, Gesamtpaket, Seriendruck');

console.log('\n══ Verdrahtung ══');
check(/onclick="TerminSeite\.oeffnen\(\$\{t\.id\}\)" title="Termin-Seite: \$\{phase\} ist dran">Öffnen<\/button>/.test(V), 'Termine-Liste: Hauptknopf „Öffnen“ führt auf die Seite');
check(/onclick="TerminSeite\.oeffnen\(\$\{t\.id\}\)" title="Termin-Seite: Vorbereitung, Durchsicht, Nachbereitung, Bögen"/.test(V), 'Dashboard „Nächste Termine“: Öffnen → Termin-Seite, ▸ Starten bleibt');
check(/Vorbereitung → Durchsicht → Nachbereitung → Bögen & Export/.test(V) && /'Vorbereitung', `\$\{st\.termineOffen\} Termin\(e\) geplant/.test(V) && /'Bögen & Export', st\.ohneNachbereitung \? 'nach der Nachbereitung' : 'Berichte & Export'/.test(V), 'Dashboard „Wo stehen wir?“ folgt den vier Phasen');
check(/label: '▦ Termin-Seite \(Vorbereitung · Nachbereitung · Bögen\)', onclick: `TerminSeite\.oeffnen\(\$\{terminId\}\)`/.test(K), 'Menü „Termin ▾“ der Durchsicht führt zur Termin-Seite');
check(/_auffrischen\(\) \{/.test(P) && /if \(App\.currentView === 'termin' && typeof TerminSeite !== 'undefined'\) \{ TerminSeite\.render\(\); return; \}/.test(P) && (P.match(/^\s*Views\.planung\(\);$/mg) || []).length === 1, 'Speichern, Löschen, Zusage, Nachholtermin und Kampagne zeichnen die Termin-Seite neu, wenn sie offen ist');
check(/else if \(App\.currentView === 'termin' && typeof TerminSeite !== 'undefined'\) TerminSeite\.render\(\);/.test(W), 'Anfrage an die Schule frischt die Termin-Seite auf');
check(/Termin-Seite – ein Ort je Termin/.test(V) && /<strong>Vorbereitung<\/strong>/.test(V) && /<strong>Bögen &amp; Export<\/strong>/.test(V), 'Hilfe erklärt die Termin-Seite mit den vier Phasen');
check(/\.ts-phase > summary \{/.test(CSS) && /\.ts-phase\.aktiv \{ border-left: 4px solid var\(--clr-forest\); \}/.test(CSS) && /\.ts-phase > summary:focus-visible/.test(CSS) && !/\.ts-[a-z-]+ \{[^}]*font-size: 1[01]px/.test(CSS), 'CSS: Phasen-Abschnitte, aktive Phase markiert, sichtbarer Fokus, keine Schrift unter 12 px');

console.log('\n══ Verhalten mit Daten ══');
{
  const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
  const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });
  const db = new SQL.Database();
  db.run(`CREATE TABLE kontrolltermine (id INTEGER PRIMARY KEY, geplant_datum TEXT, status TEXT DEFAULT 'geplant', typ TEXT DEFAULT 'schulkontrolle', pruefer TEXT DEFAULT '', bemerkung TEXT DEFAULT '', angefragt_am TEXT DEFAULT '', angefragt_von TEXT DEFAULT '', bestaetigt_am TEXT DEFAULT '', nachbereitet_am TEXT DEFAULT '', durchgefuehrt_datum TEXT DEFAULT '', berufsschule_id INTEGER, ort TEXT DEFAULT '');
    CREATE TABLE kontrollergebnisse (id INTEGER PRIMARY KEY, kontrolltermin_id INTEGER, schueler_id INTEGER, anwesend INTEGER DEFAULT 1, ergebnis TEXT DEFAULT '');
    CREATE TABLE wiedervorlagen (id INTEGER PRIMARY KEY, kontrollergebnis_id INTEGER, schueler_id INTEGER, art TEXT, frist_datum TEXT, status TEXT);
    CREATE TABLE schueler (id INTEGER PRIMARY KEY, nachname TEXT, vorname TEXT, zustaendiges_amt TEXT DEFAULT '93', betrieb_id INTEGER);
    INSERT INTO kontrolltermine (id, geplant_datum) VALUES (1, '2099-01-10');
    INSERT INTO kontrolltermine (id, geplant_datum, status, durchgefuehrt_datum) VALUES (2, '2020-01-10', 'durchgefuehrt', '2020-01-10');
    INSERT INTO kontrolltermine (id, geplant_datum, status, nachbereitet_am) VALUES (3, '2020-01-10', 'durchgefuehrt', '2020-01-20');
    INSERT INTO kontrolltermine (id, geplant_datum) VALUES (4, '2000-01-10');
    INSERT INTO schueler (id, nachname, vorname) VALUES (1, 'A', 'a'), (2, 'B', 'b'), (3, 'C', 'c');
    INSERT INTO kontrollergebnisse (id, kontrolltermin_id, schueler_id, anwesend, ergebnis) VALUES (1, 2, 1, 1, 'in_ordnung'), (2, 2, 2, 1, 'nachholung_naechste_durchsicht'), (3, 2, 3, 0, '');
    INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum, status) VALUES (2, 2, 'nachholung', '', 'offen');`);
  const query = (sql, params = []) => { const st = db.prepare(sql); st.bind(params); const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return rows; };
  const App = {
    query, _heuteIso: () => '2026-11-03', getTerminSchueler: () => query('SELECT * FROM schueler'), istFremdesAmt: () => false,
    terminKette: t => ({ schritt: t.bestaetigt_am ? 'bestaetigt' : t.angefragt_am ? 'angefragt' : '', label: '', farbe: '' }),
  };
  const Workflows = { _betriebeDesTermins: () => ({ betriebe: [{ email: 'x@y' }, { email: '' }] }) };
  const formatDate = d => d ? d.split('-').reverse().join('.') : '';
  const ctx = { App, Workflows, console, formatDate, getKW: () => 1, esc: x => String(x), statusBadge: s => s };
  vm.createContext(ctx);
  vm.runInContext(TS + '\nglobalThis.TerminSeite = TerminSeite;', ctx);
  const T = ctx.TerminSeite;
  const t = id => query('SELECT * FROM kontrolltermine WHERE id=?', [id])[0];
  check(T.stand(t(1)).phase === 'vorbereitung', 'Geplanter Termin in der Zukunft ohne Ergebnisse → Vorbereitung');
  check(T.stand(t(4)).phase === 'durchsicht', 'Fälliger Termin → Durchsicht');
  const s2 = T.stand(t(2));
  check(s2.phase === 'nachbereitung' && s2.bewertet === 2 && s2.ok === 1 && s2.maengel === 1 && s2.abwesend === 1 && s2.offen === 0 && s2.wvOffen === 1 && s2.mitMail === 1, 'Abgeschlossener Termin → Nachbereitung; Zahlen: 2 bewertet, 1 in Ordnung, 1 beanstandet, 1 abwesend, 1 offene WV, 1 Betrieb mit E-Mail');
  check(T.stand(t(3)).phase === 'export', 'Nachbereiteter Termin → Bögen & Export');
  check(/2 von 3 bewertet/.test(T._standText('durchsicht', t(2), s2)) && /1 offene Wiedervorlage$/.test(T._standText('nachbereitung', t(2), s2)) && T._standText('nachbereitung', t(3), T.stand(t(3))) === 'nachbereitet 20.01.2020' && T._standText('vorbereitung', t(1), T.stand(t(1))) === 'noch nicht angefragt', 'Standzeilen nennen Zahlen und Daten');
}

console.log(`\n═══ Ergebnis: ${ok} OK, ${fail} Fehler ═══`);
process.exit(fail ? 1 : 0);
