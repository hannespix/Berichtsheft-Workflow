// ═══════════════════════════════════════════════════════════════════
//  Test der Datenqualitäts-Prüfung (BerichteHandler._dqRun)
//  Ausführen:  node tests/dq-test.mjs
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
const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');
const BER_SRC = fs.readFileSync(path.join(ROOT, 'src/js/modules/berichte.js'), 'utf8');

const db = new SQL.Database();
db.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
db.run("INSERT INTO betriebe (id,name,ort,telefon,email,betriebsnummer) VALUES (1,'Gärtnerei Gut','Radolfzell','07732-1','g@g.de','B-1'), (2,'Ohne Kontakt','','','','')");
db.run("INSERT INTO berufsschulen (id,name,ort,email) VALUES (1,'BS Radolfzell','Radolfzell',''), (2,'BS Konstanz','Konstanz','bs@ks.de')");
db.run("INSERT INTO klassen (id,berufsschule_id,klassenbezeichnung,lehrjahr) VALUES (1,1,'GaLa 1',NULL), (2,2,'GaLa 2',2)");
db.run("INSERT INTO abschlussjahrgaenge (id,bezeichnung,typ,jahr) VALUES (1,'S2027','Sommer',2027)");
db.run(`INSERT INTO schueler (id,nachname,vorname,klasse_id,jahrgang_id,fachrichtung_id,betrieb_id,aktiv,ibykus_id,email,ausbildungsbeginn,ausbildungsende,geburtsdatum) VALUES
  (1,'Sauber','Susi',2,1,1,1,1,'IBK-1','s@s.de','2024-09-01','2027-08-31','2005-03-10'),
  (2,'Luecke','Lars',NULL,NULL,NULL,NULL,1,'','','','',''),
  (3,'Verdreht','Vera',2,1,1,1,1,'IBK-3','v@v.de','2027-01-01','2024-01-01','2004-01-01'),
  (4,'Doppelt','Dora',2,1,1,1,1,'IBK-DUP','','2024-09-01','2027-08-31','2003-05-05'),
  (5,'Doppelt2','Doris',2,1,1,1,1,'IBK-DUP','','2024-09-01','2027-08-31','2003-06-06'),
  (6,'Vorbei','Volker',2,1,1,2,1,'IBK-6','','2020-09-01','2023-08-31','2002-01-01')`);

const sandbox = {
  console, Date, Math, JSON, Set,
  document: { getElementById: () => ({ innerHTML: '' }) },
  App: {
    query(sql, params = []) { const st = db.prepare(sql); st.bind(params); const r = []; while (st.step()) r.push(st.getAsObject()); st.free(); return r; },
    scalar(sql, params = []) { const r = sandbox.App.query(sql, params); return r.length ? Object.values(r[0])[0] : null; },
    openModal() {}, closeModal() {}, toast() {},
  },
  ImportHandler: { editSchueler() {} }, StammdatenTab: { editBetrieb() {}, editKlasse() {}, editSchule() {} },
  esc: (s) => String(s ?? ''), todayStr: () => '2026-07-30', formatDate: (d) => String(d || ''), setTimeout: (f) => f(),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(BER_SRC + '\n;globalThis.__B = BerichteHandler;', sandbox, { filename: 'berichte.js' });
const B = sandbox.__B;

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

const issues = B._dqRun();
const of = (name) => issues.filter(i => i.name.startsWith(name));
const has = (name, frag) => of(name).some(i => i.problem.includes(frag));

check(of('Sauber').length === 0, 'Sauberer Datensatz: keine Befunde');
check(has('Luecke', 'IBYKUS-ID'), 'Fehlende IBYKUS-ID erkannt');
check(has('Luecke', 'Ausbildungsbeginn fehlt'), 'Fehlender Beginn erkannt');
check(has('Luecke', 'Kein Ausbildungsbetrieb'), 'Fehlender Betrieb erkannt');
check(has('Luecke', 'Keine Klasse'), 'Fehlende Klasse erkannt');
check(has('Verdreht', 'vor dem Beginn'), 'Ende vor Beginn erkannt');
check(has('Doppelt,', 'IBK-DUP') && has('Doppelt2', 'IBK-DUP'), 'Doppelte IBYKUS-ID bei beiden gemeldet');
check(has('Vorbei', 'zurück'), 'Aktiv trotz lange abgelaufenem Ende erkannt');
check(issues.some(i => i.kat === 'Betrieb' && i.name === 'Ohne Kontakt' && i.problem.includes('Kein Kontakt')), 'Betrieb ohne Kontakt (mit Azubi) erkannt');
check(issues.some(i => i.kat === 'Schule' && i.problem.includes('Keine E-Mail')) === false, 'Schule ohne Azubis wird NICHT gemeldet (BS Radolfzell hat keine aktiven Azubis in Klasse 1)');
check(issues.some(i => i.kat === 'Klasse' && i.problem.includes('Lehrjahr')) === false, 'Klasse ohne Azubis wird nicht gemeldet');
check(issues.every((i, idx) => idx === 0 || ({fehler:0,warnung:1,hinweis:2})[issues[idx-1].sev] <= ({fehler:0,warnung:1,hinweis:2})[i.sev]), 'Sortierung: Fehler vor Warnungen vor Hinweisen');
// Filter + Export-Datenbasis
B._dqIssues = issues; B._dqFilter = { sev: 'fehler', kat: '' };
check(B._dqFiltered().every(i => i.sev === 'fehler'), 'Schweregrad-Filter wirkt');
B._dqFilter = { sev: '', kat: 'Betrieb' };
check(B._dqFiltered().every(i => i.kat === 'Betrieb'), 'Kategorie-Filter wirkt');

console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
process.exit(failed ? 1 : 0);
