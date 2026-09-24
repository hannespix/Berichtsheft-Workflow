// ═══════════════════════════════════════════════════════════════════
//  Import über das Protokoll statt über einen Snapshot: Der Bulk-Modus
//  bereitet jede Anweisung wie eine normale Op vor (Kennungen), bulkAlsOps
//  übergibt sie dem Puffer, _saveV3 hängt in Häppchen an, der zweite Client
//  erhält Azubis, Betriebe, Klassen und Schulen mit denselben Kennungen.
//  Ausführen:  node tests/import-sync-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { getSQL, makeStore, makeSeed, makeClient, makeChecker } from './_sync-harness.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SQL = await getSQL();
const seedBytes = makeSeed(SQL);
const { check, state } = makeChecker();
const store = makeStore();
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: Date.now() });
const A = await makeClient(SQL, store, 'anna', new Uint8Array(seedBytes), { quiet: true });
const B = await makeClient(SQL, store, 'bernd', new Uint8Array(seedBytes), { quiet: true });
A.sofortSpeichern = async (q) => { A.__sofort = (A.__sofort || 0) + 1; A.__quelle = q; return true; }; // Anhängen steuert der Test selbst

console.log('══ Bulk-Modus bereitet Ops wie normale Ops vor ══');
{
  A._bulkImport = true;
  A.run("INSERT INTO schueler (nachname,vorname,aktiv,ibykus_id) VALUES (?,?,1,?)", ['Import', 'Eins', 'I-1']);
  A.run("INSERT INTO berufsschulen (name) VALUES (?)", ['BS Import']);
  A.run("INSERT INTO betriebe (betriebsnummer,name) VALUES (?,?) ON CONFLICT(betriebsnummer) DO UPDATE SET name=excluded.name", ['B-1', 'Betrieb Import']);
  A.run("INSERT OR IGNORE INTO klassen (berufsschule_id,jahrgang_id,lehrjahr,fachrichtung_id,klassenbezeichnung) VALUES (?,?,?,?,?)", [1, null, 1, null, 'K1']);
  A._bulkImport = false;
  // Jede Einfügung in eine Tombstone-Tabelle (schueler) bringt eine Nach-Op (Tombstone löschen) mit
  const ops = A._bulkOps.filter(o => !/bhk_tombstones/.test(o.sql));
  check(A._bulkOps.length === 5 && ops.length === 4 && /^INSERT INTO schueler \(id,nachname/.test(ops[0].sql) && ops[0].params[0] > 1e15, `Bulk-Op trägt eine globale Kennung (${ops[0].params[0]}), Tombstone-Nach-Op dabei`);
  check(/^INSERT INTO berufsschulen \(id,name\)/.test(ops[1].sql) && /^INSERT INTO betriebe \(id,betriebsnummer/.test(ops[2].sql) && /INSERT OR IGNORE INTO klassen \(id,/.test(ops[3].sql), 'Schulen, Betriebe (Upsert) und Klassen ebenso');
  const sid = A.scalar("SELECT id FROM schueler WHERE ibykus_id='I-1'");
  check(sid === ops[0].params[0] && A.scalar("SELECT id FROM berufsschulen WHERE name='BS Import'") === ops[1].params[0], 'Die lokale Zeile hat genau diese Kennung');
  check(A._dirtyOps.length === 0, 'Im Bulk-Modus noch keine Puffer-Ops');
}

console.log('\n══ bulkAlsOps: Puffer, Stempel, Absturzpuffer ══');
{
  const n = A.bulkAlsOps(0, 'Import');
  check(n === 5 && A._bulkOps.length === 0 && A._dirtyOps.length === 5, `Fünf Ops in den Puffer übernommen, Bulk-Liste geleert (${n})`);
  check(A._dirtyOps.every(o => o.uid && o.ts && o.seq && o.sql && Array.isArray(o.params)), 'Jede Op hat uid, ts, seq');
  check(A.__sofort === 1 && A.__quelle === 'Import' && A.unsavedChanges === true, 'Sofort schreiben angestoßen (ohne zu warten), Status „geändert“');
  // Vorschau-Muster: nur die Ops ab dem Startindex werden übernommen
  A._bulkImport = true; A.run("INSERT INTO schueler (nachname,vorname,aktiv,ibykus_id) VALUES (?,?,1,?)", ['Alt', 'Rest', 'I-0']); A._bulkImport = false;
  const ab = A._bulkOps.length;
  check(A.bulkAlsOps(ab, 'Vorschau') === 0 && A._bulkOps.length === 2, 'Ab-Index: nichts Neues → nichts übernommen, ältere Bulk-Ops bleiben');
  A._bulkOps.length = 0; A.db.run("DELETE FROM schueler WHERE ibykus_id='I-0'");
}

console.log('\n══ Anhängen in Häppchen (APPEND_MAX_BYTES) ══');
{
  A._bulkImport = true;
  for (let i = 0; i < 1500; i++) A.run("INSERT INTO schueler (nachname,vorname,aktiv,ibykus_id,ausbildungsstaette,telefon,email) VALUES (?,?,1,?,?,?,?)", ['Nachname' + i, 'Vorname' + i, 'IMP-' + i, 'Gärtnerei Nummer ' + i, '0761 ' + i, 'azubi' + i + '@beispiel.de']);
  A._bulkImport = false;
  const n = A.bulkAlsOps(0, 'Import');
  let runden = 0;
  while (A._dirtyOps.length && runden < 40) { await A.mergeAndSave(true); runden++; }
  const logs = [...store.files.entries()].filter(([name]) => name.includes(A._getClientId()) && name.endsWith('.jsonl'));
  const groesster = Math.max(...logs.map(([, f]) => f.data.length));
  const gesamt = logs.reduce((s, [, f]) => s + f.data.length, 0);
  check(n === 3000 && A._dirtyOps.length === 0 && !A._appendHaengt, `${n} Ops (1500 Azubis samt Tombstone-Ops) vollständig angehängt (${runden} Anhänge-Vorgänge)`);
  check(runden >= 3 && groesster <= A.APPEND_MAX_BYTES + 2048, `Häppchen: größtes Protokoll ${Math.round(groesster / 1024)} KB ≤ ${Math.round(A.APPEND_MAX_BYTES / 1024)} KB, ${logs.length} Generationen, ${Math.round(gesamt / 1024)} KB gesamt`);
  check(A._ungesichertAzubis.size === 0, 'Keine Azubis mehr als „ungesichert“ markiert');
}

console.log('\n══ Zweiter Client erhält alles mit denselben Kennungen ══');
{
  for (let i = 0; i < 3; i++) await B._pollOplogs();
  const idsA = (t) => A.query(`SELECT id FROM ${t} ORDER BY id`).map(r => r.id).join(',');
  const idsB = (t) => B.query(`SELECT id FROM ${t} ORDER BY id`).map(r => r.id).join(',');
  check(B.scalar('SELECT COUNT(*) FROM schueler') === A.scalar('SELECT COUNT(*) FROM schueler') && B.scalar('SELECT COUNT(*) FROM schueler') === 3 + 1501, `B hat alle Azubis (${B.scalar('SELECT COUNT(*) FROM schueler')})`);
  check(idsA('schueler') === idsB('schueler') && idsA('betriebe') === idsB('betriebe') && idsA('berufsschulen') === idsB('berufsschulen') && idsA('klassen') === idsB('klassen'), 'Kennungen von Azubis, Betrieben, Schulen und Klassen sind bei A und B identisch');
  check(B.scalar("SELECT name FROM betriebe WHERE betriebsnummer='B-1'") === 'Betrieb Import' && B.scalar("SELECT COUNT(*) FROM klassen WHERE klassenbezeichnung='K1'") === 1, 'Betrieb (Upsert) und Klasse (OR IGNORE) angekommen');
  // Ein Azubi-Update von B trifft dieselbe Zeile
  const sid = B.scalar("SELECT id FROM schueler WHERE ibykus_id='IMP-7'");
  B.run('UPDATE schueler SET telefon=? WHERE id=?', ['neu', sid]);
  await B.mergeAndSave(true); await A._pollOplogs();
  check(A.scalar("SELECT telefon FROM schueler WHERE ibykus_id='IMP-7'") === 'neu', 'Update von B über die Kennung landet bei A auf dem richtigen Azubi');
}

console.log('\n══ Import-Handler nutzt den Protokollweg ══');
{
  const IH = read('src/js/modules/import-handler.js');
  check(!/App\.fullSave\(/.test(IH) && /this\._importOps = App\.bulkAlsOps\(bulkOpsVorher, 'Import'\)/.test(IH), 'doImport: bulkAlsOps statt fullSave (kein Snapshot, keine Sperre)');
  check(/werden jetzt im Hintergrund auf das Netzlaufwerk geschrieben/.test(IH), 'Ergebnis-Dialog erklärt das Schreiben im Hintergrund');
  const APP = read('src/js/app-core.js');
  check(/APPEND_MAX_BYTES: 256 \* 1024/.test(APP) && /summe \+ z\.length > this\.APPEND_MAX_BYTES\) break;/.test(APP) && /this\._dirtyOps\.splice\(0, anzahl\)/.test(APP), '_saveV3 hängt höchstens APPEND_MAX_BYTES je Versuch an');
  check(/const prep = this\._prepareOp\(sql, params\);\n      if \(!this\._bulkOps\)/.test(APP), 'Bulk-Modus läuft über _prepareOp');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
