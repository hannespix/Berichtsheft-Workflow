// ═══════════════════════════════════════════════════════════════════
//  IBYKUS-Import: Datumsformate, Spaltenzuordnung, Betriebsanlage,
//  Re-Import-Verhalten
//  Ausführen:  node tests/import-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });
const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
const IMP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/import-handler.js'), 'utf8');

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// ImportHandler in einer Sandbox laden, um _parseD/_datumsfolgeErkennen real zu testen
import vm from 'node:vm';
const sandbox = { console, Date, Math, JSON, Set, Map,
  document: { getElementById: () => null, querySelectorAll: () => [] },
  App: { query: () => [], scalar: () => null, run() {}, toast() {}, openModal() {}, closeModal() {} },
  Papa: {}, XLSX: {}, FileReader: class {}, KontrolleHandler: { activePruefer: 't' },
  esc: (x) => String(x ?? ''), todayStr: () => '2026-08-14', formatDate: (d) => String(d || ''),
  SchuelerView: {}, Views: {}, AzubiRechner: { getPhasen: () => [] }, setTimeout: (f) => f, localStorage: { getItem: () => null, setItem() {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(IMP_SRC + '\n;globalThis.__IH = ImportHandler;', sandbox, { filename: 'import-handler.js' });
const IH = sandbox.__IH;
const iso = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;

console.log('══ Datumsformate: alle realen Export-Varianten ══');
{
  IH._datumsFormat = 'TMJ';
  check(iso(IH._parseD('15.03.2024')) === '2024-03-15', 'TT.MM.JJJJ wird korrekt gelesen');
  check(iso(IH._parseD('2024-03-15')) === '2024-03-15', 'JJJJ-MM-TT wird korrekt gelesen');
  check(iso(IH._parseD('01.09.07')) === '2007-09-01', 'TT.MM.JJ (zweistelliges Jahr) wird gelesen');
  check(iso(IH._parseD('1/9/07')) === '2007-09-01', 'T/M/JJ im deutschen Modus: 1. September');
  check(iso(IH._parseD('31.02.2024')) === null, 'Ungültiges Datum (31. Februar) wird abgelehnt');
  check(iso(IH._parseD('44562')) === null, 'Excel-Seriennummer wird abgelehnt');
  check(iso(IH._parseD('')) === null && iso(IH._parseD(null)) === null, 'Leerwerte ergeben null');
  check(iso(IH._parseD('29.02.2024')) === '2024-02-29', 'Schalttag 2024 ist gültig');
  check(iso(IH._parseD('29.02.2023')) === null, 'Schalttag 2023 wird abgelehnt');

  // Der Fall aus dem echten Export: "9/1/07" = 1. September 2007 (US-Reihenfolge)
  IH._datumsFormat = 'MTJ';
  check(iso(IH._parseD('9/1/07')) === '2007-09-01', '"9/1/07" im US-Modus → 1. September 2007');
  check(iso(IH._parseD('9/15/07')) === '2007-09-15', '"9/15/07" → 15. September (Tag > 12 hinten)');
  IH._datumsFormat = 'TMJ';
  check(iso(IH._parseD('15/9/07')) === '2007-09-15', '"15/9/07" → 15. September (Tag > 12 vorn)');
  // Eindeutige Werte übersteuern ein FALSCH eingestelltes Format
  IH._datumsFormat = 'MTJ';
  check(iso(IH._parseD('15/9/07')) === '2007-09-15', 'Tag > 12 gewinnt gegen die eingestellte Reihenfolge');
  IH._datumsFormat = 'TMJ';
}

console.log('\n══ Spaltenanalyse erkennt die Reihenfolge ══');
{
  check(IH._datumsfolgeErkennen(['9/1/07', '9/15/07', '10/1/07']) === 'MTJ',
    'US-Spalte (Tag hinten) wird als Monat/Tag/Jahr erkannt');
  check(IH._datumsfolgeErkennen(['1.9.2024', '15.9.2024', '31.8.2025']) === 'TMJ',
    'Deutsche Spalte (Tag vorn) wird als Tag.Monat.Jahr erkannt');
  check(IH._datumsfolgeErkennen(['9/1/07', '8/1/07']) === null,
    'Durchweg mehrdeutige Spalte wird als unklar gemeldet (Dialog fragt nach)');
  check(IH._datumsfolgeErkennen([]) === null, 'Leere Spalte → unklar');
}

console.log('\n══ Spaltenzuordnung: jede Spalte nur einmal ══');
{
  // Felddefinitionen + bestMatch aus dem Quelltext übernehmen
  const defStart = IMP_SRC.indexOf('const fieldDefs = {');
  const defEnde = IMP_SRC.indexOf('\n    };', defStart) + 7;
  const bmStart = IMP_SRC.indexOf('const vergeben = new Set();');
  const bmEnde = IMP_SRC.indexOf('\n    }', IMP_SRC.indexOf('function bestMatch(fieldKey, columns)')) + 6;
  const code = IMP_SRC.slice(defStart, defEnde) + '\nconst fieldKeys = Object.keys(fieldDefs);\n' +
    IMP_SRC.slice(bmStart, bmEnde) +
    '\nreturn { fieldKeys, bestMatch };';
  const { fieldKeys, bestMatch } = new Function(code)();

  const spalten = ['Name', 'Vorname', 'Betriebsname', 'Beruf', 'Tel', 'Ort', 'Schule', 'Nr'];
  const zuordnung = {};
  fieldKeys.forEach(f => { const c = bestMatch(f, spalten); if (c) zuordnung[f] = c; });

  const belegt = Object.values(zuordnung);
  check(belegt.length === new Set(belegt).size,
    `Keine Spalte doppelt vergeben (${JSON.stringify(zuordnung)})`);
  check(!(zuordnung.betriebsnummer && zuordnung.ibykus_id && zuordnung.betriebsnummer === zuordnung.ibykus_id),
    'Betriebsnummer und BAV-Ident greifen nicht dieselbe Spalte');
  check(zuordnung.ausbildungsstaette !== 'Name',
    'Der Azubi-Nachname wird nicht als Ausbildungsstätte zugeordnet');

  // Realistischer IBYKUS-Export: strengere Regel darf keine echten Spalten verlieren
  const { fieldKeys: fk2, bestMatch: bm2 } = new Function(code)();
  const echt = ['Nachname','Vorname','Geburtsdatum','Ausbildungsbeginn','Ausbildungsende','Beruf','Prüfungstermin',
    'Berufsschule','Klassebeschreibung','Betriebsname','Betrieb-Ort','Betrieb-Strasse','Betrieb-PLZ','Betrieb-Tel',
    'Betrieb-Email','Betriebsnummer','BAV-Ident','Zuständiges Amt','Geschlecht','Schulabschluss','BAV-Status','Telefon','E-Mail'];
  const z2 = {}; fk2.forEach(f => { const c = bm2(f, echt); if (c) z2[f] = c; });
  const b2 = Object.values(z2);
  check(b2.length - new Set(b2).size === 0, 'Realistischer Export: keine Doppelvergabe');
  check(z2.nachname === 'Nachname' && z2.ausbildungsstaette === 'Betriebsname'
    && z2.ibykus_id === 'BAV-Ident' && z2.betriebsnummer === 'Betriebsnummer',
    `Kernfelder korrekt erkannt (${Object.keys(z2).length} Spalten zugeordnet)`);
}

console.log('\n══ Betriebe ohne Betriebsnummer ══');
{
  const db = new SQL.Database();
  db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
  let ok = 0, fehler = 0;
  for (const name of ['Gärtnerei A', 'Gärtnerei B', 'Gärtnerei C']) {
    // So wie der Import es jetzt macht: leere Nummer als NULL
    try { db.run('INSERT INTO betriebe (betriebsnummer,name,ort) VALUES (?,?,?)', ['' || null, name, 'Ort']); ok++; }
    catch (e) { fehler++; }
  }
  check(ok === 3 && fehler === 0, `Alle 3 Betriebe ohne Nummer angelegt (${ok} ok, ${fehler} Fehler)`);
  // Echte Nummern bleiben eindeutig
  db.run("INSERT INTO betriebe (betriebsnummer,name) VALUES ('B-1','Erster')");
  let doppelt = false;
  try { db.run("INSERT INTO betriebe (betriebsnummer,name) VALUES ('B-1','Zweiter')"); } catch (e) { doppelt = true; }
  check(doppelt, 'Doppelte echte Betriebsnummer wird weiterhin abgewiesen');
  db.close();
}

console.log('\n══ Quelltext-Zusicherungen ══');
{
  check(/bnr \|\| null/.test(IMP_SRC), 'Import speichert leere Betriebsnummer als NULL');
  check(/if \(!nrCol \|\| !lfkCol\)/.test(IMP_SRC),
    'LFK-Import verlangt BEIDE Spalten (sonst löschte er alle Landesfachklassen)');
  check(/changes\.push\(\['nachname'/.test(IMP_SRC), 'Namensänderungen werden beim Re-Import übernommen');
  check(/changes\.push\(\['ibykus_id'/.test(IMP_SRC), 'Fehlende BAV-Ident wird nachgetragen');
  check(/ergebnisGepflegt/.test(IMP_SRC), 'BAV-Status ENDE überschreibt kein gepflegtes Prüfungsergebnis');
  check(/Import wurde NICHT gespeichert/.test(IMP_SRC), 'Fehlgeschlagenes Speichern wird deutlich gemeldet');
  check(/map_datumsformat/.test(IMP_SRC), 'Datumsformat-Auswahl ist im Import-Dialog vorhanden');
  check(/datumsFehler\.push/.test(IMP_SRC), 'Datumsfehler werden getrennt von übersprungenen Zeilen gezählt');
  check(/_logImportHistorie/.test(IMP_SRC), 'Jeder Import wird in der Historie protokolliert');
  check(/INSERT INTO import_historie/.test(IMP_SRC), 'Historie schreibt in die Datenbanktabelle');
  const stammdaten = fs.readFileSync(path.join(ROOT, 'src/js/modules/stammdaten.js'), 'utf8');
  check(/INSERT INTO betriebe \(name,betriebsnummer\) VALUES \(\?,NULL\)|INSERT INTO betriebe \(name\) VALUES \(\?\)[\s\S]{0,200}catch/.test(stammdaten)
    || /_autoLinkBetriebe/.test(stammdaten), 'Automatische Betriebsverknüpfung vorhanden');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
