const TableSort = {
  init() {
    // One global click listener – works on ALL tables, including future ones
    document.addEventListener('click', e => {
      const th = e.target.closest('.data-table th');
      if (!th || th.querySelector('input,button,svg')) return;
      const txt = th.textContent.trim().replace(/[▲▼]/g, '').trim();
      if (!txt || txt === 'Aktionen' || txt.length > 35) return;
      const table = th.closest('table');
      const tbody = table?.querySelector('tbody');
      if (!tbody || tbody.rows.length < 2) return;
      const colIdx = [...th.parentElement.children].indexOf(th);
      if (colIdx < 0) return;

      // Determine sort direction
      const wasAsc = th.dataset.sortDir === 'asc';
      th.parentElement.querySelectorAll('th').forEach(h => { delete h.dataset.sortDir; });
      const dir = wasAsc ? 'desc' : 'asc';
      th.dataset.sortDir = dir;

      // Sort rows
      const rows = [...tbody.rows];
      rows.sort((a, b) => {
        const cellA = a.cells[colIdx], cellB = b.cells[colIdx];
        if (!cellA || !cellB) return 0;
        // Prefer data-sort attribute over textContent
        let va = (cellA.dataset.sort || cellA.textContent || '').trim();
        let vb = (cellB.dataset.sort || cellB.textContent || '').trim();
        // Try ISO date first (YYYY-MM-DD) – must come before numeric to avoid parseFloat eating the year
        if (va.match(/^\d{4}-\d{2}/) && vb.match(/^\d{4}-\d{2}/)) return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        // Try date (DD.MM.YYYY)
        const da = va.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        const db = vb.match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (da && db) {
          const ta = new Date(da[3], da[2]-1, da[1]).getTime();
          const tb = new Date(db[3], db[2]-1, db[1]).getTime();
          return dir === 'asc' ? ta - tb : tb - ta;
        }
        // Try numeric
        const na = parseFloat(va.replace(/[^\d,.-]/g, '').replace(',', '.'));
        const nb = parseFloat(vb.replace(/[^\d,.-]/g, '').replace(',', '.'));
        if (!isNaN(na) && !isNaN(nb)) return dir === 'asc' ? na - nb : nb - na;
        // String (locale-aware)
        return dir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  },
  // Kept for backward compat – no-op since event delegation handles everything
  initAll() {}
};
