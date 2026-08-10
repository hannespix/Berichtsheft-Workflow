// ═══════════════════════════════════════════════════════════════════
//  Vergütungsrechner: Perioden, aktueller Satz, Mindestvergütung
//  Ausführen:  node tests/rechner-test.mjs
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const R_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/azubi-rechner.js'), 'utf8');
const D_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/azubi-dashboard.js'), 'utf8');

const sandbox = { console, Date, Math, JSON, Set, Map, App: { query: () => [], scalar: () => null } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(R_SRC + '\n;globalThis.AzubiRechner = AzubiRechner;', sandbox, { filename: 'azubi-rechner.js' });
vm.runInContext(D_SRC + '\n;globalThis.AzubiDashboard = AzubiDashboard;', sandbox, { filename: 'azubi-dashboard.js' });
const { AzubiRechner: R, AzubiDashboard: D } = sandbox;

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

console.log('══ Vergütungsperioden: Lücken werden nicht als bezahlte Zeit verschmolzen ══');
{
  // Zwei Ausbildungsphasen mit sechs Monaten Lücke dazwischen
  const phasen = [
    { id: 1, von: '2025-09-01', bis: '2026-05-31', typ: 'ausbildung', teilzeit_prozent: 100, betrieb: 'Betrieb A' },
    { id: 2, von: '2026-12-01', bis: '2029-05-31', typ: 'ausbildung', teilzeit_prozent: 100, betrieb: 'Betrieb A' },
  ];
  const mit = R.phasenMitEnden(phasen, 36, 0);
  const perioden = R.berechneVerguetungsUebersicht(
    { beruf_id: 'galabau', start_datum: '2025-09-01', verkuerzung_monate: 0, geburtsdatum: '2005-01-01' }, mit);
  const bezahlt = perioden.filter(p => !p.unterbrechung);
  // Keine Periode darf über die Lücke hinweglaufen
  const ueberLuecke = bezahlt.some(p => p.von < new Date(2026, 5, 1) && p.bis > new Date(2026, 10, 30));
  check(!ueberLuecke, 'Keine Periode überspannt die sechsmonatige Lücke');
  const gesamtMonate = bezahlt.reduce((s, p) => s + (p.monateDauer || 0), 0);
  check(gesamtMonate < 40, `Summe der bezahlten Monate bleibt plausibel (${gesamtMonate.toFixed(1)}), keine Phantom-Vergütung`);
}

console.log('\n══ Zusammenhängende Perioden werden weiterhin zusammengefasst ══');
{
  const phasen = [{ id: 1, von: '2025-09-01', bis: '2028-08-31', typ: 'ausbildung', teilzeit_prozent: 100, betrieb: 'A' }];
  const mit = R.phasenMitEnden(phasen, 36, 0);
  const perioden = R.berechneVerguetungsUebersicht(
    { beruf_id: 'galabau', start_datum: '2025-09-01', verkuerzung_monate: 0, geburtsdatum: '2005-01-01' }, mit);
  const lj = perioden.filter(p => !p.unterbrechung).map(p => p.lehrjahr);
  check(new Set(lj).size === 3, `Drei Lehrjahres-Abschnitte (${lj.join(', ')})`);
  const luecken = [];
  const bez = perioden.filter(p => !p.unterbrechung);
  for (let i = 1; i < bez.length; i++) if (+bez[i - 1].bis !== +bez[i].von) luecken.push(i);
  check(luecken.length === 0, 'Abschnitte schließen lückenlos aneinander an');
}

console.log('\n══ Tarifstand zum Ausbildungsbeginn gilt durchgehend ══');
{
  const phasen = [{ id: 1, von: '2025-09-01', bis: '2028-08-31', typ: 'ausbildung', teilzeit_prozent: 100 }];
  const mit = R.phasenMitEnden(phasen, 36, 0);
  const perioden = R.berechneVerguetungsUebersicht(
    { beruf_id: 'galabau', start_datum: '2025-09-01', verkuerzung_monate: 0, geburtsdatum: '2005-01-01' }, mit)
    .filter(p => !p.unterbrechung);
  const saetze = [...new Set(perioden.map(p => p.vergVZ))].sort((a, b) => a - b);
  // Tarifstand 2025-07: 1100 / 1220 / 1340
  check(JSON.stringify(saetze) === '[1100,1220,1340]',
    `Sätze des Beginn-Tarifs, keine Erhöhung mitten in der Ausbildung (${saetze.join(' / ')})`);
}

console.log('\n══ Mindestvergütung: richtiger Jahrgang, nicht für Fachwerker ══');
{
  const risiken = (kz) => D._berechneRisiken(kz);
  const basis = {
    pauschalFehltage: { summe: 0 }, fehltageHart: 30, fehltageSoft: 20,
    probleme: [], aktPhase: null, aktLehrjahr: 1,
  };
  // Vertrag von 2024 mit 700 €: nach MiAV 2024 (649 €) zulässig
  const alt = risiken({ ...basis, aktVerg: 700, isFachwerker: false, schueler: { ausbildungsbeginn: '2024-09-01' } });
  check(!alt.some(r => r.includes('Mindestvergütung')), 'Altvertrag wird gegen den Satz seines Beginnjahres geprüft');
  // Derselbe Betrag bei Beginn 2026 (724 €) ist zu niedrig
  const neu = risiken({ ...basis, aktVerg: 700, isFachwerker: false, schueler: { ausbildungsbeginn: '2026-09-01' } });
  check(neu.some(r => r.includes('Mindestvergütung')), 'Neuvertrag unter dem aktuellen Mindestsatz wird gemeldet');
  // Fachwerker: §17 BBiG gilt nicht
  const fw = risiken({ ...basis, aktVerg: 501, isFachwerker: true, schueler: { ausbildungsbeginn: '2025-09-01' } });
  check(!fw.some(r => r.includes('Mindestvergütung')), 'Fachwerker erhalten keine Falschmeldung (Ausbildungsgeld statt Tarif)');
}

console.log('\n══ Monatsarithmetik ══');
{
  const iso = (d) => R.fmtISO(d);
  check(iso(R.addMonths(R.parseISO('2024-01-31'), 1)) === '2024-02-29', '31.01. + 1 Monat = 29.02. (Schaltjahr)');
  check(iso(R.addMonths(R.parseISO('2023-01-31'), 1)) === '2023-02-28', '31.01. + 1 Monat = 28.02. (Normaljahr)');
  check(iso(R.addMonths(R.parseISO('2024-02-29'), 12)) === '2025-02-28', '29.02. + 12 Monate = 28.02.');
  check(Math.round(R.diffMonths(R.parseISO('2025-09-01'), R.parseISO('2028-09-01'))) === 36, 'Drei Jahre = 36 Monate');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
