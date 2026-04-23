const KWNav = {
  CODES: ['A','B','C','D','E','F','G','H','I'],
  CODE_LABELS: {A:'Unterschr. Azubi',B:'Unterschr. Ausbilder',C:'BS-Themen',D:'Wetter',E:'Lückenhaft',F:'Berichte fehlen',G:'Datum/KW',H:'Fehltage',I:'Sonstiges'},
  activePopover: null,
  _selectedCells: new Set(),
  _anchorCell: null,

  focusCell(cell, e) {
    if (e && e.shiftKey && this._anchorCell) {
      e.preventDefault();
      this._selectRange(this._anchorCell, cell);
      cell.focus();
      return;
    }
    this.clearSelection();
    this._anchorCell = cell;
    cell.focus();
  },

  _selectRange(fromCell, toCell) {
    const cells = this.getAllCells();
    const fromIdx = cells.indexOf(fromCell);
    const toIdx = cells.indexOf(toCell);
    if (fromIdx < 0 || toIdx < 0) return;
    const lo = Math.min(fromIdx, toIdx), hi = Math.max(fromIdx, toIdx);
    this.clearSelection();
    for (let i = lo; i <= hi; i++) {
      if (!cells[i].classList.contains('kw-inactive')) {
        this._selectedCells.add(cells[i]);
        cells[i].classList.add('kw-selected');
      }
    }
    this._updateSelectionCount();
  },

  _extendSelection(cell) {
    if (!cell || cell.classList.contains('kw-inactive')) return;
    this._selectedCells.add(cell);
    cell.classList.add('kw-selected');
    this._updateSelectionCount();
  },

  clearSelection() {
    this._selectedCells.forEach(c => c.classList.remove('kw-selected'));
    this._selectedCells.clear();
    const badge = document.getElementById('kwSelCount');
    if (badge) badge.style.display = 'none';
  },

  _updateSelectionCount() {
    let badge = document.getElementById('kwSelCount');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'kwSelCount';
      badge.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--clr-forest);color:white;padding:8px 16px;border-radius:var(--radius);font-size:13px;font-weight:700;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
      document.body.appendChild(badge);
    }
    const n = this._selectedCells.size;
    if (n > 0) {
      badge.innerHTML = `${n} KW${n > 1 ? 's' : ''} ausgewählt <span style="opacity:0.7;font-weight:400;margin-left:8px">Taste drücken zum Bearbeiten · Esc = Abwählen</span>`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  },

  _getSelectedOrFocused() {
    if (this._selectedCells.size > 0) return [...this._selectedCells];
    const cell = document.activeElement;
    if (cell && cell.classList.contains('kw-cell') && cell.dataset.ke) return [cell];
    return [];
  },

  _bulkToggleCode(cells, code) {
    if (!cells.length) return;
    const addToAll = !cells.every(c => (c.dataset.codes || '').split(',').includes(code));
    const undoData = cells.map(c => ({ keId: +c.dataset.ke, aj: +c.dataset.aj, kw: +c.dataset.kw, oldCodes: c.dataset.codes || '', fehltage: +c.dataset.fehltage || 0 }));
    cells.forEach(c => {
      let codes = (c.dataset.codes || '').split(',').filter(Boolean);
      if (addToAll) { if (!codes.includes(code)) { codes.push(code); codes.sort(); } }
      else { codes = codes.filter(x => x !== code); }
      const codesStr = codes.join(',');
      const fehl = +c.dataset.fehltage || 0;
      this.persistCodes(+c.dataset.ke, +c.dataset.aj, +c.dataset.kw, codesStr, fehl);
      this.updateCellVisual(c, codesStr, fehl);
    });
    UndoManager.push(`${cells.length} KWs ${addToAll ? '+' : '−'}${code}`,
      () => { undoData.forEach(d => this.persistCodes(d.keId, d.aj, d.kw, d.oldCodes, d.fehltage)); KontrolleHandler.renderSchueler(); },
      () => { cells.forEach(c => { const codes = (c.dataset.codes||'').split(',').filter(Boolean); this.persistCodes(+c.dataset.ke,+c.dataset.aj,+c.dataset.kw,codes.join(','),+c.dataset.fehltage||0); }); KontrolleHandler.renderSchueler(); }
    );
    this.showFeedback(cells[0], `${cells.length}× ${addToAll ? '+' : '−'}${code}`);
  },

  _bulkSetFehltage(cells, val) {
    cells.forEach(c => {
      let codes = (c.dataset.codes || '').split(',').filter(Boolean);
      if (val > 0 && !codes.includes('H')) { codes.push('H'); codes.sort(); }
      if (val === 0) codes = codes.filter(x => x !== 'H');
      this.persistCodes(+c.dataset.ke, +c.dataset.aj, +c.dataset.kw, codes.join(','), val);
      this.updateCellVisual(c, codes.join(','), val);
    });
    this.showFeedback(cells[0], `${cells.length}× H:${val}`);
  },

  _bulkClear(cells) {
    cells.forEach(c => this.clearCell(c));
    this.showFeedback(cells[0], `${cells.length}× gelöscht`);
  },

  _bulkOk(cells) {
    cells.forEach(c => {
      this.persistCodes(+c.dataset.ke, +c.dataset.aj, +c.dataset.kw, '', 0);
      this.updateCellVisual(c, '', 0);
      c.classList.add('kw-ok', 'kw-session');
      c.classList.remove('kw-issue');
    });
    this.showFeedback(cells[0], `${cells.length}× ✓ OK`);
  },

  // Get all navigable cells in order
  getAllCells() {
    return Array.from(document.querySelectorAll('.kw-cell[tabindex="0"]'));
  },

  // Find neighbor cell for arrow nav
  navigate(cell, direction) {
    const aj = parseInt(cell.dataset.aj);
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    let targetAj = aj, targetRow = row, targetCol = col;

    switch(direction) {
      case 'right':
        targetCol = col + 1;
        if (targetCol > 12) { targetCol = 0; targetRow++; }
        if (targetRow > 3) { targetRow = 0; targetAj++; }
        if (targetAj > 3) return null;
        break;
      case 'left':
        targetCol = col - 1;
        if (targetCol < 0) { targetCol = 12; targetRow--; }
        if (targetRow < 0) { targetRow = 3; targetAj--; }
        if (targetAj < 1) return null;
        break;
      case 'down':
        targetRow = row + 1;
        if (targetRow > 3) { targetRow = 0; targetAj++; }
        if (targetAj > 3) return;
        break;
      case 'up':
        targetRow = row - 1;
        if (targetRow < 0) { targetRow = 3; targetAj--; }
        if (targetAj < 1) return null;
        break;
    }

    const target = document.querySelector(`.kw-cell[data-aj="${targetAj}"][data-row="${targetRow}"][data-col="${targetCol}"]`);
    if (target) target.focus();
    return target || null;
  },

  // Toggle a code on the focused cell (A-G, I)
  toggleCode(cell, code) {
    const keId = parseInt(cell.dataset.ke);
    const aj = parseInt(cell.dataset.aj);
    const kw = parseInt(cell.dataset.kw);
    const oldCodes = cell.dataset.codes || '';
    const fehltage = parseInt(cell.dataset.fehltage) || 0;
    let currentCodes = oldCodes.split(',').filter(Boolean);

    const idx = currentCodes.indexOf(code);
    let action;
    if (idx >= 0) {
      currentCodes.splice(idx, 1);
      action = `−${code}`;
    } else {
      currentCodes.push(code);
      currentCodes.sort();
      action = `+${code}`;
    }

    const codesStr = currentCodes.join(',');

    // Push undo
    UndoManager.push(`KW ${kw} ${action}`,
      () => { this.persistCodes(keId, aj, kw, oldCodes, fehltage); KontrolleHandler.renderSchueler(); },
      () => { this.persistCodes(keId, aj, kw, codesStr, fehltage); KontrolleHandler.renderSchueler(); }
    );

    this.persistCodes(keId, aj, kw, codesStr, fehltage);
    this.updateCellVisual(cell, codesStr, fehltage);
    this.showFeedback(cell, action);
  },

  // Handle H key: show inline number input for Fehltage
  promptFehltage(cell) {
    this.closePopover();
    const keId = parseInt(cell.dataset.ke);
    const aj = parseInt(cell.dataset.aj);
    const kw = parseInt(cell.dataset.kw);
    const currentFehltage = parseInt(cell.dataset.fehltage) || 0;
    let currentCodes = (cell.dataset.codes || '').split(',').filter(Boolean);

    const pop = document.createElement('div');
    pop.className = 'kw-inline-popover';
    pop.innerHTML = `
      <label>Fehltage KW ${kw}:</label>
      <div style="display:flex;align-items:center;gap:6px;">
        <input type="number" id="kwInlineFehltage" value="${currentFehltage}" min="0" max="5" autofocus>
        <span style="font-size:11px;color:var(--clr-text-light)">(0–5, Enter bestätigt)</span>
      </div>
    `;
    cell.appendChild(pop);
    this.activePopover = { element: pop, cell };

    const input = pop.querySelector('input');
    requestAnimationFrame(() => { input.focus(); input.select(); });

    const confirm = () => {
      const val = Math.min(5, Math.max(0, parseInt(input.value) || 0));
      // If fehltage > 0, add H code; if 0, remove H code
      if (val > 0 && !currentCodes.includes('H')) {
        currentCodes.push('H');
        currentCodes.sort();
      } else if (val === 0) {
        currentCodes = currentCodes.filter(c => c !== 'H');
      }
      const codesStr = currentCodes.join(',');
      this.persistCodes(keId, aj, kw, codesStr, val);
      this.updateCellVisual(cell, codesStr, val);
      this.closePopover();
      cell.focus();
      if (val > 0) this.showFeedback(cell, `H:${val}`);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closePopover(); cell.focus(); }
      // Allow number keys, backspace, delete, arrows
      else if (!'0123456789'.includes(e.key) && !['Backspace','Delete','ArrowLeft','ArrowRight','Tab'].includes(e.key)) {
        e.preventDefault();
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { if (this.activePopover) confirm(); }, 150);
    });
  },

  closePopover() {
    if (this.activePopover) {
      this.activePopover.element.remove();
      this.activePopover = null;
    }
  },

  // Clear all codes from a cell
  clearCell(cell) {
    const sid = parseInt(cell.dataset.sid);
    const keId = parseInt(cell.dataset.ke);
    const aj = parseInt(cell.dataset.aj);
    const kw = parseInt(cell.dataset.kw);
    const oldCodes = cell.dataset.codes || '';
    const oldFehltage = parseInt(cell.dataset.fehltage) || 0;

    // Push undo (restore old state)
    if (oldCodes || oldFehltage) {
      UndoManager.push(`KW ${kw} geleert`,
        () => { this.persistCodes(keId, aj, kw, oldCodes, oldFehltage); KontrolleHandler.renderSchueler(); },
        () => { this.persistCodes(keId, aj, kw, '', 0); KontrolleHandler.renderSchueler(); }
      );
    }

    // Clear in kw_status: move current codes to behobene
    const existing = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw]);
    if (existing.length && existing[0].maengel_codes) {
      const oldCodes = existing[0].maengel_codes;
      const prevBehoben = existing[0].behobene_codes ? existing[0].behobene_codes.split(',').filter(Boolean) : [];
      const merged = [...new Set([...prevBehoben, ...oldCodes.split(',').filter(Boolean)])].join(',');
      App.run('UPDATE kw_status SET maengel_codes="", behobene_codes=?, fehltage=0, behoben_bei=? WHERE id=?', [merged, keId, existing[0].id]);
    } else if (existing.length) {
      App.run('DELETE FROM kw_status WHERE id=?', [existing[0].id]);
    }
    // Backward compat: also update kw_maengel
    App.run('DELETE FROM kw_maengel WHERE kontrollergebnis_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [keId, aj, kw]);
    this.updateCellVisual(cell, '', 0);
    this.showFeedback(cell, '✓ Geleert');
  },

  // Persist codes to DB (kw_status = cumulative, kw_maengel = per-session backward compat)
  persistCodes(keId, aj, kw, codesStr, fehltage) {
    // Get schuelerId from the focused cell or from KontrolleHandler
    const s = KontrolleHandler.currentSchuelerList[KontrolleHandler.currentIndex];
    const sid = s ? s.id : null;

    // ── kw_status (cumulative per student) ──
    if (sid) {
      const existing = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw]);
      if (existing.length) {
        if (!codesStr && !fehltage) {
          // Nothing left — but keep if there were behobene_codes
          if (existing[0].behobene_codes) {
            App.run('UPDATE kw_status SET maengel_codes="", fehltage=0 WHERE id=?', [existing[0].id]);
          } else {
            App.run('DELETE FROM kw_status WHERE id=?', [existing[0].id]);
          }
        } else {
          App.run('UPDATE kw_status SET maengel_codes=?, fehltage=?, geprueft=1, erstellt_bei=COALESCE(erstellt_bei,?) WHERE id=?',
            [codesStr, fehltage, keId, existing[0].id]);
        }
      } else if (codesStr || fehltage) {
        App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,?,?,1,?)',
          [sid, aj, kw, codesStr, fehltage, keId]);
      }

      // Track this KW as checked in this session
      this.trackSessionKW(keId, aj, kw);
    }

    // ── kw_maengel (backward compat per kontrollergebnis) ──
    const exM = App.query('SELECT * FROM kw_maengel WHERE kontrollergebnis_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [keId, aj, kw]);
    if (exM.length) {
      if (!codesStr && !fehltage) App.run('DELETE FROM kw_maengel WHERE id=?', [exM[0].id]);
      else App.run('UPDATE kw_maengel SET maengel_codes=?, fehltage=? WHERE id=?', [codesStr, fehltage, exM[0].id]);
    } else if (codesStr || fehltage) {
      App.run('INSERT INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage) VALUES (?,?,?,?,?)',
        [keId, aj, kw, codesStr, fehltage]);
    }
  },

  // Track session KWs in kontrollergebnisse.geprueft_kws
  trackSessionKW(keId, aj, kw) {
    const ke = App.query('SELECT geprueft_kws FROM kontrollergebnisse WHERE id=?', [keId])[0];
    if (!ke) return;
    let data = {};
    try { data = JSON.parse(ke.geprueft_kws || '{}'); } catch(e) {}
    if (!data[aj]) data[aj] = [];

    // School-year KW order: 36-52, then 1-35
    const kwOrder = [];
    for (let i = 36; i <= 52; i++) kwOrder.push(i);
    for (let i = 1; i <= 35; i++) kwOrder.push(i);

    // Find position of the clicked KW
    const clickedIdx = kwOrder.indexOf(kw);
    if (clickedIdx < 0) return;

    const s = KontrolleHandler.currentSchuelerList[KontrolleHandler.currentIndex];
    const newlyFilled = [];

    // Auto-fill: mark ALL KWs from start up to and including the clicked KW
    for (let i = 0; i <= clickedIdx; i++) {
      const fillKW = kwOrder[i];
      if (!data[aj].includes(fillKW)) {
        data[aj].push(fillKW);
        newlyFilled.push({aj, kw: fillKW});
        if (s) {
          const exists = App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, fillKW]);
          if (!exists) {
            App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,"",0,1,?)',
              [s.id, aj, fillKW, keId]);
          } else {
            App.run('UPDATE kw_status SET geprueft=1 WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, fillKW]);
          }
        }
      }
    }

    // ── CASCADE: fill ALL active KWs in earlier AJs ──
    if (s) {
      const schuelerAJs = App.getSchuelerAJs(s.id);
      const ajBounds = App.getAJKWBounds(s.id);
      const earlierAJs = schuelerAJs.filter(a => a < aj);
      earlierAJs.forEach(prevAJ => {
        if (!data[prevAJ]) data[prevAJ] = [];
        const bounds = ajBounds[prevAJ] || { inactiveKWs: [] };
        const inactiveSet = new Set(bounds.inactiveKWs);
        kwOrder.forEach(fillKW => {
          if (inactiveSet.has(fillKW)) return;
          if (!data[prevAJ].includes(fillKW)) {
            data[prevAJ].push(fillKW);
            newlyFilled.push({aj: prevAJ, kw: fillKW});
            const exists = App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, prevAJ, fillKW]);
            if (!exists) {
              App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,"",0,1,?)',
                [s.id, prevAJ, fillKW, keId]);
            } else {
              App.run('UPDATE kw_status SET geprueft=1 WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, prevAJ, fillKW]);
            }
          }
        });
      });
    }

    if (newlyFilled.length) {
      // Sort all AJ data
      Object.keys(data).forEach(k => { data[k].sort((a,b) => kwOrder.indexOf(a) - kwOrder.indexOf(b)); });
      App.run('UPDATE kontrollergebnisse SET geprueft_kws=? WHERE id=?', [JSON.stringify(data), keId]);

      // Live visual update: turn newly filled cells green
      newlyFilled.forEach(({aj: fillAJ, kw: fillKW}) => {
        const cell = document.querySelector(`.kw-cell[data-aj="${fillAJ}"][data-kw="${fillKW}"]`);
        if (cell && !cell.classList.contains('kw-issue') && !cell.classList.contains('kw-behoben')) {
          cell.classList.add('kw-session');
          if (!cell.dataset.codes) cell.classList.add('kw-ok');
        }
      });
    }
  },

  // Open Sonstiges (I) modal with Bemerkung + Textbausteine
  openSonstigesModal(cell) {
    this.closePopover();
    const keId = parseInt(cell.dataset.ke);
    const aj = parseInt(cell.dataset.aj);
    const kw = parseInt(cell.dataset.kw);
    const sid = parseInt(cell.dataset.sid);
    const currentCodes = (cell.dataset.codes || '').split(',').filter(Boolean);
    const hasI = currentCodes.includes('I');

    // Load existing bemerkung for this KW
    const kwStatus = App.query('SELECT bemerkung FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw]);
    const existingBem = kwStatus.length ? (kwStatus[0].bemerkung || '') : '';

    // Load Textbausteine from settings
    const bausteine = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]');

    App.openModal(`KW ${kw} – Sonstiges (I)`, `
      <div style="margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="sonstI" ${hasI ? 'checked' : ''} style="accent-color:var(--clr-forest)">
          <strong>I – Sonstiges</strong> als Mangel markieren
        </label>
      </div>
      <div class="form-group">
        <label>Bemerkung zu KW ${kw}</label>
        <textarea class="form-control" id="sonstBem" rows="3" style="font-size:12px" placeholder="Freitext-Bemerkung zur KW…">${esc(existingBem)}</textarea>
      </div>
      ${bausteine.length ? `<div style="margin-bottom:10px">
        <label style="font-size:12px;font-weight:600;color:var(--clr-forest);margin-bottom:4px;display:block">Textbausteine (Klick = einfügen)</label>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${bausteine.map(b => `<button class="btn btn-sm btn-secondary" style="font-size:11px;padding:3px 8px" onclick="const t=document.getElementById('sonstBem');const v=t.value;t.value=v+(v?'\\n':'')+${JSON.stringify(b)};t.focus()" title="${esc(b)}">${esc(b.length > 30 ? b.substring(0, 28) + '…' : b)}</button>`).join('')}
        </div>
      </div>` : `<div style="font-size:11px;color:var(--clr-text-light);margin-bottom:8px">
        Keine Textbausteine definiert – <a href="#" onclick="App.closeModal();App.navigate('einstellungen');return false" style="color:var(--clr-forest)">In Einstellungen anlegen</a>
      </div>`}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="KWNav.saveSonstiges(${keId},${aj},${kw},${sid})">Speichern</button>`);
    setTimeout(() => document.getElementById('sonstBem')?.focus(), 100);
  },

  saveSonstiges(keId, aj, kw, sid) {
    const checked = document.getElementById('sonstI')?.checked;
    const bem = document.getElementById('sonstBem')?.value?.trim() || '';

    // Toggle I code
    const cell = document.querySelector(`.kw-cell[data-ke="${keId}"][data-aj="${aj}"][data-kw="${kw}"]`);
    if (cell) {
      let currentCodes = (cell.dataset.codes || '').split(',').filter(Boolean);
      const hadI = currentCodes.includes('I');
      if (checked && !hadI) currentCodes.push('I');
      else if (!checked && hadI) currentCodes = currentCodes.filter(c => c !== 'I');
      currentCodes.sort();
      const codesStr = currentCodes.join(',');
      const fehltage = parseInt(cell.dataset.fehltage) || 0;
      this.persistCodes(keId, aj, kw, codesStr, fehltage);
      this.updateCellVisual(cell, codesStr, fehltage);
    }

    // Save bemerkung to kw_status
    const existing = App.query('SELECT id FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw]);
    if (existing.length) {
      App.run('UPDATE kw_status SET bemerkung=? WHERE id=?', [bem, existing[0].id]);
    } else if (bem) {
      App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,bemerkung,geprueft,erstellt_bei) VALUES (?,?,?,?,1,?)',
        [sid, aj, kw, bem, keId]);
    }

    // Append to student's global Bemerkung field if there's text
    if (bem) {
      const ke = App.query('SELECT bemerkung FROM kontrollergebnisse WHERE id=?', [keId])[0];
      if (ke) {
        const prefix = `[AJ${aj}/KW${kw}] `;
        const existingGlobal = ke.bemerkung || '';
        // Don't duplicate if already present
        if (!existingGlobal.includes(prefix + bem)) {
          const newBem = existingGlobal ? existingGlobal + '\n' + prefix + bem : prefix + bem;
          App.run('UPDATE kontrollergebnisse SET bemerkung=? WHERE id=?', [newBem, keId]);
          // Update visible Bemerkung field if present
          const bemField = document.getElementById('keBemerkung');
          if (bemField) bemField.value = newBem;
        }
      }
    }

    App.closeModal();
    if (cell) cell.focus();
  },

  // Update cell appearance without full re-render
  updateCellVisual(cell, codesStr, fehltage) {
    cell.dataset.codes = codesStr;
    cell.dataset.fehltage = fehltage || '';
    const kw = cell.dataset.kw;
    const hasCodes = !!codesStr;
    const fehl = parseInt(fehltage) || 0;
    const hasBehoben = cell.dataset.behoben && !hasCodes;
    let cls = 'kw-cell';
    if (hasCodes) cls += ' kw-issue';
    else if (hasBehoben) cls += ' kw-behoben';
    if (fehl > 0 && !hasCodes) cls += ' kw-fehltage-only';
    cls += ' kw-session'; // currently being edited = in session
    cell.className = cls;
    const fehlHtml = fehl > 0 ? `<span class="kw-fehltage">${fehl}</span>` : '';
    cell.innerHTML = `<span class="kw-num">${kw}</span>${hasCodes ? `<span class="kw-codes">${codesStr.replace(/,/g,' ')}</span>` : ''}${fehlHtml}`;
    // Auto-update Fehltage sums
    const sid = parseInt(cell.dataset.sid);
    const keId = parseInt(cell.dataset.ke);
    KontrolleHandler.autoUpdateFehltage(sid, keId);
  },

  // Brief visual feedback on the cell
  showFeedback(cell, text) {
    const fb = document.createElement('div');
    fb.className = 'kw-feedback';
    fb.textContent = text;
    cell.appendChild(fb);
    setTimeout(() => fb.remove(), 800);
  },

  // Global keyboard handler (attached to document)
  handleKeyDown(e) {
    const cell = document.activeElement;
    if (!cell || !cell.classList.contains('kw-cell') || !cell.dataset.ke) return;
    // Don't capture if popover input is focused
    if (this.activePopover && document.activeElement.tagName === 'INPUT') return;

    const key = e.key.toUpperCase();

    // Shift+Arrow: extend selection; Arrow: navigate
    if (['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const dir = e.key.replace('Arrow','').toLowerCase();
      if (e.shiftKey) {
        if (!this._anchorCell) this._anchorCell = cell;
        if (this._selectedCells.size === 0) { this._selectedCells.add(cell); cell.classList.add('kw-selected'); }
        const next = this.navigate(cell, dir);
        if (next) { this._extendSelection(next); next.focus(); }
      } else {
        this.clearSelection();
        this._anchorCell = null;
        this.navigate(cell, dir);
      }
      return;
    }

    // Tab: move to next cell (default browser behavior + across grids)
    if (e.key === 'Tab') {
      // Let default behavior work for Tab; cells have tabindex
      return;
    }

    // Delete / Backspace: clear cell(s)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const targets = this._getSelectedOrFocused();
      if (targets.length > 1) { this._bulkClear(targets); this.clearSelection(); }
      else { this.clearCell(cell); }
      return;
    }

    // Space or Enter: open full modal
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const keId = parseInt(cell.dataset.ke);
      const aj = parseInt(cell.dataset.aj);
      const kw = parseInt(cell.dataset.kw);
      KontrolleHandler.editKW(keId, aj, kw, cell);
      return;
    }

    // Escape: close popover or clear selection
    if (e.key === 'Escape') {
      if (this.activePopover) { this.closePopover(); cell.focus(); e.preventDefault(); }
      else if (this._selectedCells.size > 0) { this.clearSelection(); e.preventDefault(); }
      return;
    }

    // Letter codes A-G: toggle (bulk if selected)
    if ('ABCDEFG'.includes(key)) {
      e.preventDefault();
      const targets = this._getSelectedOrFocused();
      if (targets.length > 1) { this._bulkToggleCode(targets, key); }
      else { this.toggleCode(cell, key); }
      return;
    }

    // I: open Sonstiges modal with Bemerkung + Textbausteine
    if (key === 'I') {
      e.preventDefault();
      this.openSonstigesModal(cell);
      return;
    }

    // H: open Fehltage input
    if (key === 'H') {
      e.preventDefault();
      this.promptFehltage(cell);
      return;
    }

    // O: "Keine Beanstandungen" (bulk if selected)
    if (key === 'O') {
      e.preventDefault();
      const targets = this._getSelectedOrFocused();
      if (targets.length > 1) { this._bulkOk(targets); this.clearSelection(); }
      else {
        const keId = parseInt(cell.dataset.ke);
        const aj = parseInt(cell.dataset.aj);
        const kw = parseInt(cell.dataset.kw);
        this.persistCodes(keId, aj, kw, '', 0);
        this.updateCellVisual(cell, '', 0);
        cell.classList.add('kw-ok', 'kw-session');
        cell.classList.remove('kw-issue');
        this.showFeedback(cell, '✓ OK');
      }
      return;
    }

    // Number keys 1-5 as shortcut for H (Fehltage) — bulk if selected
    if ('12345'.includes(e.key) && !this.activePopover) {
      e.preventDefault();
      const val = parseInt(e.key);
      const targets = this._getSelectedOrFocused();
      if (targets.length > 1) { this._bulkSetFehltage(targets, val); this.clearSelection(); }
      else {
        const keId = parseInt(cell.dataset.ke);
        const aj = parseInt(cell.dataset.aj);
        const kw = parseInt(cell.dataset.kw);
        let currentCodes = (cell.dataset.codes || '').split(',').filter(Boolean);
        if (!currentCodes.includes('H')) { currentCodes.push('H'); currentCodes.sort(); }
        const codesStr = currentCodes.join(',');
        this.persistCodes(keId, aj, kw, codesStr, val);
        this.updateCellVisual(cell, codesStr, val);
        this.showFeedback(cell, `H:${val}`);
      }
      return;
    }

    // 0: remove Fehltage — bulk if selected
    if (e.key === '0' && !this.activePopover) {
      e.preventDefault();
      const targets = this._getSelectedOrFocused();
      if (targets.length > 1) { this._bulkSetFehltage(targets, 0); this.clearSelection(); }
      else {
        const keId = parseInt(cell.dataset.ke);
        const aj = parseInt(cell.dataset.aj);
        const kw = parseInt(cell.dataset.kw);
        let currentCodes = (cell.dataset.codes || '').split(',').filter(c => c && c !== 'H');
        const codesStr = currentCodes.join(',');
        this.persistCodes(keId, aj, kw, codesStr, 0);
        this.updateCellVisual(cell, codesStr, 0);
        this.showFeedback(cell, '−H');
      }
      return;
    }
  }
};
