// ╔══════════════════════════════════════════════════════════════╗
// ║  UTILITY FUNCTIONS                                           ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Monochrome Inline-SVG-Icons (Feather/Lucide-Stil, erben currentColor) ──
// Für Aktionen mit eigener Bedeutung: Text-Glyphen wie ◈/▤ sind zu abstrakt,
// Emojis tabu (unprofessionell + Plattform-abhängig bunt).
function svgIcon(name, size = 14) {
  const paths = {
    // Azubi-Dashboard: Übersichtskacheln
    dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    // Schüler-Akte: Ordner
    akte: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    // Zulassung / Abschluss / Prüfung: Doktorhut
    abschluss: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    // Dateitypen (Schüler-Akte)
    datei: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    bild: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    tabelle: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="12" y1="3" x2="12" y2="21"/>',
    archiv: '<rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}" style="vertical-align:-2px;flex-shrink:0">${paths[name] || paths.datei}</svg>`;
}

// Textbaustein per Index in ein Textfeld einfügen. Der Baustein-TEXT darf nie
// in ein onclick-Attribut eingebettet werden: JSON.stringify erzeugt doppelte
// Anführungszeichen, die das Attribut an Ort und Stelle beenden (Bug: Klick
// auf Baustein-Buttons tat nichts).
function bausteinInsert(targetId, idx) {
  try {
    const t = document.getElementById(targetId);
    const b = App.getTextbausteine()[idx];
    if (!t || b == null) return;
    t.value = t.value ? t.value + '\n' + b : b;
    t.focus();
  } catch(e) {}
}

function esc(str) {
  if (str === null || str === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  // textContent→innerHTML escaped & < > — aber NICHT Anführungszeichen.
  // Ohne diese bricht z.B. Betrieb `Gärtnerei "Grün" GmbH` aus Attributen aus (Injection).
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Lokales Datum als YYYY-MM-DD (KEIN UTC!) ──
// Ersetzt das verbreitete .toISOString().slice(0,10) welches in Sommerzeit
// einen Tag früher liefern kann (UTC vs. lokale Zeit Verschiebung).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dateStr(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function addDaysStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDate(d) {
  if (!d) return '–';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return d; }
}
function getKW(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  const tmp = new Date(dt.getTime()); tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  return Math.ceil(((tmp - new Date(tmp.getFullYear(), 0, 4)) / 86400000 + ((new Date(tmp.getFullYear(), 0, 4).getDay() + 6) % 7) + 1) / 7);
}
function formatDateKW(d) {
  if (!d) return '–';
  const kw = getKW(d);
  return `${formatDate(d)} <span style="font-size:10px;color:var(--clr-sage);font-weight:600">KW${kw}</span>`;
}

function formatDateTime(dt) {
  if (!dt) return '–';
  try {
    return new Date(dt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return dt; }
}

function statusBadge(status) {
  const map = {
    'geplant': '<span class="badge-status badge-planned">Geplant</span>',
    'durchgefuehrt': '<span class="badge-status badge-done">Durchgeführt</span>',
    'abgesagt': '<span class="badge-status badge-overdue">Abgesagt</span>',
  };
  return map[status] || status;
}

function wvStatusBadge(status) {
  const map = {
    'offen': '<span class="badge-status badge-open">Offen</span>',
    'erledigt': '<span class="badge-status badge-done">Erledigt</span>',
    'ueberfaellig': '<span class="badge-status badge-overdue">Überfällig</span>',
  };
  return map[status] || status;
}

function wvArtLabel(art) {
  const map = {
    'nachholung_naechste_durchsicht': 'Nachholung bis nächste Durchsicht',
    'sachberichte_wetter_email': 'Sachberichte (Wetter) per E-Mail',
    'berichte_bis_termin_email': 'Berichte per E-Mail bis Termin',
    'persoenliche_vorlage_rp': 'Persönliche Vorlage im RP',
    'post_an_rp': 'Per Post ans RP',
  };
  return map[art] || art || '–';
}

function ergebnisLabel(e) {
  const map = {
    'in_ordnung': 'In Ordnung',
    'nachholung_naechste_durchsicht': 'Nachholung',
    'sachberichte_wetter_email': 'Sachberichte (E-Mail)',
    'berichte_bis_termin_email': 'Berichte (E-Mail)',
    'persoenliche_vorlage_rp': 'Vorlage RP',
    'post_an_rp': 'Post RP',
  };
  return map[e] || e || 'Nicht kontrolliert';
}

// ── Auto-init ──
// Restore dark mode preference
try { if (App.uGet('dark') === '1') document.body.classList.add('dark-mode'); } catch(e) {}
window.addEventListener('DOMContentLoaded', () => { TableSort.init(); App.init(); });

// ── Warn before closing with unsaved changes ──
window.addEventListener('beforeunload', (e) => {
  try {
    if (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) {
      App._deletePositionFile(KontrolleHandler.activePruefer);
    }
  } catch(ex) {}
  // Persist dirty ops to IndexedDB so they survive tab close
  // (auch die gerade in einem Append steckenden – _persistDirtyOps sichert
  // _opsInFlight mit)
  if ((App._dirtyOps && App._dirtyOps.length > 0) || (App._opsInFlight && App._opsInFlight.length > 0)) {
    try { App._persistDirtyOps(); } catch(ex) {}
  }
  // Release lock file – aber NICHT während ein Save läuft: bricht der Nutzer
  // das Tab-Schließen ab, liefe der Schreibvorgang sonst ungeschützt weiter.
  // Im v3-Modus heißen die laufenden Schreibvorgänge _compactInProgress
  // (Snapshot-Write unter Lock!) und _appendInProgress – auch dann behalten.
  try {
    if (!App._mergeInProgress && !App._compactInProgress && !App._appendInProgress) App._releaseLock();
  } catch(ex) {}
  if (App.unsavedChanges && !App.demoMode) {
    e.preventDefault();
    e.returnValue = 'Es gibt ungespeicherte Änderungen. Wirklich schließen?';
  }
});
