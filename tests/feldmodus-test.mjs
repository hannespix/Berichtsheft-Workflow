// ═══════════════════════════════════════════════════════════════════
//  Feldmodus & Lag-Budget: Abgleich-Takt aus Netzqualität, Dauer des
//  Abgleichs fließt ein, eigenes Protokoll rotiert ab LOG_ROTATE_BYTES,
//  Bereinigung löscht nur vom Snapshot abgedeckte Generationen
//  Ausführen:  node tests/feldmodus-test.mjs
// ═══════════════════════════════════════════════════════════════════
import { getSQL, makeStore, makeSeed, makeClient, makeChecker, APP_SRC, ROOT } from './_sync-harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SQL = await getSQL();
const { check, state } = makeChecker();
const store = makeStore();
const seed = makeSeed(SQL);
const A = await makeClient(SQL, store, 'anna', new Uint8Array(seed), { quiet: true });
const B = await makeClient(SQL, store, 'bernd', new Uint8Array(seed), { quiet: true });
// echte Netzqualitäts-Funktion (der Harness stubbt sie)
A._updateNetworkQuality = Object.getPrototypeOf(A)._updateNetworkQuality || A.constructor.prototype._updateNetworkQuality;
const echt = APP_SRC.match(/_updateNetworkQuality\(\) \{[\s\S]*?\n  \},/)[0];

console.log('══ Abgleich-Takt aus Netzqualität und Feldmodus ══');
{
  A._networkQuality = 'good';
  check(A._pollIntervallBerechnen() === 3000 && A._liveSyncIntervallBerechnen() === 8000, 'Schnelle Leitung: 3 s Abgleich, 8 s Positionsabgleich');
  A._networkQuality = 'slow';
  check(A._pollIntervallBerechnen() === 10000 && A._liveSyncIntervallBerechnen() === 20000, 'Langsam: 10 s / 20 s');
  A._networkQuality = 'very-slow';
  check(A._pollIntervallBerechnen() === 30000 && A._liveSyncIntervallBerechnen() === 30000, 'Sehr langsam: 30 s / 30 s');
  A._networkQuality = 'good';
  A.lsSet('bhk_feldmodus', '1');
  check(A.feldmodus === true && A._pollIntervallBerechnen() === 30000 && A._liveSyncIntervallBerechnen() === 30000, 'Feldmodus erzwingt 30 s unabhängig von der Messung');
  A.lsSet('bhk_feldmodus', '0');
  check(/const minDelay = this\.feldmodus \? 10000 : this\.autoSaveDelay;/.test(APP_SRC), 'Feldmodus bündelt das Speichern (10 s)');
}

console.log('\n══ Dauer des Abgleichs fließt in die Netzqualität ein ══');
{
  // Harness-Stub durch die echte Funktion ersetzen
  const fn = new Function('return function ' + echt.replace(/,\s*$/, '')).call(null);
  A._updateNetworkQuality = fn; A._updateNetworkUI = () => {};
  A._lastSaveDurationMs = 0; A._lastPollMs = 200; A._updateNetworkQuality();
  check(A._networkQuality === 'good', 'Abgleich 200 ms → gut');
  A._lastPollMs = 800; A._updateNetworkQuality();
  check(A._networkQuality === 'slow', 'Abgleich 800 ms (×3 gewichtet) → langsam');
  A._lastPollMs = 2000; A._updateNetworkQuality();
  check(A._networkQuality === 'very-slow', 'Abgleich 2 s → sehr langsam');
  A._lastPollMs = 0; A._lastSaveDurationMs = 3000; A._updateNetworkQuality();
  check(A._networkQuality === 'slow', 'Speichern 3 s → langsam (vorher galt das noch als gut)');
  A._lastSaveDurationMs = 0; A._updateNetworkQuality();
  await A._pollOplogs();
  check(typeof A._lastPollMs === 'number' && A._lastPollMs >= 0, `Abgleich misst seine Dauer (${A._lastPollMs} ms)`);
  check(/!this\._appendInProgress && !this\._snapshotSchreibt && !this\._appendHaengt && !this\.offlineModus\) \{/.test(APP_SRC), 'Abgleich läuft nie parallel zu einem Anhängen, Snapshot-Write oder hängenden Versuch');
  const K_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/kontrolle.js'), 'utf8');
  check(/if \(App\._appendInProgress \|\| App\.offlineModus \|\| App\._netzWeg\) return;/.test(K_SRC) && /App\._liveSyncIntervallBerechnen\(\)/.test(K_SRC), 'Positionsabgleich pausiert während des Anhängens und nutzt den Takt');
}

console.log('\n══ Kleine Protokolle: Rotation ab LOG_ROTATE_BYTES, Bereinigung nur bei Abdeckung ══');
{
  A.LOG_ROTATE_BYTES = 400;
  const genVorher = A._logGen;
  for (let i = 0; i < 6; i++) {
    A.run('UPDATE schueler SET nachname=? WHERE id=?', ['Rotation ' + i, 1]);
    await A.mergeAndSave(true);
  }
  check(A._logGen > genVorher, `Eigenes Log rotiert nach Größe (Generation ${genVorher} → ${A._logGen})`);
  const eigen = A._oplogPrefix() + A._getClientId() + '_g';
  const gens = [...store.files.keys()].filter(n => n.startsWith(eigen));
  check(gens.length >= 2, `Mehrere Generationen liegen im Ordner (${gens.length})`);
  await B._pollOplogs();
  check(B.scalar('SELECT nachname FROM schueler WHERE id=1') === 'Rotation 5', 'Kollege liest über alle Generationen hinweg den letzten Stand');
  // Bereinigung: ohne Snapshot-Abdeckung bleibt alles liegen
  await A._pruneAlteGenerationen(A._syncDirV3());
  const gensDanach = [...store.files.keys()].filter(n => n.startsWith(eigen));
  check(gensDanach.length === gens.length, 'Ohne Abdeckung durch den Snapshot wird keine Generation gelöscht');
  // Abdeckung vortäuschen: älteste Generation vollständig im Snapshot → darf weg
  const aelteste = gens.map(n => ({ n, g: parseInt(n.slice(eigen.length)) })).sort((a, b) => a.g - b.g)[0].n;
  const size = store.files.get(aelteste).data.length;
  const metaName = A._snapMetaName();
  const meta = store.files.has(metaName) ? JSON.parse(new TextDecoder().decode(store.files.get(metaName).data)) : {};
  meta.offsets = { ...(meta.offsets || {}), [aelteste]: size };
  store.files.set(metaName, { data: new TextEncoder().encode(JSON.stringify(meta)), mtime: Date.now() });
  await A._pruneAlteGenerationen(A._syncDirV3());
  check(!store.files.has(aelteste) || gens.length <= 2, `Vom Snapshot abgedeckte alte Generation wird bereinigt (${aelteste})`);
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
