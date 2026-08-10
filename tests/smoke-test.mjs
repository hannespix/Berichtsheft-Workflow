// ═══════════════════════════════════════════════════════════════════
//  Laufzeit-Smoke-Test: startet dist/berichtsheftkontrolle.html im
//  echten Chromium, klickt alle Ansichten/Tabs/Modals durch und meldet
//  jeden Konsolenfehler. Findet Fehler, die statische Prüfung nicht sieht.
//
//  Voraussetzung: playwright-core + Chromium (im Dev-Container vorhanden)
//  Ausführen:  node tests/smoke-test.mjs
//  Ohne Playwright wird der Test übersprungen (Exit 0).
// ═══════════════════════════════════════════════════════════════════
import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const APP = 'file://' + path.join(ROOT, 'dist/berichtsheftkontrolle.html');

const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  process.env.CHROME_PATH,
];
const exe = CHROME_CANDIDATES.find(p => p && fs.existsSync(p));

// Auflösung auch über NODE_PATH (Playwright liegt im Dev-Container außerhalb
// des Projekts – das Tool selbst hat bewusst keine npm-Abhängigkeiten).
let chromium;
const modCandidates = ['playwright-core', 'playwright',
  ...(process.env.NODE_PATH || '').split(':').filter(Boolean)
    .flatMap(base => [path.join(base, 'playwright-core', 'index.mjs'), path.join(base, 'playwright', 'index.mjs')])
    .map(p => url.pathToFileURL(p).href)];
for (const cand of modCandidates) {
  try { ({ chromium } = await import(cand)); if (chromium) break; } catch { /* nächster Kandidat */ }
}
if (!chromium || !exe) {
  console.log('⊘ Smoke-Test übersprungen (Playwright oder Chromium nicht verfügbar)');
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 250)); });
page.on('pageerror', e => errors.push('[pageerror] ' + (e.message || String(e)).slice(0, 250)));

let failed = 0, passed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  ✗ FEHLER: ' + m); } };

await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const demo = page.locator('button:has-text("Demo-Modus")');
check(await demo.count() > 0, 'Startbildschirm mit Demo-Modus geladen');
await demo.first().click();
await page.waitForTimeout(2500);
check(await page.locator('#appMain').isVisible(), 'App nach Demo-Start sichtbar');

const anzahl = await page.evaluate(() => App.scalar('SELECT COUNT(*) FROM schueler'));
check(anzahl > 0, `Demo-Datenbank gefüllt (${anzahl} Schüler)`);

console.log('\n══ Alle Ansichten ══');
for (const v of ['dashboard','stammdaten','import','planung','kontrolle','nacherfassung','wiedervorlagen','berichte','einstellungen','hilfe']) {
  const before = errors.length;
  await page.evaluate(vv => App.navigate(vv), v);
  await page.waitForTimeout(600);
  const len = await page.evaluate(() => (document.getElementById('mainContent')?.innerHTML || '').length);
  check(errors.length === before && len > 500, `Ansicht "${v}" (${len} Zeichen)`);
}

console.log('\n══ Stammdaten-Tabs ══');
await page.evaluate(() => App.navigate('stammdaten'));
await page.waitForTimeout(400);
for (const tab of ['azubis','jahrgaenge','schulen','klassen','betriebe','fachrichtungen','pruefer']) {
  const before = errors.length;
  await page.evaluate(t => StammdatenTab.show(t), tab);
  await page.waitForTimeout(350);
  check(errors.length === before, `Tab "${tab}"`);
}

console.log('\n══ Kernfunktionen ══');
{
  const before = errors.length;
  const n = await page.evaluate(() => { GlobalSearch.search('mueller'); return GlobalSearch._results.length; });
  check(errors.length === before && n >= 0, `Globale Suche liefert ${n} Treffer`);
}
{
  const before = errors.length;
  const n = await page.evaluate(() => BerichteHandler._dqRun().length);
  check(errors.length === before, `Datenqualitätsprüfung läuft (${n} Befunde)`);
}
{
  const before = errors.length;
  const r = await page.evaluate(() => {
    // Termin mit den meisten Schülern – sonst testet man ein leeres Raster
    const t = App.query(`SELECT kt.id FROM kontrolltermine kt
      ORDER BY (SELECT COUNT(*) FROM kontrolltermin_schueler WHERE kontrolltermin_id=kt.id) DESC LIMIT 1`)[0];
    if (!t) return 'kein Termin';
    App.navigate('kontrolle'); KontrolleHandler.loadTermin(t.id);
    return KontrolleHandler.currentSchuelerList?.length ?? 0;
  });
  await page.waitForTimeout(900);
  check(errors.length === before, `Kontrolldurchführung geladen (${r} Schüler)`);
}
for (const call of ['BerichteHandler.datenqualitaet()','BerichteHandler.zulassungsliste()','Views.openTarifModal()','GlobalSearch.showCheatSheet()']) {
  const before = errors.length;
  await page.evaluate(c => eval(c), call);
  await page.waitForTimeout(400);
  await page.evaluate(() => App.closeModal());
  check(errors.length === before, `Dialog ${call}`);
}

if (errors.length) {
  console.log('\n──── Konsolenfehler ────');
  [...new Set(errors)].forEach(e => console.log('  ' + e));
}
console.log(`\n═══ Ergebnis: ${passed} OK, ${failed} Fehler ═══`);
await browser.close();
process.exit(failed ? 1 : 0);
