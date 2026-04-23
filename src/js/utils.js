// ╔══════════════════════════════════════════════════════════════╗
// ║  UTILITY FUNCTIONS                                           ║
// ╚══════════════════════════════════════════════════════════════╝

function esc(str) {
  if (str === null || str === undefined) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
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
  if (App._dirtyOps && App._dirtyOps.length > 0) {
    try { App._persistDirtyOps(); } catch(ex) {}
  }
  // Release lock file
  try { App._releaseLock(); } catch(ex) {}
  if (App.unsavedChanges && !App.demoMode) {
    e.preventDefault();
    e.returnValue = 'Es gibt ungespeicherte Änderungen. Wirklich schließen?';
  }
});
