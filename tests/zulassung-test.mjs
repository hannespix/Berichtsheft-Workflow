// ═══════════════════════════════════════════════════════════════════
//  Logik-Audit Pakete 1–3: Zulassung nach § 43 Abs. 1 Nr. 2 BBiG
//  (zulassungsrelevante Codes, 1.4 als Hinweis, Befund mit Gründen,
//  Übersteuerung mit Meldung und Begründung, PA + Zulassung kombinierbar,
//  vorzeitige Zulassung), Fehlzeiten (ohne Urlaub, bisher vs. gesamt,
//  Schwelle als Einstellung, Teilzeit-Deckel § 7a), Zusatzvereinbarung
//  (1.2) als Schalter für Wetter/Sachberichte, Migration, Vorlagen, Hilfe
//  Ausführen:  node tests/zulassung-test.mjs
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
const SQL = await initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) });
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP_SRC = read('src/js/app-core.js');
const K_SRC = read('src/js/modules/kontrolle.js');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);

const el = () => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, appendChild() {}, remove() {}, focus() {} });
const sandbox = {
  console, setTimeout: (f) => { if (typeof f === 'function') f(); }, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Promise, Set, Map, TextEncoder, TextDecoder, Uint8Array, confirm: () => true, prompt: () => 'Grund',
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el,
    addEventListener() {}, hidden: false, activeElement: null, body: { classList: { add() {}, remove() {}, contains: () => false } } },
  navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  initSqlJs: async () => SQL, TableSort: { init() {}, initAll() {} },
  UndoManager: { _stack: [], push(desc, undo, redo) { this._stack.push({ desc, undo, redo }); }, clear() { this._stack = []; } },
  esc: (s) => String(s ?? ''), todayStr: () => '2026-03-10', formatDate: (d) => String(d || ''),
  addDaysStr: (n) => { const d = new Date('2026-03-10T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
for (const [f, name] of [['src/js/modules/phasen.js', 'Phasen'], ['src/js/modules/kontrolle.js', 'KontrolleHandler'], ['src/js/modules/kw-nav.js', 'KWNav']]) {
  vm.runInContext(read(f) + `\n;globalThis.${name} = ${name};`, sandbox, { filename: path.basename(f) });
}
const { __App: App, KontrolleHandler: KH, Phasen } = sandbox;
App.db = db;
App.toast = () => {}; App.markDirty = () => {}; App.scheduleAutoSave = () => {};
KH.renderSchueler = () => {}; KH.renderUebersicht = () => {}; KH.startLiveSync = () => {}; KH.saveAndRelease = () => {};

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

// ── Testdaten: Azubi 1 im letzten Jahr (Beginn 2024, heute 24.09.2026 → AJ 3), Azubi 2 im 2. Jahr, Azubi 3 vorzeitig ──
db.run(`INSERT INTO fachrichtungen (id,code,bezeichnung,typ) VALUES (1,'031','Zierpflanzenbau','Produktion')`);
db.run(`INSERT INTO schueler (id,nachname,vorname,aktiv,ausbildungsbeginn,ausbildungsende,fachrichtung_id,vorzeitige_zulassung) VALUES
  (1,'Erst','Anna',1,'2024-09-01','2027-08-31',1,0),
  (2,'Zweit','Bernd',1,'2025-09-01','2028-08-31',1,0),
  (3,'Dritt','Clara',1,'2025-09-01','2028-08-31',1,1)`);
db.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (10,'2026-03-10','geplant')`);
db.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,geprueft_kws,ergebnis,p_1_1_ausbildungsplan,p_1_5_bescheinigungen,bescheinigungen_anzahl) VALUES
  (100,10,1,'{}','in_ordnung','ja','ja',2), (200,10,2,'{}','in_ordnung','ja','ja',2), (300,10,3,'{}','in_ordnung','ja','ja',2)`);
KH.currentTerminId = 10;
KH.currentSchuelerList = App.query('SELECT * FROM schueler ORDER BY id');
KH.activePruefer = 'Anna Berater';
KH.currentIndex = 0;
const s1 = KH.currentSchuelerList[0], s2 = KH.currentSchuelerList[1], s3 = KH.currentSchuelerList[2];
const ke = (id) => App.query('SELECT * FROM kontrollergebnisse WHERE id=?', [id])[0];

console.log('══ Zulassungsrelevante Codes (A B C E F G), D nur mit Zusatzvereinbarung, I Hinweis ══');
{
  check(App.ZULASSUNG_CODES.join('') === 'ABCEFG', `ZULASSUNG_CODES = ${App.ZULASSUNG_CODES.join(' ')}`);
  check(!App.zulassungsCodes({ f_1_2_vertragliche_regelungen: '' }).includes('D'), 'Ohne Zusatzvereinbarung zählt D (Wetter) nicht');
  check(App.zulassungsCodes({ f_1_2_vertragliche_regelungen: 'ja' }).includes('D'), 'Mit Zusatzvereinbarung (1.2 = ja) zählt D');
  check(App.istZulassungsMangel('D,H', {}) === false && App.istZulassungsMangel('I', {}) === false && App.istZulassungsMangel('H', {}) === false, 'D, I und H sind ohne Zusatzvereinbarung kein Zulassungsmangel');
  check(App.istZulassungsMangel('A,H', {}) === true && App.istZulassungsMangel('C', {}) === true && App.istZulassungsMangel('D', { f_1_2_vertragliche_regelungen: 'ja' }) === true, 'A, C – und D mit Zusatzvereinbarung – sind Zulassungsmängel');
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (1,1,40,'D',0,1),(1,1,41,'H',2,1),(1,1,42,'I',0,1)`);
  check(App.offeneZulassungsMaengel(1, ke(100)) === 0, 'Wochen mit D, H, I zählen nicht als offene Zulassungsmängel');
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (1,1,43,'B,D',0,1)`);
  check(App.offeneZulassungsMaengel(1, ke(100)) === 1, 'Eine Woche mit B zählt (auch wenn D dabeisteht)');
  App.run("UPDATE kontrollergebnisse SET f_1_2_vertragliche_regelungen='ja' WHERE id=100");
  check(App.offeneZulassungsMaengel(1, ke(100)) === 2, 'Mit Zusatzvereinbarung zählt auch die D-Woche (2)');
  App.run("UPDATE kontrollergebnisse SET f_1_2_vertragliche_regelungen='' WHERE id=100");
  db.run("DELETE FROM kw_status WHERE schueler_id=1 AND kalenderwoche=43");
}

console.log('\n══ Pflichtteile: 1.1 und 1.5 sind Voraussetzung, 1.4 ist Hinweis ══');
{
  const voll = { p_1_1_ausbildungsplan: 'ja', p_1_4_auszubildende: '', p_1_5_bescheinigungen: 'ja', bescheinigungen_anzahl: 2, p_1_1_gefuehrt: '', p_1_5_gefuehrt: '' };
  check(KH.pflichtteileOK(voll, 2) === true, '1.4 leer → trotzdem erfüllt');
  check(KH.pflichtteileOK({ ...voll, p_1_4_auszubildende: 'nein' }, 2) === true, '1.4 = nein → trotzdem erfüllt (Hinweis)');
  check(KH.pflichtteileOK({ ...voll, p_1_1_ausbildungsplan: 'nein' }, 2) === false, '1.1 fehlt → nicht erfüllt');
  check(!/p_1_4_auszubildende === 'ja'/.test(K_SRC.match(/pflichtteileOK\(ke, reqUBA\) \{[\s\S]*?\n  \},/)[0]), 'pflichtteileOK enthält 1.4 nicht mehr');
  check(!KH.PFLICHT_AUTO_JA.includes('f_1_2_vertragliche_regelungen') && KH.PFLICHT_AUTO_JA.includes('p_1_4_auszubildende'), '„In Ordnung“ setzt 1.4/1.6 auf ja, aber NICHT die Zusatzvereinbarung (1.2)');
  check(!/pflichtFields = \[[^\]]*f_1_2_vertragliche_regelungen/.test(K_SRC), '_markOK setzt 1.2 nicht');
  const P = read('src/js/modules/pdf-export.js');
  check(/pflichtItems = \[\s*\['1\.1'[\s\S]*?\['1\.5'/.test(P) && !/pflichtItems = \[[\s\S]*?\['1\.4'[\s\S]*?\];\s*let px/.test(P) && /freiItems = \[[\s\S]*?\['1\.4', 'Der\/die Auszubildende'/.test(P) && /'HINWEIS:'/.test(P), 'PDF: 1.4 steht unter HINWEIS, Pflicht sind 1.1 und 1.5');
  check(/Zusatzvereinbarung Berichtsheftführung/.test(K_SRC) && /Hinweis \(keine Zulassungsvoraussetzung\)/.test(K_SRC), 'Karte: 1.2 heißt Zusatzvereinbarung, Block „Hinweis (keine Zulassungsvoraussetzung)“');
}

console.log('\n══ Befund: Gründe in Klartext, letztes Jahr, vorzeitige Zulassung ══');
{
  const b1 = KH.zulassungsBefund(s1, ke(100));
  check(b1.ok === true && b1.gruende.length === 0, `Azubi 1 (i.O., Pflichtteile, D-Woche): Voraussetzung erfüllt (${b1.gruende.join('; ')})`);
  check(b1.imLetztenAJ === true, 'Azubi 1 ist im letzten Ausbildungsjahr');
  const b2 = KH.zulassungsBefund(s2, ke(200));
  check(b2.ok === true && b2.imLetztenAJ === false, 'Azubi 2 (2. Jahr): erfüllt, aber nicht im letzten Jahr → kein automatischer Vorschlag');
  const b3 = KH.zulassungsBefund(s3, ke(300));
  check(b3.vorzeitig === true && b3.imLetztenAJ === true, 'Azubi 3 mit vorzeitiger Zulassung (§ 45 Abs. 1) gilt als letztes Jahr');
  App.run("UPDATE kontrollergebnisse SET p_1_1_ausbildungsplan='nein', ergebnis='nachholung_naechste_durchsicht' WHERE id=200");
  db.run("INSERT INTO wiedervorlagen (id,schueler_id,kontrollergebnis_id,frist_datum,status,art) VALUES (1,2,200,'2026-04-01','offen','nachholung_naechste_durchsicht')");
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (2,1,40,'A,C',0,1)`);
  const b2b = KH.zulassungsBefund(s2, ke(200));
  check(b2b.ok === false && b2b.gruende.some(g => /Ausbildungsplan \(1\.1\) fehlt/.test(g)) && b2b.gruende.some(g => /1 Woche\(n\) mit Mängeln/.test(g)) && b2b.gruende.some(g => /Wiedervorlage offen/.test(g)) && b2b.gruende.some(g => /nicht „in Ordnung“/.test(g)), `Gründe: ${b2b.gruende.join(' · ')}`);
  check(/§ 43 Abs\. 1 Nr\. 2 BBiG/.test(KH.zulassungsMeldung(b2b)) && KH.zulassungsMeldung(b2b).split('\n').length === 5, 'Meldung nennt § 43 und jeden Grund in einer Zeile');
}

console.log('\n══ Fehlzeiten: ohne Urlaub, bisher vs. gesamt, Schwelle einstellbar ══');
{
  const heute = new Date('2026-03-10T12:00:00');
  const gesamt = App.calcArbeitstage(s1.ausbildungsbeginn, s1.ausbildungsende, 1);
  const bisher = App.calcArbeitstageBisher(1, heute);
  check(bisher > 0 && bisher < gesamt, `Arbeitstage bisher (${bisher}) < gesamt (${gesamt})`);
  // AJ1 komplett (52 Wochen) + AJ2 bis vor KW 11 (28 Wochen) = 80 Wochen × 5 − 17 Feiertage = 383
  check(bisher >= 370 && bisher <= 400, `bis 10.03.2026 ≈ 80 aktive Wochen (${bisher} Arbeitstage)`);
  check(App.calcArbeitstageBisher(1, new Date('2030-01-01T12:00:00')) === gesamt, 'Nach dem Vertragsende = Gesamtdauer');
  db.run(`INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft) VALUES (1,1,45,'H',5,1),(1,1,46,'H',5,1),(1,1,47,'H',5,1),(1,1,48,'H',5,1),(1,1,49,'H',5,1),(1,1,50,'H',5,1),(1,1,51,'H',5,1),(1,2,2,'H',5,1)`);
  const fz = App.fehlzeitenStand(s1, heute);
  check(fz.gesamt === 42 && fz.prozentBisher > fz.prozent, `42 Fehltage: bisher ${fz.prozentBisher.toFixed(1)} % > gesamt ${fz.prozent.toFixed(1)} %`);
  check(fz.schwelle === 10 && fz.warn === true, 'Standard-Schwelle 10 % → Warnung (bezogen auf die bisherige Zeit)');
  App.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('fehlzeiten_prozent','15')");
  const fz2 = App.fehlzeitenStand(s1, heute);
  check(fz2.schwelle === 15 && fz2.warn === false, 'Einstellung fehlzeiten_prozent = 15 → keine Warnung');
  App.run("DELETE FROM einstellungen WHERE schluessel='fehlzeiten_prozent'");
  const b = KH.zulassungsBefund(s1, ke(100), heute);
  check(b.ok === false && b.gruende.some(g => /Fehlzeiten .* der bisherigen Ausbildungszeit/.test(g)), 'Befund nennt die Fehlzeiten als Grund');
  check(/§ 8 Abs\. 2 BBiG/.test(App.TB_FEHLTAGE) && /TB_FEHLTAGE_ALT/.test(APP_SRC) && /tb_fehltage_v2/.test(APP_SRC), 'Textbaustein nennt § 8 Abs. 2 (Verlängerung), alter Wortlaut wird migriert');
  check(/ohne Urlaub und Berufsschule/.test(K_SRC) && /ohne Urlaub\/Berufsschule/.test(read('src/js/modules/kw-nav.js')) && /ohne Urlaub und Berufsschule/.test(read('src/js/modules/nacherfassung.js')), 'Beschriftungen: Fehltage ohne Urlaub und Berufsschule (Karte, Popover, Nacherfassung)');
  check(/H: 'Fehltage'/.test(read('src/js/modules/workflows.js')), 'Anschreiben-Label H = „Fehltage“ (nicht „nicht eingetragen“)');
  check(/setFehlzeitenProzent/.test(read('src/js/modules/views.js')) && /\$\{t\.zulassung\}/.test(read('src/js/modules/views.js')), 'Einstellung „Fehlzeiten-Schwelle“ im Reiter Regeln');
  db.run("DELETE FROM kw_status WHERE schueler_id=1 AND maengel_codes='H'");
}

console.log('\n══ Übersteuerung: trotzdem zulassen mit Meldung und Begründung, PA + Zulassung ══');
{
  sandbox.confirm = () => false;
  await KH.toggleZulassung(2, true);
  check(ke(200).zulassung_ap === 0, 'Rückfrage abgelehnt → keine Zulassung');
  sandbox.confirm = () => true; sandbox.prompt = () => '';
  await KH.toggleZulassung(2, true);
  check(ke(200).zulassung_ap === 0, 'Ohne Begründung → keine Zulassung');
  let meldung = '';
  sandbox.confirm = (t) => { meldung = t; return true; }; sandbox.prompt = () => 'Beschluss des Prüfungsausschusses vom 10.03.2026';
  await KH.toggleZulassung(2, true);
  check(ke(200).zulassung_ap === 1 && ke(200).zulassung_manuell === 0, 'Mit Bestätigung und Begründung → Zulassung gesetzt');
  check(/Nicht alle Zulassungsvoraussetzungen nach § 43 Abs\. 1 Nr\. 2 BBiG/.test(meldung) && /Ausbildungsplan \(1\.1\) fehlt/.test(meldung) && /§ 46 Abs\. 1 BBiG/.test(meldung), 'Meldung nennt die fehlenden Voraussetzungen und § 46');
  check(/\[Zulassung trotz Abweichung\] Beschluss des Prüfungsausschusses/.test(ke(200).bemerkung), 'Begründung steht als eigene Zeile in der Bemerkung');
  await KH.togglePA(2, true);
  check(ke(200).pruefungsausschuss === 1 && ke(200).zulassung_ap === 1, 'PA und Zulassung schließen sich nicht mehr aus');
  check(/\[PA\]/.test(ke(200).bemerkung), 'PA-Begründung ebenfalls in der Bemerkung');
  await KH.toggleZulassung(2, false);
  check(ke(200).zulassung_ap === 0 && ke(200).zulassung_manuell === 1 && ke(200).pruefungsausschuss === 1, 'Abwahl bleibt dauerhaft, PA bleibt stehen');
  // Erfüllter Befund: keine Rückfrage
  let gefragt = false; sandbox.confirm = () => { gefragt = true; return true; };
  await KH.toggleZulassung(1, true);
  check(ke(100).zulassung_ap === 1 && gefragt === false, 'Bei erfülltem Befund keine Rückfrage');
  check(/trotzAbweichung/.test(K_SRC) && /✓!/.test(K_SRC) && /ZULASSUNG_TROTZ_PREFIX/.test(read('src/js/modules/pdf-export.js')), 'Übersicht zeigt ✓! bei Zulassung trotz Abweichung, der Bogen druckt den Vermerk');
  check(!/pruefungsausschuss=0, zulassung_ap=1/.test(K_SRC) && !/zulassung_ap=0, pruefungsausschuss=1/.test(K_SRC), 'Kein gegenseitiges Zurücksetzen mehr');
}

console.log('\n══ Zusatzvereinbarung: Migration, Ergebnis-Hinweis, Vorlagen ══');
{
  const d2 = new SQL.Database();
  d2.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
  d2.run(`INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (1,'2026-01-01','geplant')`);
  d2.run(`INSERT INTO kontrollergebnisse (id,kontrolltermin_id,schueler_id,f_1_2_vertragliche_regelungen) VALUES (1,1,1,'ja'),(2,1,2,'nein'),(3,1,3,'')`);
  check(App._migrateZusatzvereinbarung(d2) === true, 'Migration läuft einmal');
  const st = d2.prepare("SELECT f_1_2_vertragliche_regelungen AS v FROM kontrollergebnisse ORDER BY id"); const v = []; while (st.step()) v.push(st.getAsObject().v); st.free();
  check(v.join('|') === '|nein|', `Automatik-„ja“ geleert, „nein“ bleibt (${v.join('|')})`);
  d2.run("UPDATE kontrollergebnisse SET f_1_2_vertragliche_regelungen='ja' WHERE id=3");
  check(App._migrateZusatzvereinbarung(d2) === false, 'Zweiter Lauf tut nichts (Merker)');
  const st2 = d2.prepare("SELECT f_1_2_vertragliche_regelungen AS v FROM kontrollergebnisse WHERE id=3"); st2.step(); const v3 = st2.getAsObject().v; st2.free();
  check(v3 === 'ja', 'Bewusst gesetztes „ja“ nach der Migration bleibt');
  check(/_migrateZusatzvereinbarung\(diskDb\)/.test(APP_SRC) && /_migrateZusatzvereinbarung\(this\.db\)/.test(APP_SRC), 'Migration läuft auf In-Memory- UND Disk-DB (Parität)');
  // Ergebnis „Sachberichte wegen Wetter“ bleibt möglich, Hinweis ohne Zusatzvereinbarung
  const toasts = []; App.toast = (m) => toasts.push(m);
  KH.currentIndex = 0;
  KH.saveField('ergebnis', 'sachberichte_wetter_email');
  check(ke(100).ergebnis === 'sachberichte_wetter_email' && toasts.some(t => /Zusatzvereinbarung/.test(t)), 'Ergebnis gespeichert, Hinweis auf fehlende Zusatzvereinbarung');
  App.toast = () => {};
  KH.saveField('ergebnis', 'in_ordnung');
  check(ke(100).f_1_2_vertragliche_regelungen === '' && ke(100).p_1_4_auszubildende === 'ja', '„In Ordnung“ lässt 1.2 leer, setzt 1.4 (Hinweis) auf ja');
  const V = App.VORLAGEN;
  check(/Tagesberichte \(Teil 2\.1/.test(V.betrieb_bcc.body) && /Zusatzvereinbarung/.test(V.betrieb_bcc.body) && !/Sachberichte \/ Wochenberichte/.test(V.betrieb_bcc.body), 'Serien-Mail nennt Tagesberichte, Zusatzvereinbarung statt „Sachberichte/Wochenberichte“');
  check(/Tagesberichte/.test(V.betrieb_ankuendigung.body) && /§ 14 Abs\. 2 BBiG/.test(V.betrieb_maengel.body), 'Ankündigung nennt Tagesberichte, Mängelmitteilung § 14 Abs. 2');
  check(/kw-hinweis/.test(read('src/css/styles.css')) && /kw-hinweis/.test(K_SRC) && /kw-hinweis/.test(read('src/js/modules/kw-nav.js')), 'Hinweis-Codes (D ohne Zusatzvereinbarung, I) werden gelb statt rot gezeichnet');
  const H = read('src/js/modules/views.js');
  check(/§ 46 Abs\. 1 BBiG/.test(H) && /§ 14 Abs\. 2 BBiG/.test(H) && /§ 8 Abs\. 2 BBiG/.test(H) && /Trotzdem zulassen/.test(H), 'Hilfe: § 14, § 46, § 8 Abs. 2 und die Übersteuerung sind erklärt');
}

console.log('\n══ Teilzeit-Deckel § 7a Abs. 2 BBiG ══');
{
  const s = { ausbildungsbeginn: '2024-09-01', regulaer_dauer_monate: 36, verkuerzung_monate: 0 };
  check(Phasen.teilzeitDeckelWarnung([{ id: 1, typ: 'ausbildung', von: '2024-09-01', bis: '', teilzeit_prozent: 50 }], s).includes('54 Monate'), '50 % Teilzeit (72 Monate) überschreitet den Deckel von 54 Monaten');
  check(Phasen.teilzeitDeckelWarnung([{ id: 1, typ: 'ausbildung', von: '2024-09-01', bis: '', teilzeit_prozent: 75 }], s) === '', '75 % Teilzeit (48 Monate) liegt unter dem Deckel');
  check(Phasen.teilzeitDeckelWarnung([], s) === '', 'Ohne Phasen keine Warnung');
}

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
