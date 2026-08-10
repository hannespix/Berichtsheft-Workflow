// ═══════════════════════════════════════════════════════════════════
//  Berichtszahlen: Abdeckung, Erfolgsquote, Klassenübersicht, Diagramme
//  Ausführen:  node tests/berichte-test.mjs
//
//  Kernregel: Kontroll-Kennzahlen zählen Azubi-KÖPFE über den AKTIVEN
//  Bestand. Zeilenzählung über Kontrollergebnisse ergibt bei mehreren
//  Durchsichten Quoten über 100 %; inaktive Azubis im Zähler lassen die
//  Abdeckung nach jedem Jahrgangsabschluss steigen.
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
const BER_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/berichte.js'), 'utf8');
const VIEWS_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/views.js'), 'utf8');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
const q = (sql, p = []) => { const st = db.prepare(sql); st.bind(p); const r = []; while (st.step()) r.push(st.getAsObject()); st.free(); return r; };
const scalar = (sql, p = []) => { const r = q(sql, p); return r.length ? Object.values(r[0])[0] : null; };

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// ── Testbestand: 10 Azubis, teils mehrfach kontrolliert ──
db.run(`INSERT INTO klassen (id,klassenbezeichnung) VALUES (1,'GaLa 1')`);
for (let i = 1; i <= 10; i++) {
  db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,klasse_id) VALUES (?,?,?,1,1)`, [i, 'Azubi' + i, 'V']);
}
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (1,'2026-01-15','durchgefuehrt'),(2,'2026-05-15','durchgefuehrt')`);
// Azubis 1-4: je zwei OK-Kontrollen (Doppelzählungs-Falle)
for (const sid of [1, 2, 3, 4]) {
  db.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis) VALUES (1,?,'in_ordnung'),(2,?,'in_ordnung')`, [sid, sid]);
}
// Azubi 5+6: erst Mangel, dann OK  → dürfen NICHT doppelt zählen
for (const sid of [5, 6]) {
  db.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis) VALUES (1,?,'post_an_rp'),(2,?,'in_ordnung')`, [sid, sid]);
}
// Azubi 7: nur Mangel; 8-10: nie kontrolliert
db.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis) VALUES (1,7,'post_an_rp')`);

// Die geprüften Abfragen 1:1 aus dem Quelltext ziehen, damit der Test
// nicht an einer Kopie vorbeiprüft.
const nimm = (src, marke, muster) => {
  const idx = src.indexOf(marke);
  if (idx < 0) throw new Error('Marke nicht gefunden: ' + marke);
  const m = src.slice(idx).match(muster);
  if (!m) throw new Error('Muster nicht gefunden bei ' + marke);
  return m[1].replace(/\s+/g, ' ').trim();
};

console.log('══ Jahresbericht: Abdeckung und Quoten ══');
{
  const kontrolliertSql = nimm(BER_SRC, 'const kontrolliert = App.scalar(', /App\.scalar\(`([\s\S]*?)`\)/);
  const okSql = nimm(BER_SRC, 'const okCount = App.scalar(', /App\.scalar\(`([\s\S]*?)`\)/);
  const mangelSql = nimm(BER_SRC, 'const mangelCount = App.scalar(', /App\.scalar\(`([\s\S]*?)`\)/);

  const rechne = () => {
    const aktiv = scalar('SELECT COUNT(*) FROM schueler WHERE aktiv=1');
    const kontrolliert = scalar(kontrolliertSql);
    const ok = scalar(okSql), mangel = scalar(mangelSql);
    return { aktiv, kontrolliert, offen: Math.max(0, aktiv - kontrolliert),
      abdeckung: aktiv ? Math.round(kontrolliert / aktiv * 100) : 0,
      ok, mangel, quote: kontrolliert ? Math.round(ok / kontrolliert * 100) : 0 };
  };

  const a = rechne();
  check(a.kontrolliert === 7, `7 von 10 Azubis kontrolliert (${a.kontrolliert}) – Mehrfachkontrollen zählen einmal`);
  check(a.abdeckung <= 100, `Abdeckung plausibel: ${a.abdeckung} %`);
  check(a.quote <= 100, `Erfolgsquote plausibel: ${a.quote} %`);
  check(a.ok + a.mangel === a.kontrolliert, `OK (${a.ok}) + Mängel (${a.mangel}) = kontrolliert (${a.kontrolliert}), keine Doppelzählung`);
  check(a.ok === 4 && a.mangel === 3, `Azubis mit späterer OK-Kontrolle bleiben in der Mängel-Spalte (${a.ok}/${a.mangel})`);

  // Jahrgang archivieren: die Zahlen dürfen NICHT springen
  db.run('UPDATE schueler SET aktiv=0 WHERE id IN (1,2,3)');
  const b = rechne();
  check(b.abdeckung <= 100, `Nach Archivierung weiterhin plausibel: ${b.abdeckung} %`);
  check(b.offen >= 0, `"Noch offen" bleibt nicht-negativ (${b.offen})`);
  check(b.kontrolliert === 4, `Archivierte zählen nicht mehr als kontrolliert (${b.kontrolliert})`);
  db.run('UPDATE schueler SET aktiv=1 WHERE id IN (1,2,3)');
}

console.log('\n══ Klassenübersicht: eine Zeile pro Azubi ══');
{
  const sql = nimm(BER_SRC, 'const schueler = App.query(`SELECT s.*,', /App\.query\(`([\s\S]*?)`, \[klasseId\]\)/);
  const zeilen = q(sql, [1]);
  check(zeilen.length === 10, `10 Zeilen für 10 Azubis (${zeilen.length}) – trotz Mehrfachkontrollen`);
  const ids = new Set(zeilen.map(r => r.id));
  check(ids.size === zeilen.length, 'Keine doppelten Azubis in der Liste');
  const a1 = zeilen.find(r => r.id === 5);
  check(a1 && a1.ergebnis === 'in_ordnung', 'Es wird das JÜNGSTE Ergebnis übernommen');
  db.run('UPDATE schueler SET aktiv=0 WHERE id=10');
  check(q(sql, [1]).length === 9, 'Inaktive Azubis erscheinen nicht in der Klassenübersicht');
  db.run('UPDATE schueler SET aktiv=1 WHERE id=10');
}

console.log('\n══ Dashboard-Diagramm: Anteile summieren sich sauber ══');
{
  const okSql = nimm(VIEWS_SRC, "const okCnt = App.scalar('SELECT COUNT(DISTINCT s.id)", /App\.scalar\('([\s\S]*?)' \+ _ak/);
  const issueSql = nimm(VIEWS_SRC, "const issueCnt = App.scalar('SELECT COUNT(DISTINCT s.id)", /App\.scalar\('([\s\S]*?)' \+ _ak/);
  const total = scalar('SELECT COUNT(*) FROM schueler WHERE aktiv=1');
  const ok = scalar(okSql + ' s.aktiv=1');
  const issue = scalar(issueSql + ' s.aktiv=1');
  const offen = total - ok - issue;
  check(offen >= 0, `"Offen" ist nicht negativ (${total} − ${ok} − ${issue} = ${offen})`);
  check(ok + issue <= total, 'Summe der Segmente überschreitet den Gesamtbestand nicht');
  check(issue === 3, `Azubis mit Mangel zählen als Mangel, auch mit späterer OK-Kontrolle (${issue})`);
}

console.log('\n══ Mängelcodes: Fehltage (H) zählen nicht als Mangel ══');
{
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes) VALUES
    (1,1,10,'A,H'),(1,1,11,'H'),(2,1,12,'B')`);
  const rows = q(nimm(BER_SRC, 'const topCodes = App.query(', /App\.query\(`([\s\S]*?)`\)/));
  const codeCount = {};
  rows.forEach(r => r.maengel_codes.split(',').filter(Boolean).forEach(c => { if (c !== 'H') codeCount[c] = (codeCount[c] || 0) + 1; }));
  check(!codeCount['H'], 'H taucht nicht in der Mängelcode-Statistik auf');
  check(codeCount['A'] === 1 && codeCount['B'] === 1, `A und B werden gezählt (${JSON.stringify(codeCount)})`);
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
