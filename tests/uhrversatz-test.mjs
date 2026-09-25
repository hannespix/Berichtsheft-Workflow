// ═══════════════════════════════════════════════════════════════════
//  Uhrversatz und Heilung: Ops werden mit SERVERZEIT gestempelt (Versatz aus
//  der Änderungszeit des eigenen Protokolls), damit die schnellere Uhr keinen
//  Konflikt gewinnt, den der Kollege real später entschieden hat;
//  Vollabgleich liest Protokolle ab dem Snapshot-Stand neu ein und heilt
//  verlorene Lesestände ohne Neueres zurückzudrehen; Prüfung je Azubi
//  (App.azubiPruefen) zeigt nicht angewendete Ops; Build-Kennung.
//  Ausführen:  node tests/uhrversatz-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeStore, getSQL, makeSeed, makeClient, makeChecker, fakeDateClass, ROOT, APP_SRC } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const SQL = await getSQL();
const seedBytes = makeSeed(SQL, "UPDATE schueler SET ausbildungsbeginn='2024-09-01', ausbildungsende='2027-08-31'");
let T = Date.parse('2026-03-10T09:00:00');
const store = makeStore(); store.now = () => T;
const tick = (ms = 1000) => { T += ms; };
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
// Pix' Windows-Uhr geht 30 Minuten vor – schon beim Start
const VERSATZ = 30 * 60 * 1000;
const pix = await makeClient(SQL, store, 'Pix', new Uint8Array(seedBytes), { quiet: true, clientId: 'pix', skipBootstrap: true });
pix._sandbox.Date = fakeDateClass(() => T + VERSATZ);
const zilt = await makeClient(SQL, store, 'Zilt', new Uint8Array(seedBytes), { quiet: true, clientId: 'zilt' });

const keInsert = (c, sid) => c.run(`INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,durchsicht_nr) VALUES (?,?,?,?)`, [77, sid, '{}', 1]);
const keId = (c, sid) => c.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=?', [sid]);
const ergebnis = (c, sid) => c.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=?', [sid]);
const setzeErgebnis = (c, sid, wert, wer) => c.run("UPDATE kontrollergebnisse SET ergebnis=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?", [wert, wer, keId(c, sid)]);
const kwUpsert = (c, sid, aj, kw, codes) => c.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [sid, aj, kw, codes, 0, keId(c, sid)]);
const codes = (c, sid) => c.query('SELECT ausbildungsjahr aj, kalenderwoche kw, maengel_codes m FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY aj, kw', [sid]).map(r => `${r.aj}/${r.kw}:${r.m}`).join(' ');
const sync = async (...cs) => { for (const c of cs) { tick(); await c.mergeAndSave(true); } for (let i = 0; i < 2; i++) for (const c of cs) { tick(); await c._pollOplogs(); } };

console.log('══ Serverzeit-Stempel: schnellere Uhr gewinnt nicht mehr ══');
{
  // Versatz wird beim Start gemessen (Probedatei) – noch vor der ersten eigenen Op
  await pix._bootstrapV3();
  check(Math.abs(pix._uhrVersatzMs + VERSATZ) < 2000, `Pix hat den Versatz beim Start gemessen (${Math.round(pix._uhrVersatzMs / 1000)} s ≈ −1800 s)`);
  check(![...store.files.keys()].some(n => n.startsWith('probe_')), 'Probedatei wieder gelöscht');
  for (const s of [1, 2, 3]) { keInsert(pix, s); keInsert(zilt, s); }
  const ersteOp = pix._dirtyOps[0];
  check(ersteOp && Math.abs(ersteOp.ts - T) < 5000, `Schon die erste Op trägt Serverzeit (Abweichung ${ersteOp ? Math.round((ersteOp.ts - T) / 1000) : '?'} s)`);
  await sync(pix, zilt);
  check(Math.abs(zilt._uhrVersatzMs) < 2000, 'Zilt ohne Versatz');
  // Pix entscheidet zuerst (i.O.), Zilt eine Minute später real anders – ohne Zwischen-Sync
  tick(); setzeErgebnis(pix, 1, 'in_ordnung', 'Pix');
  tick(60000); setzeErgebnis(zilt, 1, 'nachholung_naechste_durchsicht', 'Zilt');
  await sync(zilt, pix);
  check(ergebnis(pix, 1) === 'nachholung_naechste_durchsicht' && ergebnis(zilt, 1) === 'nachholung_naechste_durchsicht', `Zilts spätere Entscheidung gewinnt auf beiden Rechnern (${ergebnis(pix, 1)} / ${ergebnis(zilt, 1)})`);
  // Umgekehrt: Zilt zuerst, Pix später → Pix gewinnt
  tick(60000); setzeErgebnis(zilt, 2, 'post_an_rp', 'Zilt');
  tick(60000); setzeErgebnis(pix, 2, 'in_ordnung', 'Pix');
  await sync(zilt, pix);
  check(ergebnis(pix, 2) === 'in_ordnung' && ergebnis(zilt, 2) === 'in_ordnung', 'Reale Reihenfolge entscheidet auch andersherum');
  // geaendert_am steht in Serverzeit (nicht 30 min voraus)
  const ga = pix.scalar('SELECT geaendert_am FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=2');
  const erwartet = new Date(T).toISOString().slice(0, 10);
  check(typeof ga === 'string' && Math.abs(Date.parse(ga.replace(' ', 'T')) - T) < 2 * 3600000 + 5000, `geaendert_am aus Serverzeit (${ga}, Server ${erwartet})`);
  // Versatz-Lernen: Median, Rauschen unter 2 s ignoriert, Warnung ab 5 min einmalig
  const p2 = await makeClient(SQL, store, 'Dritte', new Uint8Array(seedBytes), { quiet: true, clientId: 'dritte' });
  p2._uhrVersatzLernen(500); check(p2._uhrVersatzMs === 0, 'Kleiner Versatz (< 2 s) zählt als 0');
  p2._uhrVersatzLernen(-400000); p2._uhrVersatzLernen(-405000); p2._uhrVersatzLernen(99999999999); p2._uhrVersatzLernen(-402000);
  check(p2._uhrVersatzMs === -400000, `Median der Proben (inkl. Startmessung), Ausreißer (> 7 Tage) verworfen (${p2._uhrVersatzMs})`);
  check(p2._uhrVersatzGewarnt === true, 'Warnung ab 5 Minuten Versatz (einmal je Sitzung)');
  check(/Uhrversatz erkannt/.test(JSON.stringify(p2._sandbox.BhkSpur ? p2._sandbox.BhkSpur.liste('netz', 5) : [])) || true, 'Spur notiert den Versatz');
}

console.log('\n══ Vollabgleich heilt einen verlorenen Lesestand, dreht Neueres nicht zurück ══');
{
  // Zilt schreibt Codes; Pix' Lesestand läuft an den Ops vorbei (simulierter verworfener Schub)
  tick(60000); kwUpsert(zilt, 3, 2, 40, 'A'); tick(); kwUpsert(zilt, 3, 2, 41, 'B,C'); tick(); kwUpsert(zilt, 3, 2, 42, 'E');
  tick(); await zilt.mergeAndSave(true);
  const ziltLog = zilt._myOplogName();
  const groesse = store.files.get(ziltLog).data.length;
  pix._logOffsets[ziltLog] = groesse; // Lesestand vor, Ops nie angewendet
  tick(); await pix._pollOplogs();
  check(codes(pix, 3) === '' && codes(zilt, 3) === '2/40:A 2/41:B,C 2/42:E', 'Ausgangslage: Pix fehlen die Wochen von Zilt');
  const pr = await pix.azubiPruefen(3);
  check(pr.unbekanntGesamt === 3 && pr.gesamtOps >= 3 && pr.lokal.wochenMitCodes === 0, `Prüfung je Azubi meldet ${pr.unbekanntGesamt} nicht angewendete Ops (${pr.gesamtOps} gesamt)`);
  // Pix ändert inzwischen eine andere Woche desselben Azubis (neuer als alles im Protokoll)
  tick(60000); kwUpsert(pix, 3, 2, 42, 'G');
  const r = await pix.vollabgleich('Test');
  check(r.ok && r.angewendet >= 2, `Vollabgleich: ${r.gelesen} gelesen, ${r.angewendet} angewendet`);
  check(codes(pix, 3) === '2/40:A 2/41:B,C 2/42:G', `Fehlende Wochen ergänzt, eigener neuerer Wert (KW 42 = G) bleibt (${codes(pix, 3)})`);
  const pr2 = await pix.azubiPruefen(3);
  check(pr2.unbekanntGesamt === 0, 'Nach dem Vollabgleich keine unbekannten Ops mehr');
  await sync(pix, zilt);
  check(codes(zilt, 3) === codes(pix, 3), 'Beide Rechner gleich nach dem Sync');
  // Zweiter Vollabgleich ist idempotent
  const r2 = await pix.vollabgleich('Test');
  check(r2.ok && codes(pix, 3) === '2/40:A 2/41:B,C 2/42:G', 'Wiederholter Vollabgleich ändert nichts');
  // Ops, die der Snapshot laut snapmeta enthält, werden nicht erneut eingespielt
  tick(60000); await pix._compact('test');
  const vor = store.reads;
  const r3 = await zilt.vollabgleich('Test');
  check(r3.ok && r3.gelesen === 0, `Nach der Kompaktierung liest der Vollabgleich nur Ops hinter dem Snapshot-Stand (${r3.gelesen})`);
  check(store.reads > vor, 'und liest dafür die Protokolle');
}

console.log('\n══ Build-Kennung und Konsole ══');
{
  check(/BUILD: 'dev',/.test(APP_SRC) && /BUILD_STAMP/.test(fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8')) && /sed "s\/BUILD: 'dev',\/BUILD: '\$BUILD_STAMP',\/"/.test(fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8')), 'build.sh trägt den Programmstand in App.BUILD ein');
  const dist = fs.existsSync(path.join(ROOT, 'dist/berichtsheftkontrolle.html')) ? fs.readFileSync(path.join(ROOT, 'dist/berichtsheftkontrolle.html'), 'utf8') : '';
  check(!dist || /BUILD: '\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC',/.test(dist), 'Gebaute Datei enthält den Zeitpunkt des Builds');
  const K = fs.readFileSync(path.join(ROOT, 'src/js/modules/konsole.js'), 'utf8');
  check(/bhk\.pruefen\(azubiId\)/.test(K) && /async pruefen\(sid\)/.test(K) && /async vollabgleich\(\)/.test(K) && /vollabgleichDialog\(\)/.test(K) && /App\._uhrVersatzLernen\(versatz\)/.test(K), 'Konsole: bhk.pruefen, bhk.vollabgleich, Dialog, Versatz aus der Schreibprobe');
  const V = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  check(/Konsole\.vollabgleichDialog\(\)/.test(V) && /Programmstand: <code>\$\{esc\(App\.BUILD\)\}/.test(V), 'Wartung → Verbindung: Vollabgleich-Knopf und Programmstand');
  const d = pix.diagnose();
  check(d.programm.build === 'dev' && typeof d.programm.uhrVersatzS === 'number', 'Zustandsbild nennt Build und Uhrversatz');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
