// ═══════════════════════════════════════════════════════════════════
//  Stand dieses Rechners für alle (App.standAusschreiben): Wenn ein Rechner
//  die Änderungen des Kollegen verworfen hat (Last-Write-Wins gegen einen
//  eigenen, evtl. aus der Zukunft stammenden Stempel), schreibt der Rechner
//  mit dem richtigen Stand seine Durchsicht als NEUESTE Änderung mit Zwang
//  ins Protokoll – alle übernehmen sie. bhk.pruefen nennt verworfene Ops.
//  Ausführen:  node tests/ausschreiben-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeStore, getSQL, makeSeed, makeClient, makeChecker, ROOT } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const SQL = await getSQL();
const seedBytes = makeSeed(SQL, "UPDATE schueler SET ausbildungsbeginn='2024-09-01', ausbildungsende='2027-08-31'");
let T = Date.parse('2026-09-24T09:00:00');
const store = makeStore(); store.now = () => T;
const tick = (ms = 1000) => { T += ms; };
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
const zilz = await makeClient(SQL, store, 'Zilz', new Uint8Array(seedBytes), { quiet: true, clientId: 'zilz' });
const pix = await makeClient(SQL, store, 'Pix', new Uint8Array(seedBytes), { quiet: true, clientId: 'pix' });

const keInsert = (c, sid) => c.run(`INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,durchsicht_nr) VALUES (?,?,?,?)`, [77, sid, '{}', 1]);
const keId = (c, sid) => c.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=?', [sid]);
const ergebnis = (c, sid) => c.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=?', [sid]);
const setzeErgebnis = (c, sid, wert, wer) => c.run("UPDATE kontrollergebnisse SET ergebnis=?, bemerkung=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?", [wert, 'von ' + wer, wer, keId(c, sid)]);
const kwUpsert = (c, sid, aj, kw, codes, fehltage = 0) => c.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET maengel_codes=excluded.maengel_codes, fehltage=excluded.fehltage, geprueft=1', [sid, aj, kw, codes, fehltage, keId(c, sid)]);
const codes = (c, sid) => c.query('SELECT ausbildungsjahr aj, kalenderwoche kw, maengel_codes m, fehltage f FROM kw_status WHERE schueler_id=? AND (maengel_codes != "" OR fehltage > 0) ORDER BY aj, kw', [sid]).map(r => `${r.aj}/${r.kw}:${r.m}${r.f ? '+' + r.f : ''}`).join(' ');
const wvs = (c, sid) => c.query('SELECT w.art, w.frist_datum f, w.status s, (SELECT COUNT(*) FROM wiedervorlage_notizen n WHERE n.wiedervorlage_id=w.id) n FROM wiedervorlagen w WHERE w.schueler_id=? ORDER BY w.id', [sid]).map(r => `${r.art}@${r.f}:${r.s}/${r.n}`).join(' ');
const sync = async (...cs) => { for (const c of cs) { tick(); await c.mergeAndSave(true); } for (let i = 0; i < 2; i++) for (const c of cs) { tick(); await c._pollOplogs(); } };
const stand = (c, sid) => `${ergebnis(c, sid)} | ${codes(c, sid)} | ${wvs(c, sid)}`;

console.log('══ Ausgangslage: Pix verwirft Zilz’ Änderungen (eigener Stempel aus der Zukunft) ══');
{
  for (const s of [1, 2, 3]) { keInsert(zilz, s); keInsert(pix, s); }
  await sync(zilz, pix);
  // Pix hatte den Azubi zuerst auf „In Ordnung“ gesetzt …
  tick(60000); pix.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung' WHERE id=?", [keId(pix, 1)]);
  await sync(pix, zilz);
  // … Zilz arbeitet danach am 24.: Codes, Fehltage, Ergebnis, Wiedervorlage mit Notiz
  tick(60000);
  kwUpsert(zilz, 1, 2, 40, 'A'); tick(); kwUpsert(zilz, 1, 2, 41, 'B,C', 2); tick(); kwUpsert(zilz, 1, 2, 42, 'E'); tick();
  setzeErgebnis(zilz, 1, 'post_an_rp', 'Zilz'); tick();
  zilz.run('INSERT INTO wiedervorlagen (kontrollergebnis_id,schueler_id,art,frist_datum,status) VALUES (?,?,?,?,?)', [keId(zilz, 1), 1, 'post', '2026-10-15', 'offen']); tick();
  const wvId = zilz.scalar('SELECT id FROM wiedervorlagen WHERE schueler_id=1');
  zilz.run('INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?)', [wvId, 'Heft per Post erbeten', 'Zilz']); tick();
  // Pix hat – aus einer früheren Sitzung mit vorgehender Uhr – Stempel aus der
  // Zukunft für genau diese Felder (simuliert), und ein anderes Ergebnis
  const zukunft = T + 3 * 86400000;
  const st = { ts: zukunft, c: 'pix', seq: 1 };
  pix._rowStamps = pix._rowStamps || new Map();
  pix._rowStamps.set(`kontrollergebnisse|kontrolltermin_id:77|schueler_id:1`, { ergebnis: st, bemerkung: st, geaendert_von: st });
  for (const kw of [40, 41, 42]) pix._rowStamps.set(`kw_status|schueler_id:1|ausbildungsjahr:2|kalenderwoche:${kw}`, { maengel_codes: st, fehltage: st, geprueft: st });
  await sync(zilz, pix);
  check(stand(zilz, 1) === 'post_an_rp | 2/40:A 2/41:B,C+2 2/42:E | post@2026-10-15:offen/1', `Zilz hat seinen Stand (${stand(zilz, 1)})`);
  check(ergebnis(pix, 1) === 'in_ordnung' && codes(pix, 1) === '' && wvs(pix, 1) !== '', `Pix verwirft Ergebnis und Wochen (Ergebnis ${ergebnis(pix, 1)}, Wochen „${codes(pix, 1)}“), nur die Wiedervorlage kam an`);
  const pr = await pix.azubiPruefen(1);
  check(pr.unbekanntGesamt === 0 && pr.verworfenGesamt >= 4, `bhk.pruefen auf Pix: alle Ops bekannt, aber ${pr.verworfenGesamt} verworfen (Last-Write-Wins)`);
  check(pr.verworfen.length && pr.verworfen[0].rechner === 'zilz', 'Die verworfenen Ops stammen von Zilz');
  // Vollabgleich hilft hier NICHT (er dreht Neueres nicht zurück) – genau der Feldfall
  const v = await pix.vollabgleich('Test');
  check(v.ok && ergebnis(pix, 1) === 'in_ordnung' && codes(pix, 1) === '', 'Vollabgleich ändert daran nichts (Pix’ Stempel sind „neuer“)');
}

console.log('\n══ Zilz schreibt seinen Stand aus – Pix übernimmt ihn ══');
{
  const vorher = stand(zilz, 1);
  const keVorher = keId(pix, 1);
  const wochenVorher = zilz.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=1');
  tick(60000);
  const r = zilz.standAusschreiben({ terminId: 77, schuelerId: 1 });
  check(r.azubis === 1 && r.zeilen === 1 + 3 + 1 + 1 && r.ops >= r.zeilen, `Ausschreiben: ${r.azubis} Azubi, ${r.zeilen} Zeilen (Ergebnis, 3 Wochen, WV, Notiz), ${r.ops} Ops`);
  check(zilz._dirtyOps.slice(-r.ops).every(o => o.zwang === 1) && /"zwang":1/.test(r.text), 'Alle Ops tragen den Zwang (auch in der Datei)');
  check(stand(zilz, 1) === vorher && zilz.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=1') === wochenVorher, 'Lokal ändert sich bei Zilz nichts');
  await sync(zilz, pix);
  check(stand(pix, 1) === vorher, `Pix hat jetzt Zilz’ Stand (${stand(pix, 1)})`);
  check(keId(pix, 1) === keVorher, 'Pix’ Kontrollergebnis behält seine Kennung (natürlicher Schlüssel)');
  check(pix.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=1') === 1, 'Wiedervorlage nicht verdoppelt');
  check(pix.scalar('SELECT kontrollergebnis_id FROM wiedervorlagen WHERE schueler_id=1') === keVorher, 'Wiedervorlage zeigt auf Pix’ Kontrollergebnis (Verweis aufgelöst)');
  const pr = await pix.azubiPruefen(1);
  check(pr.zwangOps >= 4 && pr.zwangUnbekannt === 0 && pr.zwangLetzte > 0 && pr.verworfenGesamt === 0 && pr.datenbank && typeof pr.ordner === 'string', `bhk.pruefen auf Pix nennt den ausgeschriebenen Stand (${pr.zwangOps} Zwang-Ops, ${pr.zwangUnbekannt} ungelesen, ${pr.verworfenGesamt} verworfen, Datenbank ${pr.datenbank})`);
  // Die Stempel bei Pix sind jetzt auf dem Zwang – spätere normale Änderungen von Zilz kommen wieder an
  tick(60000); kwUpsert(zilz, 1, 2, 41, 'G');
  await sync(zilz, pix);
  check(codes(pix, 1) === codes(zilz, 1) && /2\/41:G/.test(codes(pix, 1)), `Spätere normale Änderung von Zilz kommt wieder an (${codes(pix, 1)})`);
  // Und umgekehrt bleibt Last-Write-Wins intakt: Pix ändert danach → gewinnt
  tick(60000); setzeErgebnis(pix, 1, 'in_ordnung', 'Pix');
  await sync(pix, zilz);
  check(ergebnis(zilz, 1) === 'in_ordnung', 'Normale Ops danach folgen wieder der Reihenfolge (Pix’ spätere Entscheidung gilt)');
}

console.log('\n══ Ganzer Termin, Datei-Notausgang, Rechner ohne Protokoll ══');
{
  tick(60000);
  kwUpsert(zilz, 2, 1, 10, 'F'); tick(); setzeErgebnis(zilz, 2, 'persoenliche_vorlage_rp', 'Zilz'); tick();
  kwUpsert(zilz, 3, 3, 5, 'A,B'); tick();
  await sync(zilz, pix);
  // Dritter Rechner, der Zilz’ Protokoll nie bekommt (Lesestand am Ende)
  const dritte = await makeClient(SQL, store, 'Dritte', new Uint8Array(seedBytes), { quiet: true, clientId: 'dritte', skipBootstrap: true });
  dritte._appliedForeignUids = new Set(); dritte._ownLogUids = new Set(); dritte._logOffsets = {}; dritte._myLogSize = 0; dritte._v3Ready = true;
  for (const [name, f] of store.files) if (name.startsWith(dritte._oplogPrefix()) && name.endsWith('.jsonl')) dritte._logOffsets[name] = f.data.length; // alles bisherige „überlesen“
  for (const s of [1, 2, 3]) keInsert(dritte, s);
  await sync(dritte);
  check(codes(dritte, 2) === '' && codes(dritte, 3) === '', 'Dritte hat nichts von Zilz');
  tick(60000);
  const r = zilz.standAusschreiben({ terminId: 77 });
  check(r.azubis === 3 && r.zeilen >= 3 + 3 + 1 + 1 + 1 + 1, `Ganzer Termin: ${r.azubis} Azubis, ${r.zeilen} Zeilen`);
  check(r.text.split('\n').filter(Boolean).length === r.ops, 'Datei enthält genau diese Ops');
  // Datei bei Dritte einspielen (ohne Protokoll)
  const e = dritte.importOpPufferText(r.text);
  check(e.uebernommen === r.ops && e.angewendet >= r.zeilen, `Datei eingespielt: ${e.uebernommen} übernommen, ${e.angewendet} angewendet`);
  check(stand(dritte, 1) === stand(zilz, 1) && stand(dritte, 2) === stand(zilz, 2) && codes(dritte, 3) === codes(zilz, 3), 'Dritte hat Zilz’ Stand für alle drei Azubis');
  // Zilz’ Protokoll (dieselben uids) später doch gelesen → nichts doppelt
  await sync(zilz, pix, dritte);
  check(dritte.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=1') === 1 && stand(pix, 2) === stand(zilz, 2), 'Nach dem Protokoll keine Doppel, Pix gleich');
  // Nichts auszuschreiben
  const leer = zilz.standAusschreiben({ terminId: 999 });
  check(leer.azubis === 0 && leer.ops === 0 && leer.text === '', 'Unbekannter Termin: nichts auszuschreiben');
  check(!zilz._opZwang && !pix._opZwang, 'Zwang-Schalter nach dem Ausschreiben wieder aus');
}

console.log('\n══ Dialog und Konsolenbefehl laufen wirklich durch (kein Absturz vor dem Schreiben) ══');
{
  // konsole.js in Zilz’ Sandkasten laden – der Dialog greift auf echte Spalten zu
  // (Feldfall: „no such column: datum“ warf VOR der Rückfrage, nichts wurde geschrieben)
  const vm = await import('node:vm');
  const KSRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/konsole.js'), 'utf8');
  vm.runInContext(KSRC + '\n;globalThis.__Konsole = Konsole;', zilz._sandbox, { filename: 'konsole.js' });
  const K = zilz._sandbox.__Konsole;
  const fragen = [];
  zilz._sandbox.confirm = (text) => { fragen.push(text); return fragen.length === 1; }; // 1. Rückfrage ja, Datei nein
  tick(60000); setzeErgebnis(zilz, 3, 'in_ordnung', 'Zilz'); await sync(zilz, pix);
  tick(60000); setzeErgebnis(pix, 3, 'post_an_rp', 'Pix'); await sync(pix, zilz); // beide: post_an_rp
  // Pix' Stempel künstlich in die Zukunft, Zilz setzt lokal zurück → Divergenz
  tick(60000); setzeErgebnis(zilz, 3, 'in_ordnung', 'Zilz');
  pix._rowStamps.set('kontrollergebnisse|kontrolltermin_id:77|schueler_id:3', { ergebnis: { ts: T + 5 * 86400000, c: 'pix', seq: 9 }, bemerkung: { ts: T + 5 * 86400000, c: 'pix', seq: 9 }, geaendert_von: { ts: T + 5 * 86400000, c: 'pix', seq: 9 } });
  await sync(zilz, pix);
  check(ergebnis(zilz, 3) === 'in_ordnung' && ergebnis(pix, 3) === 'post_an_rp', 'Ausgangslage: Rechner zeigen verschiedene Ergebnisse');
  fragen.length = 0;
  const r = await K.ausschreibenDialog(77, 3);
  check(r && r.ops > 0 && fragen.length === 2 && /Zilz|Azubi|Durchsicht von/.test(fragen[0]) && /Termin 01\.07\.2026|Termin 2026-07-01/.test(fragen[0]), `Dialog je Azubi: Rückfrage mit Termin, dann Datei-Frage, ${r ? r.ops : '?'} Ops (${(fragen[0] || '').slice(0, 60)}…)`);
  await sync(zilz, pix);
  check(ergebnis(pix, 3) === 'in_ordnung', 'Nach dem Dialog hat Pix Zilz’ Ergebnis');
  fragen.length = 0;
  const r2 = await K.ausschreibenDialog(77);
  check(r2 && r2.azubis === 3 && fragen.length === 2 && /alle Durchsichten des Termins/.test(fragen[0]), `Dialog ganzer Termin: ${r2 ? r2.azubis : '?'} Azubis`);
  zilz._sandbox.confirm = () => false;
  const r3 = await K.ausschreibenDialog(77, 3);
  check(r3 === null, 'Abbrechen schreibt nichts');
  const r4 = K.ausschreiben(77, 3);
  check(r4 && r4.ops > 0 && r4.azubis === 1, 'bhk.ausschreiben(termin, azubi) läuft');
  check(K.ausschreiben() === null, 'bhk.ausschreiben() ohne Kennung erklärt den Aufruf');
  const pr = await pix.azubiPruefen(3);
  check(pr.zwangOps > 0 && typeof pr.ordner === 'string', 'bhk.pruefen sieht die Zwang-Ops');
}

console.log('\n══ Verdrahtung ══');
{
  const K = fs.readFileSync(path.join(ROOT, 'src/js/modules/konsole.js'), 'utf8');
  const KO = fs.readFileSync(path.join(ROOT, 'src/js/modules/kontrolle.js'), 'utf8');
  const V = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');
  check(/bhk\.ausschreiben\(terminId, azubiId\?\)/.test(K) && /ausschreiben\(terminId, schuelerId\)/.test(K) && /async ausschreibenDialog\(terminId, schuelerId\)/.test(K) && /verworfenGesamt/.test(K), 'Konsole: bhk.ausschreiben, Dialog, verworfene Ops in bhk.pruefen');
  check(/Konsole\.ausschreibenDialog\(\$\{this\.currentTerminId\},\$\{s\.id\}\)/.test(KO) && /Konsole\.ausschreibenDialog\(\$\{terminId\}\)/.test(KO), 'Durchsicht: Einzelansicht (⋯) je Azubi und Übersicht („Weitere Aktionen“) für den ganzen Termin');
  check(/Stand dieses Rechners für alle übernehmen/.test(V) && /verworfen/.test(V), 'Wartung → Verbindung und Hilfe erklären den Weg');
  const A = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
  check(/if \(op\.zwang\) return false;/.test(A) && /o\.zwang \? \{ zwang: 1 \} : \{\}/.test(A) && /_notiereStamp\(op\.sql, op\.params, op\.ts, op\.c, op\.seq, op\.zwang\)/.test(A), 'Zwang: LWW nie, Stempel übernehmen, in Protokoll, Datei und Absturzpuffer');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
