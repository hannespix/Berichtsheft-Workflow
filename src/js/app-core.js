// ╔══════════════════════════════════════════════════════════════╗
// ║  BERICHTSHEFTKONTROLLE – Main Application                   ║
// ╚══════════════════════════════════════════════════════════════╝

const App = {
  db: null,
  dbFileHandle: null,
  dbLastModified: null,
  _sqlJsFactory: null, // Cached sql.js factory (avoids re-loading WASM)
  async _getSqlJs() {
    if (!this._sqlJsFactory) {
      this._sqlJsFactory = await initSqlJs({
        locateFile: file => `libs/${file}`,
        ...(window.__SQL_WASM_BINARY ? { wasmBinary: window.__SQL_WASM_BINARY } : {})
      });
    }
    return this._sqlJsFactory;
  },
  currentView: 'dashboard',
  filterJahrgang: [], // Empty = all, otherwise array of jahrgang IDs
  filterAmt: [],     // Empty = all, otherwise array of amt codes (strings like '93')
  filterBavStatus: 'aktiv', // 'aktiv' = not Ende (default), 'alle' = all, 'ende' = only Ende
  filterZp: [], // Empty = all, otherwise array of ZP codes (e.g. ['H2026','F2027'])
  currentUser: '', // Active Sachbearbeiter name

  // ── Per-User localStorage ──
  uKey(key) { return this.currentUser ? `bhk_${this.currentUser.replace(/\s+/g,'_')}_${key}` : `bhk_${key}`; },
  uGet(key, fallback) { try { return localStorage.getItem(this.uKey(key)) ?? fallback ?? null; } catch(e) { return fallback ?? null; } },
  uSet(key, val) { try { localStorage.setItem(this.uKey(key), val); } catch(e) {} },
  uRemove(key) { try { localStorage.removeItem(this.uKey(key)); } catch(e) {} },

  _populateUserSelect() {
    const sel = document.getElementById('topbarUserSelect');
    if (!sel || !this.db) return;
    const pruefer = this.query('SELECT name FROM pruefer WHERE aktiv=1 ORDER BY name');
    const u = this.currentUser;
    sel.innerHTML = '<option value="">👤 Prüfer wählen</option>' + pruefer.map(p =>
      `<option value="${esc(p.name)}" ${p.name === u ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');
    sel.classList.toggle('has-user', !!u);
  },

  switchUser(name) {
    this.currentUser = name;
    try { localStorage.setItem('bhk_current_user', name); } catch(e) {}
    this._restoreUserSettings();
    this._populateUserSelect();
    // Sync Kontrolle-Prüfer
    if (typeof KontrolleHandler !== 'undefined') {
      KontrolleHandler.activePruefer = name;
      if (KontrolleHandler.currentTerminId) {
        KontrolleHandler.setActivePruefer(name);
        if (this.currentView === 'kontrolle') KontrolleHandler.renderSchueler();
      }
    }
    this.toast(name ? `👤 ${name}` : 'Kein Benutzer', 'info');
  },

  _restoreUserSettings() {
    this._applySidebarVisibility();
    this._restoreSidebarState();
    this._restoreFilterPanel();
    const w = this.uGet('sidebar_w');
    if (w) { const sb = document.getElementById('sidebarNav'); if (sb) sb.style.width = w + 'px'; }
    const dark = this.uGet('dark');
    if (dark !== null) document.body.classList.toggle('dark-mode', dark === '1');
  },

  cycleBavFilter() { this.toggleBavDropdown(); }, // legacy compat
  toggleBavDropdown() {
    const dd = document.getElementById('bavFilterDropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    this._closeAllFilterDropdowns();
    if (!isOpen) dd.style.display = 'block';
  },
  setBavFilter(val) {
    this.filterBavStatus = val;
    const btn = document.getElementById('bavFilterBtn');
    const labels = {aktiv:'📋 Aktive BAV ▾', alle:'📋 Alle BAV ▾', ende:'📋 Beendete BAV ▾'};
    if (btn) {
      btn.textContent = labels[val];
      btn.classList.toggle('active', val !== 'aktiv');
    }
    ['aktiv','alle','ende'].forEach(k => {
      const el = document.getElementById('bavOpt_' + k);
      if (el) el.textContent = k === val ? '✓' : '';
    });
    document.getElementById('bavFilterDropdown').style.display = 'none';
    this._updateFilterCount();
    this.renderCurrentView();
  },

  // Zuständiges Amt → Name lookup
  AEMTER: {
    '01':'Böblingen','02':'Esslingen','03':'Göppingen','04':'Heidenheim','05':'Heilbronn',
    '06':'Hohenlohekreis','07':'Ludwigsburg','08':'Main-Tauber','09':'Ostalbkreis','10':'Rems-Murr',
    '11':'Schwäb. Hall','12':'Calw','13':'Enzkreis','14':'Freudenstadt','15':'Karlsruhe',
    '16':'Neckar-Odenwald','17':'Rastatt','18':'Rhein-Neckar','19':'Brsg-Hochschw.','20':'Emmendingen',
    '21':'Konstanz','22':'Lörrach','23':'Ortenaukreis','24':'Rottweil','25':'Schwarzw-Baar',
    '26':'Tuttlingen','27':'Waldshut','28':'Alb-Donau','29':'Biberach','30':'Bodenseekreis',
    '31':'Ravensburg','32':'Reutlingen','33':'Sigmaringen','34':'Tübingen','35':'Zollernalbkreis',
    '90':'RP Tübingen','91':'RP Stuttgart','92':'RP Karlsruhe','93':'RP Freiburg'
  },
  amtLabel(code) { return code ? `${code} ${this.AEMTER[code]||'?'}` : '–'; },
  // Prefix → Label (einheitlich für AP und ZP)
  _prefixLabel(code) {
    if (!code) return '';
    const map = { S: 'Sommer', W: 'Winter', F: 'Frühjahr', H: 'Herbst' };
    const p = code[0];
    return map[p] || '';
  },
  zpLabel(code) {
    if (!code) return '–';
    const lbl = this._prefixLabel(code);
    return lbl ? code + ' (' + lbl + ' ' + code.substring(1) + ')' : code;
  },
  jgLabel(bez) {
    if (!bez) return '–';
    const lbl = this._prefixLabel(bez);
    return lbl ? bez + ' (' + lbl + ' ' + bez.substring(1) + ')' : bez;
  },

  setJgFilter(val) {
    // Called from dropdown checkboxes
    this._updateJgButton();
    const dd = document.getElementById('jgFilterDropdown');
    // Don't close on checkbox click
    this.renderCurrentView();
  },

  _closeAllFilterDropdowns() {
    ['jgFilterDropdown','bgFilterDropdown','amtFilterDropdown','bavFilterDropdown'].forEach(id => {
      const dd = document.getElementById(id);
      if (dd) dd.style.display = 'none';
    });
  },

  toggleJgDropdown() {
    const dd = document.getElementById('jgFilterDropdown');
    if (!dd) return;
    const wasOpen = dd.style.display !== 'none';
    this._closeAllFilterDropdowns();
    if (!wasOpen) {
      this.refreshJgDropdown();
      dd.style.display = '';
      setTimeout(() => {
        const closer = (e) => {
          if (!dd.contains(e.target) && e.target.id !== 'jgFilterBtn') {
            dd.style.display = 'none';
            document.removeEventListener('click', closer);
          }
        };
        document.addEventListener('click', closer);
      }, 10);
    }
  },

  _applyJgExclusive(source) {
    if (source === 'ap') {
      // AP changed → deactivate ZP
      const checkedJg = [...document.querySelectorAll('.chk-jg:checked')].map(c => parseInt(c.value));
      const allJgCount = document.querySelectorAll('.chk-jg').length;
      this.filterJahrgang = checkedJg.length === allJgCount ? [] : (checkedJg.length === 0 ? [-1] : checkedJg);
      this.filterZp = []; // clear ZP
    } else {
      // ZP changed → deactivate AP
      const checkedZp = [...document.querySelectorAll('.chk-zp:checked')].map(c => c.value);
      const allZpCount = document.querySelectorAll('.chk-zp').length;
      this.filterZp = checkedZp.length === allZpCount ? [] : (checkedZp.length === 0 ? ['---'] : checkedZp);
      this.filterJahrgang = []; // clear AP
    }
    this.refreshJgDropdown(); // rebuild UI to show disabled state
    this._updateFilterCount();
    this.renderCurrentView();
  },

  // Legacy compat
  _applyJgFilter() { this._applyJgExclusive('ap'); },
  _updateZpFromJgDropdown() { this._applyJgExclusive('zp'); },

  _toggleJgAll() {
    const isAll = this.filterJahrgang.length === 0 && this.filterZp.length === 0;
    if (isAll) {
      // All selected → select none
      this.filterJahrgang = [-1];
      this.filterZp = ['---'];
    } else {
      // Some or none → select all
      this.filterJahrgang = [];
      this.filterZp = [];
    }
    this._updateJgButton();
    this.refreshJgDropdown();
    this._updateFilterCount();
    this.renderCurrentView();
  },

  _updateJgButton() {
    const btn = document.getElementById('jgFilterBtn');
    if (!btn) return;
    const jg = this.filterJahrgang;
    const zp = this.filterZp;
    const jgActive = jg.length > 0;
    const zpActive = zp.length > 0;
    if (!jgActive && !zpActive) {
      btn.textContent = '📅 Alle Jahrgänge ▾';
      btn.classList.remove('active');
    } else {
      const parts = [];
      if (jgActive && jg[0] !== -1) {
        if (jg.length === 1) {
          parts.push(this.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jg[0]]) || '?');
        } else { parts.push(jg.length + ' AP'); }
      } else if (jg[0] === -1) { parts.push('Keine AP'); }
      if (zpActive && zp[0] !== '---') {
        parts.push(zp.length === 1 ? zp[0] : zp.length + ' ZP');
      } else if (zp[0] === '---') { parts.push('Keine ZP'); }
      btn.textContent = '📅 ' + parts.join(' + ') + ' ▾';
      btn.classList.add('active');
    }
  },

  // ── Berufsgruppen Filter (hierarchical: Gruppe → Fachrichtungen) ──
  filterFachrichtungen: [], // Empty = all, otherwise array of fachrichtung IDs

  toggleBgDropdown() {
    const dd = document.getElementById('bgFilterDropdown');
    if (!dd) return;
    const wasOpen = dd.style.display !== 'none';
    this._closeAllFilterDropdowns();
    if (!wasOpen) {
      this.refreshBgDropdown();
      dd.style.display = '';
      setTimeout(() => {
        const closer = (e) => {
          if (!dd.contains(e.target) && e.target.id !== 'bgFilterBtn') {
            dd.style.display = 'none';
            document.removeEventListener('click', closer);
          }
        };
        document.addEventListener('click', closer);
      }, 10);
    }
  },

  refreshBgDropdown() {
    const dd = document.getElementById('bgFilterDropdown');
    if (!dd || !this.db) return;
    const allFR = this.query('SELECT * FROM fachrichtungen ORDER BY typ, code');
    // Map Fachwerker → parent group
    const gruppeOf = (typ) => typ === 'Fachwerker' ? 'Gärtner' : typ;
    const groups = {}; // gruppe → [{typ, frs: [...]}]
    allFR.forEach(fr => {
      const grp = gruppeOf(fr.typ);
      if (!groups[grp]) groups[grp] = {};
      if (!groups[grp][fr.typ]) groups[grp][fr.typ] = [];
      groups[grp][fr.typ].push(fr);
    });
    const active = this.filterFachrichtungen;
    const isAll = active.length === 0;

    dd.innerHTML = `
      <div style="padding:4px 12px;border-bottom:1px solid var(--clr-sand)">
        <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
          <input type="checkbox" ${isAll ? 'checked' : ''} onchange="App._toggleBgAll()" style="accent-color:var(--clr-forest)"> Alle / Keine
        </label>
      </div>
      ${Object.entries(groups).map(([grp, subGroups]) => {
        const allFrs = Object.values(subGroups).flat();
        const groupIds = allFrs.map(f => f.id);
        const allChecked = isAll || groupIds.every(id => active.includes(id));
        const someChecked = !allChecked && groupIds.some(id => active.includes(id));
        const expanded = this._bgExpanded && this._bgExpanded[grp];
        const subTyps = Object.keys(subGroups).sort((a,b) => a === grp ? -1 : b === grp ? 1 : a.localeCompare(b));
        const hasSubGroups = subTyps.length > 1;
        return `<div style="border-bottom:1px solid var(--clr-sand-light)">
          <div style="display:flex;align-items:center;gap:4px;padding:5px 12px;cursor:pointer" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
            <input type="checkbox" class="chk-bg-group" data-typ="${esc(grp)}" data-ids="${groupIds.join(',')}" ${allChecked ? 'checked' : ''} ${someChecked ? 'style="accent-color:var(--clr-amber)"' : 'style="accent-color:var(--clr-forest)"'} onchange="App._toggleBgGroup(this)">
            <span onclick="App._toggleBgExpand('${esc(grp)}');event.stopPropagation()" style="flex:1;font-size:12px;font-weight:600;color:var(--clr-forest-dark);cursor:pointer">${esc(grp)}</span>
            <span style="font-size:10px;color:var(--clr-text-light)">${allFrs.length}</span>
            <span onclick="App._toggleBgExpand('${esc(grp)}');event.stopPropagation()" style="font-size:10px;cursor:pointer;color:var(--clr-text-light);width:14px;text-align:center">${expanded ? '▾' : '▸'}</span>
          </div>
          <div style="display:${expanded ? 'block' : 'none'};padding-left:20px;padding-bottom:4px;background:var(--clr-warm)">
            ${subTyps.map(typ => {
              const frs = subGroups[typ];
              const subLabel = hasSubGroups ? (typ === grp ? grp : typ) : null;
              return (subLabel ? `<div style="font-size:9px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;letter-spacing:0.04em;padding:4px 8px 1px;margin-top:2px">${esc(subLabel)}</div>` : '') +
              frs.map(fr => `<label style="display:flex;align-items:center;gap:5px;padding:2px 12px 2px 8px;cursor:pointer;font-size:11px" onmouseenter="this.style.background='rgba(0,0,0,0.03)'" onmouseleave="this.style.background=''">
                <input type="checkbox" class="chk-bg-fr" value="${fr.id}" data-typ="${esc(grp)}" ${isAll || active.includes(fr.id) ? 'checked' : ''} onchange="App._onBgFrChange('${esc(grp)}')" style="accent-color:var(--clr-forest);width:13px;height:13px">
                <span style="color:#555">${esc(fr.bezeichnung)}</span>
                <span style="margin-left:auto;font-size:9px;color:var(--clr-text-light)">${esc(fr.code)}</span>
              </label>`).join('');
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    `;
  },

  _bgExpanded: {},

  _toggleBgExpand(typ) {
    this._bgExpanded[typ] = !this._bgExpanded[typ];
    this.refreshBgDropdown();
  },

  _toggleBgGroup(cb) {
    const ids = cb.dataset.ids.split(',').map(Number);
    const checked = cb.checked;
    // Get all currently checked FR IDs
    const allFRchecked = [...document.querySelectorAll('.chk-bg-fr:checked')].map(c => parseInt(c.value));
    let newSet;
    if (checked) {
      newSet = [...new Set([...allFRchecked, ...ids])];
    } else {
      newSet = allFRchecked.filter(id => !ids.includes(id));
    }
    const allCount = document.querySelectorAll('.chk-bg-fr').length;
    this.filterFachrichtungen = newSet.length === allCount ? [] : (newSet.length === 0 ? [-1] : newSet);
    this.refreshBgDropdown();
    this._updateBgButton();
    this.renderCurrentView();
  },

  _onBgFrChange(typ) {
    // Gather all checked FR IDs
    const allChecked = [...document.querySelectorAll('.chk-bg-fr:checked')].map(c => parseInt(c.value));
    const allCount = document.querySelectorAll('.chk-bg-fr').length;
    this.filterFachrichtungen = allChecked.length === allCount ? [] : (allChecked.length === 0 ? [-1] : allChecked);
    // Update group checkbox
    const grpCb = document.querySelector(`.chk-bg-group[data-typ="${typ}"]`);
    if (grpCb) {
      const grpIds = grpCb.dataset.ids.split(',').map(Number);
      const grpChecked = grpIds.filter(id => allChecked.includes(id));
      grpCb.checked = grpChecked.length === grpIds.length;
      grpCb.indeterminate = grpChecked.length > 0 && grpChecked.length < grpIds.length;
    }
    this._updateBgButton();
    this.renderCurrentView();
  },

  _applyBgFilter() {
    this._updateBgButton();
    this.refreshBgDropdown();
    this._updateFilterCount();
    this.renderCurrentView();
  },

  _toggleBgAll() {
    if (this.filterFachrichtungen.length === 0) {
      // All selected → select none
      this.filterFachrichtungen = [-1]; // impossible ID = nothing matches
    } else {
      // Some/none selected → select all
      this.filterFachrichtungen = [];
    }
    this._applyBgFilter();
  },

  _updateBgButton() {
    const btn = document.getElementById('bgFilterBtn');
    if (!btn) return;
    const f = this.filterFachrichtungen;
    if (f.length === 0) {
      btn.textContent = '🌿 Alle Berufe ▾';
      btn.classList.remove('active');
    } else if (f.length === 1 && f[0] === -1) {
      btn.textContent = '🌿 Keine Berufe ▾';
      btn.classList.add('active');
    } else {
      const allFR = this.db ? this.query('SELECT * FROM fachrichtungen') : [];
      const gruppeOf = (typ) => typ === 'Fachwerker' ? 'Gärtner' : typ;
      const groups = {};
      allFR.forEach(fr => { const g = gruppeOf(fr.typ); if (!groups[g]) groups[g] = []; groups[g].push(fr.id); });
      let label = null;
      for (const [grp, ids] of Object.entries(groups)) {
        if (ids.length === f.length && ids.every(id => f.includes(id))) { label = grp; break; }
      }
      if (!label && f.length <= 3) {
        const names = allFR.filter(fr => f.includes(fr.id)).map(fr => (fr.typ === 'Fachwerker' ? 'FW: ' : '') + fr.bezeichnung);
        label = names.join(', ');
        if (label.length > 22) label = f.length + ' Berufe';
      }
      btn.textContent = '🌿 ' + (label || f.length + ' Berufe') + ' ▾';
      btn.classList.add('active');
    }
  },

  // ── Zuständiges Amt filter ──
  toggleAmtDropdown() {
    const dd = document.getElementById('amtFilterDropdown');
    const wasOpen = dd.style.display !== 'none';
    this._closeAllFilterDropdowns();
    if (!wasOpen) {
      // Get unique amt codes from schueler
      const codes = this.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE zustaendiges_amt != '' ORDER BY zustaendiges_amt").map(r => r.zustaendiges_amt);
      const active = this.filterAmt;
      const isAll = active.length === 0;

      dd.innerHTML = `
        <div style="padding:4px 12px;border-bottom:1px solid var(--clr-sand)">
          <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
            <input type="checkbox" ${isAll ? 'checked' : ''} onchange="App._toggleAmtAll(this.checked)"> Alle / Keine
          </label>
        </div>
        ${codes.map(c => `<div style="padding:3px 12px">
          <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" class="chk-amt" value="${c}" ${isAll || active.includes(c) ? 'checked' : ''} onchange="App._updateAmtFilter()">
            <strong>${c}</strong> ${esc(this.AEMTER[c]||'?')}
          </label>
        </div>`).join('')}
      `;
      dd.style.display = 'block';
      setTimeout(() => {
        document.addEventListener('click', function handler(e) {
          if (!dd.contains(e.target) && e.target.id !== 'amtFilterBtn') {
            dd.style.display = 'none'; document.removeEventListener('click', handler);
          }
        });
      }, 10);
    }
  },
  _toggleAmtAll(checked) {
    document.querySelectorAll('.chk-amt').forEach(c => c.checked = checked);
    this._updateAmtFilter();
  },
  _updateAmtFilter() {
    const all = [...document.querySelectorAll('.chk-amt')];
    const checked = all.filter(c => c.checked).map(c => c.value);
    const allCount = all.length;
    this.filterAmt = checked.length === allCount ? [] : (checked.length === 0 ? ['-1'] : checked);
    this._updateAmtButton();
    this._updateFilterCount();
    this.renderCurrentView();
  },
  _applyAmtFilter() { this._updateAmtButton(); this._updateFilterCount(); this.renderCurrentView(); },
  _updateAmtButton() {
    const btn = document.getElementById('amtFilterBtn');
    if (!btn) return;
    const f = this.filterAmt;
    if (f.length === 0) {
      btn.textContent = '🏛 Alle Ämter ▾';
      btn.classList.remove('active');
    } else if (f.length === 1 && f[0] === '-1') {
      btn.textContent = '🏛 Kein Amt ▾';
      btn.classList.add('active');
    } else if (f.length === 1) {
      btn.textContent = '🏛 ' + this.amtLabel(f[0]) + ' ▾';
      btn.classList.add('active');
    } else {
      btn.textContent = '🏛 ' + f.length + ' Ämter ▾';
      btn.classList.add('active');
    }
  },

  // ── Zwischenprüfung filter ──
  toggleZpDropdown() {
    const dd = document.getElementById('zpFilterDropdown');
    const wasOpen = dd.style.display !== 'none';
    this._closeAllFilterDropdowns();
    if (!wasOpen) {
      const codes = this.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != '' ORDER BY zwischenpruefung").map(r => r.zwischenpruefung);
      const active = this.filterZp;
      const isAll = active.length === 0;
      const zpLabel = (c) => App.zpLabel(c);
      dd.innerHTML = `
        <div style="padding:4px 12px;border-bottom:1px solid var(--clr-sand)">
          <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
            <input type="checkbox" ${isAll ? 'checked' : ''} onchange="App._toggleZpAll(this.checked)"> Alle / Keine
          </label>
        </div>
        ${codes.map(c => `<div style="padding:3px 12px">
          <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" class="chk-zp" value="${esc(c)}" ${isAll || active.includes(c) ? 'checked' : ''} onchange="App._updateZpFilter()">
            ${zpLabel(c)}
          </label>
        </div>`).join('')}
      `;
      dd.style.display = 'block';
      setTimeout(() => {
        document.addEventListener('click', function handler(e) {
          if (!dd.contains(e.target) && e.target.id !== 'zpFilterBtn') {
            dd.style.display = 'none'; document.removeEventListener('click', handler);
          }
        });
      }, 10);
    }
  },
  _toggleZpAll(checked) {
    document.querySelectorAll('.chk-zp').forEach(c => c.checked = checked);
    this._updateZpFilter();
  },
  _updateZpFilter() {
    const all = [...document.querySelectorAll('.chk-zp')];
    const checked = all.filter(c => c.checked).map(c => c.value);
    const allCount = all.length;
    this.filterZp = checked.length === allCount ? [] : (checked.length === 0 ? ['---'] : checked);
    this._updateZpButton();
    this._updateFilterCount();
    this.renderCurrentView();
  },
  _applyZpFilter() { this._updateJgButton(); this._updateFilterCount(); this.renderCurrentView(); },
  _updateZpButton() { this._updateJgButton(); }, // ZP is now part of JG dropdown

  // SQL clause for Berufsgruppen filter – supports various entity types
  // bgWhere('s.fachrichtung_id')  → direct FR filter on schueler
  // bgWhere('k.fachrichtung_id')  → direct FR filter on klassen
  // bgWhere('bs.id','schule')     → schools having matching klassen
  // bgWhere('b.id','betrieb')     → betriebe having matching schueler
  // bgWhere('kt.id','termin')     → termine having matching klassen
  bgWhere(col, entity) {
    if (!this.filterFachrichtungen.length) return { where: '', params: [] };
    const ids = this.filterFachrichtungen.join(',');
    if (entity === 'schule') {
      return { where: ` AND ${col} IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 WHERE k2.fachrichtung_id IN (${ids}))`, params: [] };
    }
    if (entity === 'betrieb') {
      return { where: ` AND ${col} IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.fachrichtung_id IN (${ids}) AND s2.betrieb_id IS NOT NULL)`, params: [] };
    }
    if (entity === 'termin') {
      return { where: ` AND ${col} IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id WHERE k2.fachrichtung_id IN (${ids}))`, params: [] };
    }
    return { where: ` AND ${col} IN (${ids})`, params: [] };
  },

  // Combined global filter (JG + BG) for any entity type
  // Usage: App.gf('schueler')  → WHERE clause for s.jahrgang_id + s.fachrichtung_id
  //        App.gf('klassen')   → WHERE clause for k.jahrgang_id + k.fachrichtung_id
  //        App.gf('schulen')   → subqueries via klassen
  //        App.gf('betriebe')  → subqueries via schueler
  //        App.gf('termine')   → subqueries via kontrolltermin_klassen
  gf(entity) {
    let w = '';
    const jg = this.filterJahrgang;
    const bg = this.filterFachrichtungen;
    const amt = this.filterAmt;
    const zp = this.filterZp;
    if (entity === 'schueler' || entity === 's') {
      if (jg.length) w += ` AND s.jahrgang_id IN (${jg.join(',')})`;
      if (bg.length) w += ` AND s.fachrichtung_id IN (${bg.join(',')})`;
      if (amt.length) w += ` AND s.zustaendiges_amt IN (${amt.map(a => "'"+a+"'").join(',')})`;
      if (zp.length) w += ` AND s.zwischenpruefung IN (${zp.map(z => "'"+z+"'").join(',')})`;
      if (this.filterBavStatus === 'aktiv') w += ` AND (s.bav_status = '' OR s.bav_status NOT LIKE '%Ende%')`;
      else if (this.filterBavStatus === 'ende') w += ` AND s.bav_status LIKE '%Ende%'`;
    } else if (entity === 'klassen' || entity === 'k') {
      if (jg.length) w += ` AND k.jahrgang_id IN (${jg.join(',')})`;
      if (bg.length) w += ` AND k.fachrichtung_id IN (${bg.join(',')})`;
      if (amt.length) w += ` AND k.id IN (SELECT DISTINCT s2.klasse_id FROM schueler s2 WHERE s2.zustaendiges_amt IN (${amt.map(a => "'"+a+"'").join(',')}) AND s2.klasse_id IS NOT NULL)`;
      if (zp.length) w += ` AND k.id IN (SELECT DISTINCT s2.klasse_id FROM schueler s2 WHERE s2.zwischenpruefung IN (${zp.map(z => "'"+z+"'").join(',')}) AND s2.klasse_id IS NOT NULL)`;
    } else if (entity === 'schulen' || entity === 'bs') {
      if (jg.length) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 WHERE k2.jahrgang_id IN (${jg.join(',')}))`;
      if (bg.length) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 WHERE k2.fachrichtung_id IN (${bg.join(',')}))`;
      if (amt.length) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 JOIN schueler s2 ON s2.klasse_id=k2.id WHERE s2.zustaendiges_amt IN (${amt.map(a => "'"+a+"'").join(',')}))`;
      if (zp.length) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 JOIN schueler s2 ON s2.klasse_id=k2.id WHERE s2.zwischenpruefung IN (${zp.map(z => "'"+z+"'").join(',')}))`;
    } else if (entity === 'betriebe' || entity === 'b') {
      if (jg.length) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.jahrgang_id IN (${jg.join(',')}) AND s2.betrieb_id IS NOT NULL)`;
      if (bg.length) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.fachrichtung_id IN (${bg.join(',')}) AND s2.betrieb_id IS NOT NULL)`;
      if (amt.length) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.zustaendiges_amt IN (${amt.map(a => "'"+a+"'").join(',')}) AND s2.betrieb_id IS NOT NULL)`;
      if (zp.length) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.zwischenpruefung IN (${zp.map(z => "'"+z+"'").join(',')}) AND s2.betrieb_id IS NOT NULL)`;
    } else if (entity === 'termine' || entity === 'kt') {
      if (jg.length) w += ` AND kt.jahrgang_id IN (${jg.join(',')})`;
      if (bg.length) w += ` AND kt.id IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id WHERE k2.fachrichtung_id IN (${bg.join(',')}))`;
      if (amt.length) w += ` AND kt.id IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id JOIN schueler s2 ON s2.klasse_id=k2.id WHERE s2.zustaendiges_amt IN (${amt.map(a => "'"+a+"'").join(',')}))`;
      if (zp.length) w += ` AND kt.id IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id JOIN schueler s2 ON s2.klasse_id=k2.id WHERE s2.zwischenpruefung IN (${zp.map(z => "'"+z+"'").join(',')}))`;
    }
    return w;
  },

  // Filter indicator badge for views
  filterBadgeHtml() {
    const parts = [];
    // Combined JG+ZP badge
    if (this.filterJahrgang.length || this.filterZp.length) {
      const subParts = [];
      if (this.filterJahrgang.length) {
        if (this.filterJahrgang[0] === -1) subParts.push('Keine AP');
        else {
          const names = this.filterJahrgang.map(id => this.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [id])).filter(Boolean);
          subParts.push(names.length <= 2 ? 'AP: ' + names.join(', ') : names.length + ' AP');
        }
      }
      if (this.filterZp.length) {
        if (this.filterZp[0] === '---') subParts.push('Keine ZP');
        else subParts.push(this.filterZp.length <= 2 ? 'ZP: ' + this.filterZp.join(', ') : this.filterZp.length + ' ZP');
      }
      const hasNone = (this.filterJahrgang[0] === -1) || (this.filterZp[0] === '---');
      const bg = hasNone ? 'var(--clr-red-light)' : 'var(--clr-amber-light)';
      parts.push(`<span style="padding:3px 8px;background:${bg};border-radius:8px;font-size:11px">📅 ${esc(subParts.join(' + '))} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterJahrgang=[];App.filterZp=[];App._updateJgButton();App._updateFilterCount();App.renderCurrentView();return false" title="Jahrgangs-Filter entfernen">✕</span></span>`);
    }
    if (this.filterFachrichtungen.length) {
      if (this.filterFachrichtungen[0] === -1) {
        parts.push(`<span style="padding:3px 8px;background:var(--clr-red-light);border-radius:8px;font-size:11px">🌿 Keine Berufe <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterFachrichtungen=[];App._applyBgFilter();return false" title="Filter entfernen">✕</span></span>`);
      } else {
        const btn = document.getElementById('bgFilterBtn');
        const label = btn ? btn.textContent.replace(' ▾','').replace(/^(?:🌿|📅|🏛|📋|📝)\s*/,'').trim() : this.filterFachrichtungen.length + ' Berufe';
        parts.push(`<span style="padding:3px 8px;background:var(--clr-amber-light);border-radius:8px;font-size:11px">🌿 ${esc(label)} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterFachrichtungen=[];App._applyBgFilter();return false" title="Filter entfernen">✕</span></span>`);
      }
    }
    if (this.filterAmt.length) {
      if (this.filterAmt[0] === '-1') {
        parts.push(`<span style="padding:3px 8px;background:var(--clr-red-light);border-radius:8px;font-size:11px">🏛 Kein Amt <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterAmt=[];App._applyAmtFilter();return false" title="Filter entfernen">✕</span></span>`);
      } else {
        const label = this.filterAmt.length === 1 ? this.amtLabel(this.filterAmt[0]) : this.filterAmt.length + ' Ämter';
        parts.push(`<span style="padding:3px 8px;background:var(--clr-blue-light);border-radius:8px;font-size:11px">🏛 ${esc(label)} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterAmt=[];App._applyAmtFilter();return false" title="Filter entfernen">✕</span></span>`);
      }
    }
    if (this.filterBavStatus !== 'aktiv') {
      const bavLabel = this.filterBavStatus === 'alle' ? 'Alle BAV (inkl. beendete)' : 'Nur beendete BAV';
      parts.push(`<span style="padding:3px 8px;background:${this.filterBavStatus === 'ende' ? 'var(--clr-red-light)' : 'var(--clr-blue-light)'};border-radius:8px;font-size:11px;font-weight:600">📋 ${bavLabel} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterBavStatus='aktiv';var bb=document.getElementById('bavFilterBtn');if(bb){bb.textContent='📋 Aktive BAV';bb.style.background='rgba(255,255,255,0.15)';bb.style.fontWeight='400';}App.renderCurrentView();return false" title="Zurück auf 'Aktive BAV'">✕</span></span>`);
    }
    if (!parts.length) return '';
    return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--clr-text-light);text-transform:uppercase;letter-spacing:0.05em">Aktive Filter:</span>
      ${parts.join('')}
      ${parts.length > 1 ? `<span style="font-size:10px;color:var(--clr-forest);cursor:pointer;text-decoration:underline" onclick="App.filterFachrichtungen=[];App.filterJahrgang=[];App.filterAmt=[];App.filterZp=[];App.filterBavStatus='aktiv';var bb=document.getElementById('bavFilterBtn');if(bb){bb.textContent='📋 Aktive BAV ▾';bb.classList.remove('active');}App._updateZpButton();App._applyBgFilter();App._applyJgFilter();App._applyAmtFilter()">Alle zurücksetzen</span>` : ''}
    </div>`;
  },

  // Font scale (persisted in localStorage, not DB)
  toggleFilterPanel() {
    const panel = document.getElementById('filterPanel');
    const btn = document.getElementById('filterPanelToggle');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    btn?.classList.toggle('active', isOpen);
    try { App.uSet('filter_panel', isOpen ? '1' : ''); } catch(e) {}
  },
  _restoreFilterPanel() {
    try {
      if (App.uGet('filter_panel') === '1') {
        document.getElementById('filterPanel')?.classList.add('open');
        document.getElementById('filterPanelToggle')?.classList.add('active');
      }
    } catch(e) {}
  },
  _updateFilterCount() {
    let cnt = 0;
    if (this.filterJahrgang.length || this.filterZp.length) cnt++; // combined JG+ZP = 1 filter
    if (this.filterFachrichtungen.length) cnt++;
    if (this.filterAmt.length) cnt++;
    if (this.filterBavStatus !== 'aktiv') cnt++;
    const el = document.getElementById('filterActiveCount');
    if (el) el.textContent = cnt > 0 ? `(${cnt})` : '';
    const btn = document.getElementById('filterPanelToggle');
    if (btn) btn.style.borderColor = cnt > 0 ? 'rgba(255,200,50,0.7)' : 'rgba(255,255,255,0.3)';
  },

  // ── Dashboard Drill-Down (click chart → filter Azubi list) ──
  drillDown(where, label) {
    StammdatenTab._azubiFilter = { drillDown: { where, label } };
    StammdatenTab._azubiSearch = '';
    StammdatenTab._azubiPage = 0;
    this.navigate('stammdaten');
    setTimeout(() => {
      StammdatenTab.show('azubis', document.querySelector('.tab-btn'));
    }, 50);
    this.toast('🔍 ' + label, 'info');
  },

  // Returns SQL clause + params for filtering by jahrgang
  // usage: const {where, params} = App.jgWhere('s.jahrgang_id');
  jgWhere(col) {
    let w = '';
    if (col.includes('s.')) w = this.gf('schueler');
    else if (col.includes('kt.')) w = this.gf('termine');
    else if (col.includes('k.')) w = this.gf('klassen');
    else if (this.filterJahrgang.length) w = ` AND ${col} IN (${this.filterJahrgang.join(',')})`;
    return { where: w, params: [] };
  },

  refreshJgDropdown() {
    const dd = document.getElementById('jgFilterDropdown');
    if (!dd || !this.db) return;
    const jgs = this.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ');
    const zpCodes = this.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != '' ORDER BY zwischenpruefung").map(r => r.zwischenpruefung);
    const activeJg = this.filterJahrgang;
    const activeZp = this.filterZp;
    const isAllJg = activeJg.length === 0;
    const isAllZp = activeZp.length === 0;
    const isAll = isAllJg && isAllZp;

    // Sort ZP: group by year desc, within year alphabetically by prefix
    const zpSorted = [...zpCodes].sort((a, b) => {
      const ya = parseInt(a.substring(1)), yb = parseInt(b.substring(1));
      if (ya !== yb) return yb - ya;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

    // Determine active mode: 'all', 'ap', or 'zp'
    const mode = (!isAllJg && isAllZp) ? 'ap' : (!isAllZp && isAllJg) ? 'zp' : 'all';
    const apOff = mode === 'zp';
    const zpOff = mode === 'ap';

    let html = `<div style="padding:4px 12px;border-bottom:1px solid var(--clr-sand)">
      <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
        <input type="checkbox" ${isAll ? 'checked' : ''} onchange="App._toggleJgAll()" style="accent-color:var(--clr-forest)"> Alle (kein Filter)
      </label>
    </div>`;
    if (mode !== 'all') {
      html += `<div style="padding:3px 12px;font-size:10px;color:${mode==='zp'?'var(--clr-amber)':'var(--clr-forest)'};background:${mode==='zp'?'var(--clr-amber-light)':'var(--clr-green-light)'};border-bottom:1px solid var(--clr-sand)">⚡ ${mode==='ap'?'AP':'ZP'}-Filter aktiv – ${mode==='ap'?'ZP':'AP'} deaktiviert <span style="font-size:9px;color:var(--clr-text-light)">(entweder AP oder ZP, nicht beides)</span></div>`;
    }

    // ── AP Section ──
    html += `<div style="padding:4px 12px 2px;font-size:9px;font-weight:700;color:${apOff?'var(--clr-text-light)':'var(--clr-forest)'};text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--clr-sand);margin-top:2px">Abschlussprüfung (AP)</div>`;
    jgs.forEach(j => {
      const label = this._prefixLabel(j.bezeichnung) || j.typ;
      const chk = !apOff && (isAllJg || activeJg.includes(j.id));
      html += `<label style="display:flex;align-items:center;gap:6px;padding:2px 12px 2px 16px;cursor:pointer;font-size:12px;${apOff?'opacity:0.4':''}" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
        <input type="checkbox" class="chk-jg" value="${j.id}" ${chk?'checked':''} ${apOff?'disabled':''} onchange="App._applyJgExclusive('ap')" style="accent-color:var(--clr-forest)">
        <strong>${esc(j.bezeichnung)}</strong> <span style="color:var(--clr-text-light);font-size:10px">${label} ${j.jahr}</span>
      </label>`;
    });

    // ── ZP Section ──
    if (zpSorted.length) {
      html += `<div style="padding:4px 12px 2px;font-size:9px;font-weight:700;color:${zpOff?'var(--clr-text-light)':'var(--clr-amber)'};text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--clr-sand);margin-top:2px">Zwischenprüfung (ZP)</div>`;
      zpSorted.forEach(code => {
        const sem = this._prefixLabel(code) || code[0];
        const yr = code.substring(1);
        const chk = !zpOff && (isAllZp || activeZp.includes(code));
        html += `<label style="display:flex;align-items:center;gap:6px;padding:2px 12px 2px 16px;cursor:pointer;font-size:12px;${zpOff?'opacity:0.4':''}" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
          <input type="checkbox" class="chk-zp" value="${esc(code)}" ${chk?'checked':''} ${zpOff?'disabled':''} onchange="App._applyJgExclusive('zp')" style="accent-color:var(--clr-amber)">
          <strong>${esc(code)}</strong> <span style="color:var(--clr-text-light);font-size:10px">${sem} ${yr}</span>
        </label>`;
      });
    }

    dd.innerHTML = html;
    this._updateJgButton();
  },
  pollInterval: null,
  unsavedChanges: false,

  // ── Database Schema ──
  SCHEMA: `
    CREATE TABLE IF NOT EXISTS abschlussjahrgaenge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bezeichnung TEXT NOT NULL UNIQUE,
      typ TEXT NOT NULL DEFAULT '',
      jahr INTEGER NOT NULL,
      pruefungstermin TEXT DEFAULT '',
      aktiv INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS berufsschulen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ort TEXT DEFAULT '',
      ansprechpartner TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      email_cc TEXT DEFAULT '',
      ansprechpartner_json TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS blockplan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      berufsschule_id INTEGER REFERENCES berufsschulen(id),
      schuljahr TEXT DEFAULT '2025/2026',
      lehrjahr INTEGER DEFAULT 1,
      kalenderwoche INTEGER NOT NULL,
      UNIQUE(berufsschule_id, schuljahr, lehrjahr, kalenderwoche)
    );
    CREATE TABLE IF NOT EXISTS fachrichtungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL DEFAULT '',
      bezeichnung TEXT NOT NULL,
      typ TEXT DEFAULT 'Gärtner',
      UNIQUE(code)
    );
    CREATE TABLE IF NOT EXISTS klassen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      berufsschule_id INTEGER REFERENCES berufsschulen(id),
      jahrgang_id INTEGER REFERENCES abschlussjahrgaenge(id),
      lehrjahr INTEGER DEFAULT NULL,
      fachrichtung_id INTEGER REFERENCES fachrichtungen(id),
      klassenbezeichnung TEXT DEFAULT '',
      UNIQUE(berufsschule_id, jahrgang_id, fachrichtung_id)
    );
    CREATE TABLE IF NOT EXISTS kontrolltermin_klassen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER REFERENCES kontrolltermine(id) ON DELETE CASCADE,
      klasse_id INTEGER REFERENCES klassen(id),
      UNIQUE(kontrolltermin_id, klasse_id)
    );
    CREATE TABLE IF NOT EXISTS kontrolltermin_schueler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER REFERENCES kontrolltermine(id) ON DELETE CASCADE,
      schueler_id INTEGER REFERENCES schueler(id),
      UNIQUE(kontrolltermin_id, schueler_id)
    );
    CREATE TABLE IF NOT EXISTS betriebe (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      betriebsnummer TEXT DEFAULT '',
      name TEXT NOT NULL,
      vorname TEXT DEFAULT '',
      zusatzbezeichnung TEXT DEFAULT '',
      firma TEXT DEFAULT '',
      ansprechpartner TEXT DEFAULT '',
      strasse TEXT DEFAULT '',
      plz TEXT DEFAULT '',
      ort TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      fax TEXT DEFAULT '',
      email TEXT DEFAULT '',
      UNIQUE(betriebsnummer)
    );
    CREATE TABLE IF NOT EXISTS schueler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ibykus_id TEXT DEFAULT '',
      nachname TEXT NOT NULL,
      vorname TEXT NOT NULL,
      ausbildungsstaette TEXT DEFAULT '',
      fachrichtung_id INTEGER REFERENCES fachrichtungen(id),
      ausbildungsbeginn TEXT DEFAULT '',
      ausbildungsende TEXT DEFAULT '',
      betrieb_id INTEGER REFERENCES betriebe(id),
      klasse_id INTEGER REFERENCES klassen(id),
      jahrgang_id INTEGER REFERENCES abschlussjahrgaenge(id),
      aktiv INTEGER DEFAULT 1,
      status TEXT DEFAULT 'aktiv',
      ap_zugelassen INTEGER DEFAULT 0,
      ap_bestanden INTEGER DEFAULT 0,
      inaktiv_grund TEXT DEFAULT '',
      inaktiv_datum TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      zustaendiges_amt TEXT DEFAULT '',
      geschlecht TEXT DEFAULT '',
      schulabschluss TEXT DEFAULT '',
      pruefungserfolg TEXT DEFAULT '',
      pruefungserfolg_wdh1 TEXT DEFAULT '',
      pruefungserfolg_wdh2 TEXT DEFAULT '',
      bav_status TEXT DEFAULT '',
      zwischenpruefung TEXT DEFAULT '',
      landesfachklasse TEXT DEFAULT '',
      import_datum TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS pruefer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      email TEXT DEFAULT '',
      aktiv INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS kontrolltermine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      betrieb_id INTEGER REFERENCES betriebe(id),
      klasse_id INTEGER DEFAULT NULL REFERENCES klassen(id),
      jahrgang_id INTEGER REFERENCES abschlussjahrgaenge(id),
      geplant_datum TEXT NOT NULL,
      durchgefuehrt_datum TEXT DEFAULT '',
      pruefer TEXT DEFAULT '',
      status TEXT DEFAULT 'geplant' CHECK (status IN ('geplant','durchgefuehrt','abgesagt')),
      typ TEXT DEFAULT 'schulkontrolle' CHECK (typ IN ('schulkontrolle','einsendung')),
      bemerkung TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS kontrollergebnisse (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER REFERENCES kontrolltermine(id),
      schueler_id INTEGER REFERENCES schueler(id),
      durchsicht_nr INTEGER DEFAULT 1,
      geprueft_kws TEXT DEFAULT '{}',
      ergebnis TEXT DEFAULT '' CHECK (ergebnis IN ('','in_ordnung','nachholung_naechste_durchsicht','sachberichte_wetter_email','berichte_bis_termin_email','persoenliche_vorlage_rp','post_an_rp')),
      p_1_1_ausbildungsplan TEXT DEFAULT '' CHECK (p_1_1_ausbildungsplan IN ('','ja','nein','nicht_vorhanden')),
      p_1_4_auszubildende TEXT DEFAULT '' CHECK (p_1_4_auszubildende IN ('','ja','nein','nicht_vorhanden')),
      p_1_5_bescheinigungen TEXT DEFAULT '' CHECK (p_1_5_bescheinigungen IN ('','ja','nein','nicht_vorhanden')),
      bescheinigungen_anzahl INTEGER DEFAULT 0,
      f_1_2_vertragliche_regelungen TEXT DEFAULT '' CHECK (f_1_2_vertragliche_regelungen IN ('','ja','nein','nicht_vorhanden')),
      f_1_6_ausbildungsbetrieb TEXT DEFAULT '' CHECK (f_1_6_ausbildungsbetrieb IN ('','ja','nein','nicht_vorhanden')),
      fehltage_gesamt INTEGER DEFAULT 0,
      sachberichte_anzahl INTEGER DEFAULT 0,
      zulassung_ap INTEGER DEFAULT 0,
      pruefungsausschuss INTEGER DEFAULT 0,
      anwesend INTEGER DEFAULT 1,
      bemerkung TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime')),
      geaendert_am TEXT DEFAULT (datetime('now','localtime')),
      geaendert_von TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS aktive_sitzung (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER,
      schueler_id INTEGER,
      pruefer TEXT DEFAULT '',
      seit TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(kontrolltermin_id, pruefer)
    );
    CREATE TABLE IF NOT EXISTS kw_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER NOT NULL REFERENCES schueler(id),
      ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
      kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
      maengel_codes TEXT DEFAULT '',
      behobene_codes TEXT DEFAULT '',
      fehltage INTEGER DEFAULT 0,
      geprueft INTEGER DEFAULT 0,
      bemerkung TEXT DEFAULT '',
      erstellt_bei INTEGER DEFAULT NULL,
      behoben_bei INTEGER DEFAULT NULL,
      UNIQUE(schueler_id, ausbildungsjahr, kalenderwoche)
    );
    CREATE TABLE IF NOT EXISTS durchsicht_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrollergebnis_id INTEGER NOT NULL REFERENCES kontrollergebnisse(id),
      schueler_id INTEGER NOT NULL REFERENCES schueler(id),
      snapshot_datum TEXT NOT NULL,
      kw_daten_json TEXT DEFAULT '{}',
      geprueft_kws_json TEXT DEFAULT '{}',
      pflichtteile_json TEXT DEFAULT '{}',
      ergebnis TEXT DEFAULT '',
      bemerkung TEXT DEFAULT '',
      pruefer TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS kw_maengel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrollergebnis_id INTEGER REFERENCES kontrollergebnisse(id),
      ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
      kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
      maengel_codes TEXT DEFAULT '',
      fehltage INTEGER DEFAULT 0,
      UNIQUE(kontrollergebnis_id, ausbildungsjahr, kalenderwoche)
    );
    CREATE TABLE IF NOT EXISTS wiedervorlagen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrollergebnis_id INTEGER REFERENCES kontrollergebnisse(id),
      schueler_id INTEGER REFERENCES schueler(id),
      art TEXT DEFAULT '',
      frist_datum TEXT NOT NULL,
      erinnerung_datum TEXT DEFAULT '',
      status TEXT DEFAULT 'offen' CHECK (status IN ('offen','erledigt','ueberfaellig')),
      erledigt_datum TEXT DEFAULT '',
      erledigt_bemerkung TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime')),
      geaendert_am TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS wiedervorlage_notizen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wiedervorlage_id INTEGER REFERENCES wiedervorlagen(id),
      notiz TEXT NOT NULL,
      erstellt_von TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS einstellungen (
      schluessel TEXT PRIMARY KEY,
      wert TEXT DEFAULT ''
    );
  `,

  SEED_DATA: `
    INSERT OR IGNORE INTO fachrichtungen (code, bezeichnung, typ) VALUES
      -- Gärtner
      ('030','Gärtner (allgemein)','Gärtner'),
      ('031','Zierpflanzenbau','Gärtner'),('032','Gemüsebau','Gärtner'),
      ('033','Baumschule','Gärtner'),('034','Obstbau','Gärtner'),
      ('035','Staudengärtnerei','Gärtner'),('036','GaLaBau','Gärtner'),
      ('037','Friedhofsgärtnerei','Gärtner'),
      -- Gartenbaufachwerker
      ('170','Gartenbaufachwerker (allg.)','Fachwerker'),
      ('171','Zierpflanzenbau','Fachwerker'),('172','Gemüsebau','Fachwerker'),
      ('173','Baumschule','Fachwerker'),('174','Obstbau','Fachwerker'),
      ('175','Staudengärtnerei','Fachwerker'),('176','GaLaBau','Fachwerker'),
      ('177','Friedhofsgärtnerei','Fachwerker'),
      -- Landwirtschaft
      ('010','Landwirt','Landwirt'),
      ('015','Landwirtschaftsfachwerker/in','Landwirt'),
      -- Hauswirtschaft
      ('020','Hauswirtschafter','Hauswirtschaft'),
      ('021','Hauswirtschafter LW','Hauswirtschaft'),
      ('160','Hauswirtschaftshelfer','Hauswirtschaft'),
      ('161','Fachpraktiker/in Hauswirtschaft','Hauswirtschaft'),
      -- Winzer
      ('040','Winzer','Winzer'),
      -- Tierwirt
      ('050','Tierwirt (allgemein)','Tierwirt'),
      ('051','Tierwirt: Rinderhaltung','Tierwirt'),
      ('052','Tierwirt: Schweinehaltung','Tierwirt'),
      ('054','Tierwirt: Geflügelhaltung','Tierwirt'),
      ('055','Tierwirt: Schäferei','Tierwirt'),
      ('056','Tierwirt: Imkerei','Tierwirt'),
      -- Pferdewirt
      ('060','Pferdewirt (allgemein)','Pferdewirt'),
      ('061','Pferdewirt: Pferdezucht und -haltung','Pferdewirt'),
      ('062','Pferdewirt: Reiten','Pferdewirt'),
      ('063','Pferdewirt: Rennreiten','Pferdewirt'),
      ('064','Pferdewirt: Trabrennfahren','Pferdewirt'),
      ('065','Pferdewirt: Pferdehaltung und Service','Pferdewirt'),
      ('066','Pferdewirt: Pferdezucht','Pferdewirt'),
      ('067','Pferdewirt: Klassische Reitausbildung','Pferdewirt'),
      ('068','Pferdewirt: Pferderennen','Pferdewirt'),
      ('069','Pferdewirt: Spezialreitweisen','Pferdewirt'),
      -- Fischwirt
      ('070','Fischwirt (allgemein)','Fischwirt'),
      ('071','Fischwirt: Fischhaltung und Fischzucht','Fischwirt'),
      ('072','Fischwirt: Seen- und Flussfischerei','Fischwirt'),
      ('073','Fischwirt: Kleine Hochsee-/Küstenfischerei','Fischwirt'),
      ('074','Fischwirt: Aquakultur und Binnenfischerei','Fischwirt'),
      ('075','Fischwirt: Küstenfischerei/Hochseefischerei','Fischwirt'),
      -- Agrar / Forst
      ('080','Fachkraft Agrarservice','Agrar/Forst'),
      ('081','Pflanzentechnologe/in','Agrar/Forst'),
      ('091','Revierjäger/in','Agrar/Forst'),
      ('092','Forstwirt/in','Agrar/Forst'),
      -- Milchwirtschaft
      ('110','Molkereifachmann','Milchwirtschaft'),
      ('111','Milchtechnologe/in','Milchwirtschaft'),
      ('121','Milchwirtschaftl. Laborant/in','Milchwirtschaft');
    INSERT OR IGNORE INTO pruefer (name, email) VALUES ('Hannes Pix','hannes.pix@rpf.bwl.de'),('Christoph Zilz','christoph.zilz@rpf.bwl.de'),('Eva Dronia','eva.dronia@rpf.bwl.de');
    INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES
      ('email_freisprechung','Freisprechung.GB@rpf.bwl.de'),
      ('rp_adresse_persoenlich','Regierungspräsidium Freiburg, Abteilung 3 / Referat 31 / Herr Pix, Zimmer 411 (4. OG), Bertoldstraße 43, 79098 Freiburg'),
      ('rp_adresse_post','Regierungspräsidium Freiburg, Abteilung 3 / Referat 31 / Herr Pix, Bissierstraße 7, 79114 Freiburg');
  `,

  // ── Initialize (auto-load DB from same folder) ──
  async init() {
    // Step 1: Try to auto-load .sqlite via fetch (only works via http/https server, not file://)
    if (location.protocol !== 'file:') {
      const dbNames = ['berichtsheftkontrolle.sqlite', 'datenbank.sqlite', 'bhk.sqlite', 'kontrolle.sqlite'];
      for (const name of dbNames) {
        try {
          const resp = await fetch(`./${name}`);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            if (buf.byteLength > 0) {
              const SQL = await App._getSqlJs();
              this.db = new SQL.Database(new Uint8Array(buf));
              this.autoLoadedDbName = name;
              document.getElementById('dbFileName').textContent = `${name} (nur-lesen bis Ordner freigegeben)`;
              document.getElementById('autoSaveIndicator').textContent = 'Auto-Save: Ordner-Freigabe nötig';
              this.showApp();
              this.toast(`"${name}" automatisch geladen. Für Auto-Save bitte einmalig Ordner freigeben.`, 'success');
              this.tryRestoreWriteAccess();
              return;
            }
          }
        } catch(e) { /* fetch failed, try next name */ }
      }
    }

    // Step 2: Try auto-reconnect from stored directory handle (IndexedDB)
    if ('showDirectoryPicker' in window) {
      const stored = await this.restoreDirHandle();
      if (stored) {
        try {
          // First try queryPermission (no user gesture needed – checks if permission is still active)
          let perm = await stored.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            this.dirHandle = stored;
            await this.ensureAppDirs();
            // Try last-used DB directly
            const lastDb = this.restoreLastDb();
            if (lastDb && lastDb.dbName) {
              try {
                const targetDir = lastDb.dbPath === 'Datenbanken' && this.dbDirHandle ? this.dbDirHandle : this.dirHandle;
                const fh = await targetDir.getFileHandle(lastDb.dbName, { create: false });
                await this.loadDatabaseFromHandle(fh, lastDb.dbPath);
                return;
              } catch(e) { console.log('Last DB not found, scanning...'); }
            }
            // Fallback: scan
            const dbFiles = await this.scanForDatabases();
            if (dbFiles.length === 1) {
              await this.loadDatabaseFromHandle(dbFiles[0].handle, dbFiles[0].subDir);
              return;
            } else if (dbFiles.length > 1) {
              this.showDbSelection(dbFiles);
              return;
            }
          } else {
            // Permission not active – show quick-reconnect instead of full connect screen
            const folderName = stored.name || 'gespeicherter Ordner';
            const lastDb = this.restoreLastDb();
            const dbLabel = lastDb?.dbName || '';
            document.getElementById('connectInfo').innerHTML = `
              <div style="padding:12px;background:var(--clr-green-light);border-radius:var(--radius);border-left:4px solid var(--clr-green);margin-bottom:12px">
                ${dbLabel ? `<strong style="font-size:15px">🗄️ ${esc(dbLabel)}</strong>
                <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:6px">in ${esc(folderName)}${lastDb?.dbPath ? '/'+lastDb.dbPath : ''}</div>` :
                `<strong>📁 Ordner: "${esc(folderName)}"</strong>`}
                <div style="margin-top:6px">
                  <button class="btn btn-primary" onclick="App.reconnectStored()" style="padding:10px 24px;font-size:15px">
                    🔗 Erneut verbinden
                  </button>
                </div>
                <div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">Chrome benötigt bei jedem Neustart eine einmalige Bestätigung.</div>
              </div>`;
          }
        } catch(e) { console.log('Auto-reconnect:', e.message); }
      }
    }
    // Step 3: Show connect screen (fallback)
  },

  // Try to silently get write access using stored handle
  // Try to silently get write access using stored handle
  async reconnectStored() {
    try {
      const stored = await this.restoreDirHandle();
      if (!stored) return App.toast('Kein gespeicherter Ordner gefunden', 'error');
      const perm = await stored.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.dirHandle = stored;
        await this.ensureAppDirs();
        const lastDb = this.restoreLastDb();
        if (lastDb && lastDb.dbName) {
          try {
            const targetDir = lastDb.dbPath === 'Datenbanken' && this.dbDirHandle ? this.dbDirHandle : this.dirHandle;
            const fh = await targetDir.getFileHandle(lastDb.dbName, { create: false });
            await this.loadDatabaseFromHandle(fh, lastDb.dbPath);
            return;
          } catch(e) { /* fall through to scan */ }
        }
        const dbFiles = await this.scanForDatabases();
        if (dbFiles.length === 1) {
          await this.loadDatabaseFromHandle(dbFiles[0].handle, dbFiles[0].subDir);
        } else if (dbFiles.length > 1) {
          this.showDbSelection(dbFiles);
        } else {
          App.toast('Keine Datenbank gefunden', 'warning');
        }
      }
    } catch(e) { App.toast('Verbindung fehlgeschlagen: ' + e.message, 'error'); }
  },

  async tryRestoreWriteAccess() {
    try {
      const stored = await this.restoreDirHandle();
      if (!stored) return;
      const perm = await stored.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.dirHandle = stored;
        await this.enableWriteAccess();
      }
    } catch(e) { /* silent fail – user will grant manually */ }
  },

  // Enable write access after folder is granted
  async enableWriteAccess() {
    if (!this.dirHandle) return;
    try {
      // Find the DB file handle
      const name = this.autoLoadedDbName || 'berichtsheftkontrolle.sqlite';
      this.dbFileHandle = await this.dirHandle.getFileHandle(name, { create: false });
      const file = await this.dbFileHandle.getFile();
      this.dbLastModified = file.lastModified; this._lastFileSize = file.size;
      // Get/create _bhk dirs
      await this.ensureAppDirs();
      // Store handle for next time
      await this.storeDirHandle(this.dirHandle);
      // Update UI
      document.getElementById('dbFileName').textContent = name;
      document.getElementById('autoSaveIndicator').textContent = 'Auto-Save aktiv';
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Verbunden';
      document.getElementById('btnGrantAccess').style.display = 'none';
      this.toast('Ordner freigegeben – Auto-Save aktiviert!', 'success');
    } catch(e) {
      console.warn('enableWriteAccess failed:', e);
    }
  },

  // Grant write access (called from UI button or on first save)
  async grantFolderAccess() {
    try {
      const startIn = await this.restoreDirHandle() || 'desktop';
      this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn });
      await this.storeDirHandle(this.dirHandle);
      await this.enableWriteAccess();
      // If we have unsaved changes, save now
      if (this.unsavedChanges) this.scheduleAutoSave();
    } catch(e) {
      if (e.name !== 'AbortError') this.toast('Fehler: ' + e.message, 'error');
    }
  },

  // ── Switch DB / Disconnect ──
  switchDB() {
    App.openModal('Datenbank wechseln', `
      <p style="font-size:13px;margin-bottom:16px">Was möchten Sie tun?</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.switchToNewFolder()">
          <span style="font-size:22px">📂</span>
          <div><strong>Anderen Arbeitsordner wählen</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Ordner mit Datenbanken auswählen</div></div>
        </button>
        <button class="btn btn-secondary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.promptNewDb()">
          <span style="font-size:22px">✨</span>
          <div><strong>Neue Datenbank erstellen</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Leere DB im aktuellen Ordner anlegen</div></div>
        </button>
        <button class="btn btn-secondary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.disconnectDB()">
          <span style="font-size:22px">🔌</span>
          <div><strong>Verbindung trennen</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Zurück zum Startbildschirm</div></div>
        </button>
        ${!this.demoMode ? '' : `<button class="btn btn-secondary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.disconnectDB();App.start()">
          <span style="font-size:22px">💾</span>
          <div><strong>Echte Datenbank verbinden</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Demo beenden und Ordner wählen</div></div>
        </button>`}
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>`);
  },

  async switchToNewFolder() {
    if (this.unsavedChanges && this.dbFileHandle) {
      try { await this.doAutoSave(); } catch(e) {}
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this._cleanupDB();
      this.dirHandle = dirHandle;
      await this.storeDirHandle(dirHandle);
      await this.ensureAppDirs();
      const dbFiles = await this.scanForDatabases();
      if (dbFiles.length === 1) {
        await this.loadDatabaseFromHandle(dbFiles[0].handle, dbFiles[0].subDir);
      } else if (dbFiles.length > 1) {
        this.showDbSelection(dbFiles);
      } else {
        this.promptNewDb();
      }
    } catch(e) {
      if (e.name !== 'AbortError') this.toast('Fehler: ' + e.message, 'error');
    }
  },

  disconnectDB() {
    // Save changes first if possible
    if (this.unsavedChanges && this.dbFileHandle) {
      try { this.doAutoSave(); } catch(e) {}
    }
    this._cleanupDB();
    // Show connect screen
    document.getElementById('appMain').style.display = 'none';
    document.getElementById('connectScreen').style.display = '';
    document.getElementById('connectInfo').innerHTML = `
      <div style="padding:8px 12px;background:var(--clr-green-light);border-radius:var(--radius);font-size:12px">
        ✓ Verbindung getrennt. Wählen Sie einen Ordner mit einer .sqlite-Datei.
      </div>`;
  },

  _cleanupDB() {
    // Stop timers
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.autoSaveTimer) { clearTimeout(this.autoSaveTimer); this.autoSaveTimer = null; }
    try { if (this._syncChannel) { this._syncChannel.close(); this._syncChannel = null; } } catch(e) {}
    try { KontrolleHandler.stopLiveSync(); } catch(e) {}
    // Close DB
    if (this.db) { try { this.db.close(); } catch(e) {} }
    // Reset state
    this.db = null;
    this.dbFileHandle = null;
    this.dirHandle = null;
    this.backupsDirHandle = null;
    this.bhkDirHandle = null;
    this.dbDirHandle = null;
    this.autoLoadedDbName = null;
    this.unsavedChanges = false;
    this.demoMode = false;
    this._lastFileSize = 0;
    this._tkCache = {};
    this.filterJahrgang = [];
    this.filterFachrichtungen = [];
    this.filterBavStatus = 'aktiv';
    // Reset UI
    document.getElementById('dbFileName').textContent = '–';
    document.getElementById('dbLastSaved').textContent = '–';
    document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Getrennt';
    document.getElementById('autoSaveIndicator').textContent = '';
    document.getElementById('btnSwitchDB').style.display = 'none';
    document.getElementById('btnGrantAccess').style.display = 'none';
  },

  // ── Store/restore directory handle in IndexedDB ──
  async storeDirHandle(handle) {
    try {
      const dbReq = indexedDB.open('BHKontrolle', 1);
      dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('handles');
      const idb = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = rej; });
      const tx = idb.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'dirHandle');
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
      idb.close();
    } catch(e) { console.warn('Could not store handle:', e); }
  },

  storeLastDb(dbName, subDir) {
    try {
      localStorage.setItem('bhk_lastDb', JSON.stringify({
        dbName: dbName, dbPath: subDir || '',
        folderName: this.dirHandle?.name || '',
        lastOpened: new Date().toISOString()
      }));
    } catch(e) {}
  },

  restoreLastDb() {
    try { const r = localStorage.getItem('bhk_lastDb'); return r ? JSON.parse(r) : null; } catch(e) { return null; }
  },

  async ensureAppDirs() {
    if (!this.dirHandle) return;
    try { this.bhkDirHandle = await this.dirHandle.getDirectoryHandle('_bhk', { create: true });
      this.backupsDirHandle = await this.bhkDirHandle.getDirectoryHandle('backups', { create: true });
    } catch(e) { console.warn('_bhk/ dir failed:', e); }
    try { this.dbDirHandle = await this.dirHandle.getDirectoryHandle('Datenbanken', { create: true });
    } catch(e) { console.warn('Datenbanken/ dir failed:', e); }
  },

  async scanForDatabases() {
    const found = [];
    if (this.dbDirHandle) {
      try { for await (const entry of this.dbDirHandle.values()) {
        if (entry.kind === 'file' && (entry.name.endsWith('.sqlite') || entry.name.endsWith('.db')))
          found.push({ handle: entry, name: entry.name, subDir: 'Datenbanken' });
      }} catch(e) {}
    }
    try { for await (const entry of this.dirHandle.values()) {
      if (entry.kind === 'file' && (entry.name.endsWith('.sqlite') || entry.name.endsWith('.db')))
        if (!found.some(f => f.name === entry.name))
          found.push({ handle: entry, name: entry.name, subDir: '' });
    }} catch(e) {}
    return found;
  },

  async restoreDirHandle() {
    try {
      const dbReq = indexedDB.open('BHKontrolle', 1);
      dbReq.onupgradeneeded = () => dbReq.result.createObjectStore('handles');
      const idb = await new Promise((res, rej) => { dbReq.onsuccess = () => res(dbReq.result); dbReq.onerror = rej; });
      const tx = idb.transaction('handles', 'readonly');
      const handle = await new Promise((res, rej) => {
        const req = tx.objectStore('handles').get('dirHandle');
        req.onsuccess = () => res(req.result);
        req.onerror = rej;
      });
      idb.close();
      return handle || null;
    } catch(e) { return null; }
  },

  // ── Demo Mode ──
  async startDemo() {
    try {
      const SQL = await App._getSqlJs();
      this.db = new SQL.Database();
      this.db.run(this.SCHEMA);
      this.db.run(this.SEED_DATA);
      this._generateDemoData();
      this.demoMode = true;
      document.getElementById('dbFileName').textContent = 'Demo-Modus (In-Memory)';
      document.getElementById('dbLastSaved').textContent = '';
      document.getElementById('autoSaveIndicator').textContent = 'Demo – kein Speichern';
      this.showApp();
      this.toast('Demo-Modus gestartet – Daten werden nicht gespeichert', 'warning');
    } catch(e) {
      this.toast('Demo-Fehler: ' + e.message, 'error');
      console.error(e);
    }
  },

  _generateDemoData() {
    const db = this.db;
    const r = (arr) => arr[Math.floor(Math.random()*arr.length)];
    const ri = (min,max) => Math.floor(Math.random()*(max-min+1))+min;

    // ── Jahrgänge ──
    db.run("INSERT INTO abschlussjahrgaenge (bezeichnung,typ,jahr,pruefungstermin,aktiv) VALUES ('S2026','Sommer',2026,'2026-06-10',0)");
    db.run("INSERT INTO abschlussjahrgaenge (bezeichnung,typ,jahr,pruefungstermin,aktiv) VALUES ('S2027','Sommer',2027,'2027-06-15',1)");
    db.run("INSERT INTO abschlussjahrgaenge (bezeichnung,typ,jahr,pruefungstermin) VALUES ('W2027','Winter',2027,'2027-01-20')");
    db.run("INSERT INTO abschlussjahrgaenge (bezeichnung,typ,jahr,pruefungstermin) VALUES ('S2028','Sommer',2028,'2028-06-15')");

    // ── Berufsschulen ──
    const schulen = [
      ['Edith-Stein-Schule','Freiburg','Fr. Schneider','schneider@ess-freiburg.de'],
      ['Albert-Schweitzer-Schule','Villingen-Schwenningen','Fr. Klein','klein@ass-vs.de'],
      ['CJD Offenburg','Offenburg','Hr. Weber','weber@cjd-offenburg.de'],
      ['Berufsschule Radolfzell','Radolfzell','Hr. Meier','meier@bs-radolfzell.de'],
      ['Justus-von-Liebig-Schule','Waldshut','Fr. Huber','huber@jvl-wt.de'],
    ];
    schulen.forEach(s => db.run("INSERT INTO berufsschulen (name,ort,ansprechpartner,email) VALUES (?,?,?,?)", s));

    // ── Betriebe (30 Stück, realistisch) ──
    const betriebe = [
      ['Gartenbau Schmidt GmbH','Freiburg','Hr. Schmidt','schmidt@gartenbau-schmidt.de','0761-12345'],
      ['Landschaftspflege Huber','Emmendingen','Hr. Huber','huber@lp-huber.de','07641-98765'],
      ['Grünplan AG','Freiburg','Fr. Grün','info@gruenplan.de','0761-55544'],
      ['Naturstein & Garten OHG','Breisach','Hr. Stein','stein@naturgarten.de','07667-1234'],
      ['Parkpflege Freiburg GmbH','Freiburg','Fr. Park','park@parkpflege-fr.de','0761-77788'],
      ['Gärtnerei Sonnenschein','Offenburg','Hr. Sonne','info@gaertnerei-sonnenschein.de','0781-4455'],
      ['Rosenhof Müller','Lahr','Hr. Müller','mueller@rosenhof.de','07821-6677'],
      ['Blumen Breisgau','March','Fr. Blume','blume@blumen-breisgau.de','07665-1122'],
      ['Baumschule Schwarzwald','Kirchzarten','Hr. Baum','baum@baumschule-sw.de','07661-3344'],
      ['Friedhofsgärtnerei Weber','Villingen','Hr. Weber','weber@fg-villingen.de','07721-5566'],
      ['Garten & Landschaft Süd','Lörrach','Hr. Süd','sued@gala-loerrach.de','07621-7788'],
      ['Staudengärtnerei Wolf','Waldkirch','Fr. Wolf','wolf@staudengaertnerei.de','07681-9900'],
      ['Gemüsebau Münstertal','Münstertal','Hr. Gemüse','info@gemuese-muenstertal.de','07636-1122'],
      ['Obstbau Kaiserstuhl','Ihringen','Hr. Obst','obst@kaiserstuhl.de','07668-3344'],
      ['GaLaBau Fischer','Titisee-Neustadt','Hr. Fischer','fischer@galabau-tn.de','07651-5566'],
      ['Grünwerk Ortenau','Kehl','Fr. Grünwerk','info@gruenwerk-kehl.de','07851-7788'],
      ['Pflanzenhof Dreisam','Buchenbach','Hr. Dreisam','dreisam@pflanzenhof.de','07661-9900'],
      ['Gartencenter Markgräflerland','Müllheim','Fr. Mark','mark@gc-muellheim.de','07631-1234'],
      ['Landschaftsbau Kinzigtal','Haslach','Hr. Kinzig','kinzig@lb-haslach.de','07832-5678'],
      ['Floristik Breisgau','Freiburg','Fr. Flora','flora@floristik-breisgau.de','0761-8899'],
      ['Garten Erlebnis GmbH','Waldshut-Tiengen','Hr. Erlebnis','info@garten-erlebnis.de','07751-2233'],
      ['Hegau Gartenbau','Singen','Fr. Hegau','hegau@hegau-gartenbau.de','07731-4455'],
      ['Bodensee Grün','Überlingen','Hr. Bodensee','info@bodensee-gruen.de','07551-6677'],
      ['Wiesental Gärten','Schopfheim','Hr. Wiese','wiese@wiesental-gaerten.de','07622-8899'],
      ['Schwarzwald Garten','St. Georgen','Fr. Schwarz','schwarz@sw-garten.de','07724-1100'],
    ];
    betriebe.forEach((b, i) => db.run("INSERT INTO betriebe (betriebsnummer,name,ort,ansprechpartner,email,telefon) VALUES (?,?,?,?,?,?)", ['DEMO-'+String(i+1).padStart(3,'0'), ...b]));

    // ── FR distribution: ~72% GaLaBau, 8% FW (GaLa+Zierpfl+Friedh), 20% sonstige Gärtner ──
    // ── FR IDs: 1=Gärtner(allg) 2=Zierpfl 3=Gemüse 4=Baumsch 5=Obstbau 6=Stauden 7=GaLaBau 8=Friedhof
    //            9=FW(allg) 10=FW Zierpfl ... 15=FW GaLaBau 16=FW Friedhof
    // ~72% GaLaBau, ~9% FW gesamt, ~19% sonstige Gärtner ──
    const frDist = [[7,72],[2,8],[4,4],[8,3],[3,2],[5,1],[6,1],[15,5],[10,2],[16,2]]; // [frId, percent]
    const amtDist = [['93',55],['23',15],['19',8],['92',5],['15',5],['01',4],['09',3],['16',3],['24',2]]; // realistic
    const nachnamen = ['Müller','Schmidt','Schneider','Fischer','Weber','Meyer','Wagner','Becker','Schulz','Hoffmann','Schäfer','Koch','Bauer','Richter','Klein','Wolf','Schröder','Neumann','Schwarz','Zimmermann','Braun','Krüger','Hofmann','Hartmann','Lange','Schmitt','Werner','Schmitz','Krause','Meier','Lehmann','Schmid','Schulze','Maier','Köhler','Herrmann','König','Walter','Peters','Möller','Keller','Jung','Hahn','Vogel','Friedrich','Günther','Frank','Berger','Winkler','Roth','Beck','Lorenz','Baumann','Franke','Albrecht','Schuster','Simon','Ludwig','Böhm','Winter','Kraus','Martin','Schubert','Jäger','Groß','Sommer','Haas','Graf','Heinrich','Brandt','Seidel','Kuhn','Pohl','Horn','Thomas','Busch','Engel','Vogt','Ott','Stein','Hansen','Ziegler','Dietrich','Bruns','Moser','Beyer','Böhme','Otto','Pfeiffer','Karl','Fuchs','Wendt','Scholz','Frey'];
    const vornamenM = ['Tim','Max','Lukas','Felix','Jonas','David','Jan','Paul','Leon','Nico','Kevin','Marcel','Tom','Philip','Alexander','Florian','Tobias','Julian','Stefan','Christian','Michael','Daniel','Andreas','Markus','Sebastian','Benjamin','Dennis','Dominik','Marco','Patrick','Oliver','Fabian','Martin','Simon','Luca','Noah','Elias','Finn','Moritz','Niklas','Robin','Erik'];
    const vornamenW = ['Anna','Lena','Sophie','Emma','Mia','Julia','Laura','Lisa','Sarah','Lea','Marie','Hannah','Johanna','Katharina','Christina','Jennifer','Sandra','Nicole','Melanie','Stefanie','Sabrina','Vanessa','Jessica','Nadine','Franziska','Lara','Nele','Amelie','Jana','Alina','Nina','Isabel','Pia','Carolin','Elena','Miriam'];

    function pickWeighted(dist) {
      const total = dist.reduce((s,[,w]) => s+w, 0);
      let roll = Math.random() * total;
      for (const [val,w] of dist) { roll -= w; if (roll <= 0) return val; }
      return dist[0][0];
    }

    // JG sizes: S2026=170(abgeschl.), S2027=185(aktiv Sommer), W2027=95(Winter), S2028=155(nächster Sommer)
    const jgConfig = [{id:3,count:170,startY:2023},{id:1,count:185,startY:2024},{id:2,count:95,startY:2024},{id:4,count:155,startY:2025}];

    // Create klassen (per school × FR × JG)
    const klassenMap = {}; // key: bsId_frId_jgId → klasseId
    let klasseId = 0;
    for (const jg of jgConfig) {
      for (let bsIdx = 1; bsIdx <= schulen.length; bsIdx++) {
        for (const [frId] of frDist.slice(0,6)) { // Top 6 FRs get klassen
          klasseId++;
          const frName = this.scalar('SELECT bezeichnung FROM fachrichtungen WHERE id=?', [frId]) || 'FR'+frId;
          const jgName = this.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jg.id]) || 'JG'+jg.id;
          const kurz = frName.length > 8 ? frName.substring(0,8)+'.' : frName;
          db.run("INSERT INTO klassen (berufsschule_id,jahrgang_id,fachrichtung_id,klassenbezeichnung) VALUES (?,?,?,?)",
            [bsIdx, jg.id, frId, kurz + ' ' + jgName]);
          klassenMap[bsIdx+'_'+frId+'_'+jg.id] = klasseId;
        }
      }
    }

    // ── Generate students ──
    let sid = 0;
    const allStudents = [];
    for (const jg of jgConfig) {
      for (let i = 0; i < jg.count; i++) {
        sid++;
        const geschl = Math.random() < 0.68 ? 'm' : 'w';
        const vn = geschl === 'm' ? r(vornamenM) : r(vornamenW);
        const nn = r(nachnamen);
        const frId = pickWeighted(frDist);
        const amt = pickWeighted(amtDist);
        const betriebIdx = ri(1, betriebe.length);
        const bsIdx = ri(1, schulen.length);
        const key = bsIdx+'_'+frId+'_'+jg.id;
        const klId = klassenMap[key] || Object.values(klassenMap)[ri(0,Object.values(klassenMap).length-1)];
        const startM = ri(8,10); // Aug-Oct
        const avBeg = jg.startY + '-' + String(startM).padStart(2,'0') + '-01';
        const dur = Math.random() < 0.08 ? 2 : 3; // 8% Verkürzer
        const endY = jg.startY + dur;
        const avEnd = endY + '-08-31';
        // Zwischenprüfung: ~1.5 Jahre nach Beginn → Herbst oder Frühjahr
        const zpY = jg.startY + 1 + (startM <= 9 ? 0 : 1);
        const zpSemester = Math.random() < 0.5 ? 'H' : 'F';
        const zp = zpSemester + (zpSemester === 'H' ? zpY : zpY + 1);
        // Schulabschluss (1-5, gewichtet: 40% HS, 35% RS, 15% ohne, 8% Abi, 2% Ausland)
        const sa = pickWeighted([['2',40],['3',35],['1',15],['4',8],['5',2]]);
        // Prüfungserfolg (nur für abgeschlossene JG S2026)
        const pe = jg.id === 3 ? (Math.random() < 0.85 ? 'bestanden' : 'nicht_bestanden') : '';
        const peW1 = pe === 'nicht_bestanden' && Math.random() < 0.6 ? 'bestanden' : '';
        // BAV-Status
        const bavSt = jg.id === 3 ? (Math.random() < 0.9 ? 'ENDE' : 'BESTAET') : 'BESTAET';
        // IBYKUS-ID
        const ibykId = 'DEMO-' + String(sid).padStart(5,'0');
        db.run("INSERT INTO schueler (nachname,vorname,ausbildungsstaette,fachrichtung_id,klasse_id,jahrgang_id,betrieb_id,geschlecht,zustaendiges_amt,ausbildungsbeginn,ausbildungsende,aktiv,zwischenpruefung,schulabschluss,pruefungserfolg,pruefungserfolg_wdh1,bav_status,ibykus_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)",
          [nn, vn, betriebe[betriebIdx-1][0], frId, klId, jg.id, betriebIdx, geschl, amt, avBeg, avEnd, zp, sa, pe, peW1, bavSt, ibykId]);
        allStudents.push({id:sid, jgId:jg.id});
      }
    }

    // ── Kontrolltermine: past (durchgeführt) + future (geplant) ──
    const pruefer = ['Hannes Pix','Christoph Zilz','Eva Dronia'];
    let tid = 0;

    // Past termine (Oct 2025 – Feb 2026)
    const pastDates = ['2025-10-15','2025-11-12','2025-11-26','2025-12-10','2026-01-14','2026-01-28','2026-02-11','2026-02-25'];
    pastDates.forEach(datum => {
      tid++;
      const bsIdx = ri(1, schulen.length);
      const prf = r(pruefer) + (Math.random() < 0.4 ? ', ' + r(pruefer) : '');
      db.run("INSERT INTO kontrolltermine (klasse_id,jahrgang_id,geplant_datum,pruefer,status) VALUES (?,?,?,?,'durchgefuehrt')",
        [ri(1,klasseId), ri(1,4), datum, prf]);
      // Link 1-2 klassen
      db.run("INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (?,?)", [tid, ri(1,klasseId)]);
      if (Math.random() < 0.3) db.run("INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (?,?)", [tid, ri(1,klasseId)]);
    });

    // Future termine (Apr 2026 – Jul 2026)
    const futureDates = ['2026-04-08','2026-04-22','2026-05-06','2026-05-20','2026-06-03','2026-06-17','2026-07-01'];
    futureDates.forEach(datum => {
      tid++;
      const bsIdx = ri(1, schulen.length);
      const prf = r(pruefer);
      db.run("INSERT INTO kontrolltermine (klasse_id,jahrgang_id,geplant_datum,pruefer,status) VALUES (?,?,?,?,'geplant')",
        [ri(1,klasseId), ri(1,4), datum, prf]);
      db.run("INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (?,?)", [tid, ri(1,klasseId)]);
      if (Math.random() < 0.5) db.run("INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (?,?)", [tid, ri(1,klasseId)]);
    });

    // ── Kontrollergebnisse for past termine ──
    const ergebnisse = ['in_ordnung','in_ordnung','in_ordnung','in_ordnung','nachholung_naechste_durchsicht','sachberichte_wetter_email','berichte_bis_termin_email','persoenliche_vorlage_rp'];
    const maengelSets = ['A,D','B,E','F','D','C,D','A,F','E,G','B','F,H','A,E,F','D,C','G,H'];
    let keId = 0;
    for (let t = 1; t <= pastDates.length; t++) {
      const studentsForTermin = allStudents.filter(() => Math.random() < 0.06).slice(0,ri(15,35));
      studentsForTermin.forEach(s => {
        keId++;
        const erg = r(ergebnisse);
        const ft = ri(0,12);
        db.run("INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis,p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,fehltage_gesamt) VALUES (?,?,?,'ja','ja',?,?)",
          [t, s.id, erg, Math.random()<0.85?'ja':'nein', ft]);
        // kw_status for beanstandungen
        if (erg !== 'in_ordnung') {
          const codes = r(maengelSets);
          const kw = ri(35,52);
          db.run("INSERT OR IGNORE INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,geprueft,erstellt_bei) VALUES (?,?,?,?,1,?)",
            [s.id, ri(1,2), kw, codes, keId]);
          db.run("INSERT OR IGNORE INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage) VALUES (?,?,?,?,?)",
            [keId, ri(1,2), kw, codes, ri(0,3)]);
        }
      });
    }

    // ── Wiedervorlagen from beanstandungen ──
    const wvArten = ['nachholung_naechste_durchsicht','sachberichte_wetter_email','berichte_bis_termin_email','persoenliche_vorlage_rp'];
    const beanst = this.query("SELECT ke.id, ke.schueler_id, ke.ergebnis FROM kontrollergebnisse ke WHERE ke.ergebnis != 'in_ordnung' AND ke.ergebnis != ''");
    let wvId = 0;
    beanst.forEach(ke => {
      if (Math.random() < 0.7) { // 70% der Beanstandungen bekommen WV
        wvId++;
        const daysOut = ri(14,90);
        const frist = new Date(Date.now() + daysOut * 86400000 * (Math.random() < 0.4 ? -1 : 1));
        const fristStr = frist.toISOString().split('T')[0];
        // Realistische Statusverteilung: 35% erledigt, 65% offen (auto→überfällig bei View)
        const isErledigt = Math.random() < 0.35;
        const status = isErledigt ? 'erledigt' : 'offen';
        const erledigtDatum = isErledigt ? new Date(frist.getTime() - ri(1,30)*86400000).toISOString().split('T')[0] : null;
        db.run("INSERT INTO wiedervorlagen (kontrollergebnis_id,schueler_id,art,frist_datum,status,erledigt_datum) VALUES (?,?,?,?,?,?)",
          [ke.id, ke.schueler_id, ke.ergebnis, fristStr, status, erledigtDatum]);
        if (Math.random() < 0.3) {
          db.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id,notiz,erstellt_von) VALUES (?,?,?)",
            [wvId, r(['Telefonisch erinnert','E-Mail an Betrieb gesendet','Azubi hat Nachreichung zugesagt','Rückmeldung ausstehend','2. Mahnung versendet','Betrieb bestätigt Nachbesserung','Termin zur Nachkontrolle vereinbart']), r(pruefer)]);
        }
      }
    });
  },

  // ══════════════════════════════════════════
  //  FOLDER-BASED DATABASE (Auto-Save + History)
  // ══════════════════════════════════════════
  dirHandle: null,       // Directory handle (user-selected folder)
  dbFileHandle: null,    // Current .sqlite file handle
  backupsDirHandle: null,// _bhk/backups/ sub-directory handle
  bhkDirHandle: null,    // _bhk/ internal app data directory
  dbDirHandle: null,     // Datenbanken/ subdirectory handle
  dbLastModified: null,
  _lastFileSize: 0,
  autoSaveTimer: null,
  autoSaveDelay: 1500,   // 1.5 seconds debounce
  saveCount: 0,
  lastBackupTime: 0,
  backupIntervalMs: 5 * 60 * 1000, // Backup every 5 minutes max

  async start() {
    try {
      const startIn = await this.restoreDirHandle() || 'desktop';
      this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn });
      await this.storeDirHandle(this.dirHandle);
      await this.ensureAppDirs();
      const dbFiles = await this.scanForDatabases();
      if (dbFiles.length === 1) {
        await this.loadDatabaseFromHandle(dbFiles[0].handle, dbFiles[0].subDir);
      } else if (dbFiles.length === 0) {
        this.promptNewDb();
      } else {
        this.showDbSelection(dbFiles);
      }
    } catch (e) {
      if (e.name !== 'AbortError') this.toast('Fehler: ' + e.message, 'error');
    }
  },

  showDbSelection(dbFiles) {
    this._dbChoices = dbFiles;
    const body = `
      <p style="font-size:13px;color:var(--clr-text-light);margin-bottom:12px">
        ${dbFiles.length} Datenbank${dbFiles.length>1?'en':''} gefunden in <strong>${esc(this.dirHandle?.name||'Ordner')}</strong>
      </p>
      ${dbFiles.map((f, i) => `
        <button class="btn btn-secondary" style="width:100%;margin-bottom:8px;text-align:left;padding:10px 14px" onclick="App.loadDatabaseFromHandle(App._dbChoices[${i}].handle,App._dbChoices[${i}].subDir);App.closeModal()">
          <div style="display:flex;align-items:center;gap:10px;width:100%">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
            <div><strong>${esc(f.name)}</strong><div style="font-size:11px;color:var(--clr-text-light)">${f.subDir?f.subDir+'/':'Hauptordner'}</div></div>
          </div>
        </button>
      `).join('')}
      <hr style="margin:12px 0;border-color:var(--clr-sand)">
      <button class="btn btn-primary" style="width:100%" onclick="App.promptNewDb();App.closeModal()">
        + Neue Datenbank erstellen
      </button>
    `;
    this.openModal('Datenbank auswählen', body);
  },

  async promptNewDb() {
    if (!this.dirHandle) {
      try {
        const startIn = await this.restoreDirHandle() || 'desktop';
        this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', startIn });
        await this.storeDirHandle(this.dirHandle);
        await this.ensureAppDirs();
      } catch(e) { if (e.name !== 'AbortError') this.toast('Abgebrochen', 'warning'); return; }
    }
    const name = prompt('Name der neuen Datenbank:', 'berichtsheftkontrolle');
    if (!name) return;
    const safeName = name.replace(/[^a-zA-Z0-9_\-\s\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df]/g, '').trim();
    if (!safeName) return this.toast('Kein gültiger Name', 'error');
    await this.createNewDb(safeName + '.sqlite');
  },

  async createNewDb(fileName) {
    fileName = fileName || 'berichtsheftkontrolle.sqlite';
    try {
      const SQL = await App._getSqlJs();
      this.db = new SQL.Database();
      this.db.run(this.SCHEMA);
      this.db.run(this.SEED_DATA);
      const year = new Date().getFullYear();
      this.db.run(`INSERT OR IGNORE INTO abschlussjahrgaenge (bezeichnung, typ, jahr, aktiv) VALUES (?, 'Sommer', ?, 1)`, [`S${year+2}`, year+2]);
      this.db.run(`INSERT OR IGNORE INTO abschlussjahrgaenge (bezeichnung, typ, jahr) VALUES (?, 'Sommer', ?)`, [`S${year+3}`, year+3]);
      await this.ensureAppDirs();
      const targetDir = this.dbDirHandle || this.dirHandle;
      const subDir = this.dbDirHandle ? 'Datenbanken' : '';
      this.dbFileHandle = await targetDir.getFileHandle(fileName, { create: true });
      await this.writeDatabaseToFile(true);
      this.storeLastDb(fileName, subDir);
      this.autoLoadedDbName = fileName;
      document.getElementById('dbFileName').textContent = fileName;
      this.showApp();
      this.toast('Neue Datenbank erstellt im Ordner', 'success');
    } catch (e) {
      this.toast('Fehler: ' + e.message, 'error');
    }
  },

  async loadDatabaseFromHandle(fileHandle, subDir) {
    try {
      this.dbFileHandle = fileHandle;
      const file = await fileHandle.getFile();
      this.dbLastModified = file.lastModified;
      this._lastFileSize = file.size;
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      this.db = new SQL.Database(new Uint8Array(buf));

      // ── Integrity check ──
      try {
        const check = this.scalar("PRAGMA integrity_check");
        if (check !== 'ok') {
          this.toast(`⚠️ Datenbank-Integritätsprüfung: ${check}. Backup wird empfohlen!`, 'warning');
          console.warn('DB integrity check failed:', check);
        }
      } catch(e) { console.warn('Integrity check error:', e); }

      document.getElementById('dbFileName').textContent = file.name;
      this.autoLoadedDbName = file.name;
      // Ensure _bhk/ dirs + use for backups
      await this.ensureAppDirs();
      // Remember which DB we opened
      this.storeLastDb(file.name, subDir || '');
      this.showApp();
      this.toast(`Datenbank "${file.name}" geladen – Auto-Save aktiv`, 'success');
    } catch (e) {
      this.toast('Fehler beim Laden: ' + e.message, 'error');
    }
  },

  // ── Auto-Save (debounced 2s after last change) ──
  scheduleAutoSave() {
    if (this.demoMode || !this.dbFileHandle) return;
    // Show "saving..." indicator
    document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Geändert…';
    // Clear previous timer, set new one
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => this.doAutoSave(), this.autoSaveDelay);
  },

  async doAutoSave() {
    if (!this.db || !this.dbFileHandle) return;
    // Cooldown after repeated failures: wait 30s before trying again
    if (this._saveCooldownUntil && Date.now() < this._saveCooldownUntil) return;
    try {
      await this.mergeAndSave();
      // Periodic backup (every 5 min)
      const now = Date.now();
      if (now - this.lastBackupTime > this.backupIntervalMs) {
        await this.createBackup();
        this.lastBackupTime = now;
      }
    } catch (e) {
      console.error('Auto-save error:', e);
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
    }
  },

  async writeDatabaseToFile(force = false) {
    if (!this.dbFileHandle || !this.db) return;
    // Respect cooldown after repeated failures
    if (this._saveCooldownUntil && Date.now() < this._saveCooldownUntil) return;
    // For force-writes (microSave, initial create): use mergeAndSave if we have dirty ops
    if (this._dirtyOps.length > 0) {
      return this.mergeAndSave(force);
    }
    // No dirty ops but force requested (e.g. initial DB creation): full write
    if (!force) return;
    try {
      const data = this.db.export();
      const writable = await this.dbFileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      const f2 = await this.dbFileHandle.getFile();
      this.dbLastModified = f2.lastModified; this._lastFileSize = f2.size;
      this.unsavedChanges = false;
      this.saveCount++;
      this._writeRetryCount = 0;
      this._saveCooldownUntil = null;
      const timeStr = new Date().toLocaleTimeString('de-DE');
      document.getElementById('dbLastSaved').textContent = `✓ ${timeStr} (#${this.saveCount})`;
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Gespeichert';
      this._broadcastChange();
      this._writeSyncMarker();
    } catch (e) {
      // Re-acquire file handle on InvalidStateError (max 3 retries)
      this._writeRetryCount = (this._writeRetryCount || 0) + 1;
      if (e.name === 'InvalidStateError' && this.dirHandle && this._writeRetryCount <= 3) {
        try {
          const oldName = this.dbFileHandle?.name || 'berichtsheftkontrolle.sqlite';
          this.dbFileHandle = await this.dirHandle.getFileHandle(oldName, { create: false });
          console.log('[Save] direct-write retry ' + this._writeRetryCount + '/3');
          return this.writeDatabaseToFile(force);
        } catch(re) { /* fall through */ }
      }
      if (this._writeRetryCount > 3) {
        console.warn('[Save] Cooldown 30s (direct write)');
        this._saveCooldownUntil = Date.now() + 30000;
      }
      this._writeRetryCount = 0;
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
      console.error('Save error:', e);
    }
  },

  // ── Backup History ──
  async createBackup() {
    if (!this.backupsDirHandle || !this.db) return;
    try {
      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const backupName = `backup_${ts}.sqlite`;
      const backupHandle = await this.backupsDirHandle.getFileHandle(backupName, { create: true });
      const data = this.db.export();
      const writable = await backupHandle.createWritable();
      await writable.write(data);
      await writable.close();
      console.log('Backup erstellt:', backupName);
      // Clean old backups (keep last 20)
      await this.cleanOldBackups(20);
    } catch (e) {
      console.warn('Backup failed:', e);
    }
  },

  async cleanOldBackups(keep) {
    if (!this.backupsDirHandle) return;
    try {
      const backups = [];
      for await (const entry of this.backupsDirHandle.values()) {
        if (entry.kind === 'file' && entry.name.startsWith('backup_') && entry.name.endsWith('.sqlite')) {
          backups.push(entry.name);
        }
      }
      backups.sort();
      const toDelete = backups.slice(0, Math.max(0, backups.length - keep));
      for (const name of toDelete) {
        await this.backupsDirHandle.removeEntry(name);
      }
    } catch (e) { /* ignore cleanup errors */ }
  },

  async reloadFromFile() {
    if (!this.dbFileHandle) return;
    const file = await this.dbFileHandle.getFile();
    const buf = await file.arrayBuffer();
    const SQL = await App._getSqlJs();
    this.db = new SQL.Database(new Uint8Array(buf));
    this.dbLastModified = file.lastModified; this._lastFileSize = file.size;
    this.unsavedChanges = false;
    this.renderCurrentView();
    this.toast('Datenbank neu geladen', 'success');
  },

  async saveDatabase() {
    if (this.demoMode) {
      this.toast('Demo-Modus: Änderungen werden nur im Speicher gehalten', 'warning');
      return;
    }
    await this.mergeAndSave(true);
    await this.createBackup();
    this.toast('Gespeichert + Backup erstellt', 'success');
  },

  startPolling() {
    if (this.demoMode) return;
    this._reconnectAttempts = 0;

    // ── BroadcastChannel: instant sync between tabs in same browser ──
    try {
      this._syncChannel = new BroadcastChannel('bhk-sync');
      this._syncChannel.onmessage = (e) => {
        if (e.data?.type === 'db-saved' && this.db && !this._mergeInProgress) {
          setTimeout(() => this._doSyncImport('broadcast'), 400);
        }
      };
    } catch(e) {}

    // ── Sync marker polling: read tiny _bhk/sync_{dbname} file instead of full DB ──
    // Only imports full DB when marker version changes
    this._syncMarkerHandle = null;
    this._lastSyncVersion = this.saveCount || 0;

    this.pollInterval = setInterval(() => {
      // Pause when tab is hidden (save resources)
      if (document.hidden) return;
      if (!this.dirHandle || this._mergeInProgress) return;
      this._pollSyncMarker();
    }, 3000);
  },

  async _pollSyncMarker() {
    try {
      // Read the tiny sync marker file (~50 bytes)
      const syncDir = this.bhkDirHandle || this.dirHandle;
      const syncName = 'sync' + (this.autoLoadedDbName ? '_' + this.autoLoadedDbName.replace(/\.sqlite$|\.db$/,'') : '');
      const handle = await syncDir.getFileHandle(syncName, { create: false });
      const file = await handle.getFile();
      const text = await file.text();
      const marker = JSON.parse(text);

      // Connection OK
      if (this._reconnectAttempts > 0) {
        this._reconnectAttempts = 0;
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Verbunden';
      }
      if (!this._syncReady) this._syncReady = true;

      // Check if another user saved (version changed)
      if (marker.v && marker.v !== this._lastSyncVersion) {
        console.log(`[Sync] Marker: v${marker.v} von ${marker.u} (lokal: v${this._lastSyncVersion})`);
        this._lastSyncVersion = marker.v;
        await this._doSyncImport('marker');
      }
    } catch(e) {
      // sync marker doesn't exist yet or read error → fall back to file size check
      if (e.name === 'NotFoundError') {
        // First run or other user hasn't saved yet – write our own marker
        this._writeSyncMarker();
        return;
      }
      this._reconnectAttempts++;
      if (this._reconnectAttempts > 5) {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Getrennt';
      }
    }
  },

  // Write sync marker after each save (~50 bytes, fast even on network)
  async _writeSyncMarker() {
    if (!this.dirHandle) return;
    try {
      const syncDir = this.bhkDirHandle || this.dirHandle;
      const syncName = 'sync' + (this.autoLoadedDbName ? '_' + this.autoLoadedDbName.replace(/\.sqlite$|\.db$/,'') : '');
      const handle = await syncDir.getFileHandle(syncName, { create: true });
      const writable = await handle.createWritable();
      const marker = { v: this.saveCount, t: new Date().toISOString(), u: KontrolleHandler?.activePruefer || '?' };
      await writable.write(JSON.stringify(marker));
      await writable.close();
      this._lastSyncVersion = this.saveCount;
    } catch(e) { /* non-critical – polling still works via DB file */ }
  },

  // ── Position file system (no DB lock needed!) ──
  // Each prüfer writes _bhk/pos-{name}.json (~80 bytes) on every student switch
  // All prüfers read each other's files during poll
  _otherPositions: [],
  _posWriteWarnCount: 0,

  async _writePositionFile(pruefer, terminId, schuelerId, schuelerName) {
    if (!this.dirHandle) return;
    const posDir = this.bhkDirHandle || this.dirHandle;
    const safeName = pruefer.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');
    try {
      const handle = await posDir.getFileHandle('pos-' + safeName + '.json', { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify({ p: pruefer, t: terminId, s: schuelerId, n: schuelerName, ts: Date.now() }));
      await writable.close();
    } catch(e) {
      if (this._posWriteWarnCount < 3) {
        console.warn('[Pos] Write failed:', e.message);
        this._posWriteWarnCount++;
      }
    }
  },

  async _readPositionFiles(myPruefer) {
    if (!this.dirHandle) return;
    const posDir = this.bhkDirHandle || this.dirHandle;
    const positions = [];
    const now = Date.now();
    try {
      for await (const [name, handle] of posDir) {
        if (!name.startsWith('pos-') || !name.endsWith('.json')) continue;
        try {
          const file = await handle.getFile();
          const data = JSON.parse(await file.text());
          if (data.p && data.p !== myPruefer && data.ts && (now - data.ts < 15 * 60 * 1000)) {
            positions.push({ pruefer: data.p, terminId: data.t, schuelerId: data.s, schuelerName: data.n, seit: new Date(data.ts).toISOString() });
          }
        } catch(e) { /* skip unreadable files */ }
      }
    } catch(e) { /* directory iteration failed */ }
    this._otherPositions = positions;
  },

  async _deletePositionFile(pruefer) {
    if (!this.dirHandle) return;
    const posDir = this.bhkDirHandle || this.dirHandle;
    const safeName = pruefer.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_');
    try {
      await posDir.removeEntry('pos-' + safeName + '.json');
    } catch(e) { /* file may not exist */ }
  },

  // Actual import: reads full DB, merges, refreshes UI
  async _doSyncImport(source) {
    if (!this.dbFileHandle || !this.dirHandle || this._mergeInProgress) return;
    try {
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Sync…';
      const handle = await this.dirHandle.getFileHandle(this.dbFileHandle.name, { create: false });
      const file = await handle.getFile();
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      const diskDb = new SQL.Database(new Uint8Array(buf));
      this._importChangeCount = 0;
      this._importFromDisk(diskDb);
      diskDb.close();
      this.dbLastModified = file.lastModified;
      this._lastFileSize = file.size;

      if (this._importChangeCount > 0) {
        console.log(`[Sync:${source}] ${this._importChangeCount} Änderungen importiert`);
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green" style="animation:syncPulse 0.6s"></span>Sync ✓';
        setTimeout(() => {
          const el = document.getElementById('dbStatusIndicator');
          if (el) el.innerHTML = '<span class="dot dot-green"></span>Verbunden';
        }, 2000);
        this._smartRefresh();
      } else {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Verbunden';
      }
    } catch(e) {
      console.warn(`[Sync:${source}] Import-Fehler:`, e.message);
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Verbunden';
    }
  },

  // Notify other tabs in the same browser that we saved
  _broadcastChange() {
    try {
      if (this._syncChannel) {
        this._syncChannel.postMessage({ type: 'db-saved', time: Date.now() });
      }
    } catch(e) { /* BroadcastChannel may be closed */ }
  },

  // Try to re-establish file access
  async tryReconnect() {
    document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Verbinde…';
    try {
      // First try: re-acquire file handle from directory (fixes InvalidStateError)
      if (this.dirHandle && this.dbFileHandle?.name) {
        try {
          this.dbFileHandle = await this.dirHandle.getFileHandle(this.dbFileHandle.name, { create: false });
          const file = await this.dbFileHandle.getFile();
          this._reconnectAttempts = 0;
          this._saveRetryCount = 0; this._saveCooldownUntil = null;
          this._hideOfflineBanner();
          this.dbLastModified = file.lastModified; this._lastFileSize = file.size;
          document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Verbunden';
          // Only show toast if last reconnect message was >5 min ago
          if (!this._lastReconnectToast || (Date.now() - this._lastReconnectToast > 300000)) {
            this.toast('Verbindung wiederhergestellt', 'success');
            this._lastReconnectToast = Date.now();
          }
          // Retry pending saves
          if (this._dirtyOps.length > 0) setTimeout(() => this.doAutoSave(), 500);
          return;
        } catch(e) { /* fall through to next method */ }
      }
      // Second try: just re-read the file (handle may still be valid for reading)
      if (this.dbFileHandle) {
        try {
          const file = await this.dbFileHandle.getFile();
          this._reconnectAttempts = 0;
          this._saveRetryCount = 0; this._saveCooldownUntil = null;
          this._hideOfflineBanner();
          this.dbLastModified = file.lastModified; this._lastFileSize = file.size;
          document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Verbunden';
          if (!this._lastReconnectToast || (Date.now() - this._lastReconnectToast > 300000)) {
            this.toast('Verbindung wiederhergestellt', 'success');
            this._lastReconnectToast = Date.now();
          }
          return;
        } catch(e) { /* fall through */ }
      }
    } catch(e) {}
    try {
      // Third try: re-validate stored directory handle
      const stored = await this.restoreDirHandle();
      if (stored) {
        const perm = await stored.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          this.dirHandle = stored;
          await this.enableWriteAccess();
          this._reconnectAttempts = 0;
          this._saveRetryCount = 0; this._saveCooldownUntil = null;
          this._hideOfflineBanner();
          this.toast('Ordner-Zugriff wiederhergestellt', 'success');
          return;
        }
      }
    } catch(e) {}
    // All failed
    this.toast('Verbindung konnte nicht hergestellt werden. Bitte Ordner erneut freigeben.', 'error');
    document.getElementById('btnGrantAccess').style.display = '';
  },

  _reconnectAttempts: 0,

  // Auto-import other prüfer's changes without losing our own
  _importChangeCount: 0,

  /**
   * Smart UI refresh after importing other user's changes
   * - Skips refresh if user is actively typing
   * - Preserves scroll position
   * - On Kontrolle: lightweight badge/status update only
   * - Shows subtle sync pulse
   */
  _smartRefresh() {
    // Don't interrupt active editing
    const active = document.activeElement;
    const isEditing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

    if (this.currentView === 'kontrolle') {
      if (KontrolleHandler._viewMode === 'uebersicht' && !isEditing) {
        KontrolleHandler.renderUebersicht();
      } else if (KontrolleHandler._viewMode === 'einzeln') {
        // Update quick-nav status (lock indicators, other prüfer positions)
        try { KontrolleHandler._updateQuickNavStatus(); } catch(e) {}
        // Update the "andere Prüfer" indicator in the header
        try { KontrolleHandler._updateAnderePrueferBar(); } catch(e) {}
      }
    } else if (!isEditing) {
      const mc = document.getElementById('mainContent');
      const scrollY = mc ? mc.scrollTop : 0;
      this.renderCurrentView();
      if (mc) requestAnimationFrame(() => { mc.scrollTop = scrollY; });
    }

    this.updateBadges();
  },

  markDirty() {
    this.unsavedChanges = true;
    if (!this.dbFileHandle && !this.demoMode) {
      // No write access yet – prompt user
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-amber"></span>Nur-Lesen';
      if (!this._writeAccessPrompted) {
        this._writeAccessPrompted = true;
        this.toast('Für Auto-Save bitte einmalig <strong><a href="#" onclick="App.grantFolderAccess();return false" style="color:var(--clr-forest);text-decoration:underline">Ordner freigeben</a></strong>', 'warning');
      }
      return;
    }
    this.scheduleAutoSave();
  },

  // ── Query helpers ──
  query(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },
  run(sql, params = []) {
    this.db.run(sql, params);
    // During bulk import: skip dirty-tracking, full-write happens at end
    if (this._bulkImport) return;
    // ── Dirty-Tracking: record the SQL + params for merge-save ──
    this._dirtyOps.push({ sql, params: [...params] });
    this.markDirty();
  },
  _bulkImport: false,
  // Run without tracking (used during merge-import to avoid re-tracking)
  _runSilent(sql, params = []) {
    this.db.run(sql, params);
  },
  // Full-write after bulk import: merge other users' changes first, then write
  async fullSave() {
    if (!this.dbFileHandle || !this.db) return;
    this._mergeInProgress = true;
    try {
      // 1) Read disk version to preserve other users' changes
      const file = await this.dbFileHandle.getFile();
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      const diskDb = new SQL.Database(new Uint8Array(buf));

      // 2) Import other users' changes INTO our in-memory DB before writing
      this._importFromDisk(diskDb);
      diskDb.close();

      // 3) NOW export our merged in-memory DB (has both our import + others' edits)
      const data = this.db.export();
      const writable = await this.dbFileHandle.createWritable();
      await writable.write(data);
      await writable.close();

      const f2 = await this.dbFileHandle.getFile();
      this.dbLastModified = f2.lastModified;
      this._lastFileSize = f2.size;
      this._dirtyOps = [];
      this.unsavedChanges = false;
      this.saveCount++;
      this._saveRetryCount = 0;
      this._saveCooldownUntil = null;
      const timeStr = new Date().toLocaleTimeString('de-DE');
      document.getElementById('dbLastSaved').textContent = `✓ ${timeStr} (#${this.saveCount})`;
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Gespeichert';
      this._broadcastChange();
      this._writeSyncMarker();
      console.log('[Save] Full-write nach Import abgeschlossen (mit Merge)');
    } catch(e) {
      console.error('[Save] fullSave error:', e);
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
    } finally {
      this._mergeInProgress = false;
    }
  },
  scalar(sql, params = []) {
    const r = this.query(sql, params);
    if (!r.length) return null;
    return Object.values(r[0])[0];
  },

  // ═══════════════════════════════════════════
  //  DIRTY-TRACKING + MERGE-SAVE
  // ═══════════════════════════════════════════
  _dirtyOps: [],        // Tracked SQL operations since last save
  _mergeInProgress: false,

  // Tables that get merged (written during Kontrolle by multiple Prüfer)
  MERGE_TABLES: ['kontrollergebnisse','kw_status','kw_maengel',
                 'wiedervorlagen','wiedervorlage_notizen','durchsicht_snapshots',
                 'kontrolltermine','kontrolltermin_schueler'],

  // Tables where we import ALL rows from disk (to see other's changes)
  SYNC_IMPORT_TABLES: ['kontrollergebnisse','kw_status'],

  /**
   * mergeAndSave() – The core sync mechanism
   * 
   * Instead of blindly overwriting the file with our full DB:
   * 1) Read the current .sqlite file from disk → diskDb
   * 2) Replay our tracked dirty operations onto diskDb
   * 3) Write diskDb back to file
   * 4) Import OTHER prüfer's changes from diskDb into our in-memory DB
   * 5) Clear dirty-tracking
   */
  async mergeAndSave(force = false) {
    if (!this.dbFileHandle || !this.db || this._mergeInProgress) return;
    if (this._dirtyOps.length === 0 && !force) return;
    // Respect cooldown after repeated failures
    if (this._saveCooldownUntil && Date.now() < this._saveCooldownUntil) return;

    this._mergeInProgress = true;
    try {
      // 1) Read disk version
      const file = await this.dbFileHandle.getFile();
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      const diskDb = new SQL.Database(new Uint8Array(buf));

      // 2) Replay our dirty ops onto diskDb
      const ops = [...this._dirtyOps]; // snapshot
      let replayErrors = 0;
      ops.forEach(op => {
        try {
          diskDb.run(op.sql, op.params);
        } catch(e) {
          // Ignore constraint violations (e.g. INSERT OR REPLACE already handled)
          replayErrors++;
          console.warn('Merge-replay skip:', e.message, op.sql.substring(0, 60));
        }
      });

      // 3) Write merged diskDb back to file
      const data = diskDb.export();
      const writable = await this.dbFileHandle.createWritable();
      await writable.write(data);
      await writable.close();

      // 4) Import other prüfer's changes into our in-memory DB
      this._importFromDisk(diskDb);

      // 5) Update timestamp + clear tracking
      const f2 = await this.dbFileHandle.getFile();
      this.dbLastModified = f2.lastModified; this._lastFileSize = f2.size;
      this._dirtyOps = [];
      this.unsavedChanges = false;
      this.saveCount++;
      this._saveRetryCount = 0;
      this._saveCooldownUntil = null;

      diskDb.close();

      // Update UI
      const timeStr = new Date().toLocaleTimeString('de-DE');
      document.getElementById('dbLastSaved').textContent = `✓ ${timeStr} (#${this.saveCount})`;
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Gespeichert';

      // Notify other tabs in same browser immediately
      this._broadcastChange();
      this._writeSyncMarker();

      if (replayErrors > 0) {
        console.log(`Merge-save: ${ops.length} ops replayed, ${replayErrors} skipped`);
      }
    } catch(e) {
      // Track consecutive failures
      this._saveRetryCount = (this._saveRetryCount || 0) + 1;

      const isStale = e.name === 'InvalidStateError' || e.message?.includes('state');
      const isPermission = e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.message?.includes('not allowed');

      // Retry up to 3 times with fresh handle (only for stale errors)
      if (isStale && this.dirHandle && this._saveRetryCount <= 3) {
        try {
          const oldName = this.dbFileHandle?.name || 'berichtsheftkontrolle.sqlite';
          this.dbFileHandle = await this.dirHandle.getFileHandle(oldName, { create: false });
          console.log('[Save] retry ' + this._saveRetryCount + '/3');
          this._mergeInProgress = false;
          return this.mergeAndSave(force);
        } catch(reacquireErr) {
          // Fall through
        }
      }

      // After 3 retries or permission error: enter cooldown (30s)
      if (this._saveRetryCount >= 3 || isPermission) {
        this._saveCooldownUntil = Date.now() + 30000;
        this._saveRetryCount = 0;
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Warte 30s…';
        console.warn('[Save] Cooldown 30s nach ' + (isPermission ? 'Permission-Error' : '3 Fehlversuchen'));
        // Try reconnect max once per minute
        const now = Date.now();
        if (!this._lastReconnectAttempt || (now - this._lastReconnectAttempt > 60000)) {
          this._lastReconnectAttempt = now;
          await this.tryReconnect();
        }
        return;
      }

      // Other errors
      if (this._saveRetryCount <= 2) {
        console.error('Merge-save error:', e);
      }
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
    } finally {
      this._mergeInProgress = false;
    }
  },

  /**
   * Import other prüfer's changes from diskDb into our in-memory DB
   * Uses timestamp + geaendert_von for intelligent conflict resolution
   */
  _conflicts: [], // [{schueler_id, schueler_name, local_pruefer, disk_pruefer, field, resolved}]

  _importFromDisk(diskDb) {
    const myPruefer = (KontrolleHandler?.activePruefer || '').toLowerCase();
    // Build set of schueler_ids with pending dirty ops (don't overwrite these!)
    const dirtySchuelerIds = new Set();
    this._dirtyOps.forEach(op => {
      const m = op.sql.match(/schueler_id[=,]\s*\?/i);
      if (m && op.params) {
        // Find the param index that corresponds to schueler_id
        const sqlBefore = op.sql.substring(0, op.sql.indexOf(m[0]));
        const paramIdx = (sqlBefore.match(/\?/g) || []).length;
        if (op.params[paramIdx]) dirtySchuelerIds.add(op.params[paramIdx]);
      }
    });

    try {
      // ── 1) kontrollergebnisse: COLUMN-LEVEL merge ──
      const diskKE = [];
      const stmtKe = diskDb.prepare('SELECT * FROM kontrollergebnisse');
      while (stmtKe.step()) diskKE.push(stmtKe.getAsObject());
      stmtKe.free();

      const mergeColumns = ['ergebnis','p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen',
        'bescheinigungen_anzahl','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb',
        'fehltage_gesamt','anwesend','bemerkung','durchsicht_nr','geprueft_kws'];

      diskKE.forEach(dke => {
        const local = this.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?',
          [dke.kontrolltermin_id, dke.schueler_id]);

        if (!local.length) {
          // Row exists on disk but not locally → import fully
          this._runSilent('INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis,p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb,fehltage_gesamt,anwesend,bemerkung,durchsicht_nr,geprueft_kws,geaendert_am,geaendert_von) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [dke.kontrolltermin_id,dke.schueler_id,dke.ergebnis,dke.p_1_1_ausbildungsplan,dke.p_1_4_auszubildende,dke.p_1_5_bescheinigungen,dke.bescheinigungen_anzahl,dke.f_1_2_vertragliche_regelungen,dke.f_1_6_ausbildungsbetrieb,dke.fehltage_gesamt,dke.anwesend,dke.bemerkung,dke.durchsicht_nr,dke.geprueft_kws,dke.geaendert_am||'',dke.geaendert_von||'']);
          this._importChangeCount++;
          return;
        }

        const lke = local[0];
        const diskVon = (dke.geaendert_von || '').toLowerCase();
        const isFromOther = diskVon && diskVon !== myPruefer;

        // Skip if disk version is from us
        if (!isFromOther) return;

        // Skip if we have pending dirty ops for this student (our save will handle it)
        if (dirtySchuelerIds.has(dke.schueler_id)) return;

        // COLUMN-LEVEL MERGE: only update columns where disk differs AND we didn't change
        const localVon = (lke.geaendert_von || '').toLowerCase();
        const weEdited = localVon === myPruefer;
        let updates = [];
        let values = [];
        let hasConflict = false;

        mergeColumns.forEach(col => {
          const diskVal = dke[col] ?? '';
          const localVal = lke[col] ?? '';
          if (String(diskVal) !== String(localVal)) {
            if (weEdited) {
              // We also edited this row – real column-level conflict!
              // For key fields (ergebnis, bemerkung), log conflict
              if (col === 'ergebnis' || col === 'bemerkung') {
                hasConflict = true;
                this._conflicts.push({
                  schueler_id: dke.schueler_id,
                  schueler_name: this.scalar('SELECT nachname FROM schueler WHERE id=?', [dke.schueler_id]) || '?',
                  local_pruefer: lke.geaendert_von || '?',
                  disk_pruefer: dke.geaendert_von || '?',
                  field: col,
                  local_val: localVal,
                  disk_val: diskVal,
                  resolved: (dke.geaendert_am||'') > (lke.geaendert_am||'') ? 'disk_wins' : 'local_wins'
                });
              }
              // Newer timestamp wins for conflicting fields
              if ((dke.geaendert_am||'') > (lke.geaendert_am||'')) {
                updates.push(`${col}=?`);
                values.push(diskVal);
              }
              // else: keep local (we're newer)
            } else {
              // We didn't edit this row → take disk version
              updates.push(`${col}=?`);
              values.push(diskVal);
            }
          }
        });

        if (updates.length) {
          // Also update metadata if we're taking any disk changes
          updates.push('geaendert_am=?', 'geaendert_von=?');
          values.push(dke.geaendert_am||'', dke.geaendert_von||'');
          values.push(dke.kontrolltermin_id, dke.schueler_id);
          this._runSilent(`UPDATE kontrollergebnisse SET ${updates.join(',')} WHERE kontrolltermin_id=? AND schueler_id=?`, values);
          this._importChangeCount++;
        }
      });

      // ── 2) kw_status: merge non-conflicting KW data ──
      const diskKW = [];
      const stmtKw = diskDb.prepare('SELECT * FROM kw_status');
      while (stmtKw.step()) diskKW.push(stmtKw.getAsObject());
      stmtKw.free();

      diskKW.forEach(dkw => {
        const local = this.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?',
          [dkw.schueler_id, dkw.ausbildungsjahr, dkw.kalenderwoche]);
        if (!local.length) {
          // New KW data from disk → import
          this._runSilent('INSERT OR IGNORE INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,behobene_codes,fehltage,geprueft,erstellt_bei,behoben_bei) VALUES (?,?,?,?,?,?,?,?,?)',
            [dkw.schueler_id,dkw.ausbildungsjahr,dkw.kalenderwoche,dkw.maengel_codes,dkw.behobene_codes,dkw.fehltage,dkw.geprueft,dkw.erstellt_bei,dkw.behoben_bei]);
          this._importChangeCount++;
        } else {
          const lkw = local[0];
          // If disk has more behobene_codes, merge them
          if (dkw.behobene_codes && dkw.behobene_codes !== lkw.behobene_codes) {
            const localBehoben = (lkw.behobene_codes || '').split(',').filter(Boolean);
            const diskBehoben = (dkw.behobene_codes || '').split(',').filter(Boolean);
            const merged = [...new Set([...localBehoben, ...diskBehoben])].join(',');
            if (merged !== lkw.behobene_codes) {
              this._runSilent('UPDATE kw_status SET behobene_codes=? WHERE id=?', [merged, lkw.id]);
            }
          }
          // If disk cleared maengel that we still have, take the cleared version
          if (lkw.maengel_codes && !dkw.maengel_codes && dkw.behobene_codes) {
            this._runSilent('UPDATE kw_status SET maengel_codes="", behobene_codes=? WHERE id=?', [dkw.behobene_codes, lkw.id]);
          }
        }
      });

      // ── 3) kw_maengel: additive sync (import new rows from other users) ──
      try {
        const diskKM = this._readTable(diskDb, 'kw_maengel');
        const localKMKeys = new Set(
          this.query('SELECT kontrollergebnis_id||"_"||ausbildungsjahr||"_"||kalenderwoche as k FROM kw_maengel').map(r => r.k)
        );
        diskKM.forEach(dkm => {
          const key = dkm.kontrollergebnis_id + '_' + dkm.ausbildungsjahr + '_' + dkm.kalenderwoche;
          if (!localKMKeys.has(key)) {
            this._runSilent('INSERT OR IGNORE INTO kw_maengel (kontrollergebnis_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage) VALUES (?,?,?,?,?)',
              [dkm.kontrollergebnis_id, dkm.ausbildungsjahr, dkm.kalenderwoche, dkm.maengel_codes||'', dkm.fehltage||0]);
            this._importChangeCount++;
          } else {
            // Update if disk has newer/more data
            const lkm = this.query('SELECT * FROM kw_maengel WHERE kontrollergebnis_id=? AND ausbildungsjahr=? AND kalenderwoche=?',
              [dkm.kontrollergebnis_id, dkm.ausbildungsjahr, dkm.kalenderwoche])[0];
            if (lkm && dkm.maengel_codes && dkm.maengel_codes !== lkm.maengel_codes) {
              // Merge codes: union of both sets
              const localCodes = (lkm.maengel_codes||'').split(',').filter(Boolean);
              const diskCodes = (dkm.maengel_codes||'').split(',').filter(Boolean);
              const merged = [...new Set([...localCodes, ...diskCodes])].join(',');
              if (merged !== lkm.maengel_codes) {
                this._runSilent('UPDATE kw_maengel SET maengel_codes=? WHERE kontrollergebnis_id=? AND ausbildungsjahr=? AND kalenderwoche=?',
                  [merged, dkm.kontrollergebnis_id, dkm.ausbildungsjahr, dkm.kalenderwoche]);
                this._importChangeCount++;
              }
            }
          }
        });
      } catch(e) { /* kw_maengel table may not exist */ }

      // ── 4) kontrolltermine: import new + update status/pruefer ──
      const diskKT = this._readTable(diskDb, 'kontrolltermine');
      const localKTIds = new Set(this.query('SELECT id FROM kontrolltermine').map(r => r.id));
      diskKT.forEach(dkt => {
        if (!localKTIds.has(dkt.id)) {
          this._runSilent('INSERT INTO kontrolltermine (id,klasse_id,jahrgang_id,geplant_datum,pruefer,status,typ,notizen,erstellt_am) VALUES (?,?,?,?,?,?,?,?,?)',
            [dkt.id,dkt.klasse_id,dkt.jahrgang_id,dkt.geplant_datum,dkt.pruefer,dkt.status,dkt.typ||'schulkontrolle',dkt.notizen||'',dkt.erstellt_am||'']);
          this._importChangeCount++;
        } else {
          // Update status + pruefer if disk is newer
          const lkt = this.query('SELECT * FROM kontrolltermine WHERE id=?', [dkt.id])[0];
          if (lkt && dkt.status !== lkt.status) {
            this._runSilent('UPDATE kontrolltermine SET status=?,pruefer=?,notizen=? WHERE id=?',
              [dkt.status, dkt.pruefer||lkt.pruefer, dkt.notizen||lkt.notizen, dkt.id]);
            this._importChangeCount++;
          }
        }
      });

      // ── 5) kontrolltermin_klassen: additive sync ──
      const diskTKK = this._readTable(diskDb, 'kontrolltermin_klassen');
      const localTKK = new Set(this.query('SELECT kontrolltermin_id||"_"||klasse_id as k FROM kontrolltermin_klassen').map(r => r.k));
      diskTKK.forEach(d => {
        const key = d.kontrolltermin_id + '_' + d.klasse_id;
        if (!localTKK.has(key)) {
          this._runSilent('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (?,?)',
            [d.kontrolltermin_id, d.klasse_id]);
          this._importChangeCount++;
        }
      });

      // ── 6) kontrolltermin_schueler: additive sync ──
      try {
        const diskTKS = this._readTable(diskDb, 'kontrolltermin_schueler');
        const localTKS = new Set(this.query('SELECT kontrolltermin_id||"_"||schueler_id as k FROM kontrolltermin_schueler').map(r => r.k));
        diskTKS.forEach(d => {
          const key = d.kontrolltermin_id + '_' + d.schueler_id;
          if (!localTKS.has(key)) {
            this._runSilent('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (?,?)',
              [d.kontrolltermin_id, d.schueler_id]);
            this._importChangeCount++;
          }
        });
      } catch(e) {} // table may not exist in older DBs

      // ── 7) wiedervorlagen: import new + update status ──
      const diskWV = this._readTable(diskDb, 'wiedervorlagen');
      const localWVIds = new Set(this.query('SELECT id FROM wiedervorlagen').map(r => r.id));
      diskWV.forEach(d => {
        if (!localWVIds.has(d.id)) {
          this._runSilent('INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,status,erstellt_am) VALUES (?,?,?,?,?,?,?)',
            [d.id,d.kontrollergebnis_id,d.schueler_id,d.art,d.frist_datum,d.status,d.erstellt_am||'']);
          this._importChangeCount++;
        } else {
          const lw = this.query('SELECT status FROM wiedervorlagen WHERE id=?', [d.id])[0];
          if (lw && d.status !== lw.status) {
            this._runSilent('UPDATE wiedervorlagen SET status=?,frist_datum=? WHERE id=?', [d.status, d.frist_datum, d.id]);
            this._importChangeCount++;
          }
        }
      });

      // ── 8) wiedervorlage_notizen: additive ──
      const diskWN = this._readTable(diskDb, 'wiedervorlage_notizen');
      const localWNIds = new Set(this.query('SELECT id FROM wiedervorlage_notizen').map(r => r.id));
      diskWN.forEach(d => {
        if (!localWNIds.has(d.id)) {
          this._runSilent('INSERT INTO wiedervorlage_notizen (id,wiedervorlage_id,text,erstellt_am,erstellt_von) VALUES (?,?,?,?,?)',
            [d.id,d.wiedervorlage_id,d.text,d.erstellt_am||'',d.erstellt_von||'']);
          this._importChangeCount++;
        }
      });

      // ── 9) durchsicht_snapshots: additive ──
      const diskDS = this._readTable(diskDb, 'durchsicht_snapshots');
      const localDSIds = new Set(this.query('SELECT id FROM durchsicht_snapshots').map(r => r.id));
      diskDS.forEach(d => {
        if (!localDSIds.has(d.id)) {
          this._runSilent('INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum,snapshot_data) VALUES (?,?,?,?,?)',
            [d.id,d.kontrollergebnis_id,d.schueler_id,d.snapshot_datum||'',d.snapshot_data||'']);
          this._importChangeCount++;
        }
      });

      // ── 10) schueler: import new students ──
      const diskS = this._readTable(diskDb, 'schueler');
      const localSIds = new Set(this.query('SELECT id FROM schueler').map(r => r.id));
      diskS.forEach(d => {
        if (!localSIds.has(d.id)) {
          this._runSilent('INSERT INTO schueler (id,nachname,vorname,ibykus_id,klasse_id,jahrgang_id,fachrichtung_id,betrieb_id,ausbildungsstaette,ausbildungsbeginn,ausbildungsende,email,telefon,aktiv,zustaendiges_amt,geschlecht) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [d.id,d.nachname,d.vorname,d.ibykus_id||'',d.klasse_id,d.jahrgang_id,d.fachrichtung_id,d.betrieb_id,d.ausbildungsstaette||'',d.ausbildungsbeginn||'',d.ausbildungsende||'',d.email||'',d.telefon||'',d.aktiv??1,d.zustaendiges_amt||'',d.geschlecht||'']);
          this._importChangeCount++;
        }
      });

      // ── 11) Show conflicts if any ──
      if (this._conflicts.length > 0) {
        this._showConflicts();
      }

    } catch(e) {
      console.warn('Import-from-disk error:', e);
    }
  },

  /**
   * Show conflict notifications to the user
   */
  // Helper: read all rows from a diskDb table
  _readTable(diskDb, table) {
    const rows = [];
    try {
      const stmt = diskDb.prepare(`SELECT * FROM ${table}`);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
    } catch(e) { /* table may not exist */ }
    return rows;
  },

  /**
   * Show conflict notifications to the user
   */
  _showConflicts() {
    const conflicts = this._conflicts;
    if (!conflicts.length) return;

    // Group by student
    const byStudent = {};
    conflicts.forEach(c => {
      if (!byStudent[c.schueler_id]) byStudent[c.schueler_id] = c;
    });
    const entries = Object.values(byStudent);

    if (entries.length === 1) {
      const c = entries[0];
      this.toast(`⚠️ Sync-Konflikt: <strong>${c.disk_pruefer}</strong> hat ${c.schueler_name} ebenfalls bearbeitet. Neuerer Stand übernommen.`, 'warning');
    } else {
      this.toast(`⚠️ ${entries.length} Sync-Konflikte erkannt. Neuerer Stand wurde jeweils übernommen.`, 'warning');
    }

    // Log details
    console.warn('Sync-Konflikte:', conflicts);
    // Clear after showing
    this._conflicts = [];
  },

  // ── Multi-Klassen helpers (with cache) ──
  _tkCache: {}, // terminId → {klassen: [...], ids: [...], schuelerCount: N}
  _tkCacheTime: 0,
  _tkCacheTTL: 3000, // 3s TTL

  // Bulk-preload all termin→klassen mappings (1 query instead of N)
  preloadTerminKlassen(terminIds) {
    if (!terminIds || !terminIds.length) return;
    const now = Date.now();
    // Skip if cache is fresh
    if (now - this._tkCacheTime < this._tkCacheTTL && terminIds.every(id => this._tkCache[id])) return;
    
    this._tkCache = {};
    // 1) Load all junction entries
    const allJunctions = this.query('SELECT kontrolltermin_id, klasse_id FROM kontrolltermin_klassen');
    const junctionMap = {}; // terminId → [klasseId, ...]
    allJunctions.forEach(j => {
      if (!junctionMap[j.kontrolltermin_id]) junctionMap[j.kontrolltermin_id] = [];
      junctionMap[j.kontrolltermin_id].push(j.klasse_id);
    });
    // Legacy fallback for termine without junction entries
    const allTermine = this.query('SELECT id, klasse_id FROM kontrolltermine WHERE klasse_id IS NOT NULL');
    allTermine.forEach(t => {
      if (!junctionMap[t.id]) junctionMap[t.id] = [t.klasse_id];
    });

    // 2) Load all klassen with joins (single query)
    const allKlassen = this.query(`SELECT k.*, bs.name as schule, bs.ort as schule_ort,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      j.bezeichnung as jg_bez
      FROM klassen k 
      JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN fachrichtungen f ON k.fachrichtung_id=f.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id`);
    const klassenById = {};
    allKlassen.forEach(k => { klassenById[k.id] = k; });

    // 3) Load schüler counts per klasse (single query)
    const counts = this.query('SELECT klasse_id, COUNT(*) as cnt FROM schueler WHERE aktiv=1 AND klasse_id IS NOT NULL GROUP BY klasse_id');
    const countMap = {};
    counts.forEach(c => { countMap[c.klasse_id] = c.cnt; });

    // 4) Build cache
    terminIds.forEach(tid => {
      const klassenIds = junctionMap[tid] || [];
      const klassen = klassenIds.map(kid => klassenById[kid]).filter(Boolean);
      const schuelerCount = klassenIds.reduce((s, kid) => s + (countMap[kid] || 0), 0);
      this._tkCache[tid] = { klassen, ids: klassenIds, schuelerCount };
    });
    this._tkCacheTime = now;
  },

  // Invalidate cache (call after termin/klassen changes)
  invalidateTerminCache() {
    this._tkCache = {};
    this._tkCacheTime = 0;
  },

  // Get all klasse_ids for a Termin (cached)
  getTerminKlassenIds(terminId) {
    if (this._tkCache[terminId]) return this._tkCache[terminId].ids;
    const ids = this.query('SELECT klasse_id FROM kontrolltermin_klassen WHERE kontrolltermin_id=?', [terminId]).map(r => r.klasse_id);
    if (ids.length) return ids;
    const legacy = this.scalar('SELECT klasse_id FROM kontrolltermine WHERE id=? AND klasse_id IS NOT NULL', [terminId]);
    return legacy ? [legacy] : [];
  },

  // Get all Schüler for a Termin (from all linked Klassen)
  getTerminSchueler(terminId) {
    const klassenIds = this.getTerminKlassenIds(terminId);
    // Students from linked classes
    let schueler = [];
    if (klassenIds.length) {
      const placeholders = klassenIds.map(() => '?').join(',');
      schueler = this.query(`SELECT * FROM schueler WHERE klasse_id IN (${placeholders}) AND aktiv=1`, klassenIds);
    }
    // Students directly linked (Einsendungen / manuell hinzugefügt)
    const direkt = this.query(`SELECT s.* FROM schueler s JOIN kontrolltermin_schueler kts ON kts.schueler_id=s.id WHERE kts.kontrolltermin_id=?`, [terminId]);
    // Merge without duplicates
    const ids = new Set(schueler.map(s => s.id));
    direkt.forEach(s => { if (!ids.has(s.id)) { schueler.push(s); ids.add(s.id); } });
    return schueler.sort((a,b) => (a.nachname||'').localeCompare(b.nachname||''));
  },

  // Get Klassen info for a Termin (cached)
  getTerminKlassen(terminId) {
    if (this._tkCache[terminId]) return this._tkCache[terminId].klassen;
    const klassenIds = this.getTerminKlassenIds(terminId);
    if (!klassenIds.length) return [];
    const placeholders = klassenIds.map(() => '?').join(',');
    return this.query(`SELECT k.*, bs.name as schule, bs.ort as schule_ort,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      j.bezeichnung as jg_bez
      FROM klassen k 
      JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN fachrichtungen f ON k.fachrichtung_id=f.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      WHERE k.id IN (${placeholders})
      ORDER BY bs.name, k.klassenbezeichnung`, klassenIds);
  },

  // Get cached Schüler count for a Termin
  getTerminSchuelerCount(terminId) {
    if (this._tkCache[terminId]) return this._tkCache[terminId].schuelerCount;
    return this.getTerminSchueler(terminId).length;
  },

  // Format Klassen names for display
  formatTerminKlassen(terminId) {
    const klassen = this.getTerminKlassen(terminId);
    return klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
  },

  // Aussagekräftiges Label für einen Kontrolltermin (z.B. für Dropdowns)
  formatTerminLabel(t) {
    const klassen = this.getTerminKlassen(t.id);
    const schule = klassen.length ? klassen[0].schule : '';
    const frAj = this.formatTerminFrAj(t.id);
    const count = this.getTerminSchuelerCount(t.id);
    const isEins = t.typ === 'einsendung';
    const kw = 'KW' + this._isoKW(new Date(t.geplant_datum + 'T00:00:00'));
    const datum = (t.geplant_datum || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');
    const parts = [`${kw} ${datum}`];
    if (isEins) {
      parts.push('📬 Einsendung');
    } else if (schule) {
      parts.push(schule);
    }
    if (frAj && frAj !== '–') parts.push(frAj);
    parts.push(`${count} Sch.`);
    if (t.pruefer) parts.push(t.pruefer);
    return parts.join(' – ') + ` (${t.status || 'geplant'})`;
  },

  // Format FR + AJ for display (e.g. "GaLaBau 2. AJ, Zierpfl. 2. AJ")
  formatTerminFrAj(terminId, refDate) {
    const klassen = this.getTerminKlassen(terminId);
    const termin = refDate || this.query('SELECT geplant_datum FROM kontrolltermine WHERE id=?', [terminId])[0]?.geplant_datum;
    const groups = {};
    klassen.forEach(k => {
      const aj = this.getAJFromJahrgang(k.jahrgang_id, termin);
      const fr = k.fachrichtung || 'Gartenbau';
      const key = `${fr}|${aj}`;
      if (!groups[key]) groups[key] = { fr, aj };
    });
    const sorted = Object.values(groups).sort((a,b) => a.fr.localeCompare(b.fr) || a.aj - b.aj);
    return sorted.map(g => `${g.fr} ${g.aj}. AJ`).join(', ') || '–';
  },

  // ── Verkürzer-Erkennung: < 30 Monate Ausbildungszeit ──
  isVerkuerzer(beginn, ende) {
    if (!beginn || !ende) return false;
    const d1 = this._parseDate(beginn), d2 = this._parseDate(ende);
    if (!d1 || !d2) return false;
    const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    return months < 30;
  },

  // ── Parse date from various formats (DD.MM.YYYY, YYYY-MM-DD, etc.) ──
  _parseDate(t) {
    if (!t) return null;
    if (t instanceof Date) return isNaN(t) ? null : t;
    const s = String(t).trim();
    // DD.MM.YYYY (IBYKUS-Format)
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return new Date(+m[3], m[2]-1, +m[1]);
    // YYYY-MM-DD (ISO)
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return new Date(+m[1], m[2]-1, +m[3]);
    // Fallback
    const d = new Date(s);
    return isNaN(d) ? null : d;
  },

  // ── Dynamische AJ-Liste aus tatsächlich überspannten Schuljahren ──
  // Zählt Schuljahre (Sep–Aug) die zwischen AV-Beginn und AV-Ende liegen.
  // Ein Verkürzer der im März startet spannt 3 Schuljahre → braucht 3 KW-Grids.
  getSchuelerAJs(schuelerId) {
    const s = this.query('SELECT ausbildungsbeginn, ausbildungsende FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s?.ausbildungsbeginn || !s?.ausbildungsende) return [1, 2, 3];
    const d1 = this._parseDate(s.ausbildungsbeginn), d2 = this._parseDate(s.ausbildungsende);
    if (!d1 || !d2) return [1, 2, 3];

    // School year starts in September: before Sep → previous year's SY
    const startSY = d1.getMonth() >= 8 ? d1.getFullYear() : d1.getFullYear() - 1;
    const endSY = d2.getMonth() >= 8 ? d2.getFullYear() : d2.getFullYear() - 1;
    const numSY = endSY - startSY + 1;

    // AJ numbers: count backwards from 3 (AJ3 = exam year)
    // 1 SY → [3], 2 SY → [2,3], 3 SY → [1,2,3], 4+ SY → [1,2,3,4,...]
    if (numSY <= 1) return [3];
    if (numSY === 2) return [2, 3];
    if (numSY === 3) return [1, 2, 3];
    return Array.from({length: numSY}, (_, i) => i + 1); // [1,2,3,4] etc.
  },

  // ── Aktuelles Ausbildungsjahr berechnen (aus Ausbildungsbeginn) ──
  getCurrentAJ(beginn) {
    if (!beginn) return null;
    const d = this._parseDate(beginn);
    if (!d) return null;
    const now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 0) return 1;
    return Math.min(Math.floor(months / 12) + 1, 3);
  },

  // ── Arbeitstage berechnen (individuell aus aktiven KWs pro Schüler) ──
  // Nutzt getAJKWBounds: aktive KWs × 5 Werktage − Feiertage (BW)
  calcArbeitstage(beginn, ende, schuelerId) {
    // If schuelerId given → precise calculation from active KWs
    if (schuelerId) {
      const bounds = this.getAJKWBounds(schuelerId);
      let totalActiveKWs = 0;
      Object.values(bounds).forEach(b => {
        totalActiveKWs += 52 - (b.inactiveKWs ? b.inactiveKWs.length : 0);
      });
      if (totalActiveKWs === 0) totalActiveKWs = 156; // fallback 3×52
      const years = totalActiveKWs / 52;
      const feiertage = Math.round(years * 11);
      return Math.max(1, totalActiveKWs * 5 - feiertage);
    }
    // Fallback: date-based calculation
    if (!beginn) return 660;
    const d1 = this._parseDate(beginn);
    const d2 = ende ? this._parseDate(ende) : new Date();
    if (!d1 || !d2) return 660;
    const msPerDay = 86400000;
    const totalDays = Math.max(0, Math.floor((d2 - d1) / msPerDay));
    const weeks = totalDays / 7;
    const workdays = Math.floor(weeks * 5);
    const years = totalDays / 365.25;
    const feiertage = Math.round(years * 11);
    return Math.max(1, workdays - feiertage);
  },

  // ── Erforderliche ÜBA-Bescheinigungen nach Fachrichtung ──
  // GaLaBau (Code 036, 176): 6 Bescheinigungen
  // Alle anderen Produktionsgartenbau-FRs: 2 Bescheinigungen
  getRequiredUBA(fachrichtungId) {
    if (!fachrichtungId) return 2;
    const fr = this.query('SELECT code, bezeichnung FROM fachrichtungen WHERE id=?', [fachrichtungId])[0];
    if (!fr) return 2;
    // GaLaBau = Code 036 or 176
    if (fr.code === '036' || fr.code === '176' || (fr.bezeichnung||'').toLowerCase().includes('galabau')) return 6;
    return 2;
  },
  // S2027 + Kontrolle am 15.03.2026 → AJ 2
  // Verkürzer mit S2027 + Start Sep 2025 → auch AJ 2 (gleiche Klasse)
  getAJFromJahrgang(jahrgang_id, refDate) {
    if (!jahrgang_id) return null;
    const jg = this.query('SELECT * FROM abschlussjahrgaenge WHERE id=?', [jahrgang_id])[0];
    if (!jg) return null;
    const abschlussJahr = jg.jahr; // z.B. 2027
    const ref = refDate ? new Date(refDate) : new Date();
    // Schuljahr-Start: Aug/Sep → dieses Jahr, Jan-Jul → Vorjahr
    const currentSJStart = ref.getMonth() >= 7 ? ref.getFullYear() : ref.getFullYear() - 1;
    // Letztes Schuljahr vor Prüfung = AJ 3
    const lastSJStart = abschlussJahr - 1;
    const aj = 3 - (lastSJStart - currentSJStart);
    return Math.max(1, Math.min(3, aj));
  },

  // ── AJ-Label für Anzeige (z.B. "2. AJ (S2027)") ──
  getAJLabel(jahrgang_id, refDate) {
    const aj = this.getAJFromJahrgang(jahrgang_id, refDate);
    if (!aj) return '';
    const jg = this.query('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jahrgang_id])[0];
    return `${aj}. AJ` + (jg ? ` (${jg.bezeichnung})` : '');
  },

  // ── Aktuelle Schule: Landesfachklasse-Regeln nach Fachrichtung + AJ ──
  // Bestimmte Fachrichtungen besuchen in höheren AJs eine andere Berufsschule (Landesfachklasse).
  // Regeln: Gemüsebau: 3. AJ, Obstbau: 2.+3. AJ, Baumschule: 3. AJ, Stauden: 3. AJ
  // Gibt {schule, isLandesfachklasse} zurück.
  getAktuelleSchule(schueler, refDate) {
    const regulaereSchule = schueler.schule || '';
    const lfk = (schueler.landesfachklasse || '').trim();
    if (!lfk) return { schule: regulaereSchule, isLandesfachklasse: false };

    // Fachrichtung-Code ermitteln
    const frCode = schueler.fr_code || (schueler.fachrichtung_id
      ? (this.query('SELECT code FROM fachrichtungen WHERE id=?', [schueler.fachrichtung_id])[0]?.code || '')
      : '');
    if (!frCode) return { schule: regulaereSchule, isLandesfachklasse: false };

    // Aktuelles Ausbildungsjahr
    const aj = this.getAJFromJahrgang(schueler.jahrgang_id, refDate);
    if (!aj) return { schule: regulaereSchule, isLandesfachklasse: false };

    // Regeln: Code → ab welchem AJ gilt die Landesfachklasse
    // Gemüsebau (032/172): 3. AJ | Obstbau (034/174): 2.+3. AJ | Baumschule (033/173): 3. AJ | Stauden (035/175): 3. AJ
    const lfkRegeln = {
      '032': 3, '172': 3,   // Gemüsebau
      '034': 2, '174': 2,   // Obstbau (ab 2. AJ)
      '033': 3, '173': 3,   // Baumschule
      '035': 3, '175': 3,   // Staudengärtnerei
    };
    const abAJ = lfkRegeln[frCode];
    if (abAJ && aj >= abAJ) {
      return { schule: lfk, isLandesfachklasse: true };
    }
    return { schule: regulaereSchule, isLandesfachklasse: false };
  },

  // ── Standortgruppen: Schüler nach aktuellem Schulstandort gruppieren ──
  // Berücksichtigt Landesfachklasse-Regeln je nach Fachrichtung + AJ.
  // opts: { jahrgangId, fachrichtungId, amt, zwischenpruefung, refDate }
  // Gibt Array von { schule, isLFK, schueler: [...], klasse_ids: Set } zurück.
  getStandortgruppen(opts) {
    if (!opts) opts = {};
    let sql = `SELECT s.*,
      f.code as fr_code, f.bezeichnung as fr_bez, f.typ as fr_typ,
      k.klassenbezeichnung, k.lehrjahr, k.berufsschule_id,
      bs.name as schule,
      j.bezeichnung as jahrgang
      FROM schueler s
      LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      WHERE s.aktiv=1`;
    const params = [];
    if (opts.jahrgangId) { sql += ' AND s.jahrgang_id=?'; params.push(opts.jahrgangId); }
    if (opts.fachrichtungId) { sql += ' AND s.fachrichtung_id=?'; params.push(opts.fachrichtungId); }
    if (opts.amt) { sql += ' AND s.zustaendiges_amt=?'; params.push(opts.amt); }
    if (opts.zwischenpruefung) { sql += ' AND s.zwischenpruefung=?'; params.push(opts.zwischenpruefung); }
    sql += ' ORDER BY s.nachname, s.vorname';

    const schuelerList = this.query(sql, params);
    const gruppen = {}; // key = schulName → { schule, isLFK, schueler, klasse_ids }

    schuelerList.forEach(s => {
      const ak = this.getAktuelleSchule(s, opts.refDate);
      const key = ak.schule || '(ohne Schule)';
      if (!gruppen[key]) {
        gruppen[key] = { schule: key, isLFK: ak.isLandesfachklasse, schueler: [], klasse_ids: new Set(), hasLFK: false, hasRegulaer: false };
      }
      gruppen[key].schueler.push(s);
      if (s.klasse_id) gruppen[key].klasse_ids.add(s.klasse_id);
      if (ak.isLandesfachklasse) gruppen[key].hasLFK = true;
      else gruppen[key].hasRegulaer = true;
    });

    return Object.values(gruppen).sort((a, b) => b.schueler.length - a.schueler.length);
  },

  // ── Prüfbereich: erste/letzte KW aus Ausbildungsbeginn + heute ──
  getKWRange(beginn) {
    if (!beginn) return null;
    const d = this._parseDate(beginn);
    if (!d) return null;
    // First KW: week of ausbildungsbeginn
    const getKW = (dt) => { const target = new Date(dt.valueOf()); const dayNr = (dt.getDay() + 6) % 7; target.setDate(target.getDate() - dayNr + 3); const firstThursday = target.valueOf(); target.setMonth(0, 1); if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7); return 1 + Math.round((firstThursday - target) / 604800000); };
    return { startKW: getKW(d), endKW: getKW(new Date()) };
  },

  // ── KW-Nummern-Berechnung (ISO 8601) ──
  _isoKW(dt) {
    const target = new Date(dt.valueOf());
    const dayNr = (dt.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    // Use Math.round instead of Math.ceil to avoid DST rounding errors
    // (DST transition adds/subtracts 1 hour → ±0.006 weeks → ceil rounds up incorrectly)
    return 1 + Math.round((firstThursday - target) / 604800000);
  },

  // ── Aktive KW-Bereiche pro AJ aus AV-Daten berechnen ──
  // Returns { 1: {start:36, end:35, active:true}, 2: {...}, 3: {...} }
  // Inaktive KWs: vor AV-Beginn (1. AJ) oder nach AV-Ende (letztes AJ)
  getAJKWBounds(schuelerId) {
    const s = this.query('SELECT ausbildungsbeginn, ausbildungsende FROM schueler WHERE id=?', [schuelerId])[0];
    const ajs = this.getSchuelerAJs(schuelerId);
    const result = {};
    const allKWOrder = [36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35];

    if (!s?.ausbildungsbeginn) {
      ajs.forEach(aj => { result[aj] = { startKW: 36, endKW: 35, inactiveKWs: [], schoolYear: '' }; });
      return result;
    }

    const d1 = this._parseDate(s.ausbildungsbeginn);
    const d2 = s.ausbildungsende ? this._parseDate(s.ausbildungsende) : null;
    const startKW = d1 ? this._isoKW(d1) : 36;
    const endKW = d2 ? this._isoKW(d2) : 35;

    // School year of first AJ: month >= Sep → year, else year-1
    const firstSY = d1 ? (d1.getMonth() >= 8 ? d1.getFullYear() : d1.getFullYear() - 1) : null;

    // Diagnostic: log once per student to help debug KW issues
    if (!this._kwBoundsLogged) this._kwBoundsLogged = {};
    if (!this._kwBoundsLogged[schuelerId]) {
      this._kwBoundsLogged[schuelerId] = true;
      // console.log(`[KW-Bounds] Schüler ${schuelerId}: AV ${s.ausbildungsbeginn} → ${s.ausbildungsende}, d1=${d1?.toISOString()}, d2=${d2?.toISOString()}, startKW=${startKW}, endKW=${endKW}, AJs=[${ajs}]`);
    }

    ajs.forEach((aj, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === ajs.length - 1;
      const inactive = [];

      if (isFirst && startKW !== 36) {
        const startIdx = allKWOrder.indexOf(startKW);
        // KWs 33-35 (indices 49-51) = school year boundary → all active
        if (startIdx > 0 && startIdx < 49) {
          for (let i = 0; i < startIdx; i++) inactive.push(allKWOrder[i]);
        }
      }

      if (isLast && endKW !== 35) {
        const endIdx = allKWOrder.indexOf(endKW);
        // BOUNDARY FIX: endKW in range 33-36 (indices 49-51 or 0) = school year end zone
        // Student ends near Aug/Sep → full last AJ should be active
        if (endIdx > 2 && endIdx < 49) {
          for (let i = endIdx + 1; i < allKWOrder.length; i++) inactive.push(allKWOrder[i]);
        }
        // endIdx 0-2 (KW 36-38) or >= 49 (KW 33-35) → treat as full year
      }

      const sy = firstSY !== null ? firstSY + idx : null;
      const syLabel = sy ? `${sy}/${String(sy+1).slice(-2)}` : '';
      result[aj] = { startKW: isFirst ? startKW : 36, endKW: isLast ? endKW : 35, inactiveKWs: inactive, schoolYear: syLabel, syStart: sy };
    });

    return result;
  },

  // ── KW to date range (Montag–Sonntag) for a given school year ──
  // kwDateRange(10, 2025) → { mon: '03.03.2025', sun: '09.03.2025', label: '03.03.–09.03.2025' }
  kwDateRange(kw, syStart) {
    if (!syStart || !kw) return null;
    // Determine calendar year: KW 36-52 → syStart year, KW 1-35 → syStart+1
    const year = kw >= 36 ? syStart : syStart + 1;
    // ISO 8601: Monday of week 1 is the week containing Jan 4
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = (jan4.getDay() + 6) % 7; // 0=Mon
    const monday1 = new Date(jan4);
    monday1.setDate(jan4.getDate() - dayOfWeek); // Monday of week 1
    const targetMon = new Date(monday1);
    targetMon.setDate(monday1.getDate() + (kw - 1) * 7);
    const targetSun = new Date(targetMon);
    targetSun.setDate(targetMon.getDate() + 6);
    const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    const fmtShort = (d) => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`;
    return {
      mon: fmt(targetMon), sun: fmt(targetSun),
      label: targetMon.getFullYear() === targetSun.getFullYear()
        ? `${fmtShort(targetMon)}\u2013${fmt(targetSun)}`
        : `${fmt(targetMon)}\u2013${fmt(targetSun)}`
    };
  },

  // ── Ampel-System: Schüler-Status auf Basis der letzten Kontrolle ──
  // Returns {color:'green'|'yellow'|'red'|'gray', icon:'🟢'|'🟡'|'🔴'|'⚪', label:'...', prevErgebnis:'...', wvOffen:bool}
  getSchuelerAmpel(schuelerId) {
    const lastKE = this.query(`SELECT ke.ergebnis, ke.kontrolltermin_id, kt.geplant_datum
      FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`, [schuelerId]);
    const wvOffen = this.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [schuelerId]) > 0;
    const offeneMaengel = this.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != '' AND maengel_codes != 'H'", [schuelerId]) || 0;

    if (!lastKE.length) return { color: 'gray', icon: '⚪', label: 'Noch nie kontrolliert', prevErgebnis: '', wvOffen, offeneMaengel };
    const e = lastKE[0].ergebnis;
    if (e === 'in_ordnung' && !wvOffen && offeneMaengel === 0) {
      return { color: 'green', icon: '🟢', label: 'Letzte Kontrolle OK', prevErgebnis: e, wvOffen, offeneMaengel };
    }
    if (e === 'nachholung_naechste_durchsicht' || e === 'sachberichte_wetter_email' || e === 'berichte_bis_termin_email') {
      return { color: 'yellow', icon: '🟡', label: 'Nachholung/E-Mail nötig', prevErgebnis: e, wvOffen, offeneMaengel };
    }
    if (e === 'persoenliche_vorlage_rp' || e === 'post_an_rp' || wvOffen) {
      return { color: 'red', icon: '🔴', label: 'Eskalation / WV offen', prevErgebnis: e, wvOffen, offeneMaengel };
    }
    return { color: 'yellow', icon: '🟡', label: 'Mängel vorhanden', prevErgebnis: e, wvOffen, offeneMaengel };
  },

  // ── Wiederholungstäter-Erkennung ──
  // Returns {count:N, codes:['D','A',...], isRepeat:bool, suggestion:'...'}
  getWiederholungstaeter(schuelerId) {
    // Get all past kontrollergebnisse with issues
    const history = this.query(`SELECT ke.ergebnis, ke.kontrolltermin_id
      FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung'
      ORDER BY kt.geplant_datum DESC`, [schuelerId]);
    // Get recurring mängel codes
    const allCodes = this.query(`SELECT maengel_codes FROM kw_status WHERE schueler_id=? AND maengel_codes != ''`, [schuelerId]);
    const codeCount = {};
    allCodes.forEach(r => r.maengel_codes.split(',').filter(Boolean).forEach(c => { if (c !== 'H') codeCount[c] = (codeCount[c]||0) + 1; }));
    const recurring = Object.entries(codeCount).filter(([c, n]) => n >= 3).map(([c]) => c).sort();

    const isRepeat = history.length >= 2;
    let suggestion = '';
    if (history.length >= 3) suggestion = 'Persönliche Vorlage im RP empfohlen (3+ Beanstandungen)';
    else if (history.length === 2) suggestion = 'Erneute Beanstandung – engere Begleitung empfohlen';

    return { count: history.length, codes: recurring, isRepeat, suggestion, codeCount };
  },

  // ── Vorheriges Ergebnis als Template laden ──
  getPreviousKETemplate(schuelerId, currentTerminId) {
    const prev = this.query(`SELECT ke.* FROM kontrollergebnisse ke
      JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.kontrolltermin_id != ? AND ke.ergebnis != ''
      ORDER BY kt.geplant_datum DESC LIMIT 1`, [schuelerId, currentTerminId]);
    return prev.length ? prev[0] : null;
  },

  // ── Bemerkung-Textbausteine (loaded from DB) ──
  getTextbausteine() {
    try { return JSON.parse(this.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]'); }
    catch(e) { return []; }
  },

  // ── Show main app ──
  showApp() {
    document.getElementById('connectScreen').style.display = 'none';
    const appEl = document.getElementById('appMain');
    appEl.style.display = 'flex';
    document.getElementById('btnSwitchDB').style.display = '';
    if (this.dbFileHandle) {
      this.dbFileHandle.getFile().then(f => {
        document.getElementById('dbFileName').textContent = f.name;
      });
      document.getElementById('btnGrantAccess').style.display = 'none';
    } else if (!this.demoMode) {
      document.getElementById('btnGrantAccess').style.display = '';
    }
    // ── Migrate old kw_maengel → kw_status if needed ──
    this.migrateDB();
    this.startPolling();

    // Mark sync as ready after a short delay (file handle needs to stabilize after F5)
    this._syncReady = false;
    setTimeout(() => { this._syncReady = true; }, 3000);

    // ── Default-Filter: Gartenbauberufe (Gärtner + Fachwerker) vorauswählen ──
    if (this.filterFachrichtungen.length === 0) {
      const gaertnerIds = this.query("SELECT id FROM fachrichtungen WHERE typ IN ('Gärtner','Fachwerker')").map(r => r.id);
      if (gaertnerIds.length > 0) {
        this.filterFachrichtungen = gaertnerIds;
        this._updateBgButton();
      }
    }

    // ── Default-Filter: Zuständiges Amt = 93 RP Freiburg ──
    if (this.filterAmt.length === 0) {
      const hasFreiburg = this.scalar("SELECT COUNT(*) FROM schueler WHERE zustaendiges_amt='93'");
      if (hasFreiburg > 0) {
        this.filterAmt = ['93'];
        this._updateAmtButton();
      }
    }

    const validViews = ['dashboard','stammdaten','import','planung','kontrolle','nacherfassung','wiedervorlagen','berichte','einstellungen','hilfe'];
    const hashView = location.hash.replace('#','');

    // ── Restore last position after reload ──
    let restored = false;
    try {
      const lastView = App.uGet('last_view') || '';
      const pos = JSON.parse(App.uGet('last_position') || 'null');

      if (lastView === 'kontrolle' && pos && pos.terminId && (Date.now() - pos.timestamp < 4 * 60 * 60 * 1000)) {
        // Kontrolle with specific position (< 4h old)
        const termin = this.query('SELECT id FROM kontrolltermine WHERE id=?', [pos.terminId]);
        if (termin.length) {
          this.navigate('kontrolle');
          setTimeout(() => {
            const sel = document.getElementById('selKontrolltermin');
            if (sel) sel.value = pos.terminId;
            KontrolleHandler.loadTermin(pos.terminId);
            setTimeout(() => {
              if (pos.schuelerId) {
                const idx = KontrolleHandler.currentSchuelerList.findIndex(s => s.id === pos.schuelerId);
                if (idx >= 0) KontrolleHandler.currentIndex = idx;
              }
              if (pos.viewMode === 'einzeln') {
                KontrolleHandler._viewMode = 'einzeln';
                KontrolleHandler.enterSchüler();
              }
            }, 150);
          }, 100);
          restored = true;
          console.log(`[Session] Kontrolle wiederhergestellt: Termin ${pos.terminId}, Schüler ${pos.schuelerId}`);
        }
      } else if (lastView && validViews.includes(lastView)) {
        // Any other view → navigate directly
        this.navigate(lastView);
        restored = true;
        console.log(`[Session] View wiederhergestellt: ${lastView}`);
      }
    } catch(e) { console.warn('[Session] Restore failed:', e.message); }

    if (!restored) {
      this.navigate(validViews.includes(hashView) ? hashView : 'dashboard');
    }
    window.addEventListener('hashchange', () => {
      const v = location.hash.replace('#','');
      if (validViews.includes(v) && v !== App.currentView) App.navigate(v, true);
    });
    this._initSidebarResize();
    this._restoreSidebarState();
    this._restoreFilterPanel();
    this._updateFilterCount();
    this._applySidebarVisibility();

    // ── Restore current user ──
    try { this.currentUser = localStorage.getItem('bhk_current_user') || ''; } catch(e) {}
    this._populateUserSelect();
    if (this.currentUser) this._restoreUserSettings();
  },

  // ── Sidebar Feature Toggle System ──
  SIDEBAR_FEATURES: {
    nacherfassung: { label: 'Nacherfassung (vergangene Kontrollen)', default: false },
    import: { label: 'IBYKUS-Import', default: true },
  },

  _getSidebarVisibility() {
    try { return JSON.parse(App.uGet('sidebar_features') || '{}'); } catch(e) { return {}; }
  },

  _applySidebarVisibility() {
    const vis = this._getSidebarVisibility();
    document.querySelectorAll('.sidebar-optional').forEach(el => {
      const key = el.dataset.feature;
      const show = vis[key] !== undefined ? vis[key] : (this.SIDEBAR_FEATURES[key]?.default ?? true);
      el.style.display = show ? '' : 'none';
    });
  },

  _toggleSidebarFeature(key, enabled) {
    const vis = this._getSidebarVisibility();
    vis[key] = enabled;
    App.uSet('sidebar_features', JSON.stringify(vis));
    this._applySidebarVisibility();
  },

  _initSidebarResize() {
    const handle = document.getElementById('sidebarResize');
    const sidebar = document.getElementById('sidebarNav');
    if (!handle || !sidebar) return;
    // Restore saved width
    try {
      const saved = App.uGet('sidebar_w');
      if (saved) { const w = parseInt(saved); if (w >= 160 && w <= 400) sidebar.style.width = w + 'px'; }
    } catch(e) {}
    let dragging = false, startX = 0, startW = 0;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true; startX = e.clientX; startW = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = Math.min(400, Math.max(160, startW + e.clientX - startX));
      sidebar.style.width = newW + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { App.uSet('sidebar_w', sidebar.offsetWidth); } catch(e) {}
    });
  },

  migrateDB() {
    try {
      // Ensure new tables exist (SCHEMA handles CREATE IF NOT EXISTS)
      // Add columns to kontrollergebnisse if missing
      const keCols = this.query("PRAGMA table_info(kontrollergebnisse)").map(r => r.name);
      if (!keCols.includes('geprueft_kws')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN geprueft_kws TEXT DEFAULT '{}'");
      }
      if (!keCols.includes('durchsicht_nr')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN durchsicht_nr INTEGER DEFAULT 1");
      }
      if (!keCols.includes('bescheinigungen_anzahl')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN bescheinigungen_anzahl INTEGER DEFAULT 0");
      }
      if (!keCols.includes('anwesend')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN anwesend INTEGER DEFAULT 1");
      }
      if (!keCols.includes('geaendert_von')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN geaendert_von TEXT DEFAULT ''");
      }
      if (!keCols.includes('zulassung_ap')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN zulassung_ap INTEGER DEFAULT 0");
      }
      if (!keCols.includes('pruefungsausschuss')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN pruefungsausschuss INTEGER DEFAULT 0");
      }
      // Aktive Sitzung tracking
      this.db.run(`CREATE TABLE IF NOT EXISTS aktive_sitzung (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kontrolltermin_id INTEGER, schueler_id INTEGER,
        pruefer TEXT DEFAULT '', seit TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(kontrolltermin_id, pruefer)
      )`);
      // Betriebe table
      this.db.run(`CREATE TABLE IF NOT EXISTS betriebe (
        id INTEGER PRIMARY KEY AUTOINCREMENT, betriebsnummer TEXT DEFAULT '',
        name TEXT NOT NULL, firma TEXT DEFAULT '', ansprechpartner TEXT DEFAULT '',
        strasse TEXT DEFAULT '', plz TEXT DEFAULT '', ort TEXT DEFAULT '',
        telefon TEXT DEFAULT '', fax TEXT DEFAULT '', email TEXT DEFAULT '',
        UNIQUE(betriebsnummer)
      )`);
      const sCols = this.query("PRAGMA table_info(schueler)").map(r => r.name);
      if (!sCols.includes('betrieb_id')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN betrieb_id INTEGER DEFAULT NULL");
      }
      if (!sCols.includes('status')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN status TEXT DEFAULT 'aktiv'");
      }
      if (!sCols.includes('ap_zugelassen')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN ap_zugelassen INTEGER DEFAULT 0");
      }
      if (!sCols.includes('ap_bestanden')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN ap_bestanden INTEGER DEFAULT 0");
      }
      if (!sCols.includes('inaktiv_grund')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN inaktiv_grund TEXT DEFAULT ''");
      }
      if (!sCols.includes('inaktiv_datum')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN inaktiv_datum TEXT DEFAULT ''");
      }
      if (!sCols.includes('zustaendiges_amt')) {
        this.db.run("ALTER TABLE schueler ADD COLUMN zustaendiges_amt TEXT DEFAULT ''");
      }
      // Clean stale sessions (silent – don't track as dirty op)
      try { this.db.run("DELETE FROM aktive_sitzung WHERE seit < datetime('now','localtime','-30 minutes')"); } catch(e) {}
      // kw_status.bemerkung for "I - Sonstiges" notes
      try { this.db.run("ALTER TABLE kw_status ADD COLUMN bemerkung TEXT DEFAULT ''"); } catch(e) {}
      // schueler: telefon + email
      try { this.db.run("ALTER TABLE schueler ADD COLUMN telefon TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN email TEXT DEFAULT ''"); } catch(e) {}
      // schueler: geschlecht (m/w/d)
      try { this.db.run("ALTER TABLE schueler ADD COLUMN geschlecht TEXT DEFAULT ''"); } catch(e) {}
      // schueler: schulabschluss + pruefungserfolg
      try { this.db.run("ALTER TABLE schueler ADD COLUMN schulabschluss TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN pruefungserfolg TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN pruefungserfolg_wdh1 TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN pruefungserfolg_wdh2 TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN bav_status TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN zwischenpruefung TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN landesfachklasse TEXT DEFAULT ''"); } catch(e) {}
      // berufsschulen: email_cc + ansprechpartner_json
      try { this.db.run("ALTER TABLE berufsschulen ADD COLUMN email_cc TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE berufsschulen ADD COLUMN ansprechpartner_json TEXT DEFAULT '[]'"); } catch(e) {}
      // betriebe: vorname + zusatzbezeichnung
      try { this.db.run("ALTER TABLE betriebe ADD COLUMN vorname TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE betriebe ADD COLUMN zusatzbezeichnung TEXT DEFAULT ''"); } catch(e) {}
      // kontrolltermine: typ (schulkontrolle vs einsendung)
      try { this.db.run("ALTER TABLE kontrolltermine ADD COLUMN typ TEXT DEFAULT 'schulkontrolle'"); } catch(e) {}
      // Relax fachrichtungen CHECK constraint + add new professions
      try {
        const chk = this.query("SELECT sql FROM sqlite_master WHERE name='fachrichtungen'")[0]?.sql || '';
        if (chk.includes("IN ('Gärtner','Fachwerker')")) {
          this.db.run("CREATE TABLE fachrichtungen_new (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL DEFAULT '', bezeichnung TEXT NOT NULL, typ TEXT DEFAULT 'Gärtner', UNIQUE(code))");
          this.db.run("INSERT INTO fachrichtungen_new SELECT * FROM fachrichtungen");
          this.db.run("DROP TABLE fachrichtungen");
          this.db.run("ALTER TABLE fachrichtungen_new RENAME TO fachrichtungen");
          console.debug('fachrichtungen CHECK constraint removed');
        }
      } catch(e) { console.warn('fachrichtungen migration:', e.message); }
      // Fix old codes without leading zero (31→031 etc.)
      [['31','031'],['32','032'],['33','033'],['34','034'],['35','035'],['36','036'],['37','037']].forEach(([old,nw]) => {
        try { this.db.run("UPDATE fachrichtungen SET code=? WHERE code=?", [nw, old]); } catch(e) {}
      });
      // Insert all new professions (INSERT OR IGNORE = safe for existing DBs)
      const newBerufe = [
        ['030','Gärtner (allgemein)','Gärtner'],['170','Gartenbaufachwerker (allg.)','Fachwerker'],
        ['010','Landwirt','Landwirt'],['015','Landwirtschaftsfachwerker/in','Landwirt'],
        ['020','Hauswirtschafter','Hauswirtschaft'],['021','Hauswirtschafter LW','Hauswirtschaft'],
        ['160','Hauswirtschaftshelfer','Hauswirtschaft'],['161','Fachpraktiker/in Hauswirtschaft','Hauswirtschaft'],
        ['040','Winzer','Winzer'],
        ['050','Tierwirt (allgemein)','Tierwirt'],['051','Tierwirt: Rinderhaltung','Tierwirt'],
        ['052','Tierwirt: Schweinehaltung','Tierwirt'],['054','Tierwirt: Geflügelhaltung','Tierwirt'],
        ['055','Tierwirt: Schäferei','Tierwirt'],['056','Tierwirt: Imkerei','Tierwirt'],
        ['060','Pferdewirt (allgemein)','Pferdewirt'],['061','Pferdewirt: Pferdezucht und -haltung','Pferdewirt'],
        ['062','Pferdewirt: Reiten','Pferdewirt'],['063','Pferdewirt: Rennreiten','Pferdewirt'],
        ['064','Pferdewirt: Trabrennfahren','Pferdewirt'],['065','Pferdewirt: Pferdehaltung und Service','Pferdewirt'],
        ['066','Pferdewirt: Pferdezucht','Pferdewirt'],['067','Pferdewirt: Klassische Reitausbildung','Pferdewirt'],
        ['068','Pferdewirt: Pferderennen','Pferdewirt'],['069','Pferdewirt: Spezialreitweisen','Pferdewirt'],
        ['070','Fischwirt (allgemein)','Fischwirt'],['071','Fischwirt: Fischhaltung und Fischzucht','Fischwirt'],
        ['072','Fischwirt: Seen- und Flussfischerei','Fischwirt'],['073','Fischwirt: Kleine Hochsee-/Küstenfischerei','Fischwirt'],
        ['074','Fischwirt: Aquakultur und Binnenfischerei','Fischwirt'],['075','Fischwirt: Küstenfischerei/Hochseefischerei','Fischwirt'],
        ['080','Fachkraft Agrarservice','Agrar/Forst'],['081','Pflanzentechnologe/in','Agrar/Forst'],
        ['091','Revierjäger/in','Agrar/Forst'],['092','Forstwirt/in','Agrar/Forst'],
        ['110','Molkereifachmann','Milchwirtschaft'],['111','Milchtechnologe/in','Milchwirtschaft'],
        ['121','Milchwirtschaftl. Laborant/in','Milchwirtschaft']
      ];
      newBerufe.forEach(([c,b,t]) => {
        try { this.db.run("INSERT OR IGNORE INTO fachrichtungen (code,bezeichnung,typ) VALUES (?,?,?)", [c,b,t]); } catch(e) {}
      });
      // Relax CHECK constraint on abschlussjahrgaenge.typ to allow Frühjahr/Herbst
      try {
        const jgChk = this.query("SELECT sql FROM sqlite_master WHERE name='abschlussjahrgaenge'")[0]?.sql || '';
        if (jgChk.includes("IN ('Sommer','Winter')") && !jgChk.includes('Frühjahr')) {
          this.db.run("CREATE TABLE abschlussjahrgaenge_new AS SELECT * FROM abschlussjahrgaenge");
          this.db.run("DROP TABLE abschlussjahrgaenge");
          this.db.run(`CREATE TABLE abschlussjahrgaenge (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bezeichnung TEXT NOT NULL UNIQUE,
            typ TEXT NOT NULL DEFAULT '',
            jahr INTEGER,
            pruefungstermin TEXT DEFAULT '',
            aktiv INTEGER DEFAULT 1
          )`);
          this.db.run("INSERT INTO abschlussjahrgaenge SELECT * FROM abschlussjahrgaenge_new");
          this.db.run("DROP TABLE abschlussjahrgaenge_new");
          console.debug('abschlussjahrgaenge CHECK constraint expanded: +Frühjahr, +Herbst');
        }
      } catch(e) { console.warn('abschlussjahrgaenge migration:', e.message); }
      // kontrolltermin_schueler junction table for Einsendungen
      this.db.run("CREATE TABLE IF NOT EXISTS kontrolltermin_schueler (id INTEGER PRIMARY KEY AUTOINCREMENT, kontrolltermin_id INTEGER REFERENCES kontrolltermine(id) ON DELETE CASCADE, schueler_id INTEGER REFERENCES schueler(id), UNIQUE(kontrolltermin_id, schueler_id))");
      // Migrate: copy firma→zusatzbezeichnung if zusatzbezeichnung empty (one-time)
      try { this.db.run("UPDATE betriebe SET zusatzbezeichnung=firma WHERE zusatzbezeichnung='' AND firma!=''"); } catch(e) {}
      // Relax CHECK constraint on kw_status/kw_maengel to allow AJ 4 (Verlängerer)
      try {
        const chk = this.query("SELECT sql FROM sqlite_master WHERE name='kw_status'")[0]?.sql || '';
        if (chk.includes('IN (1,2,3)')) {
          this.db.run("CREATE TABLE kw_status_new AS SELECT * FROM kw_status");
          this.db.run("DROP TABLE kw_status");
          this.db.run(`CREATE TABLE kw_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER NOT NULL REFERENCES schueler(id),
            ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
            kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
            maengel_codes TEXT DEFAULT '', behobene_codes TEXT DEFAULT '', fehltage INTEGER DEFAULT 0,
            geprueft INTEGER DEFAULT 0, bemerkung TEXT DEFAULT '',
            erstellt_bei INTEGER DEFAULT NULL, behoben_bei INTEGER DEFAULT NULL,
            UNIQUE(schueler_id, ausbildungsjahr, kalenderwoche))`);
          this.db.run("INSERT OR IGNORE INTO kw_status (id,schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,behobene_codes,fehltage,geprueft,bemerkung,erstellt_bei,behoben_bei) SELECT id,schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,behobene_codes,fehltage,geprueft,COALESCE(bemerkung,''),erstellt_bei,behoben_bei FROM kw_status_new");
          this.db.run("DROP TABLE kw_status_new");
          console.debug('kw_status CHECK constraint relaxed to BETWEEN 1 AND 4');
        }
      } catch(e) { console.warn('kw_status migration:', e.message); }
      try {
        const chk2 = this.query("SELECT sql FROM sqlite_master WHERE name='kw_maengel'")[0]?.sql || '';
        if (chk2.includes('IN (1,2,3)')) {
          this.db.run("CREATE TABLE kw_maengel_new AS SELECT * FROM kw_maengel");
          this.db.run("DROP TABLE kw_maengel");
          this.db.run(`CREATE TABLE kw_maengel (
            id INTEGER PRIMARY KEY AUTOINCREMENT, kontrollergebnis_id INTEGER NOT NULL REFERENCES kontrollergebnisse(id),
            ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
            kalenderwoche INTEGER, maengel_codes TEXT DEFAULT '', fehltage INTEGER DEFAULT 0,
            UNIQUE(kontrollergebnis_id, ausbildungsjahr, kalenderwoche))`);
          this.db.run("INSERT OR IGNORE INTO kw_maengel SELECT * FROM kw_maengel_new");
          this.db.run("DROP TABLE kw_maengel_new");
        }
      } catch(e) { console.warn('kw_maengel migration:', e.message); }
      // Default Textbausteine if not set (unified for Bemerkung + Sonstiges)
      const hasTB = this.query("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'");
      if (!hasTB.length) {
        // Migrate from old key if exists
        const oldTB = this.query("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_sonstiges'");
        if (oldTB.length) {
          this.db.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung',?)", [oldTB[0].wert]);
          this.db.run("DELETE FROM einstellungen WHERE schluessel='textbausteine_sonstiges'");
        } else {
          this.db.run("INSERT OR IGNORE INTO einstellungen (schluessel,wert) VALUES ('textbausteine_bemerkung',?)",
            [JSON.stringify([
              'Wetterbericht fehlt durchgehend',
              'Unterschrift Ausbilder fehlt',
              'Sachberichte zu Wetter nachzureichen per E-Mail',
              'Berichte komplett lückenhaft – persönliches Gespräch empfohlen',
              'Berichtsheft ordentlich und vollständig geführt',
              'Fehltage-Nachweise nicht beigelegt',
              'Überbetriebliche Ausbildungsnachweise fehlen',
              'Ausbildungsplan nicht abgeheftet',
              'Berichtsheft nicht vollständig unterschrieben',
              'Sachberichte fehlen teilweise',
              'Wochenberichte zu knapp / nicht aussagekräftig',
              'Zeichnungen/Skizzen fehlen',
              'Berichtsheft verschmutzt / unordentlich',
              'Ausbildungsnachweis nicht chronologisch geordnet'
            ])]);
        }
      }
      // Blockplan table for school presence weeks
      try {
        this.db.run(`CREATE TABLE IF NOT EXISTS blockplan (
          id INTEGER PRIMARY KEY AUTOINCREMENT, berufsschule_id INTEGER REFERENCES berufsschulen(id),
          schuljahr TEXT DEFAULT '2025/2026', lehrjahr INTEGER DEFAULT 1, kalenderwoche INTEGER NOT NULL,
          UNIQUE(berufsschule_id, schuljahr, lehrjahr, kalenderwoche))`);
      } catch(e) {}
      // Ensure default pruefer exist (deduplicate first for existing DBs)
      try {
        // Remove duplicates: keep lowest id per name
        this.db.run(`DELETE FROM pruefer WHERE id NOT IN (SELECT MIN(id) FROM pruefer GROUP BY name)`);
        // Add unique index if not exists
        try { this.db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pruefer_name ON pruefer(name)'); } catch(e) {}
      } catch(e) { console.warn('Pruefer dedup:', e); }
      this.db.run("INSERT OR IGNORE INTO pruefer (name, email) VALUES ('Hannes Pix','hannes.pix@rpf.bwl.de'),('Christoph Zilz','christoph.zilz@rpf.bwl.de'),('Eva Dronia','eva.dronia@rpf.bwl.de')");
      // Update emails for existing pruefer without email
      this.db.run("UPDATE pruefer SET email='hannes.pix@rpf.bwl.de' WHERE name='Hannes Pix' AND (email='' OR email IS NULL)");
      this.db.run("UPDATE pruefer SET email='christoph.zilz@rpf.bwl.de' WHERE name='Christoph Zilz' AND (email='' OR email IS NULL)");
      this.db.run("UPDATE pruefer SET email='eva.dronia@rpf.bwl.de' WHERE name='Eva Dronia' AND (email='' OR email IS NULL)");
      // Ensure kw_status and durchsicht_snapshots tables exist
      this.db.run(`CREATE TABLE IF NOT EXISTS kw_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schueler_id INTEGER NOT NULL,
        ausbildungsjahr INTEGER,
        kalenderwoche INTEGER,
        maengel_codes TEXT DEFAULT '',
        behobene_codes TEXT DEFAULT '',
        fehltage INTEGER DEFAULT 0,
        geprueft INTEGER DEFAULT 0,
        erstellt_bei INTEGER DEFAULT NULL,
        behoben_bei INTEGER DEFAULT NULL,
        UNIQUE(schueler_id, ausbildungsjahr, kalenderwoche)
      )`);
      this.db.run(`CREATE TABLE IF NOT EXISTS durchsicht_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kontrollergebnis_id INTEGER NOT NULL,
        schueler_id INTEGER NOT NULL,
        snapshot_datum TEXT NOT NULL,
        kw_daten_json TEXT DEFAULT '{}',
        geprueft_kws_json TEXT DEFAULT '{}',
        pflichtteile_json TEXT DEFAULT '{}',
        ergebnis TEXT DEFAULT '',
        bemerkung TEXT DEFAULT '',
        pruefer TEXT DEFAULT '',
        erstellt_am TEXT DEFAULT (datetime('now','localtime'))
      )`);
      // Migrate kw_maengel → kw_status (if kw_status is empty but kw_maengel has data)
      const kwStatusCount = this.scalar('SELECT COUNT(*) FROM kw_status') || 0;
      const kwMaengelCount = this.scalar('SELECT COUNT(*) FROM kw_maengel') || 0;
      if (kwStatusCount === 0 && kwMaengelCount > 0) {
        console.log(`Migrating ${kwMaengelCount} kw_maengel → kw_status...`);
        this.db.run(`INSERT OR IGNORE INTO kw_status (schueler_id, ausbildungsjahr, kalenderwoche, maengel_codes, fehltage, geprueft, erstellt_bei)
          SELECT ke.schueler_id, km.ausbildungsjahr, km.kalenderwoche, km.maengel_codes, km.fehltage, 1, km.kontrollergebnis_id
          FROM kw_maengel km JOIN kontrollergebnisse ke ON km.kontrollergebnis_id=ke.id`);
        console.debug('Migration done');
      }
    } catch(e) { console.warn('Migration:', e); }

    // ── Multi-Klassen Migration ──
    try {
      // Create junction table if not exists
      this.db.run(`CREATE TABLE IF NOT EXISTS kontrolltermin_klassen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kontrolltermin_id INTEGER REFERENCES kontrolltermine(id) ON DELETE CASCADE,
        klasse_id INTEGER REFERENCES klassen(id),
        UNIQUE(kontrolltermin_id, klasse_id)
      )`);
      // Migrate existing kontrolltermine.klasse_id → kontrolltermin_klassen
      const junctionCount = this.scalar('SELECT COUNT(*) FROM kontrolltermin_klassen') || 0;
      if (junctionCount === 0) {
        const oldTermine = this.query('SELECT id, klasse_id FROM kontrolltermine WHERE klasse_id IS NOT NULL');
        if (oldTermine.length) {
          oldTermine.forEach(t => {
            this.db.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [t.id, t.klasse_id]);
          });
          console.debug(`Multi-Klassen-Migration: ${oldTermine.length} Termine migriert`);
        }
      }
    } catch(e) { console.warn('Multi-Klassen-Migration:', e); }

    // ── Auto-link schueler.ausbildungsstaette → betriebe ──
    try {
      const unlinked = this.query("SELECT id, ausbildungsstaette FROM schueler WHERE betrieb_id IS NULL AND ausbildungsstaette != '' AND aktiv=1");
      if (unlinked.length) {
        let linked = 0;
        unlinked.forEach(s => {
          const name = s.ausbildungsstaette.replace(/\s*\(.*\)$/, '').trim();
          let b = this.query('SELECT id FROM betriebe WHERE name=?', [name])[0];
          if (!b) b = this.query('SELECT id FROM betriebe WHERE name LIKE ?', [`%${name}%`])[0];
          if (b) { this.db.run('UPDATE schueler SET betrieb_id=? WHERE id=?', [b.id, s.id]); linked++; }
        });
        if (linked) console.log(`Auto-Link: ${linked} Schüler mit Betrieben verknüpft`);
      }
    } catch(e) { console.warn('Auto-Link Betriebe:', e); }
  },

  // ── Jahrgang management ──
  // Jahrgang is now a per-view filter, no global state needed
  loadJahrgaenge() { /* no-op, kept for compatibility */ },
  setJahrgang(id) { /* no-op */ },

  // ── Navigation ──
  toggleSidebar() {
    const sidebar = document.getElementById('sidebarNav');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (window.innerWidth <= 768) {
      // Mobile: overlay mode
      const isOpen = sidebar.classList.contains('open');
      sidebar.classList.toggle('open', !isOpen);
      backdrop.classList.toggle('active', !isOpen);
      document.body.style.overflow = isOpen ? '' : 'hidden';
    } else {
      // Desktop: collapse/expand
      sidebar.classList.toggle('collapsed');
      try { App.uSet('sidebar_collapsed', sidebar.classList.contains('collapsed') ? '1' : ''); } catch(e) {}
    }
  },

  closeSidebar() {
    const sidebar = document.getElementById('sidebarNav');
    const backdrop = document.getElementById('sidebarBackdrop');
    sidebar.classList.remove('open');
    backdrop.classList.remove('active');
    document.body.style.overflow = '';
  },

  _restoreSidebarState() {
    try {
      const collapsed = App.uGet('sidebar_collapsed');
      if (collapsed === '1') document.getElementById('sidebarNav')?.classList.add('collapsed');
    } catch(e) {}
  },

  navigate(view, skipHash) {
    this.currentView = view;
    if (!skipHash) location.hash = '#' + view;
    // Persist current view for reload recovery
    try { App.uSet('last_view', view); } catch(e) {}
    document.querySelectorAll('.sidebar-item').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
    // Stop live sync when leaving kontrolle
    if (view !== 'kontrolle' && typeof KontrolleHandler !== 'undefined') {
      KontrolleHandler.stopLiveSync();
    }
    // Close sidebar on mobile after navigation
    if (window.innerWidth <= 768) this.closeSidebar();
    this.renderCurrentView();
  },
  renderCurrentView() {
    this.updateBadges();
    this.refreshJgDropdown();
    const views = {
      dashboard: Views.dashboard,
      stammdaten: Views.stammdaten,
      import: Views.importView,
      planung: Views.planung,
      kontrolle: Views.kontrolle,
      nacherfassung: Views.nacherfassung,
      wiedervorlagen: Views.wiedervorlagen,
      berichte: Views.berichte,
      einstellungen: Views.einstellungen,
      hilfe: Views.hilfe,
    };
    const fn = views[this.currentView];
    if (fn) fn.call(Views);
    // Make all data-tables sortable after render
    setTimeout(() => TableSort.initAll(), 100);
  },

  updateBadges() {
    if (!this.db) return;
    const today = new Date().toISOString().split('T')[0];
    const jf = this.jgWhere('s.jahrgang_id');
    const overdue = this.scalar(`SELECT COUNT(*) FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE w.status='offen' AND w.frist_datum < ?${jf.where}`, [today, ...jf.params]) || 0;
    const b1 = document.getElementById('badgeOverdue');
    const b2 = document.getElementById('badgeWV');
    if (overdue > 0) {
      b1.textContent = overdue; b1.style.display = '';
      b2.textContent = overdue; b2.style.display = '';
    } else {
      b1.style.display = 'none';
      b2.style.display = 'none';
    }
  },

  // ── Toast notifications ──
  showLoading(text) {
    const el = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').textContent = text || 'Wird geladen…';
    el.style.display = 'flex';
  },
  hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
  },
  _showOfflineBanner(critical) {
    let banner = document.getElementById('offlineBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offlineBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9000;padding:8px 16px;text-align:center;font-size:13px;font-weight:600;transition:transform 0.3s;display:flex;align-items:center;justify-content:center;gap:8px';
      document.body.prepend(banner);
    }
    if (critical) {
      banner.style.background = '#fde8e8'; banner.style.color = '#991b1b';
      banner.innerHTML = `🔴 Verbindung zur Datenbank getrennt – Änderungen werden lokal gehalten <button class="btn btn-sm" style="background:#e8a820;color:#fff;border:none;margin-left:8px;padding:3px 12px;font-size:11px" onclick="App.tryReconnect()">🔄 Erneut verbinden</button>`;
    } else {
      banner.style.background = '#fef7ec'; banner.style.color = '#92400e';
      banner.innerHTML = '🟡 Verbindungsversuch…';
    }
    banner.style.transform = 'translateY(0)';
  },
  _hideOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.remove();
  },

  toast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4000);
  },

  // ── Modal ──
  openModal(title, bodyHtml, footerHtml = '') {
    const m = document.getElementById('modalContent');
    m.innerHTML = `
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="btn-icon" onclick="App.closeModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
    `;
    document.getElementById('modalOverlay').classList.add('active');
    setTimeout(() => TableSort.initAll(), 50);
  },
  closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
  },

  // ── ICS Export ──
  exportICS(events) {
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Berichtsheftkontrolle//DE\r\nCALSCALE:GREGORIAN\r\n';
    events.forEach(e => {
      const dtStart = e.date.replace(/-/g, '');
      ics += `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${dtStart}\r\nSUMMARY:${e.title}\r\nDESCRIPTION:${e.description || ''}\r\nEND:VEVENT\r\n`;
    });
    ics += 'END:VCALENDAR';
    const blob = new Blob([ics], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BH-Kontrolltermine_${new Date().toISOString().split('T')[0]}.ics`;
    a.click();
  },
};
