// ═══════════════════════════════════════════════════════════════════
//  Ergebnis-Verlust (Feldfall „Kollege sieht mein Ergebnis nicht, nach dem
//  Neuladen ist es auch bei mir weg“): kontrollergebnisse.geaendert_am hat
//  DEFAULT datetime('now','localtime'). Fehlte die Spalte im INSERT (Termin
//  öffnen), füllte SQLite sie auf jedem Rechner mit dessen Uhr zum Zeitpunkt
//  des Ausführens – beim Kollegen später, beim Neuladen mit der Uhrzeit des
//  Neuladens. Die Rückfallregel von Last-Write-Wins ohne Stempel verglich
//  diese Spalte mit dem eingefrorenen Zeitpunkt einer späteren Änderung und
//  verwarf sie. Jetzt werden Zeit-Vorgaben in INSERTs eingefroren – beim
//  Schreiben (Serverzeit) und beim Nachspielen alter Protokollzeilen (Zeit
//  der Op). Ausführen:  node tests/ergebnis-verlust-test.mjs
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeStore, getSQL, makeSeed, makeClient, makeChecker, ROOT } from './_sync-harness.mjs';

const { check, state } = makeChecker();
const SQL = await getSQL();
const seedBytes = makeSeed(SQL, "UPDATE schueler SET ausbildungsbeginn='2024-09-01', ausbildungsende='2027-08-31'");
// Virtuelle Uhr in der VERGANGENHEIT gegenüber der echten SQLite-Uhr (datetime('now')):
// so fällt jede nicht eingefrorene Zeit-Vorgabe sofort auf
let T = Date.parse('2026-09-24T09:00:00');
const store = makeStore(); store.now = () => T;
const tick = (ms = 1000) => { T += ms; };
store.files.set('test.sqlite', { data: new Uint8Array(seedBytes), mtime: T });
const mk = (name, id) => makeClient(SQL, store, name, new Uint8Array(store.files.get('test.sqlite').data), { quiet: true, clientId: id });
const sync = async (...cs) => { for (const c of cs) { tick(); await c.mergeAndSave(true); } for (let i = 0; i < 2; i++) for (const c of cs) { tick(); await c._pollOplogs(); } };

const KE_INSERT = `INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,fehltage_gesamt,fehltage_pauschal,durchsicht_nr,
          p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,
          f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
const oeffneTermin = (c) => { for (const sid of [1, 2, 3]) c.run(KE_INSERT, [77, sid, '{}', 0, 0, 1, '', '', '', 0, '', '']); };
const keId = (c, sid) => c.scalar('SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=?', [sid]);
const ke = (c, sid) => c.query('SELECT ergebnis, geaendert_von, bemerkung, geaendert_am, erstellt_am FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=?', [sid])[0] || {};
const ergebnisSetzen = (c, sid, wert, wer) => c.run("UPDATE kontrollergebnisse SET ergebnis=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?", [wert, wer, keId(c, sid)]);

console.log('══ Einfrieren der Zeit-Vorgaben (Einheit) ══');
{
  const a = await mk('Probe', 'probe');
  const z = '2026-09-24 09:00:00';
  const s1 = a._zeitDefaultsEinfrieren('INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id) VALUES (?,?)', z);
  check(s1 === `INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,erstellt_am,geaendert_am) VALUES (?,?,'${z}','${z}')`, `INSERT ohne Zeitspalten bekommt beide fest (${s1})`);
  const s2 = a._zeitDefaultsEinfrieren("INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum, status) VALUES ((SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?),?,'nachholung_naechste_durchsicht',?,'offen')", z);
  check(/frist_datum, status,erstellt_am,geaendert_am\) VALUES \(\(SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=\? AND schueler_id=\?\),\?,'nachholung_naechste_durchsicht',\?,'offen','2026-09-24 09:00:00','2026-09-24 09:00:00'\)$/.test(s2), 'Subselect im VALUES (Klammertiefe) und Literale bleiben, Zeit hinten angefügt');
  const s3 = a._zeitDefaultsEinfrieren("INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,geprueft,erstellt_bei) VALUES (?,?,?,1,?) ON CONFLICT(schueler_id,ausbildungsjahr,kalenderwoche) DO UPDATE SET geprueft=1", z);
  check(s3.indexOf("'2026") < 0 && /ON CONFLICT/.test(s3), 'Tabellen ohne Zeit-Vorgaben bleiben unverändert (kw_status)');
  const s4 = a._zeitDefaultsEinfrieren("INSERT INTO durchsicht_snapshots (kontrollergebnis_id, schueler_id, snapshot_datum, kw_daten_json, geprueft_kws_json, pflichtteile_json, ergebnis, bemerkung, pruefer) VALUES (?,?,?,?,?,?,?,?,?)", z);
  check(/pruefer,erstellt_am\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,'2026-09-24 09:00:00'\)$/.test(s4), 'durchsicht_snapshots: erstellt_am fest');
  const s5 = a._zeitDefaultsEinfrieren("INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geaendert_am,erstellt_am) VALUES (?,?,?,?)", z);
  check(s5 === "INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geaendert_am,erstellt_am) VALUES (?,?,?,?)", 'Bereits vorhandene Zeitspalten: nichts anfassen');
  const s6 = a._zeitDefaultsEinfrieren("INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id) VALUES (?,?),(?,?)", z);
  check(s6.indexOf("'2026") < 0, 'Mehrzeiliges VALUES bleibt unverändert');
  const s7 = a._zeitDefaultsEinfrieren("INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id) SELECT 1,2", z);
  check(s7.indexOf("'2026") < 0, 'INSERT … SELECT bleibt unverändert');
  check(a._lokalZeit(Date.parse('2026-09-24T09:05:07')) === '2026-09-24 09:05:07' && a._frozenNow().local === a._zeitText(new Date(a._serverJetzt())), 'Zeitformat wie datetime(\'now\',\'localtime\')');
  // Über App.run: lokal UND Replay-Op tragen dieselbe eingefrorene Zeit
  a.run(KE_INSERT, [77, 1, '{}', 0, 0, 1, '', '', '', 0, '', '']);
  const rec = a._dirtyOps[a._dirtyOps.length - 1];
  const zeile = ke(a, 1);
  check(/geaendert_am\)/.test(rec.sql) && zeile.geaendert_am === a._lokalZeit(T) && zeile.erstellt_am === zeile.geaendert_am, `App.run: Zeile trägt die Serverzeit (${zeile.geaendert_am}), Replay-Op auch`);
}

console.log('\n══ Feldfall: beide öffnen den Termin, Zilz schließt ab, Pix liest, beide laden neu ══');
{
  let zilz = await mk('Zilz', 'zilz');
  let pix = await mk('Pix', 'pix');
  oeffneTermin(pix); tick(); oeffneTermin(zilz); await sync(pix, zilz);
  check(keId(pix, 1) !== keId(zilz, 1), 'Kontrollergebnis-Kennungen sind je Rechner verschieden (fachlicher Schlüssel entscheidet)');
  // Jeder behält seine zuerst angelegte Zeile (INSERT OR IGNORE) – beide Anlagezeiten sind
  // eingefrorene Serverzeit (virtuelle Uhr 24.9.), nicht die echte SQLite-Uhr des Rechners
  check(ke(pix, 1).geaendert_am.startsWith('2026-09-24 09:00') && ke(zilz, 1).geaendert_am.startsWith('2026-09-24 09:00'), `Anlagezeit beider Zeilen = eingefrorene Serverzeit (${ke(pix, 1).geaendert_am} / ${ke(zilz, 1).geaendert_am})`);
  tick(60000);
  ergebnisSetzen(zilz, 1, 'post_an_rp', 'Zilz'); tick();
  zilz.run('UPDATE kontrollergebnisse SET bemerkung=? WHERE id=?', ['Heft per Post', keId(zilz, 1)]); tick();
  zilz.run('INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum) VALUES (?,?,?,?)', [keId(zilz, 1), 1, 'post', '2026-10-15']); tick();
  zilz.run("UPDATE kontrolltermine SET status='durchgefuehrt', durchgefuehrt_datum=? WHERE id=?", ['2026-09-24', 77]); tick();
  await sync(zilz, pix);
  check(ke(pix, 1).ergebnis === 'post_an_rp' && ke(pix, 1).geaendert_von === 'Zilz' && ke(pix, 1).bemerkung === 'Heft per Post', `Pix hat Zilz’ Ergebnis (${ke(pix, 1).ergebnis}/${ke(pix, 1).geaendert_von})`);
  check(pix.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id=?', [keId(pix, 1)]) === 1, 'Wiedervorlage hängt an Pix’ eigener Kontrollergebnis-Zeile');
  const wvPix = pix.query('SELECT geaendert_am FROM wiedervorlagen WHERE schueler_id=1')[0], wvZilz = zilz.query('SELECT geaendert_am FROM wiedervorlagen WHERE schueler_id=1')[0];
  check(wvPix && wvZilz && wvPix.geaendert_am === wvZilz.geaendert_am, 'Wiedervorlage: Anlagezeit auf beiden Rechnern gleich (eingefroren)');
  // Neuladen beider Rechner: Snapshot (ohne die Zeilen) + Protokolle
  tick(3600000);
  zilz = await mk('Zilz', 'zilz'); pix = await mk('Pix', 'pix');
  check(ke(zilz, 1).ergebnis === 'post_an_rp' && ke(pix, 1).ergebnis === 'post_an_rp', `Nach dem Neuladen bei beiden noch da (Zilz ${ke(zilz, 1).ergebnis}, Pix ${ke(pix, 1).ergebnis})`);
  check(pix.scalar("SELECT status FROM kontrolltermine WHERE id=77") === 'durchgefuehrt', 'Terminstatus bei Pix');
  // Pix kompaktiert, beide laden neu
  tick(3600000); const r = await pix._compact('test');
  check(r === true, 'Kompaktierung durch Pix');
  tick(60000);
  zilz = await mk('Zilz', 'zilz'); pix = await mk('Pix', 'pix');
  check(ke(zilz, 1).ergebnis === 'post_an_rp' && ke(pix, 1).ergebnis === 'post_an_rp' && ke(zilz, 1).bemerkung === 'Heft per Post', 'Nach Kompaktierung und Neuladen bei beiden da');
  // Danach normale Reihenfolge: Pix’ spätere Entscheidung gewinnt
  tick(60000); ergebnisSetzen(pix, 1, 'in_ordnung', 'Pix'); await sync(pix, zilz);
  check(ke(zilz, 1).ergebnis === 'in_ordnung' && ke(pix, 1).ergebnis === 'in_ordnung', 'Spätere Änderung gewinnt weiterhin auf beiden Rechnern');
}

console.log('\n══ Alte Protokollzeilen (ohne feste Zeit) werden beim Nachspielen mit der Op-Zeit ergänzt ══');
{
  // Ein Protokoll aus einem älteren Programmstand: INSERT ohne Zeitspalten, danach ein UPDATE
  const t0 = Date.parse('2026-09-20T10:00:00');
  // Termin 78: Zeile existiert auf keinem Rechner, sie entsteht NUR aus dem alten Protokoll
  const alt = [
    { uid: 'alt-1', ts: t0, seq: 1, c: 'altpc', u: 'Alt', sql: 'INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,durchsicht_nr) VALUES (?,?,?,?)', params: [78, 2, '{}', 1] },
    { uid: 'alt-2', ts: t0 + 60000, seq: 2, c: 'altpc', u: 'Alt', sql: "UPDATE kontrollergebnisse SET ergebnis=?, geaendert_am='2026-09-20 10:01:00', geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?", params: ['persoenliche_vorlage_rp', 'Alt', 78, 2] },
  ].map(o => JSON.stringify(o)).join('\n') + '\n';
  store.files.set('oplog_test_altpc_g0.jsonl', { data: new TextEncoder().encode(alt), mtime: t0 });
  // snapmeta kennt das Protokoll nicht → wird ab 0 gelesen
  const meta = JSON.parse(new TextDecoder().decode(store.files.get('snapmeta_test.json').data));
  delete meta.offsets['oplog_test_altpc_g0.jsonl'];
  store.files.set('snapmeta_test.json', { data: new TextEncoder().encode(JSON.stringify(meta)), mtime: T });
  tick(60000);
  const neu = await mk('Neu', 'neu');
  const z = neu.query('SELECT ergebnis, geaendert_am, erstellt_am FROM kontrollergebnisse WHERE kontrolltermin_id=78 AND schueler_id=2')[0] || {};
  check(z.ergebnis === 'persoenliche_vorlage_rp' && z.geaendert_am === '2026-09-20 10:01:00', `Altes INSERT + UPDATE aus dem Protokoll: Ergebnis da (${z.ergebnis}, ${z.geaendert_am})`);
  check(z.erstellt_am === neu._lokalZeit(t0), `Anlagezeit = Zeit der alten Op, nicht die Uhr des Neuladens (${z.erstellt_am})`);
  // Wiederherstellung aus dem Absturzpuffer geht denselben Weg
  const c2 = await mk('Crash', 'crash');
  c2.run('DELETE FROM kontrollergebnisse WHERE kontrolltermin_id=77 AND schueler_id=3'); c2._dirtyOps.length = 0;
  const n = c2._applyRestoredOps([
    { uid: 'r-1', ts: t0, seq: 1, sql: 'INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,durchsicht_nr) VALUES (?,?,?,?)', params: [77, 3, '{}', 1] },
    { uid: 'r-2', ts: t0 + 1000, seq: 2, sql: "UPDATE kontrollergebnisse SET ergebnis=?, geaendert_am='2026-09-20 10:00:01', geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?", params: ['post_an_rp', 'Crash', 77, 3] },
  ]);
  check(n === 2 && ke(c2, 3).ergebnis === 'post_an_rp' && ke(c2, 3).erstellt_am === c2._lokalZeit(t0), 'Absturzpuffer: INSERT mit Op-Zeit, UPDATE danach angewendet');
}

console.log('\n══ Stempel werden verdrängt, nie komplett verworfen ══');
{
  const a = await mk('Stempel', 'stempel');
  a._rowStamps = new Map();
  for (let i = 0; i < a.STAMPS_MAX * 2 + 5; i++) a._rowStamps.set('kw_status|schueler_id:1|ausbildungsjahr:1|kalenderwoche:' + i, { maengel_codes: { ts: 1000 + i, c: 'x', seq: i } });
  const alt = a._rowStamps.size;
  a._notiereStamp("UPDATE kontrollergebnisse SET ergebnis=? WHERE kontrolltermin_id=? AND schueler_id=?", ['x', 77, 1], 9e12, 'stempel', 1);
  check(alt === a.STAMPS_MAX * 2 + 5 && a._rowStamps.size === a.STAMPS_MAX + 1 && a._rowStamps.has('kontrollergebnisse|kontrolltermin_id:77|schueler_id:1') && !a._rowStamps.has('kw_status|schueler_id:1|ausbildungsjahr:1|kalenderwoche:0') && a._rowStamps.has('kw_status|schueler_id:1|ausbildungsjahr:1|kalenderwoche:' + (a.STAMPS_MAX * 2 + 4)), `Über der Obergrenze: älteste Stempel verdrängt, jüngste bleiben (${alt} → ${a._rowStamps.size})`);
}

console.log('\n══ Verdrahtung ══');
{
  const A = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
  check((A.match(/_zeitDefaultsEinfrieren\(/g) || []).length >= 6, 'Einfrieren in _prepareOp (lokal + Replay), _applyOps, _applyRestoredOps und Snapshot-Tausch');
  check(/ZEIT_DEFAULTS: \{/.test(A) && /kontrollergebnisse: \['erstellt_am', 'geaendert_am'\]/.test(A), 'Tabellenliste der Zeit-Vorgaben');
}

console.log(`\n═══ Ergebnis: ${state.passed} OK, ${state.failed} Fehler ═══`);
process.exit(state.failed ? 1 : 0);
