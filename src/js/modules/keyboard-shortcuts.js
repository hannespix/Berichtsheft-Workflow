
document.addEventListener('keydown', (e) => {
  // Ctrl+Z = Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    // Don't intercept in text inputs/textareas (let browser handle native undo)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    UndoManager.undo();
    return;
  }
  // Ctrl+Y or Ctrl+Shift+Z = Redo
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    UndoManager.redo();
    return;
  }
  // Ctrl+S = Save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    App.saveDatabase();
    return;
  }
  // Ctrl+→ = Next student (in Kontrolle)
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight' && KontrolleHandler.currentTerminId) {
    e.preventDefault();
    KontrolleHandler.next();
    return;
  }
  // Ctrl+← = Previous student (in Kontrolle)
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowLeft' && KontrolleHandler.currentTerminId) {
    e.preventDefault();
    KontrolleHandler.prev();
    return;
  }
  // Escape = Close modal or sidebar
  if (e.key === 'Escape') {
    const search = document.getElementById('globalSearchOverlay');
    if (search && search.style.display !== 'none') { search.style.display = 'none'; return; }
    const modal = document.getElementById('modalOverlay');
    if (modal && modal.classList.contains('active')) {
      App.closeModal();
      return;
    }
    App.closeSidebar();
  }
  // Ctrl+K = Global search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    GlobalSearch.open();
    return;
  }
  // F1 or ? = Keyboard cheat sheet
  if (e.key === 'F1' || (e.key === '?' && !e.ctrlKey && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA')) {
    e.preventDefault();
    GlobalSearch.showCheatSheet();
    return;
  }
  // Alt+1-8 = Schnellnavigation. Nicht in Eingabefeldern feuern (halb
  // ausgefüllte Formulare gingen sonst verloren) und offene Dialoge vorher
  // schließen – sonst schwebte das Fenster über einer ganz anderen Ansicht.
  if (e.altKey && !e.ctrlKey && '12345678'.includes(e.key)) {
    const t = e.target?.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.target?.isContentEditable) return;
    e.preventDefault();
    const views = ['dashboard','stammdaten','import','planung','kontrolle','wiedervorlagen','berichte','einstellungen'];
    try { const ov = document.getElementById('modalOverlay'); if (ov && ov.classList.contains('active')) App.closeModal(); } catch(err) {}
    App.navigate(views[parseInt(e.key) - 1]);
    return;
  }
  // F5 = Reload from disk (not browser refresh)
  if (e.key === 'F5' && App.dbFileHandle && !App.demoMode) {
    e.preventDefault();
    if (App.unsavedChanges && !confirm('Es gibt noch nicht gespeicherte Änderungen. Trotzdem von der Platte neu laden?\n(Eigene Änderungen werden vorher weggeschrieben, sofern möglich.)')) return;
    App.reloadFromFile();
    return;
  }

  // ── KW Modal keyboard shortcuts ──
  if (KontrolleHandler._kwModalContext && document.querySelector('.modal-overlay.active')) {
    const ctx = KontrolleHandler._kwModalContext;
    const focused = document.activeElement;
    const isTextInput = focused && (focused.tagName === 'TEXTAREA' || (focused.tagName === 'INPUT' && focused.type !== 'checkbox'));
    
    if (!isTextInput) {
      const key = e.key.toUpperCase();
      
      // Enter = Save
      if (e.key === 'Enter') {
        e.preventDefault();
        KontrolleHandler.saveKW(ctx.keId, ctx.aj, ctx.kw);
        return;
      }
      // Escape = Cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        App.closeModal();
        KontrolleHandler._kwModalContext = null;
        if (ctx.cellEl) ctx.cellEl.focus();
        return;
      }
      // O = Keine Beanstandungen
      if (key === 'O') {
        e.preventDefault();
        KontrolleHandler.saveKWOk(ctx.keId, ctx.aj, ctx.kw);
        return;
      }
      // A-I = toggle checkbox
      if ('ABCDEFGHI'.includes(key)) {
        e.preventDefault();
        const cb = document.getElementById('kwc_' + key);
        if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
        return;
      }
      // 1-5 = set Fehltage
      if ('12345'.includes(e.key)) {
        e.preventDefault();
        const fi = document.getElementById('kwFehltage');
        if (fi) fi.value = e.key;
        // Also check H
        const hCb = document.getElementById('kwc_H');
        if (hCb && !hCb.checked) hCb.checked = true;
        return;
      }
      // 0 = clear Fehltage
      if (e.key === '0') {
        e.preventDefault();
        const fi = document.getElementById('kwFehltage');
        if (fi) fi.value = '0';
        const hCb = document.getElementById('kwc_H');
        if (hCb && hCb.checked) hCb.checked = false;
        return;
      }
    } else {
      // In text input: only Escape works
      if (e.key === 'Escape') {
        e.preventDefault();
        App.closeModal();
        KontrolleHandler._kwModalContext = null;
        if (ctx.cellEl) ctx.cellEl.focus();
        return;
      }
    }
  }

  // / = Focus Schüler-Suche in Kontrolle Einzelansicht
  if (e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
    const searchInput = document.getElementById('kontrolleSearch');
    if (searchInput && searchInput.offsetParent !== null) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
  }

  // Forward to KW grid handler
  KWNav.handleKeyDown(e);
});

// ── Bulk: Schüler-Liste ──
