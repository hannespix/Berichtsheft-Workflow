// Filter-Aufklapper im Filterbalken: ein Aussehen für alle (Jahrgänge, Berufe,
// Ämter, BAV, + Filter, Wertlisten der Zusatzfilter).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP = read('src/js/app-core.js');
const HTML = read('index.html');
const CSS = read('src/css/styles.css');
let ok = 0, fail = 0;
const check = (c, name) => { if (c) { ok++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FEHLER: ' + name); } };
const fn = (name) => { const i = APP.indexOf('  ' + name + '('); const j = APP.indexOf('\n  },', i); return APP.slice(i, j); };

console.log('\n══ Gemeinsame Bausteine ══');
check(/\.fp-dd-kopf \{/.test(CSS) && /\.fp-dd-titel \{/.test(CSS) && /\.fp-dd-opt \{/.test(CSS) && /\.fp-dd-opt:hover \{ background: var\(--clr-warm\); \}/.test(CSS) && /\.fp-dd-mark \{/.test(CSS) && /\.fp-dd-sub \{/.test(CSS) && /\.fp-dd-links \{/.test(CSS) && /\.fp-dd-hinweis \{/.test(CSS) && /\.fp-dd-unter \{/.test(CSS), 'CSS kennt Kopfzeile, Titel, Option, Markierung, Zusatz, Links, Hinweis, Untergruppe');
check(/\.fp-dd-opt:focus-visible \{ outline/.test(CSS) && /\.fp-dd-opt input\[type=checkbox\] \{ accent-color: var\(--clr-forest\)/.test(CSS), 'Sichtbarer Fokus, Häkchen in Landesfarbe über CSS statt Inline-Style');
check(/\.fp-dropdown \{[^}]*min-width: 240px;[^}]*max-height: 380px;/.test(CSS) && !/fp-dropdown" style="display:none;min-width/.test(HTML), 'Alle Aufklapper gleich breit und gleich hoch (keine Inline-Breiten mehr)');
check(!/fp-dd-item/.test(APP) && !/fp-dd-item/.test(HTML) && !/fp-dd-item/.test(CSS), 'Alte Klasse fp-dd-item ist weg');

console.log('\n══ Die fünf Aufklapper ══');
const jg = fn('refreshJgDropdown'), bg = fn('refreshBgDropdown'), amt = fn('toggleAmtDropdown'), extra = fn('toggleExtraFilterDropdown'), chips = fn('_renderExtraFilterChips');
check(/<div class="fp-dd-kopf"><label><input type="checkbox" \$\{isAll \? 'checked' : ''\} onchange="App\._toggleJgAll\(\)"> Alle \/ Keine<\/label><\/div>/.test(jg) && /class="fp-dd-titel">Abschlussprüfung \(AP\)/.test(jg) && /class="fp-dd-titel">Zwischenprüfung \(ZP\)/.test(jg) && /<label class="fp-dd-opt eingerueckt">\s*<input type="checkbox" class="chk-jg"/.test(jg) && /id="jgUnionHint" class="fp-dd-hinweis"/.test(jg), 'Jahrgänge: Kopfzeile Alle / Keine, Abschnitte AP und ZP, Optionen als Zeilen');
check(/<div class="fp-dd-kopf"><label><input type="checkbox" \$\{isAll \? 'checked' : ''\} onchange="App\._toggleBgAll\(\)"> Alle \/ Keine<\/label><\/div>/.test(bg) && /<div class="fp-dd-opt hervor">\s*<input type="checkbox" class="chk-bg-group"/.test(bg) && /<label class="fp-dd-opt eingerueckt">\s*<input type="checkbox" class="chk-bg-fr"/.test(bg) && /class="fp-dd-unter"/.test(bg) && /class="fp-dd-pfeil" role="button" tabindex="0" aria-expanded/.test(bg), 'Berufe: Kopfzeile, Gruppenzeile mit Pfeil (Tastatur), Fachrichtungen eingerückt');
check(/<div class="fp-dd-kopf"><label><input type="checkbox" \$\{isAll \? 'checked' : ''\} onchange="App\._toggleAmtAll\(this\.checked\)"> Alle \/ Keine<\/label><\/div>/.test(amt) && /<div class="fp-dd-titel">Zuständiges Amt<\/div>/.test(amt) && /<label class="fp-dd-opt">\s*<input type="checkbox" class="chk-amt"/.test(amt) && /<span class="fp-dd-sub">\$\{esc\(this\.AEMTER\[c\]\|\|'\?'\)\}<\/span>/.test(amt), 'Ämter: Kopfzeile, Titel, Optionen mit leisem Amtsnamen');
check(/<div class="fp-dd-titel">Ausbildungsverhältnisse<\/div>/.test(HTML) && (HTML.match(/class="fp-dd-opt" role="menuitemradio" aria-checked="(true|false)" tabindex="0" onclick="App\.setBavFilter\('(aktiv|alle|ende)'\)"/g) || []).length === 3 && /<span class="fp-dd-mark" id="bavOpt_aktiv">✓<\/span><span>Aktive BAV<\/span><span class="fp-dd-sub">/.test(HTML) && /zeile\.setAttribute\('aria-checked'/.test(fn('setBavFilter')), 'BAV: drei Zeilen mit Markierung und Zusatz, aria-checked folgt der Wahl');
check(/<div class="fp-dd-titel">\$\{esc\(cat\)\}<\/div>/.test(extra) && /<div class="fp-dd-opt" role="menuitem" tabindex="0" onclick="App\._addExtraFilter\('\$\{k\}'\)"/.test(extra) && /<span class="fp-dd-mark">\+<\/span>/.test(extra) && /role="menu" aria-label="Weitere Filter"/.test(HTML), '+ Filter: Abschnittstitel, Optionen als Zeilen mit „+“, per Tastatur erreichbar');
check(/id="efDd_\$\{idx\}" class="fp-dropdown"/.test(chips) && /<div class="fp-dd-kopf"><span class="fp-dd-sub">Mehrfachauswahl<\/span><span class="fp-dd-links">/.test(chips) && /<label class="fp-dd-opt">\s*<input type="checkbox" class="chk-ef-\$\{idx\}"/.test(chips), 'Wertlisten der Zusatzfilter nutzen dasselbe Muster');
for (const [name, src] of [['Jahrgänge', jg], ['Berufe', bg], ['Ämter', amt], ['+ Filter', extra], ['Zusatzfilter-Werte', chips]]) check(!/onmouseenter|onmouseleave/.test(src) && !/style="padding:[^"]*cursor:pointer/.test(src) && !/text-transform:uppercase/.test(src), `${name}: keine Inline-Hover und keine Inline-Optik mehr`);
check(/aria-checked/.test(HTML) && !/color:#888/.test(HTML), 'BAV-Menü ohne harte Farbwerte');

console.log(`\n═══ Ergebnis: ${ok} OK, ${fail} Fehler ═══`);
process.exit(fail ? 1 : 0);
