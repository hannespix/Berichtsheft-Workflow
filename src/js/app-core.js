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
  extraFilters: [], // Dynamic extra filters: [{field:'verkuerzer', value:'ja'}, ...]
  currentUser: '', // Active Sachbearbeiter name

  // ── Dynamic extra filter definitions (categorized) ──
  extraFilterDefs: {
    // Kategorie: Ausbildung
    verkuerzer:       { cat: 'Ausbildung', label: 'Verkürzer', type: 'toggle', options: [{v:'ja',l:'Nur Verkürzer'},{v:'nein',l:'Keine Verkürzer'}], sqlS: (v) => v === 'ja' ? "CAST(julianday(s.ausbildungsende)-julianday(s.ausbildungsbeginn) AS INTEGER) < 1000" : "(CAST(julianday(s.ausbildungsende)-julianday(s.ausbildungsbeginn) AS INTEGER) >= 1000 OR s.ausbildungsende IS NULL OR s.ausbildungsende = '')" },
    landesfachklasse: { cat: 'Ausbildung', label: 'Landesfachklasse', type: 'toggle', options: [{v:'ja',l:'Nur LFK'},{v:'nein',l:'Keine LFK'}], sqlS: (v) => v === 'ja' ? "s.landesfachklasse != ''" : "(s.landesfachklasse = '' OR s.landesfachklasse IS NULL)" },
    geschlecht:       { cat: 'Ausbildung', label: 'Geschlecht', type: 'select', optionsSql: "SELECT DISTINCT geschlecht FROM schueler WHERE geschlecht != '' AND geschlecht IS NOT NULL ORDER BY geschlecht", optionKey: 'geschlecht', sqlS: (v) => `s.geschlecht = '${v.replace(/'/g,"''")}'` },
    schulabschluss:   { cat: 'Ausbildung', label: 'Schulabschluss', type: 'select', optionsSql: "SELECT DISTINCT schulabschluss FROM schueler WHERE schulabschluss != '' AND schulabschluss IS NOT NULL ORDER BY schulabschluss", optionKey: 'schulabschluss', sqlS: (v) => `s.schulabschluss = '${v.replace(/'/g,"''")}'` },
    lehrjahr:         { cat: 'Ausbildung', label: 'Lehrjahr', type: 'select', options: [{v:'1',l:'1. Lehrjahr'},{v:'2',l:'2. Lehrjahr'},{v:'3',l:'3. Lehrjahr'},{v:'4',l:'4. Lehrjahr (Verkürzer/Verlängerer)'}], sqlS: (v) => `s.klasse_id IN (SELECT id FROM klassen WHERE lehrjahr = ${parseInt(v)||0})` },
    ausb_beginn_ab:   { cat: 'Ausbildung', label: 'Ausb.beginn ab', type: 'date', sqlS: (v) => `s.ausbildungsbeginn >= '${v.replace(/'/g,"''")}'` },
    ausb_beginn_bis:  { cat: 'Ausbildung', label: 'Ausb.beginn bis', type: 'date', sqlS: (v) => `s.ausbildungsbeginn <= '${v.replace(/'/g,"''")}'` },
    ausb_ende_ab:     { cat: 'Ausbildung', label: 'Ausb.ende ab', type: 'date', sqlS: (v) => `s.ausbildungsende >= '${v.replace(/'/g,"''")}'` },
    ausb_ende_bis:    { cat: 'Ausbildung', label: 'Ausb.ende bis', type: 'date', sqlS: (v) => `s.ausbildungsende <= '${v.replace(/'/g,"''")}'` },
    // Kategorie: Prüfungen
    ap_zugelassen:    { cat: 'Prüfungen', label: 'AP-Zulassung', type: 'toggle', options: [{v:'ja',l:'Zugelassen'},{v:'nein',l:'Nicht zugelassen'}], sqlS: (v) => v === 'ja' ? "s.ap_zugelassen = 1" : "s.ap_zugelassen = 0" },
    ap_bestanden:     { cat: 'Prüfungen', label: 'AP bestanden', type: 'toggle', options: [{v:'ja',l:'Bestanden'},{v:'nein',l:'Nicht bestanden'}], sqlS: (v) => v === 'ja' ? "s.ap_bestanden = 1" : "s.ap_bestanden = 0" },
    pruefungserfolg:  { cat: 'Prüfungen', label: 'Prüfungserfolg', type: 'select', optionsSql: "SELECT DISTINCT pruefungserfolg FROM schueler WHERE pruefungserfolg != '' AND pruefungserfolg IS NOT NULL ORDER BY pruefungserfolg", optionKey: 'pruefungserfolg', sqlS: (v) => `s.pruefungserfolg = '${v.replace(/'/g,"''")}'` },
    zwischenpruefung: { cat: 'Prüfungen', label: 'Zwischenprüfung', type: 'select', optionsSql: "SELECT DISTINCT zwischenpruefung FROM schueler WHERE zwischenpruefung != '' AND zwischenpruefung IS NOT NULL ORDER BY zwischenpruefung", optionKey: 'zwischenpruefung', optionLabel: (r) => App.zpLabel ? App.zpLabel(r.zwischenpruefung) : r.zwischenpruefung, sqlS: (v) => `s.zwischenpruefung = '${v.replace(/'/g,"''")}'` },
    // Kategorie: Standort
    berufsschule:     { cat: 'Standort', label: 'Berufsschule', type: 'select', optionsSql: "SELECT DISTINCT bs.id, bs.name FROM berufsschulen bs JOIN klassen k ON k.berufsschule_id=bs.id JOIN schueler s ON s.klasse_id=k.id WHERE s.aktiv=1 ORDER BY bs.name", optionKey: 'name', optionValue: 'id', sqlS: (v) => `s.klasse_id IN (SELECT id FROM klassen WHERE berufsschule_id = ${parseInt(v)||0})` },
    klasse:           { cat: 'Standort', label: 'Klasse', type: 'select', optionsSql: "SELECT k.id, k.klassenbezeichnung || ' (' || bs.name || ')' as label FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id ORDER BY bs.name, k.klassenbezeichnung", optionKey: 'label', optionValue: 'id', sqlS: (v) => `s.klasse_id = ${parseInt(v)||0}` },
    plz_bereich:      { cat: 'Standort', label: 'PLZ-Bereich', type: 'text', placeholder: 'z.B. 79, 78...', sqlS: (v) => { const safe = v.replace(/[^0-9]/g, ''); return safe ? `s.betrieb_id IN (SELECT id FROM betriebe WHERE plz LIKE '${safe}%')` : '1=1'; } },
    betrieb_ort:      { cat: 'Standort', label: 'Betrieb Ort', type: 'select', optionsSql: "SELECT DISTINCT ort FROM betriebe WHERE ort != '' ORDER BY ort", optionKey: 'ort', sqlS: (v) => { const safe = v.replace(/\\/g,'').replace(/'/g,"''"); return `s.betrieb_id IN (SELECT id FROM betriebe WHERE ort = '${safe}')`; } },
    betrieb:          { cat: 'Standort', label: 'Betrieb', type: 'select', optionsSql: "SELECT DISTINCT id, name FROM betriebe WHERE name != '' ORDER BY name", optionKey: 'name', optionValue: 'id', sqlS: (v) => `s.betrieb_id = ${parseInt(v)||0}` },
    // Kategorie: Status & Kontrolle
    offene_maengel:   { cat: 'Kontrolle', label: 'Offene Mängel', type: 'toggle', options: [{v:'ja',l:'Mit Mängeln'},{v:'nein',l:'Ohne Mängel'}], sqlS: (v) => v === 'ja' ? "s.id IN (SELECT schueler_id FROM kw_status WHERE maengel_codes != '' AND maengel_codes != 'H')" : "s.id NOT IN (SELECT schueler_id FROM kw_status WHERE maengel_codes != '' AND maengel_codes != 'H')" },
    offene_wv:        { cat: 'Kontrolle', label: 'Offene Wiedervorlage', type: 'toggle', options: [{v:'ja',l:'Mit offener WV'},{v:'nein',l:'Ohne offene WV'}], sqlS: (v) => v === 'ja' ? "s.id IN (SELECT schueler_id FROM wiedervorlagen WHERE status IN ('offen','ueberfaellig'))" : "s.id NOT IN (SELECT schueler_id FROM wiedervorlagen WHERE status IN ('offen','ueberfaellig'))" },
    bav_status:       { cat: 'Kontrolle', label: 'BAV-Status', type: 'select', optionsSql: "SELECT DISTINCT bav_status FROM schueler WHERE bav_status != '' AND bav_status IS NOT NULL ORDER BY bav_status", optionKey: 'bav_status', sqlS: (v) => { const safe = v.replace(/\\/g,'').replace(/'/g,"''"); return `s.bav_status = '${safe}'`; } },
    status_inaktiv:   { cat: 'Kontrolle', label: 'Inaktive Schüler', type: 'toggle', options: [{v:'ja',l:'Nur inaktive'},{v:'alle',l:'Aktive + Inaktive'}], sqlS: (v) => v === 'ja' ? "s.aktiv = 0" : "1=1", overrideAktiv: true },
    inaktiv_grund:    { cat: 'Kontrolle', label: 'Inaktiv-Grund', type: 'select', optionsSql: "SELECT DISTINCT inaktiv_grund FROM schueler WHERE inaktiv_grund != '' AND inaktiv_grund IS NOT NULL ORDER BY inaktiv_grund", optionKey: 'inaktiv_grund', sqlS: (v) => { const safe = v.replace(/\\/g,'').replace(/'/g,"''"); return `s.inaktiv_grund = '${safe}'`; } },
    // Kategorie: Datenqualität
    ohne_betrieb:     { cat: 'Datenqualität', label: 'Ohne Betrieb', type: 'toggle', options: [{v:'ja',l:'Ohne Betrieb'}], sqlS: () => "(s.betrieb_id IS NULL OR s.betrieb_id = 0)" },
    ohne_klasse:      { cat: 'Datenqualität', label: 'Ohne Klasse', type: 'toggle', options: [{v:'ja',l:'Ohne Klasse'}], sqlS: () => "(s.klasse_id IS NULL OR s.klasse_id = 0)" },
    ohne_email:       { cat: 'Datenqualität', label: 'Ohne E-Mail', type: 'toggle', options: [{v:'ja',l:'Ohne E-Mail'}], sqlS: () => "(s.email IS NULL OR s.email = '') AND s.betrieb_id NOT IN (SELECT id FROM betriebe WHERE email != '')" },
  },

  // ── Extra Filter UI Methods ──
  toggleExtraFilterDropdown() {
    const dd = document.getElementById('extraFilterDropdown');
    if (!dd) return;
    if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }
    // Close other dropdowns
    document.querySelectorAll('.fp-dropdown').forEach(d => { if (d.id !== 'extraFilterDropdown') d.style.display = 'none'; });
    // Build categorized dropdown
    const usedFields = this.extraFilters.map(f => f.field);
    const available = Object.entries(this.extraFilterDefs).filter(([k]) => !usedFields.includes(k));
    if (!available.length) { App.toast('Alle Filter bereits hinzugefügt', 'info'); return; }
    const byCat = {};
    available.forEach(([k, def]) => { if (!byCat[def.cat]) byCat[def.cat] = []; byCat[def.cat].push([k, def]); });
    const catOrder = ['Ausbildung', 'Prüfungen', 'Standort', 'Kontrolle', 'Datenqualität'];
    dd.innerHTML = catOrder.filter(c => byCat[c]).map(cat => `
      <div style="padding:4px 12px 2px;font-size:10px;color:var(--clr-sage);text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--clr-sand);margin-top:2px">${esc(cat)}</div>
      ${byCat[cat].map(([k, def]) => `<div class="fp-dd-item" style="padding:4px 12px;cursor:pointer;font-size:12px" onclick="App._addExtraFilter('${k}')">${esc(def.label)}</div>`).join('')}
    `).join('');
    dd.style.display = '';
    this._clampDropdown(dd);
    // Close on outside click
    setTimeout(() => {
      const close = (e) => { if (!dd.contains(e.target) && e.target.id !== 'extraFilterBtn') { dd.style.display = 'none'; document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 10);
  },

  _addExtraFilter(field) {
    const def = this.extraFilterDefs[field];
    if (!def) return;
    // For toggles with single option, auto-set value
    const autoVal = (def.type === 'toggle' && def.options.length === 1) ? def.options[0].v : '';
    this.extraFilters.push({ field, value: autoVal });
    document.getElementById('extraFilterDropdown').style.display = 'none';
    this._renderExtraFilterChips();
    if (autoVal) { this._updateFilterCount(); this.renderCurrentView(); }
  },

  _removeExtraFilter(idx) {
    this.extraFilters.splice(idx, 1);
    this._renderExtraFilterChips();
    this._updateFilterCount();
    this.renderCurrentView();
  },

  _onExtraFilterChange(idx, value) {
    this.extraFilters[idx].value = value;
    this._updateFilterCount();
    this.renderCurrentView();
  },

  // ── Mehrfachauswahl für Zusatzfilter vom Typ "select" ──
  // f.value ist dort ein ARRAY gewählter Werte ([] = alle / inaktiv). Damit
  // lassen sich z.B. mehrere Zwischenprüfungstermine gleichzeitig wählen;
  // die Werte werden in _extraFilterSql mit ODER verknüpft.
  _efAktiv(f) { return Array.isArray(f.value) ? f.value.length > 0 : !!f.value; },
  _efLabel(idx) {
    const f = this.extraFilters[idx];
    if (!f || !Array.isArray(f.value) || !f.value.length) return 'Alle';
    if (f.value.length === 1) {
      const l = String((f.labels && f.labels[0]) || f.value[0]);
      return l.length > 20 ? l.slice(0, 19) + '…' : l;
    }
    return f.value.length + ' gewählt';
  },
  _efToggle(idx) {
    const dd = document.getElementById('efDd_' + idx);
    if (!dd) return;
    document.querySelectorAll('[id^="efDd_"]').forEach(d => { if (d !== dd) d.style.display = 'none'; });
    const oeffnen = dd.style.display === 'none';
    dd.style.display = oeffnen ? '' : 'none';
    if (oeffnen) {
      this._clampDropdown(dd);
      setTimeout(() => {
        const closer = (e) => {
          if (!dd.contains(e.target) && e.target.id !== 'efBtn_' + idx) {
            dd.style.display = 'none';
            document.removeEventListener('click', closer);
          }
        };
        document.addEventListener('click', closer);
      }, 10);
    }
  },
  _efAll(idx, checked) {
    document.querySelectorAll('.chk-ef-' + idx).forEach(c => { c.checked = checked; });
    this._efChange(idx);
  },
  _efChange(idx) {
    const f = this.extraFilters[idx];
    if (!f) return;
    const checked = [...document.querySelectorAll('.chk-ef-' + idx)].filter(c => c.checked);
    f.value = checked.map(c => c.value);
    f.labels = checked.map(c => c.dataset.l || c.value);
    const btn = document.getElementById('efBtn_' + idx);
    if (btn) btn.textContent = this._efLabel(idx) + ' ▾';
    this._updateFilterCount();
    this.renderCurrentView();
  },

  _clearAllExtraFilters() {
    this.extraFilters = [];
    this._renderExtraFilterChips();
    this._updateFilterCount();
    this.renderCurrentView();
  },

  _renderExtraFilterChips() {
    const box = document.getElementById('extraFilterChips');
    if (!box) return;
    if (!this.extraFilters.length) { box.innerHTML = ''; return; }
    box.innerHTML = this.extraFilters.map((f, idx) => {
      const def = this.extraFilterDefs[f.field];
      if (!def) return '';
      let input = '';
      if (def.type === 'text') {
        input = `<input class="form-control" style="width:100px;font-size:11px;padding:1px 6px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.15);color:white;border-radius:4px" placeholder="${esc(def.placeholder||'')}" value="${esc(f.value)}" oninput="App._onExtraFilterChange(${idx},this.value)">`;
      } else if (def.type === 'date') {
        input = `<input type="date" class="form-control" style="width:130px;font-size:11px;padding:1px 4px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.15);color:white;border-radius:4px" value="${esc(f.value)}" onchange="App._onExtraFilterChange(${idx},this.value)">`;
      } else if (def.type === 'toggle') {
        const opts = def.options;
        if (opts.length === 1) {
          input = `<span style="font-size:11px">${esc(opts[0].l)}</span>`;
        } else {
          input = `<select style="font-size:11px;padding:1px 4px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.15);color:white;border-radius:4px" onchange="App._onExtraFilterChange(${idx},this.value)">
            <option value="" style="color:#333">–</option>${opts.map(o => `<option value="${esc(o.v)}" style="color:#333" ${f.value===o.v?'selected':''}>${esc(o.l)}</option>`).join('')}</select>`;
        }
      } else if (def.type === 'select') {
        let opts = [];
        if (def.optionsSql) {
          try { const rows = App.query(def.optionsSql); opts = rows.map(r => ({ v: def.optionValue ? String(r[def.optionValue]) : r[def.optionKey], l: def.optionLabel ? def.optionLabel(r) : r[def.optionKey] })); } catch(e) {}
        } else if (def.options) { opts = def.options; }
        // Alt-Zustand (Einzelwert als String) in die Mehrfachauswahl übernehmen
        if (!Array.isArray(f.value)) f.value = f.value ? [String(f.value)] : [];
        const sel = f.value.map(String);
        input = `<span style="position:relative;display:inline-block">
          <button type="button" id="efBtn_${idx}" style="font-size:11px;padding:1px 8px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.15);color:white;border-radius:4px;cursor:pointer;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="App._efToggle(${idx});event.stopPropagation()">${esc(this._efLabel(idx))} ▾</button>
          <div id="efDd_${idx}" style="display:none;position:absolute;top:calc(100% + 3px);left:0;z-index:80;background:white;color:var(--clr-text);border:1px solid var(--clr-sand);border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.3);min-width:190px;max-width:280px;max-height:230px;overflow-y:auto;padding:2px 0;text-align:left">
            <div style="display:flex;gap:10px;padding:3px 10px;border-bottom:1px solid var(--clr-sand);font-size:10px">
              <a href="#" style="color:var(--clr-forest)" onclick="App._efAll(${idx},true);return false">alle</a>
              <a href="#" style="color:var(--clr-forest)" onclick="App._efAll(${idx},false);return false">keine</a>
              <span style="margin-left:auto;color:var(--clr-text-light)">Mehrfachauswahl</span>
            </div>
            ${opts.map(o => `<label style="display:flex;align-items:center;gap:6px;padding:2px 10px;cursor:pointer;font-size:11px;white-space:nowrap" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
              <input type="checkbox" class="chk-ef-${idx}" value="${esc(String(o.v))}" data-l="${esc(String(o.l))}" ${sel.includes(String(o.v)) ? 'checked' : ''} onchange="App._efChange(${idx})" style="accent-color:var(--clr-forest)"> ${esc(String(o.l))}
            </label>`).join('')}
          </div>
        </span>`;
      }
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(255,200,50,0.2);border:1px solid rgba(255,200,50,0.5);border-radius:6px;font-size:11px;color:rgba(255,255,255,0.9)">
        <strong>${esc(def.label)}:</strong> ${input}
        <span style="cursor:pointer;color:rgba(255,100,100,0.9);font-weight:bold;padding:0 2px" onclick="App._removeExtraFilter(${idx})" title="Filter entfernen">✕</span>
      </span>`;
    }).join(' ');
  },

  // Generate SQL for extra filters (schueler-level, used by gf())
  _extraFilterSql() {
    let w = '';
    let overrideAktiv = false;
    this.extraFilters.forEach(f => {
      if (!this._efAktiv(f)) return;
      const def = this.extraFilterDefs[f.field];
      if (!def || !def.sqlS) return;
      if (Array.isArray(f.value)) {
        // Mehrfachauswahl: gewählte Werte mit ODER verknüpfen
        w += ` AND (${f.value.map(v => `(${def.sqlS(v)})`).join(' OR ')})`;
      } else {
        w += ` AND (${def.sqlS(f.value)})`;
      }
      if (def.overrideAktiv) overrideAktiv = true;
    });
    return { sql: w, overrideAktiv };
  },

  // ── Per-User localStorage ──
  uKey(key) { return this.currentUser ? `bhk_${this.currentUser.replace(/\s+/g,'_')}_${key}` : `bhk_${key}`; },
  uGet(key, fallback) { try { return localStorage.getItem(this.uKey(key)) ?? fallback ?? null; } catch(e) { return fallback ?? null; } },
  uSet(key, val) { try { localStorage.setItem(this.uKey(key), val); } catch(e) {} },
  uRemove(key) { try { localStorage.removeItem(this.uKey(key)); } catch(e) {} },
  // Browser-weite Einstellungen (NICHT pro Prüfer), z.B. die Freischaltung der
  // Statistikansicht. Immer über diese Helfer zugreifen: auf gesperrten
  // Verwaltungs-PCs wirft localStorage einen SecurityError, der eine ganze
  // Ansicht mitreißen kann, wenn er mitten im Aufbau der Seite auftritt.
  lsGet(key, fallback) { try { return localStorage.getItem(key) ?? fallback ?? null; } catch(e) { return fallback ?? null; } },
  lsSet(key, val) { try { localStorage.setItem(key, val); } catch(e) {} },
  lsRemove(key) { try { localStorage.removeItem(key); } catch(e) {} },

  _populateUserSelect() {
    const sel = document.getElementById('topbarUserSelect');
    if (!sel || !this.db) return;
    const pruefer = this.query('SELECT name FROM pruefer WHERE aktiv=1 ORDER BY name');
    const u = this.currentUser;
    sel.innerHTML = '<option value="">Prüfer wählen</option>' + pruefer.map(p =>
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
    this.toast(name ? `${name}` : 'Kein Benutzer', 'info');
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
  // Dropdown im Viewport halten: linksbündig am Button; läuft es rechts aus
  // dem Bildschirm → rechtsbündig; läuft es links raus (z.B. durch die frühere
  // pauschale right:0-Mobilregel) → wieder linksbündig
  _clampDropdown(dd) {
    try {
      dd.style.left = '0'; dd.style.right = 'auto';
      const r = dd.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) { dd.style.left = 'auto'; dd.style.right = '0'; }
      const r2 = dd.getBoundingClientRect();
      if (r2.left < 8) { dd.style.left = '0'; dd.style.right = 'auto'; }
    } catch(e) {}
  },
  toggleBavDropdown() {
    const dd = document.getElementById('bavFilterDropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    this._closeAllFilterDropdowns();
    if (!isOpen) { dd.style.display = 'block'; this._clampDropdown(dd); }
  },
  setBavFilter(val) {
    this.filterBavStatus = val;
    const btn = document.getElementById('bavFilterBtn');
    const labels = {aktiv:'▤ Aktive BAV ▾', alle:'▤ Alle BAV ▾', ende:'▤ Beendete BAV ▾'};
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
      this._clampDropdown(dd);
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

  // AP und ZP sind KOMBINIERBAR: beide Dimensionen können gleichzeitig
  // eingeschränkt sein. Sind beide aktiv, wirkt die Auswahl als VEREINIGUNG
  // (Azubi gehört zu einem der gewählten AP-Jahrgänge ODER einer der
  // gewählten ZP-Kohorten) – siehe gf(). Eine komplett angehakte Sektion
  // bedeutet weiterhin "keine Einschränkung in dieser Dimension".
  _applyJgZp() {
    // Nur aus den Checkboxen ableiten, wenn das Dropdown gerendert ist –
    // sonst bleibt ein programmatisch gesetzter Filter (z.B. "Filtern"-Knopf
    // in den Stammdaten) unangetastet.
    const allJgCount = document.querySelectorAll('.chk-jg').length;
    if (allJgCount > 0) {
      const checkedJg = [...document.querySelectorAll('.chk-jg:checked')].map(c => parseInt(c.value));
      this.filterJahrgang = checkedJg.length === allJgCount ? [] : (checkedJg.length === 0 ? [-1] : checkedJg);
    }
    const allZpCount = document.querySelectorAll('.chk-zp').length;
    if (allZpCount > 0) {
      const checkedZp = [...document.querySelectorAll('.chk-zp:checked')].map(c => c.value);
      this.filterZp = checkedZp.length === allZpCount ? [] : (checkedZp.length === 0 ? ['---'] : checkedZp);
    }
    this._updateJgUnionHint();
    this._updateJgButton();
    this._updateFilterCount();
    this.renderCurrentView();
  },
  // Hinweiszeile im Dropdown aktualisieren, ohne die Checkboxen neu zu bauen
  _updateJgUnionHint() {
    const el = document.getElementById('jgUnionHint');
    if (!el) return;
    const beide = this.filterJahrgang.length > 0 && this.filterJahrgang[0] !== -1
      && this.filterZp.length > 0 && this.filterZp[0] !== '---';
    el.style.display = beide ? '' : 'none';
  },
  // Ganze Sektion (AP oder ZP) auf einmal an-/abwählen
  _jgSectionAll(cls, checked) {
    document.querySelectorAll('.' + cls).forEach(c => { c.checked = checked; });
    this._applyJgZp();
  },

  // Legacy compat
  _applyJgExclusive() { this._applyJgZp(); },
  _applyJgFilter() { this._applyJgZp(); },
  _updateZpFromJgDropdown() { this._applyJgZp(); },
  // Filter programmatisch auf genau einen AP-Jahrgang setzen (z.B. aus den
  // Stammdaten) – unabhängig vom aktuellen Checkbox-Zustand des Dropdowns
  setJgFilterDirect(id) {
    this.filterJahrgang = [id];
    this.filterZp = [];
    this.refreshJgDropdown();
    this._updateJgButton();
    this._updateFilterCount();
  },

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
      btn.textContent = 'Alle Jahrgänge ▾';
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
      btn.textContent = '' + parts.join(' + ') + ' ▾';
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
      this._clampDropdown(dd);
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
      btn.textContent = 'Alle Berufe ▾';
      btn.classList.remove('active');
    } else if (f.length === 1 && f[0] === -1) {
      btn.textContent = 'Keine Berufe ▾';
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
      btn.textContent = '' + (label || f.length + ' Berufe') + ' ▾';
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
      this._clampDropdown(dd);
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
      btn.textContent = '§ Alle Ämter ▾';
      btn.classList.remove('active');
    } else if (f.length === 1 && f[0] === '-1') {
      btn.textContent = '§ Kein Amt ▾';
      btn.classList.add('active');
    } else if (f.length === 1) {
      btn.textContent = '§ ' + this.amtLabel(f[0]) + ' ▾';
      btn.classList.add('active');
    } else {
      btn.textContent = '§ ' + f.length + ' Ämter ▾';
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
  // Sanitize filter arrays to prevent SQL injection
  _safeIntList(arr) { return arr.map(v => parseInt(v)).filter(v => !isNaN(v) && isFinite(v)); },
  _safeStrList(arr) { return arr.map(s => String(s).replace(/[^a-zA-Z0-9äöüÄÖÜß\-_.\/]/g, '')).filter(s => s.length > 0 && s.length < 50); },
  _sqlInStr(arr) { return arr.map(s => "'" + s.replace(/'/g, "''") + "'").join(','); },

  bgWhere(col, entity) {
    if (!this.filterFachrichtungen.length) return { where: '', params: [] };
    const ids = this._safeIntList(this.filterFachrichtungen).join(',');
    if (!ids) return { where: '', params: [] };
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
    // Sanitize all filter values to prevent SQL injection
    const jg = this._safeIntList(this.filterJahrgang);
    const bg = this._safeIntList(this.filterFachrichtungen);
    const amt = this._safeStrList(this.filterAmt);
    const zp = this._safeStrList(this.filterZp);
    const jgIn = jg.join(',');
    const bgIn = bg.join(',');
    const amtIn = this._sqlInStr(amt);
    const zpIn = this._sqlInStr(zp);
    // Extra dynamic filters (schueler-level SQL)
    const ef = this._extraFilterSql();
    const extraSql = ef.sql; // Always schueler-level WHERE clauses (using alias s/s2)

    // AP- und ZP-Filter: sind BEIDE aktiv, gilt die Vereinigung (ODER) –
    // der Nutzer stellt sich Kohorten zusammen (z.B. ZP 2026 + AP Sommer 2027).
    // Ist nur einer aktiv, wirkt er allein wie bisher.
    const jgZp = (jgClause, zpClause) => {
      if (jgClause && zpClause) return ` AND (${jgClause} OR ${zpClause})`;
      if (jgClause) return ` AND ${jgClause}`;
      if (zpClause) return ` AND ${zpClause}`;
      return '';
    };

    if (entity === 'schueler' || entity === 's') {
      w += jgZp(jg.length ? `s.jahrgang_id IN (${jgIn})` : '',
                zp.length ? `s.zwischenpruefung IN (${zpIn})` : '');
      if (bg.length) w += ` AND s.fachrichtung_id IN (${bgIn})`;
      if (amt.length) w += ` AND s.zustaendiges_amt IN (${amtIn})`;
      if (this.filterBavStatus === 'aktiv') w += ` AND (s.bav_status = '' OR s.bav_status NOT LIKE '%Ende%')`;
      else if (this.filterBavStatus === 'ende') w += ` AND s.bav_status LIKE '%Ende%'`;
      // Extra filters apply directly (already use alias 's')
      if (extraSql) w += extraSql;
    } else if (entity === 'klassen' || entity === 'k') {
      w += jgZp(jg.length ? `k.jahrgang_id IN (${jgIn})` : '',
                zp.length ? `k.id IN (SELECT DISTINCT s2.klasse_id FROM schueler s2 WHERE s2.zwischenpruefung IN (${zpIn}) AND s2.klasse_id IS NOT NULL)` : '');
      if (bg.length) w += ` AND k.fachrichtung_id IN (${bgIn})`;
      if (amt.length) w += ` AND k.id IN (SELECT DISTINCT s2.klasse_id FROM schueler s2 WHERE s2.zustaendiges_amt IN (${amtIn}) AND s2.klasse_id IS NOT NULL)`;
      // Extra filters cascade via subquery
      if (extraSql) w += ` AND k.id IN (SELECT DISTINCT s2.klasse_id FROM schueler s2 WHERE s2.klasse_id IS NOT NULL${extraSql.replace(/\bs\./g,'s2.')})`;
    } else if (entity === 'schulen' || entity === 'bs') {
      w += jgZp(jg.length ? `bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 WHERE k2.jahrgang_id IN (${jgIn}))` : '',
                zp.length ? `bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 JOIN schueler s2 ON s2.klasse_id=k2.id WHERE s2.zwischenpruefung IN (${zpIn}))` : '');
      if (bg.length) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 WHERE k2.fachrichtung_id IN (${bgIn}))`;
      if (amt.length) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 JOIN schueler s2 ON s2.klasse_id=k2.id WHERE s2.zustaendiges_amt IN (${amtIn}))`;
      if (extraSql) w += ` AND bs.id IN (SELECT DISTINCT k2.berufsschule_id FROM klassen k2 JOIN schueler s2 ON s2.klasse_id=k2.id WHERE 1=1${extraSql.replace(/\bs\./g,'s2.')})`;
    } else if (entity === 'betriebe' || entity === 'b') {
      w += jgZp(jg.length ? `b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.jahrgang_id IN (${jgIn}) AND s2.betrieb_id IS NOT NULL)` : '',
                zp.length ? `b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.zwischenpruefung IN (${zpIn}) AND s2.betrieb_id IS NOT NULL)` : '');
      if (bg.length) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.fachrichtung_id IN (${bgIn}) AND s2.betrieb_id IS NOT NULL)`;
      if (amt.length) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.zustaendiges_amt IN (${amtIn}) AND s2.betrieb_id IS NOT NULL)`;
      if (extraSql) w += ` AND b.id IN (SELECT DISTINCT s2.betrieb_id FROM schueler s2 WHERE s2.betrieb_id IS NOT NULL${extraSql.replace(/\bs\./g,'s2.')})`;
    } else if (entity === 'termine' || entity === 'kt') {
      // Ein Termin bleibt sichtbar, wenn IRGENDEINE verknüpfte Klasse ODER
      // IRGENDEIN einzeln verknüpfter Schüler zum Filter passt. Vorher liefen
      // alle Klauseln nur über kontrolltermin_klassen – reine Einsendungs-
      // Termine (nur Einzelschüler, keine Klasse) verschwanden bei JEDEM
      // aktiven Filter komplett aus Planung und Kontrolle.
      const ueberSchueler = (bed) => `kt.id IN (SELECT DISTINCT kts.kontrolltermin_id FROM kontrolltermin_schueler kts JOIN schueler s2 ON kts.schueler_id=s2.id WHERE ${bed})`;
      const ueberKlassenSchueler = (bed) => `kt.id IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id JOIN schueler s2 ON s2.klasse_id=k2.id WHERE ${bed})`;
      w += jgZp(jg.length ? `(kt.jahrgang_id IN (${jgIn}) OR kt.id IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id WHERE k2.jahrgang_id IN (${jgIn})) OR ${ueberSchueler(`s2.jahrgang_id IN (${jgIn})`)})` : '',
                zp.length ? `(${ueberKlassenSchueler(`s2.zwischenpruefung IN (${zpIn})`)} OR ${ueberSchueler(`s2.zwischenpruefung IN (${zpIn})`)})` : '');
      if (bg.length) w += ` AND (kt.id IN (SELECT DISTINCT tkk.kontrolltermin_id FROM kontrolltermin_klassen tkk JOIN klassen k2 ON tkk.klasse_id=k2.id WHERE k2.fachrichtung_id IN (${bgIn})) OR ${ueberSchueler(`s2.fachrichtung_id IN (${bgIn})`)})`;
      if (amt.length) w += ` AND (${ueberKlassenSchueler(`s2.zustaendiges_amt IN (${amtIn})`)} OR ${ueberSchueler(`s2.zustaendiges_amt IN (${amtIn})`)})`;
      if (extraSql) w += ` AND (${ueberKlassenSchueler(`1=1${extraSql.replace(/\bs\./g,'s2.')}`)} OR ${ueberSchueler(`1=1${extraSql.replace(/\bs\./g,'s2.')}`)})`;
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
      parts.push(`<span style="padding:3px 8px;background:${bg};border-radius:8px;font-size:11px">${esc(subParts.join(' + '))} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterJahrgang=[];App.filterZp=[];App._updateJgButton();App._updateFilterCount();App.renderCurrentView();return false" title="Jahrgangs-Filter entfernen">✕</span></span>`);
    }
    if (this.filterFachrichtungen.length) {
      if (this.filterFachrichtungen[0] === -1) {
        parts.push(`<span style="padding:3px 8px;background:var(--clr-red-light);border-radius:8px;font-size:11px">Keine Berufe <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterFachrichtungen=[];App._applyBgFilter();return false" title="Filter entfernen">✕</span></span>`);
      } else {
        const btn = document.getElementById('bgFilterBtn');
        const label = btn ? btn.textContent.replace(' ▾','').replace(/^(?:||§|▤|✎)\s*/,'').trim() : this.filterFachrichtungen.length + ' Berufe';
        parts.push(`<span style="padding:3px 8px;background:var(--clr-amber-light);border-radius:8px;font-size:11px">${esc(label)} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterFachrichtungen=[];App._applyBgFilter();return false" title="Filter entfernen">✕</span></span>`);
      }
    }
    if (this.filterAmt.length) {
      if (this.filterAmt[0] === '-1') {
        parts.push(`<span style="padding:3px 8px;background:var(--clr-red-light);border-radius:8px;font-size:11px">§ Kein Amt <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterAmt=[];App._applyAmtFilter();return false" title="Filter entfernen">✕</span></span>`);
      } else {
        const label = this.filterAmt.length === 1 ? this.amtLabel(this.filterAmt[0]) : this.filterAmt.length + ' Ämter';
        parts.push(`<span style="padding:3px 8px;background:var(--clr-blue-light);border-radius:8px;font-size:11px">§ ${esc(label)} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterAmt=[];App._applyAmtFilter();return false" title="Filter entfernen">✕</span></span>`);
      }
    }
    if (this.filterBavStatus !== 'aktiv') {
      const bavLabel = this.filterBavStatus === 'alle' ? 'Alle BAV (inkl. beendete)' : 'Nur beendete BAV';
      parts.push(`<span style="padding:3px 8px;background:${this.filterBavStatus === 'ende' ? 'var(--clr-red-light)' : 'var(--clr-blue-light)'};border-radius:8px;font-size:11px;font-weight:600">▤ ${bavLabel} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App.filterBavStatus='aktiv';var bb=document.getElementById('bavFilterBtn');if(bb){bb.textContent='▤ Aktive BAV';bb.style.background='rgba(255,255,255,0.15)';bb.style.fontWeight='400';}App.renderCurrentView();return false" title="Zurück auf 'Aktive BAV'">✕</span></span>`);
    }
    // Extra filter badges
    this.extraFilters.forEach((f, idx) => {
      if (!this._efAktiv(f)) return;
      const def = this.extraFilterDefs[f.field];
      if (!def) return;
      let label;
      if (Array.isArray(f.value)) {
        const namen = (f.labels && f.labels.length === f.value.length ? f.labels : f.value).map(String);
        const kurz = namen.join(', ');
        label = def.label + ': ' + (kurz.length > 40 ? namen.length + ' gewählt' : kurz);
      } else {
        label = def.label + ': ' + f.value;
        if (def.type === 'toggle') { const opt = def.options.find(o => o.v === f.value); if (opt) label = def.label + ': ' + opt.l; }
      }
      parts.push(`<span style="padding:3px 8px;background:rgba(232,213,245,0.6);border:1px solid #d4b8e8;border-radius:8px;font-size:11px;color:var(--clr-text)">${esc(label)} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold;margin-left:2px" onclick="App._removeExtraFilter(${idx});return false" title="Filter entfernen">✕</span></span>`);
    });
    if (!parts.length) return '';
    const hasMultiple = parts.length > 1;
    return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <span style="font-size:10px;color:var(--clr-text-light);text-transform:uppercase;letter-spacing:0.05em">Aktive Filter:</span>
      ${parts.join('')}
      ${hasMultiple ? `<span style="font-size:10px;color:var(--clr-forest);cursor:pointer;text-decoration:underline" onclick="App.filterFachrichtungen=[];App.filterJahrgang=[];App.filterAmt=[];App.filterZp=[];App.filterBavStatus='aktiv';App.extraFilters=[];App._renderExtraFilterChips();var bb=document.getElementById('bavFilterBtn');if(bb){bb.textContent='▤ Aktive BAV ▾';bb.classList.remove('active');}App.refreshJgDropdown();App._updateJgButton();App._applyBgFilter();App._applyAmtFilter()">Alle zurücksetzen</span>` : ''}
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
    if (this.filterJahrgang.length || this.filterZp.length) cnt++;
    if (this.filterFachrichtungen.length) cnt++;
    if (this.filterAmt.length) cnt++;
    if (this.filterBavStatus !== 'aktiv') cnt++;
    cnt += this.extraFilters.filter(f => this._efAktiv(f)).length;
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
    this.toast('' + label, 'info');
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

    // AP und ZP sind kombinierbar; bei Auswahl in beiden Sektionen gilt die
    // VEREINIGUNG (AP-Jahrgang ODER ZP-Kohorte) – so lassen sich z.B.
    // ZP 2026 + ZP 2027 + AP Sommer 2027 + AP Winter 2028 gemeinsam anzeigen.
    const beideAktiv = !isAllJg && activeJg[0] !== -1 && !isAllZp && activeZp[0] !== '---';
    const sektionLinks = (cls) => `<span style="margin-left:auto;font-weight:400;text-transform:none;letter-spacing:0">
      <a href="#" style="font-size:9px;color:var(--clr-forest)" onclick="App._jgSectionAll('${cls}',true);return false">alle</a>
      <span style="color:var(--clr-sand)">·</span>
      <a href="#" style="font-size:9px;color:var(--clr-forest)" onclick="App._jgSectionAll('${cls}',false);return false">keine</a>
    </span>`;

    let html = `<div style="padding:4px 12px;border-bottom:1px solid var(--clr-sand)">
      <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600">
        <input type="checkbox" ${isAll ? 'checked' : ''} onchange="App._toggleJgAll()" style="accent-color:var(--clr-forest)"> Alle (kein Filter)
      </label>
    </div>
    <div id="jgUnionHint" style="display:${beideAktiv ? '' : 'none'};padding:3px 12px;font-size:10px;color:var(--clr-forest);background:var(--clr-green-light);border-bottom:1px solid var(--clr-sand)">AP + ZP kombiniert: zeigt Azubis aus <strong>allen</strong> gewählten Kohorten</div>`;

    // ── AP Section ──
    html += `<div style="display:flex;align-items:center;padding:4px 12px 2px;font-size:9px;font-weight:700;color:var(--clr-forest);text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--clr-sand);margin-top:2px">Abschlussprüfung (AP)${sektionLinks('chk-jg')}</div>`;
    jgs.forEach(j => {
      const label = this._prefixLabel(j.bezeichnung) || j.typ;
      const chk = isAllJg || activeJg.includes(j.id);
      html += `<label style="display:flex;align-items:center;gap:6px;padding:2px 12px 2px 16px;cursor:pointer;font-size:12px" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
        <input type="checkbox" class="chk-jg" value="${j.id}" ${chk?'checked':''} onchange="App._applyJgZp()" style="accent-color:var(--clr-forest)">
        <strong>${esc(j.bezeichnung)}</strong> <span style="color:var(--clr-text-light);font-size:10px">${label} ${j.jahr}</span>
      </label>`;
    });

    // ── ZP Section ──
    if (zpSorted.length) {
      html += `<div style="display:flex;align-items:center;padding:4px 12px 2px;font-size:9px;font-weight:700;color:var(--clr-amber);text-transform:uppercase;letter-spacing:0.05em;border-top:1px solid var(--clr-sand);margin-top:2px">Zwischenprüfung (ZP)${sektionLinks('chk-zp')}</div>`;
      zpSorted.forEach(code => {
        const sem = this._prefixLabel(code) || code[0];
        const yr = code.substring(1);
        const chk = isAllZp || activeZp.includes(code);
        html += `<label style="display:flex;align-items:center;gap:6px;padding:2px 12px 2px 16px;cursor:pointer;font-size:12px" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
          <input type="checkbox" class="chk-zp" value="${esc(code)}" ${chk?'checked':''} onchange="App._applyJgZp()" style="accent-color:var(--clr-amber)">
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
      regulaer_dauer_monate INTEGER DEFAULT 36,
      verkuerzung_monate INTEGER DEFAULT 0,
      vorzeitige_zulassung INTEGER DEFAULT 0,
      vollzeit_wochenstunden REAL DEFAULT 39,
      beruf_id TEXT DEFAULT '',
      geburtsdatum TEXT DEFAULT '',
      zp_termin TEXT DEFAULT '',
      ap_termin TEXT DEFAULT '',
      brutto_lohn REAL DEFAULT 0,
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
      berufsschule_id INTEGER DEFAULT NULL REFERENCES berufsschulen(id),
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
      fehltage_pauschal INTEGER DEFAULT 0,
      sachberichte_anzahl INTEGER DEFAULT 0,
      zulassung_ap INTEGER DEFAULT 0,
      zulassung_manuell INTEGER DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS import_historie (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zeitpunkt TEXT DEFAULT (datetime('now','localtime')),
      typ TEXT DEFAULT 'azubis',
      datei TEXT DEFAULT '',
      bearbeiter TEXT DEFAULT '',
      zeilen INTEGER DEFAULT 0,
      neu INTEGER DEFAULT 0,
      aktualisiert INTEGER DEFAULT 0,
      uebersprungen INTEGER DEFAULT 0,
      fehler INTEGER DEFAULT 0,
      datums_fehler INTEGER DEFAULT 0,
      datumsformat TEXT DEFAULT '',
      details_json TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS schueler_bemerkungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER REFERENCES schueler(id),
      text TEXT DEFAULT '',
      erstellt_von TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS schueler_dateien (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER REFERENCES schueler(id),
      dateiname TEXT NOT NULL,
      original_name TEXT NOT NULL,
      beschreibung TEXT DEFAULT '',
      dateityp TEXT DEFAULT '',
      groesse INTEGER DEFAULT 0,
      erstellt_von TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ausbilder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      betrieb_id INTEGER REFERENCES betriebe(id),
      nachname TEXT DEFAULT '',
      vorname TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      mobil TEXT DEFAULT '',
      funktion TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS bhk_applied_ops (
      op_uid TEXT PRIMARY KEY,
      ts TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS bhk_tombstones (
      tabelle TEXT NOT NULL,
      key TEXT NOT NULL,
      geloescht_am TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (tabelle, key)
    );
    CREATE TABLE IF NOT EXISTS bhk_papierkorb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      art TEXT NOT NULL,
      ref_id INTEGER,
      label TEXT DEFAULT '',
      daten TEXT NOT NULL,
      geloescht_von TEXT DEFAULT '',
      geloescht_am TEXT DEFAULT (datetime('now','localtime'))
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
    CREATE TABLE IF NOT EXISTS ausbildungsphasen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER NOT NULL REFERENCES schueler(id),
      von TEXT NOT NULL,
      bis TEXT,
      typ TEXT NOT NULL CHECK (typ IN ('ausbildung','unterbrechung')),
      betrieb TEXT,
      teilzeit_prozent INTEGER DEFAULT 100,
      grund TEXT,
      pauschal_fehltage_e INTEGER DEFAULT 0,
      pauschal_fehltage_u INTEGER DEFAULT 0,
      anmerkung TEXT
    );
    CREATE TABLE IF NOT EXISTS aenderungslog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER,
      schueler_name TEXT DEFAULT '',
      feld TEXT NOT NULL,
      alter_wert TEXT DEFAULT '',
      neuer_wert TEXT DEFAULT '',
      aktion TEXT DEFAULT 'geaendert',
      bearbeiter TEXT DEFAULT '',
      zeitpunkt TEXT DEFAULT (datetime('now','localtime')),
      ibykus_relevant INTEGER DEFAULT 1,
      exportiert INTEGER DEFAULT 0
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
                ${dbLabel ? `<strong style="font-size:15px">${esc(dbLabel)}</strong>
                <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:6px">in ${esc(folderName)}${lastDb?.dbPath ? '/'+lastDb.dbPath : ''}</div>` :
                `<strong>Ordner: "${esc(folderName)}"</strong>`}
                <div style="margin-top:6px">
                  <button class="btn btn-primary" onclick="App.reconnectStored()" style="padding:10px 24px;font-size:15px">
                    Erneut verbinden
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
    } catch(e) { console.warn('Verbindung:', e); App.toast('Verbindung fehlgeschlagen', 'error'); }
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
      if (e.name !== 'AbortError') { console.warn('Fehler:', e); this.toast('Ein Fehler ist aufgetreten', 'error'); }
    }
  },

  // ── Switch DB / Disconnect ──
  switchDB() {
    App.openModal('Datenbank wechseln', `
      <p style="font-size:13px;margin-bottom:16px">Was möchten Sie tun?</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.switchToNewFolder()">
          <span style="font-size:22px"></span>
          <div><strong>Anderen Arbeitsordner wählen</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Ordner mit Datenbanken auswählen</div></div>
        </button>
        <button class="btn btn-secondary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.promptNewDb()">
          <span style="font-size:22px"></span>
          <div><strong>Neue Datenbank erstellen</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Leere DB im aktuellen Ordner anlegen</div></div>
        </button>
        <button class="btn btn-secondary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.disconnectDB()">
          <span style="font-size:22px"></span>
          <div><strong>Verbindung trennen</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Zurück zum Startbildschirm</div></div>
        </button>
        ${!this.demoMode ? '' : `<button class="btn btn-secondary" style="padding:12px;font-size:14px;text-align:left;display:flex;align-items:center;gap:10px" onclick="App.closeModal();App.disconnectDB();App.start()">
          <span style="font-size:22px"></span>
          <div><strong>Echte Datenbank verbinden</strong><div style="font-size:11px;font-weight:normal;color:var(--clr-sage);margin-top:2px">Demo beenden und Ordner wählen</div></div>
        </button>`}
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>`);
  },

  async switchToNewFolder() {
    if (this.unsavedChanges && this.dbFileHandle) {
      try { await this.doAutoSave(); } catch(e) { console.warn('Auto-Save vor Wechsel fehlgeschlagen:', e); }
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
      if (e.name !== 'AbortError') { console.warn('Fehler:', e); this.toast('Ein Fehler ist aufgetreten', 'error'); }
    }
  },

  disconnectDB() {
    // Save changes first if possible
    if (this.unsavedChanges && this.dbFileHandle) {
      try { this.doAutoSave(); } catch(e) { console.warn('Auto-Save vor Trennung fehlgeschlagen:', e); }
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
    // Sync-v3-Zustand vollständig zurücksetzen: Sonst bliebe _v3Ready=true mit
    // dem Op-Puffer und den Offsets der ALTEN Datenbank stehen – nach einem
    // DB-Wechsel würden fremde Ops in die falsche Datenbank repliziert.
    this._v3Ready = false;
    this._dirtyOps = [];
    this._opsInFlight = null;
    this._logOffsets = {};
    this._ownLogUids = null;
    this._appliedForeignUids = null;
    this._colStamps = null;
    this._snapGen = 0;
    this._logGen = 0;
    this._myLogSize = 0;
    this._maxSeenTs = 0;
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
      console.warn('Demo-Fehler:', e); this.toast('Demo konnte nicht geladen werden', 'error');
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
        const fristStr = dateStr(frist);
        // Realistische Statusverteilung: 35% erledigt, 65% offen (auto→überfällig bei View)
        const isErledigt = Math.random() < 0.35;
        const status = isErledigt ? 'erledigt' : 'offen';
        const erledigtDatum = isErledigt ? dateStr(new Date(frist.getTime() - ri(1,30)*86400000)) : null;
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
  autoSaveDelay: 1500,   // 1.5 seconds debounce (minimum)
  saveCount: 0,
  lastBackupTime: 0,
  backupIntervalMs: 5 * 60 * 1000, // Backup every 5 minutes max
  _lastSaveDurationMs: 0,
  _networkQuality: 'good', // 'good' | 'slow' | 'very-slow'
  _pollIntervalMs: 3000,
  _idbHandle: null,

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
      if (e.name !== 'AbortError') { console.warn('Fehler:', e); this.toast('Ein Fehler ist aufgetreten', 'error'); }
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
      console.warn('DB-Erstellung:', e); this.toast('Fehler beim Erstellen der Datenbank', 'error');
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
          this.toast(`⚠︎ Datenbank-Integritätsprüfung: ${check}. Backup wird empfohlen!`, 'warning');
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
      console.warn('Fehler beim Laden:', e); this.toast('Fehler beim Laden der Datenbank', 'error');
    }
  },

  // ── Auto-Save (debounced 2s after last change) ──
  scheduleAutoSave() {
    if (this.demoMode || !this.dbFileHandle) return;
    document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Geändert…';
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    // Adaptive delay: on slow connections, debounce longer to batch changes and reduce traffic
    const delay = Math.max(this.autoSaveDelay, Math.min(this._lastSaveDurationMs * 2, 30000));
    this.autoSaveTimer = setTimeout(() => this.doAutoSave(), delay);
  },

  async doAutoSave() {
    if (!this.db || !this.dbFileHandle) return;
    if (this._saveCooldownUntil && Date.now() < this._saveCooldownUntil) return;
    try {
      await this.mergeAndSave();
      // Backup frequency adapts to connection speed: 5 min (good), 15 min (slow), 30 min (very-slow)
      const backupMs = this._networkQuality === 'good' ? this.backupIntervalMs
        : this._networkQuality === 'slow' ? 15 * 60 * 1000 : 30 * 60 * 1000;
      const now = Date.now();
      if (now - this.lastBackupTime > backupMs) {
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
  async createBackup(tag) {
    if (!this.backupsDirHandle || !this.db) return;
    try {
      const now = new Date();
      const ts = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
      // Client-Kürzel im Namen: 2-3 Nutzer sichern in DENSELBEN Ordner – ohne
      // Kürzel überschrieben sich Backups derselben Sekunde gegenseitig.
      const kuerzel = this._getClientId().slice(-4);
      const backupName = `backup_${ts}_${kuerzel}${tag ? '_' + tag : ''}.sqlite`;
      const backupHandle = await this.backupsDirHandle.getFileHandle(backupName, { create: true });
      const data = this.db.export();
      const writable = await backupHandle.createWritable();
      await writable.write(data);
      await writable.close();
      console.log('Backup erstellt:', backupName);
      // Aufbewahrung: 30 Stück GEMEINSAM über alle Nutzer (Namen sortieren
      // chronologisch) – bei 3 aktiven Nutzern ≙ mehrere Stunden Historie.
      await this.cleanOldBackups(30);
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
    const alt = this.db;
    this.db = new SQL.Database(new Uint8Array(buf));
    try { alt?.close(); } catch(e) {}
    this.dbLastModified = file.lastModified; this._lastFileSize = file.size;
    // Schema der Arbeitskopie auf Stand bringen – die Disk-Datei kann älter sein
    this.migrateDB();
    // Sync-v3: Die rohe Snapshot-Datei enthält NICHT die Ops aus den Logs.
    // Ohne kompletten Re-Bootstrap wären alle Änderungen seit der letzten
    // Kompaktierung unsichtbar – und die nächste eigene Kompaktierung schriebe
    // diesen veralteten Stand als Snapshot für ALLE Clients.
    if (this._v3Active()) {
      this._v3Ready = false;
      await this._bootstrapV3();
    }
    this.unsavedChanges = this._dirtyOps.length > 0;
    try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
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
          setTimeout(() => { this._v3Active() ? this._pollOplogs() : this._doSyncImport('broadcast'); }, 400);
        }
      };
    } catch(e) {}

    // ── Sync marker polling: adaptive interval based on connection speed ──
    this._syncMarkerHandle = null;
    this._lastSyncVersion = null; // eindeutiges Token, wird beim ersten Marker-Write gesetzt

    this._schedulePoll = () => {
      // Adapt polling interval: 3s (good), 10s (slow), 30s (very-slow)
      const interval = this._networkQuality === 'good' ? 3000
        : this._networkQuality === 'slow' ? 10000 : 30000;
      this._pollIntervalMs = interval;
      this.pollInterval = setTimeout(async () => {
        if (!document.hidden && this.dirHandle && !this._mergeInProgress) {
          if (this._v3Active()) await this._pollOplogs();
          else await this._pollSyncMarker();
        }
        this._schedulePoll();
      }, interval);
    };
    // Sync-v3: erst Snapshot-Meta + Logs einziehen, dann Polling starten
    if (this._v3Active()) {
      this._bootstrapV3().then(() => {
        this._smartRefresh();
        this._schedulePoll();
      }).catch(() => this._schedulePoll());
    } else {
      this._schedulePoll();
    }

    // ── Single-Tab-Guard + Crash-Restore ──
    // Web Locks: Erst-Tab pro DB hält ein Browser-Lock. Ein Zweit-Tab derselben
    // DB bekommt es nicht → Warnung + kein Crash-Restore/-Persist (sonst
    // Doppel-Replays und gegenseitiges Überschreiben des Op-Puffers).
    (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
          const gotLock = await new Promise((resolve) => {
            navigator.locks.request('bhk_tab_' + (this.autoLoadedDbName || 'default'), { ifAvailable: true }, (lock) => {
              if (!lock) { resolve(false); return; }
              resolve(true);
              return new Promise(() => {}); // Lock für die Tab-Lebensdauer halten
            }).catch(() => resolve(true));
          });
          if (!gotLock) {
            this._tabIsPrimary = false;
            // Zweit-Tab bekommt eine EIGENE Log-Identität: mit derselben
            // clientId schrieben beide Tabs versetzt in dieselbe Log-Datei
            // (Korruption durch überlappende Positions-Writes), keiner läse
            // die Ops des anderen, und die Rotation des einen löschte die
            // aktive Datei des anderen.
            if (!this._myLogSize && !(this._ownLogUids && this._ownLogUids.size)) {
              this._clientIdCache = this._getClientId() + 't' + Math.random().toString(36).slice(2, 6);
              this._logGen = 0;
            }
            this.toast('Diese Datenbank ist bereits in einem anderen Tab geöffnet – bitte nur in EINEM Tab arbeiten', 'warning');
          }
        }
      } catch(e) {}
      // Crash-Restore erst NACH dem Bootstrap: vorher ist das uid-Set des
      // eigenen Logs leer, sodass bereits geschriebene Ops ein zweites Mal
      // angehängt und bei allen Clients doppelt angewendet würden.
      if (this._v3Active()) {
        const warte = async () => {
          // Bis zu 60s auf den Bootstrap warten. Läuft er dann immer noch,
          // KEIN Restore: mit halb gefülltem _ownLogUids würden bereits
          // geloggte Ops mit frischem Zeitstempel erneut angehängt und
          // überschrieben bei allen Clients neuere Änderungen.
          for (let i = 0; i < 600 && !this._v3Ready; i++) await new Promise(r => setTimeout(r, 100));
          if (this._v3Ready) this._restoreDirtyOps();
          else console.warn('[SyncV3] Bootstrap nach 60s nicht fertig – Crash-Restore übersprungen (Puffer bleibt erhalten)');
        };
        warte();
      } else {
        this._restoreDirtyOps();
      }
    })();
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
  // v ist ein eindeutiges Token (nicht der per-Client saveCount!) – zwei Clients
  // mit gleichem Zählerstand würden sonst gegenseitige Saves übersehen.
  async _writeSyncMarker() {
    if (!this.dirHandle) return;
    try {
      const syncDir = this.bhkDirHandle || this.dirHandle;
      const syncName = 'sync' + (this.autoLoadedDbName ? '_' + this.autoLoadedDbName.replace(/\.sqlite$|\.db$/,'') : '');
      const handle = await syncDir.getFileHandle(syncName, { create: true });
      const writable = await handle.createWritable();
      const token = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const marker = { v: token, t: new Date().toISOString(), u: KontrolleHandler?.activePruefer || '?' };
      await writable.write(JSON.stringify(marker));
      await writable.close();
      this._lastSyncVersion = token;
    } catch(e) { /* non-critical – polling still works via DB file */ }
  },

  // ── Lock file: prevents concurrent writes on slow connections ──
  _lockFileName: null,
  _lockNonce: null,
  _lockErrorCount: 0,
  async _acquireLock() {
    try {
      const syncDir = this.bhkDirHandle || this.dirHandle;
      if (!syncDir) return true;
      const lockName = 'lock' + (this.autoLoadedDbName ? '_' + this.autoLoadedDbName.replace(/\.sqlite$|\.db$/,'') : '');
      try {
        const existing = await syncDir.getFileHandle(lockName, { create: false });
        const file = await existing.getFile();
        const text = await file.text();
        const lock = JSON.parse(text);
        // Staleness MUSS größer sein als der maximale Write-Timeout (120s),
        // sonst wird ein legitimer langsamer Save als "stale" übernommen.
        // Zwei Signale: eingebetteter Client-Timestamp UND Datei-mtime (Server-Uhr).
        // Nur stehlen wenn BEIDE stale sind – schützt gegen Clock-Skew des Schreibers.
        const ageEmbedded = Date.now() - new Date(lock.t).getTime();
        const ageMtime = Date.now() - file.lastModified;
        if (Math.min(ageEmbedded, ageMtime) < 150000) {
          this._lockErrorCount = 0;
          return false;
        }
      } catch(e) { /* no lock file or unreadable → proceed */ }
      const nonce = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      const handle = await syncDir.getFileHandle(lockName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify({ u: KontrolleHandler?.activePruefer || '?', t: new Date().toISOString(), n: nonce }));
      await writable.close();
      // Verify: hat UNSER Write gewonnen? (check-then-create ist nicht atomar)
      // Doppel-Verify mit Zufalls-Wartezeit: Verify #1 fängt "anderer schrieb vor uns",
      // die Jitter-Pause + Verify #2 fängt "anderer schreibt gerade nach uns" –
      // sonst können auf langsamem SMB BEIDE Nutzer das Lock gleichzeitig halten.
      for (let v = 0; v < 2; v++) {
        if (v === 1) await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 700)));
        try {
          const verify = await syncDir.getFileHandle(lockName, { create: false });
          const vLock = JSON.parse(await (await verify.getFile()).text());
          if (vLock.n && vLock.n !== nonce) { this._lockErrorCount = 0; return false; } // anderer User war schneller
        } catch(e) {}
      }
      this._lockFileName = lockName;
      this._lockNonce = nonce;
      this._lockErrorCount = 0;
      return true;
    } catch(e) {
      // Fail-CLOSED: bei Fehlern im Lock-Mechanismus NICHT einfach ohne Lock
      // schreiben (Datenverlust-Risiko). Erst nach 3 Fehlversuchen in Folge
      // notfalls ohne Lock weitermachen, damit Speichern nie dauerhaft blockiert.
      this._lockErrorCount++;
      if (this._lockErrorCount >= 3) {
        console.warn('[Lock] Mechanismus fehlgeschlagen (' + this._lockErrorCount + 'x) – fahre ohne Lock fort:', e.message);
        return true;
      }
      console.warn('[Lock] Fehler beim Acquire – Save wird verschoben:', e.message);
      return false;
    }
  },
  // Heartbeat: Lock-Timestamp auffrischen (vor langer Schreibphase), damit
  // ein legitimer langsamer Save nicht durch die 150s-Staleness gestohlen wird.
  async _refreshLock() {
    if (!this._lockFileName || !this._lockNonce) return;
    try {
      const syncDir = this.bhkDirHandle || this.dirHandle;
      if (!syncDir) return;
      const handle = await syncDir.getFileHandle(this._lockFileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify({ u: KontrolleHandler?.activePruefer || '?', t: new Date().toISOString(), n: this._lockNonce }));
      await writable.close();
    } catch(e) { /* best effort */ }
  },
  async _releaseLock() {
    if (!this._lockFileName) return;
    try {
      const syncDir = this.bhkDirHandle || this.dirHandle;
      if (syncDir) {
        // Nur löschen wenn der Lock noch UNS gehört (Ownership-Check)
        try {
          const h = await syncDir.getFileHandle(this._lockFileName, { create: false });
          const lock = JSON.parse(await (await h.getFile()).text());
          if (!lock.n || lock.n === this._lockNonce) {
            await syncDir.removeEntry(this._lockFileName);
          }
        } catch(e) {
          // Ownership nicht verifizierbar → NICHT löschen. Ein evtl. verwaistes
          // eigenes Lock heilt die 150s-Staleness; ein fremdes Lock zu löschen
          // würde dessen laufenden Save ungeschützt lassen.
        }
      }
    } catch(e) { /* ignore */ }
    this._lockFileName = null;
    this._lockNonce = null;
  },

  // ── Pre-write version check (closes TOCTOU window) ──
  async _readMarkerToken() {
    try {
      const syncDir = this.bhkDirHandle || this.dirHandle;
      if (!syncDir) return null;
      const syncName = 'sync' + (this.autoLoadedDbName ? '_' + this.autoLoadedDbName.replace(/\.sqlite$|\.db$/,'') : '');
      const handle = await syncDir.getFileHandle(syncName, { create: false });
      const file = await handle.getFile();
      const marker = JSON.parse(await file.text());
      return marker.v || null;
    } catch(e) { return null; }
  },
  async _checkMarkerChanged() {
    const token = await this._readMarkerToken();
    return !!(token && token !== this._lastSyncVersion);
  },

  // ── Network quality tracking ──
  _updateNetworkQuality() {
    const dur = this._lastSaveDurationMs;
    const prev = this._networkQuality;
    if (dur < 5000) this._networkQuality = 'good';
    else if (dur < 15000) this._networkQuality = 'slow';
    else this._networkQuality = 'very-slow';
    if (this._networkQuality !== prev) {
      console.log(`[Network] Quality: ${prev} → ${this._networkQuality} (${(dur/1000).toFixed(1)}s)`);
    }
    this._updateNetworkUI();
  },
  _updateNetworkUI() {
    const el = document.getElementById('networkQuality');
    if (!el) return;
    if (this._networkQuality === 'good') {
      el.style.display = 'none';
    } else {
      el.style.display = '';
      const dur = (this._lastSaveDurationMs / 1000).toFixed(0);
      const poll = (this._pollIntervalMs / 1000).toFixed(0);
      if (this._networkQuality === 'slow') {
        el.innerHTML = `<span style="color:var(--clr-amber)">Langsame Verbindung (${dur}s) · Polling ${poll}s · Backup alle 15 Min</span>`;
      } else {
        el.innerHTML = `<span style="color:var(--clr-red)">Sehr langsame Verbindung (${dur}s) · Polling ${poll}s · Backup alle 30 Min</span>`;
      }
    }
  },

  // ── IndexedDB: persist dirty ops across tab close / crash ──
  _getIDB() {
    return new Promise((resolve, reject) => {
      if (this._idbHandle) { resolve(this._idbHandle); return; }
      const req = indexedDB.open('bhk_sync', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('dirtyOps', { keyPath: 'id' });
      req.onsuccess = () => { this._idbHandle = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  },
  // Crash-Store-Key pro Datenbank – zwei DBs (oder zwei Tabs verschiedener DBs)
  // dürfen sich nicht denselben Op-Puffer teilen (Replay in die falsche DB!)
  _idbOpsKey() { return 'ops_' + (this.autoLoadedDbName || 'default'); },
  async _persistDirtyOps() {
    if (this._tabIsPrimary === false) return; // Zweit-Tab überschreibt nicht den Puffer des Erst-Tabs
    try {
      const db = await this._getIDB();
      const tx = db.transaction('dirtyOps', 'readwrite');
      const store = tx.objectStore('dirtyOps');
      store.delete(this._idbOpsKey());
      store.delete('ops'); // Legacy-Key aufräumen
      // Auch Ops sichern, die gerade in einem (evtl. hängenden) Append stecken:
      // _saveV3 nimmt sie per splice aus _dirtyOps – ohne _opsInFlight würde
      // dieser Persist sie aus dem Crash-Puffer löschen, bevor der Append
      // bestätigt ist. ts/seq mitschreiben, sonst bekämen die Ops beim
      // Wiederherstellen einen FRISCHEN Zeitstempel und gewännen fälschlich
      // Last-Write-Wins gegen zwischenzeitliche Änderungen der Kollegen.
      const alle = [...(this._opsInFlight || []), ...this._dirtyOps];
      if (alle.length > 0) {
        store.put({ id: this._idbOpsKey(), ops: alle.map(o => ({uid: o.uid, ts: o.ts, seq: o.seq, sql: o.sql, params: o.params})), ts: Date.now() });
      }
    } catch(e) { /* IndexedDB not available – non-critical */ }
  },
  async _restoreDirtyOps() {
    if (this._tabIsPrimary === false) return; // Zweit-Tab: kein Crash-Restore (Doppel-Replay)
    try {
      const db = await this._getIDB();
      const tx = db.transaction('dirtyOps', 'readonly');
      const store = tx.objectStore('dirtyOps');
      const req = store.get(this._idbOpsKey());
      req.onsuccess = () => {
        const record = req.result;
        if (record && record.ops && record.ops.length > 0 && Date.now() - record.ts < 3600000) {
          // Sync-v3: Ops, die bereits im eigenen Log stehen, nicht erneut puffern
          const offen = this._ownLogUids
            ? record.ops.filter(o => !o.uid || !this._ownLogUids.has(o.uid))
            : record.ops;
          if (!offen.length) return;
          this._applyRestoredOps(offen);
          // MERGEN, nicht überschreiben: der Nutzer kann während des Bootstraps
          // bereits neue Änderungen gemacht haben – die stehen schon in _dirtyOps.
          this._dirtyOps = [...offen, ...this._dirtyOps];
          this.unsavedChanges = true;
          this.toast(`↻ ${offen.length} nicht-gespeicherte Änderung(en) aus vorheriger Sitzung wiederhergestellt`, 'info');
          this.scheduleAutoSave();
        }
      };
    } catch(e) { /* IndexedDB not available */ }
  },
  // Wiederhergestellte Ops LOKAL nachspielen: die Arbeitskopie wurde beim Start
  // frisch vom Snapshot geladen und enthält diese Änderungen noch NICHT (sie
  // standen nur im Speicherpuffer der abgebrochenen Sitzung). Ohne Replay
  // blieben sie bis zum nächsten Neustart unsichtbar – und eine Kompaktierung
  // schriebe den Snapshot ohne die Zeilen, obwohl die Log-Offsets sie als
  // enthalten markieren: endgültiger Verlust. Doppelt vorhandene INSERTs
  // scheitern an UNIQUE und werden übersprungen (unkritisch).
  _applyRestoredOps(ops) {
    let n = 0;
    for (const o of ops) {
      try { this.db.run(o.sql, o.params || []); n++; }
      catch(e) { console.warn('[Restore] Op nicht anwendbar:', e.message, (o.sql || '').slice(0, 60)); }
    }
    if (n) {
      try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
      try { this._smartRefresh(); } catch(e) {}
    }
    return n;
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
    const t0 = Date.now();
    try {
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Sync…';
      const handle = await this.dirHandle.getFileHandle(this.dbFileHandle.name, { create: false });
      const file = await handle.getFile();
      const buf = await file.arrayBuffer();
      const readMs = Date.now() - t0;
      // Use sync-import read time to also gauge network speed
      if (readMs > 5000) {
        this._lastSaveDurationMs = Math.max(this._lastSaveDurationMs, readMs);
        this._updateNetworkQuality();
      }
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
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-amber"></span>Nur-Lesen';
      if (!this._writeAccessPrompted) {
        this._writeAccessPrompted = true;
        this.toast('Für Auto-Save bitte einmalig <strong><a href="#" onclick="App.grantFolderAccess();return false" style="color:var(--clr-forest);text-decoration:underline">Ordner freigeben</a></strong>', 'warning');
      }
      return;
    }
    this.scheduleAutoSave();
    // Debounced IDB persist: ensures dirty ops survive unexpected tab close
    if (!this._idbPersistTimer) {
      this._idbPersistTimer = setTimeout(() => {
        this._idbPersistTimer = null;
        if (this._dirtyOps.length > 0) this._persistDirtyOps();
      }, 5000);
    }
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
  // ═══ Sync-v2: global eindeutige IDs + Natural-Key-Replay + Tombstones ═══
  // Tabellen, deren INSERTs eine clientseitig vergebene, global eindeutige ID
  // bekommen. Ohne das vergeben zwei Clients bei parallelen INSERTs dieselbe
  // AUTOINCREMENT-ID für verschiedene Zeilen → Replays/FKs treffen falsche Zeilen.
  ID_TABLES: new Set(['kontrolltermine','kontrollergebnisse','wiedervorlagen','wiedervorlage_notizen',
    'durchsicht_snapshots','ausbildungsphasen','schueler_bemerkungen','schueler_dateien',
    'schueler','betriebe','ausbilder','klassen','berufsschulen','aenderungslog',
    // Ohne globale IDs vergeben zwei Rechner beim gleichzeitigen Anlegen
    // dieselbe Nummer; ein späteres "WHERE id=?" trifft dann beim Kollegen die
    // falsche Zeile (Mängel landeten beim falschen Azubi, Löschungen beim
    // falschen Prüfer/Jahrgang).
    'kw_maengel','pruefer','abschlussjahrgaenge','import_historie','bhk_papierkorb']),
  // Natürliche Schlüssel: Replay-Adressierung (statt divergenter ids) + Tombstone-Keys
  NATURAL_KEYS: {
    kontrollergebnisse: ['kontrolltermin_id','schueler_id'],
    kw_status: ['schueler_id','ausbildungsjahr','kalenderwoche'],
    kw_maengel: ['kontrollergebnis_id','ausbildungsjahr','kalenderwoche'],
    kontrolltermin_klassen: ['kontrolltermin_id','klasse_id'],
    kontrolltermin_schueler: ['kontrolltermin_id','schueler_id'],
  },
  // Tabellen mit Lösch-Propagation (Tombstones verhindern Re-Import gelöschter Zeilen)
  TOMBSTONE_TABLES: new Set(['kontrolltermine','kontrollergebnisse','kw_status','kw_maengel',
    'wiedervorlagen','wiedervorlage_notizen','durchsicht_snapshots','ausbildungsphasen',
    'schueler_bemerkungen','schueler_dateien','schueler',
    'kontrolltermin_klassen','kontrolltermin_schueler']),
  _lastNewId: 0,
  // Zeitbasierte, kollisionsarme INTEGER-ID (~1.7e15 « 2^53): ms-Timestamp × 1000
  // + Zufall; monoton pro Client, praktisch kollisionsfrei zwischen 2-3 Clients.
  newId() {
    let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    if (id <= this._lastNewId) id = this._lastNewId + 1;
    this._lastNewId = id;
    return id;
  },
  _newUid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); },
  // Streng monoton steigende Sequenznummer pro Client. Zusammen mit dem
  // Erfassungs-Zeitstempel legt sie die Anwendungsreihenfolge beim Empfänger
  // eindeutig fest – ein Zufalls-Tiebreaker zerstörte sonst die Reihenfolge
  // innerhalb einer Millisekunde (INSERT nach UPDATE → Änderung ging verloren).
  _opSeq: 0,
  _nextSeq() { return ++this._opSeq; },
  // Lamport-Uhr: Ops werden empfängerseitig nach ts sortiert. Eine nachgehende
  // Windows-Uhr ließe kausal SPÄTERE eigene Ops vor bereits gesehenen fremden
  // einsortieren – deshalb stempelt ein Client nie hinter das Maximum dessen,
  // was er von anderen gesehen hat (_maxSeenTs wird in _applyOps gepflegt).
  _maxSeenTs: 0,
  _stampTs() {
    const t = Date.now();
    return t > (this._maxSeenTs || 0) ? t : (this._maxSeenTs || 0) + 1;
  },
  _frozenNow() {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return {
      local: `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
      utc: `${d.getUTCFullYear()}-${p2(d.getUTCMonth()+1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`,
    };
  },
  // VALUES-Inhalt (erstes Tupel) aus einem INSERT extrahieren
  _valuesContent(sql) {
    const m = sql.match(/VALUES\s*\(/i);
    if (!m) return null;
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++;
      else if (sql[i] === ')') depth--;
    }
    return depth === 0 ? sql.slice(start, i - 1) : null;
  },
  // Kommasplit auf Klammer-Tiefe 0 (respektiert datetime('now') etc.)
  _splitTokens(str) {
    const tokens = []; let depth = 0, cur = '';
    for (const ch of str) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { tokens.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) tokens.push(cur.trim());
    return tokens;
  },
  // Param-Index einer Spalte in einem Statement (INSERT-Spaltenliste oder "col=?")
  _paramIndexForColumn(sql, col) {
    const mIns = sql.match(/INSERT[^(]*\(([^)]*)\)\s*VALUES\s*\(/i);
    if (mIns) {
      const cols = mIns[1].split(',').map(c => c.trim().toLowerCase());
      const ci = cols.indexOf(col);
      if (ci < 0) return -1;
      const content = this._valuesContent(sql);
      if (!content) return -1;
      const tokens = this._splitTokens(content);
      if (ci >= tokens.length || tokens[ci] !== '?') return -1;
      return tokens.slice(0, ci).filter(t => t === '?').length;
    }
    const re = new RegExp(col + '\\s*=\\s*\\?', 'i');
    const idx = sql.search(re);
    if (idx < 0) return -1;
    return (sql.slice(0, idx).match(/\?/g) || []).length;
  },
  /**
   * Bereitet eine Schreib-Op für lokale Ausführung + Replay vor:
   * - injiziert explizite newId() in INSERTs auf ID_TABLES
   * - friert datetime('now') im Replay-Op ein (Replay-Divergenz)
   * - schreibt UPDATE/DELETE "WHERE id=?" auf kontrollergebnisse/kw_status
   *   im Replay-Op auf den natürlichen Schlüssel um (id-divergenzfest)
   * - erfasst Tombstones für DELETEs / räumt Tombstones bei Re-INSERT
   */
  _prepareOp(sql, params) {
    const out = { sql, params: [...params], opSql: sql, opParams: [...params], pre: [], post: [] };
    const now = this._frozenNow();
    if (out.opSql.includes("datetime('now'")) {
      out.opSql = out.opSql
        .replace(/datetime\('now',\s*'localtime'\)/g, `'${now.local}'`)
        .replace(/datetime\('now'\)/g, `'${now.utc}'`);
    }
    // date('now') ebenso einfrieren – sonst wertet der Empfänger es bei sich
    // NEU aus (anderer Tag über Mitternacht, dazu UTC statt lokal) und z.B.
    // ein "Nacherfasst am …"-Terminname divergiert zwischen den Clients.
    if (out.opSql.includes("date('now'")) {
      out.opSql = out.opSql
        .replace(/date\('now',\s*'localtime'\)/g, `'${now.local.slice(0, 10)}'`)
        .replace(/date\('now'\)/g, `'${now.utc.slice(0, 10)}'`);
    }
    // ── INSERT ──
    const mIns = sql.match(/^\s*INSERT(\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_]+)\s*\(([^)]*)\)\s*VALUES\s*\(/i);
    if (mIns) {
      const table = mIns[2].toLowerCase();
      let cols = mIns[3].split(',').map(c => c.trim().toLowerCase());
      if (this.ID_TABLES.has(table) && !cols.includes('id')) {
        const id = this.newId();
        const headOld = mIns[0];
        const headNew = headOld
          .replace('(' + mIns[3] + ')', '(id,' + mIns[3] + ')')
          .replace(/VALUES\s*\($/i, (mm) => mm + '?,');
        out.sql = out.sql.replace(headOld, headNew);
        out.opSql = out.opSql.replace(headOld, headNew);
        out.params.unshift(id);
        out.opParams.unshift(id);
        cols = ['id', ...cols];
      }
      // Re-Anlage hebt eine frühere Löschung (Tombstone) auf
      if (this.TOMBSTONE_TABLES.has(table)) {
        const keyCols = this.NATURAL_KEYS[table] || ['id'];
        const content = this._valuesContent(out.sql);
        if (content) {
          const tokens = this._splitTokens(content);
          const vals = [];
          for (const k of keyCols) {
            const ci = cols.indexOf(k);
            if (ci < 0 || ci >= tokens.length) { vals.length = 0; break; }
            const tok = tokens[ci];
            if (tok === '?') vals.push(out.params[tokens.slice(0, ci).filter(t => t === '?').length]);
            else if (/^-?\d+$/.test(tok)) vals.push(Number(tok));
            else if (/^["'].*["']$/.test(tok)) vals.push(tok.slice(1, -1));
            else { vals.length = 0; break; }
          }
          if (vals.length === keyCols.length) {
            out.post.push({ sql: 'DELETE FROM bhk_tombstones WHERE tabelle=? AND key=?',
              params: [table, vals.map(v => String(v)).join('_')] });
          }
        }
      }
      this._rewriteKeRef(out);
      return out;
    }
    // ── DELETE: Tombstones VOR dem Löschen erfassen (beliebige WHERE-Formen) ──
    const mDel = sql.match(/^\s*DELETE\s+FROM\s+([A-Za-z_]+)\b([\s\S]*)$/i);
    if (mDel && this.TOMBSTONE_TABLES.has(mDel[1].toLowerCase())) {
      const table = mDel[1].toLowerCase();
      const keyCols = this.NATURAL_KEYS[table] || ['id'];
      try {
        const rows = this.query(`SELECT ${keyCols.join(',')} FROM ${table} ${mDel[2]}`, params);
        rows.forEach(r => out.pre.push({
          sql: 'INSERT OR REPLACE INTO bhk_tombstones (tabelle,key,geloescht_am) VALUES (?,?,?)',
          params: [table, keyCols.map(k => String(r[k])).join('_'), now.local],
        }));
      } catch(e) { /* z.B. Tabelle fehlt noch */ }
    }
    // ── Natural-Key-Rewrite (nur Replay-Op): id-divergenzfeste Adressierung ──
    // Auch "WHERE id=? AND <rest>" erfassen – die frühere Regex verlangte das
    // Statement-Ende und ließ mehrere reale Statements ungerewritten durch.
    const mNk = sql.match(/^\s*(UPDATE|DELETE\s+FROM)\s+(kontrollergebnisse|kw_status|kw_maengel)\b[\s\S]*?WHERE\s+id\s*=\s*\?(\s+AND\s[\s\S]*)?$/i);
    if (mNk) {
      const table = mNk[2].toLowerCase();
      const keyCols = this.NATURAL_KEYS[table];
      const rest = mNk[3] || '';
      try {
        // Die id ist der Parameter an der Position des "id=?" – bei angehängten
        // Bedingungen folgen danach noch weitere Parameter.
        const vorId = (sql.slice(0, sql.search(/WHERE\s+id\s*=\s*\?/i)).match(/\?/g) || []).length;
        const idWert = params[vorId];
        const row = keyCols && idWert != null
          ? this.query(`SELECT ${keyCols.join(',')} FROM ${table} WHERE id=?`, [idWert])[0] : null;
        if (row) {
          out.opSql = out.opSql.replace(/WHERE\s+id\s*=\s*\?/i, 'WHERE ' + keyCols.map(k => k + '=?').join(' AND '));
          out.opParams = [
            ...out.opParams.slice(0, vorId),
            ...keyCols.map(k => row[k]),
            ...out.opParams.slice(vorId + 1),
          ];
        }
      } catch(e) {}
    }
    this._rewriteKeRef(out);
    return out;
  },
  // FK-Verweise auf kontrollergebnisse (kontrollergebnis_id) im Replay-Op durch
  // einen Natural-Key-Subselect ersetzen: der Empfänger löst die id gegen SEINE
  // lokale Zeile auf – vollständig immun gegen KE-id-Divergenz zwischen Clients.
  _rewriteKeRef(out) {
    if (!/kontrollergebnis_id/i.test(out.opSql)) return;
    if (/^\s*INSERT[^(]*INTO\s+kontrollergebnisse\b/i.test(out.opSql)) return;
    try {
      const pi = this._paramIndexForColumn(out.opSql, 'kontrollergebnis_id');
      if (pi < 0 || pi >= out.opParams.length) return;
      const keId = out.opParams[pi];
      if (keId == null) return;
      const row = this.query('SELECT kontrolltermin_id, schueler_id FROM kontrollergebnisse WHERE id=?', [keId])[0];
      if (!row || row.kontrolltermin_id == null || row.schueler_id == null) return;
      let count = -1;
      out.opSql = out.opSql.replace(/\?/g, (q) => {
        count++;
        return count === pi ? '(SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?)' : q;
      });
      out.opParams = [...out.opParams.slice(0, pi), row.kontrolltermin_id, row.schueler_id, ...out.opParams.slice(pi + 1)];
    } catch(e) {}
  },
  run(sql, params = []) {
    // During bulk import: skip dirty-tracking, full-write happens at end
    if (this._bulkImport) { this.db.run(sql, params); return; }
    const prep = this._prepareOp(sql, params);
    const stamp = () => ({ uid: this._newUid(), ts: this._stampTs(), seq: this._nextSeq() });
    prep.pre.forEach(x => {
      try { this.db.run(x.sql, x.params); this._dirtyOps.push({ ...stamp(), sql: x.sql, params: x.params }); }
      catch(e) { console.warn('[Sync] Vor-Op fehlgeschlagen:', e.message, x.sql.slice(0, 60)); }
    });
    this.db.run(prep.sql, prep.params);
    prep.post.forEach(x => {
      try { this.db.run(x.sql, x.params); this._dirtyOps.push({ ...stamp(), sql: x.sql, params: x.params }); }
      catch(e) { console.warn('[Sync] Nach-Op fehlgeschlagen:', e.message, x.sql.slice(0, 60)); }
    });
    // ── Dirty-Tracking: record the (Replay-)SQL + params for merge-save ──
    const rec = { ...stamp(), sql: prep.opSql, params: prep.opParams };
    this._dirtyOps.push(rec);
    this._notiereKeSpalten(rec.sql, rec.params, rec.ts);
    // Suchindex verwerfen – sonst zeigt die Suche veraltete Werte
    try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
    this.markDirty();
  },
  _bulkImport: false,
  // Run without tracking (used during merge-import to avoid re-tracking)
  _runSilent(sql, params = []) {
    this.db.run(sql, params);
  },
  // Full-write after bulk import: merge other users' changes first, then write.
  // Fährt dasselbe Schutzprotokoll wie mergeAndSave (Lock + Marker-Check) –
  // sonst vernichten sich Bulk-Import und paralleler Save eines anderen
  // Nutzers gegenseitig (Full-Write ersetzt die ganze Datei).
  async fullSave() {
    if (!this.dbFileHandle || !this.db) return;
    // Sync-v3: Bulk-Import → Snapshot direkt kompaktieren (Logs werden vorher
    // vollständig eingezogen, danach decken die Offsets alles ab)
    if (this._v3Active()) {
      // Bootstrap noch nicht fertig? Warten statt in den v2-Direktschreibpfad
      // zu fallen – der schriebe an snapmeta vorbei und die anderen Clients
      // erführen nie davon.
      for (let i = 0; i < 300 && !this._v3Ready; i++) await new Promise(r => setTimeout(r, 100));
      if (!this._v3Ready) throw new Error('Synchronisation nicht bereit (Bootstrap läuft)');
      // AWAITED Retries statt setTimeout: Aufrufer (z.B. der Import) müssen
      // sicher wissen, ob gespeichert wurde. Nach 3 Fehlversuchen wird hart
      // geworfen – der Import zeigt dann seine rote "NICHT gespeichert"-Warnung
      // statt fälschlich Erfolg zu melden.
      let ok = false;
      for (let versuch = 1; versuch <= 3 && !ok; versuch++) {
        ok = await this._compact('import');
        if (!ok) await new Promise(r => setTimeout(r, 3000));
      }
      if (!ok) throw new Error('Kompaktierung nicht möglich (Lock belegt oder Schreibfehler)');
      // _dirtyOps NICHT leeren: _saveV3 innerhalb von _compact hat den Puffer
      // bereits geclaimt und angehängt. Was JETZT noch drin steht, entstand
      // während des Snapshot-Writes und steckt weder im Export noch im Log –
      // es wird ganz normal vom nächsten Auto-Save angehängt.
      this.unsavedChanges = this._dirtyOps.length > 0;
      if (this._dirtyOps.length) this.scheduleAutoSave();
      this.saveCount++;
      const timeStr = new Date().toLocaleTimeString('de-DE');
      document.getElementById('dbLastSaved').textContent = `✓ ${timeStr} (#${this.saveCount})`;
      document.getElementById('dbStatusIndicator').innerHTML = this._dirtyOps.length
        ? '<span class="dot dot-yellow"></span>Geändert…'
        : '<span class="dot dot-green"></span>Gespeichert';
      this._broadcastChange();
      return;
    }
    if (this._mergeInProgress) { setTimeout(() => this.fullSave(), 2000); return; }
    this._mergeInProgress = true;
    try {
      // Retry-Schleife (siehe mergeAndSave): await-Semantik + Lock-Ownership pro Versuch
      for (let attempt = 1; attempt <= 5; attempt++) {
        const status = await this._fullSaveAttempt();
        if (status !== 'retry') break;
      }
    } finally {
      this._mergeInProgress = false;
    }
  },
  async _fullSaveAttempt() {
    let writable = null;
    try {
      // 0) Lock über die gesamte Read-Merge-Write-Sequenz
      const lockAcquired = await this._acquireLock();
      if (!lockAcquired) {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Warte (anderer User speichert)…';
        setTimeout(() => this.fullSave(), 3000);
        return 'stop';
      }

      // 1) Read disk version to preserve other users' changes
      const file = await this.dbFileHandle.getFile();
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      const diskDb = new SQL.Database(new Uint8Array(buf));

      // 2) Import other users' changes INTO our in-memory DB before writing
      this._importFromDisk(diskDb);
      diskDb.close();

      // 2b) Marker-Check direkt vor dem Schreiben: hat jemand zwischen unserem
      // Read und jetzt gespeichert? Dann mit frischem Disk-Stand neu ansetzen.
      const freshToken = await this._readMarkerToken();
      if (freshToken && freshToken !== this._lastSyncVersion) {
        this._lastSyncVersion = freshToken; // Retry liest die Disk sofort neu → Stand ist dann enthalten
        console.log('[Save] Marker changed during fullSave → retry with fresh disk data');
        return 'retry';
      }

      // 3) NOW export our merged in-memory DB (has both our import + others' edits)
      const data = this.db.export();
      writable = await this.dbFileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      writable = null;

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
      await this._writeSyncMarker(); // VOR Lock-Release, sonst maskiert ein späterer Marker fremde Saves
      console.log('[Save] Full-write nach Import abgeschlossen (mit Merge)');
      return 'ok';
    } catch(e) {
      if (writable) { try { await writable.abort(); } catch(_) {} writable = null; }
      console.error('[Save] fullSave error:', e);
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
      return 'stop';
    } finally {
      await this._releaseLock();
    }
  },

  // ═══════════════════════════════════════════
  //  SYNC-V3: Append-only Op-Logs pro Client
  //
  //  Kein konkurrierendes Schreiben mehr auf die geteilte DB-Datei:
  //  - Jeder Client schreibt AUSSCHLIESSLICH seine eigene Log-Datei
  //    (_bhk/oplog_<db>_<client>.jsonl, append-only) → keine Locks,
  //    keine Lost Updates, keine Zombie-Writes im Normalbetrieb.
  //  - Die DB-Datei ist nur noch der SNAPSHOT. Sie wird selten und mit
  //    Lock kompaktiert (Memory-Export nach vollständigem Log-Einzug).
  //  - Zustand = Snapshot + alle Logs ab snapmeta-Offsets, Ops nach
  //    Zeitstempel geordnet angewendet (LWW, wie bisheriges Verhalten).
  // ═══════════════════════════════════════════
  _logOffsets: {},          // Log-Dateiname → gelesene Bytes
  _myLogSize: 0,
  _ownLogUids: null,        // uids im eigenen Log (Crash-Restore-Dedupe)
  _appliedForeignUids: null,
  _appendInProgress: false,
  _compactInProgress: false,
  _lastCompactCheck: 0,
  _v3Ready: false,

  _v3Active() { return !this.demoMode && !!(this.bhkDirHandle || this.dirHandle) && !!this.dbFileHandle; },
  _syncDirV3() { return this.bhkDirHandle || this.dirHandle; },
  _getClientId() {
    if (this._clientIdCache) return this._clientIdCache;
    let id = null;
    try { id = localStorage.getItem('bhk_client_id'); } catch(e) {}
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('bhk_client_id', id); } catch(e) {}
    }
    this._clientIdCache = id;
    return id;
  },
  _dbSlug() { return (this.autoLoadedDbName || 'db').replace(/\.sqlite$|\.db$/i, '').replace(/[^A-Za-z0-9_-]/g, '_'); },
  _oplogPrefix() { return 'oplog_' + this._dbSlug() + '_'; },
  // Generation im Dateinamen: Beim Rotieren wird eine NEUE Datei begonnen statt
  // die bestehende zu leeren. Leser erkannten ein geleertes Log nur daran, dass
  // es kleiner geworden war – wuchs es zwischen zwei Abfragen über die alte
  // Größe hinaus, lasen sie ab der falschen Stelle und verloren Änderungen.
  _logGen: 0,
  _myOplogName() { return this._oplogPrefix() + this._getClientId() + '_g' + this._logGen + '.jsonl'; },
  _snapMetaName() { return 'snapmeta_' + this._dbSlug() + '.json'; },

  // ── Speichern: eigene Ops an das eigene Log anhängen ──
  async _saveV3() {
    if (this._appendInProgress) {
      // NICHT stillschweigend verwerfen: der Aufruf kam von einem Autosave mit
      // neuen Ops – nach dem laufenden Append erneut versuchen.
      setTimeout(() => this.scheduleAutoSave(), 1500);
      return;
    }
    if (!this._dirtyOps.length) {
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Gespeichert';
      return;
    }
    this._appendInProgress = true;
    const claimed = this._dirtyOps.splice(0);
    this._opsInFlight = claimed; // für _persistDirtyOps: Crash-Puffer behält sie
    let writable = null;
    try {
      const dir = this._syncDirV3();
      const pruefer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler?.activePruefer) || '?';
      const jetzt = Date.now();
      const cid = this._getClientId();
      const lines = claimed.map(o => JSON.stringify({
        uid: o.uid, ts: o.ts ?? jetzt, seq: o.seq ?? 0, c: cid, u: pruefer, sql: o.sql, params: o.params,
      })).join('\n') + '\n';
      const bytes = new TextEncoder().encode(lines);
      const handle = await dir.getFileHandle(this._myOplogName(), { create: true });
      let size = 0;
      try { size = (await handle.getFile()).size; } catch(e) {}
      const writeOp = async () => {
        writable = await handle.createWritable({ keepExistingData: true });
        await writable.write({ type: 'write', position: size, data: bytes });
        await writable.close();
        writable = null;
      };
      try {
        await Promise.race([
          writeOp(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Oplog-Append Timeout')), 30000)),
        ]);
      } catch(err) {
        if (writable) { try { await Promise.race([writable.abort(), new Promise(r => setTimeout(r, 10000))]); } catch(_) {} writable = null; }
        throw err;
      }
      this._myLogSize = size + bytes.length;
      claimed.forEach(o => { if (this._ownLogUids) this._ownLogUids.add(o.uid); });
      this._opsInFlight = null;
      this.unsavedChanges = this._dirtyOps.length > 0;
      this.saveCount++;
      this._saveRetryCount = 0;
      const timeStr = new Date().toLocaleTimeString('de-DE');
      document.getElementById('dbLastSaved').textContent = `✓ ${timeStr} (#${this.saveCount})`;
      // Ehrlicher Status: Sind während des Appends neue Ops aufgelaufen,
      // ist noch NICHT alles gespeichert – nachfassen statt grün melden.
      if (this._dirtyOps.length > 0) {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Geändert…';
        setTimeout(() => this.scheduleAutoSave(), 200);
      } else {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Gespeichert';
      }
      this._broadcastChange();
      this._persistDirtyOps();
      // Kompaktierung fällig? (höchstens alle 5 Min prüfen)
      if (Date.now() - this._lastCompactCheck > 300000) {
        this._lastCompactCheck = Date.now();
        if (await this._compactionDue()) this._compact('groesse');
      }
    } catch(e) {
      // Ops zurücklegen (an den Anfang – Reihenfolge erhalten), später erneut
      this._dirtyOps = [...claimed, ...this._dirtyOps];
      this._opsInFlight = null;
      this.unsavedChanges = true;
      this._persistDirtyOps(); // Crash-Puffer sofort aktualisieren
      console.error('[SyncV3] Append-Fehler:', e);
      // Windows-Netzlaufwerke: Chromium meldet InvalidStateError ("state had
      // changed since it was read from disk"), wenn sein Datei-Metadaten-Cache
      // nicht mehr zur Platte passt (SMB-Zeitstempel, Virenscanner, fremdes
      // Aufräumen). Ein erneuter Versuch auf DIESELBE Datei scheitert dann
      // dauerhaft – der Client könnte nie wieder speichern. Selbstheilung:
      // eigenes Log auf die nächste Generation drehen; die neue Datei hat
      // frischen Zustand, Leser erfassen ohnehin alle Generationen.
      if (e && e.name === 'InvalidStateError' && Date.now() - (this._lastCacheRotate || 0) > 5000) {
        this._lastCacheRotate = Date.now();
        // Lesestand der alten Datei festhalten, BEVOR die Generation wechselt:
        // sonst gilt sie ab jetzt als "fremdes" Log ohne Offset und würde beim
        // nächsten Poll komplett neu eingespielt (Selbst-Replay).
        this._logOffsets[this._myOplogName()] = this._myLogSize;
        this._logGen++;
        this._myLogSize = 0;
        console.warn(`[SyncV3] Datei-Cache-Fehler → eigenes Log rotiert auf Generation ${this._logGen}`);
        setTimeout(() => this.scheduleAutoSave(), 500);
      } else {
        setTimeout(() => this.scheduleAutoSave(), 5000);
      }
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
    } finally {
      this._appendInProgress = false;
    }
  },

  // ── Fremde Logs inkrementell lesen und anwenden ──
  async _pollOplogs() {
    if (!this._v3Ready) return;
    // Reentranz-Guard: Timer-Poll und BroadcastChannel-Zustellung können sich
    // überlappen – zwei parallele Läufe tauschten im Snapshot-Fall die DB
    // doppelt und verdoppelten Offsets-Fortschritt.
    if (this._pollBusy) return;
    const dir = this._syncDirV3();
    if (!dir || !this.db) return;
    this._pollBusy = true;
    try {
      // ZUERST prüfen, ob ein anderer Rechner den Snapshot ersetzt hat: Wird er
      // danach getauscht, wären die soeben gelesenen Ops wieder verworfen.
      await this._pruefeFremdenSnapshot();
      const prefix = this._oplogPrefix();
      const mine = this._myOplogName();
      const batch = [];
      for await (const entry of dir.entries()) {
        const name = entry[0], h = entry[1];
        if (!name.startsWith(prefix) || !name.endsWith('.jsonl') || name === mine) continue;
        let f;
        try { f = await h.getFile(); } catch(e) { continue; }
        let off = this._logOffsets[name] || 0;
        if (f.size < off) off = 0; // Log wurde rotiert → von vorn (uid-Set dedupt)
        if (f.size <= off) continue;
        const text = await f.slice(off).text();
        const nl = text.lastIndexOf('\n');
        if (nl < 0) continue; // Zeile noch unvollständig geschrieben
        const chunk = text.slice(0, nl + 1);
        this._logOffsets[name] = off + new TextEncoder().encode(chunk).length;
        chunk.split('\n').forEach(l => { if (l.trim()) batch.push(l); });
      }
      const applied = this._applyOps(batch);
      if (this._reconnectAttempts > 0) this._reconnectAttempts = 0;
      if (!this._syncReady) this._syncReady = true;
      if (applied > 0) {
        console.log(`[SyncV3] ${applied} fremde Änderungen übernommen`);
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green" style="animation:syncPulse 0.6s"></span>Sync ✓';
        setTimeout(() => {
          const el = document.getElementById('dbStatusIndicator');
          if (el && !this.unsavedChanges) el.innerHTML = '<span class="dot dot-green"></span>Verbunden';
        }, 2000);
        this._smartRefresh();
      }
      await this._rotateOwnLogIfCovered();
    } catch(e) {
      this._reconnectAttempts = (this._reconnectAttempts || 0) + 1;
      if (this._reconnectAttempts > 5) {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Getrennt';
      }
    } finally {
      this._pollBusy = false;
    }
  },

  // Ops (JSONL-Zeilen) nach Zeitstempel geordnet anwenden
  _applyOps(lines) {
    if (!lines.length) return 0;
    if (!this._appliedForeignUids) this._appliedForeignUids = new Set();
    // Großzügige Schwelle: Nach einem clear() schützt bei "geschrumpft
    // gemeldeter Datei + off=0" nur noch dieses Set vor Massen-Re-Apply.
    if (this._appliedForeignUids.size > 200000) this._appliedForeignUids.clear();
    const ops = [];
    for (const line of lines) {
      try { const op = JSON.parse(line); if (op && op.sql) ops.push(op); } catch(e) {}
    }
    // Deterministische Ordnung: Erfassungszeit, dann Client, dann dessen
    // laufende Nummer. Ein Zufalls-Tiebreaker (uid) zerstörte die Reihenfolge
    // innerhalb einer Millisekunde – abhängige Ops (INSERT, dann UPDATE
    // derselben Zeile) kamen beim Empfänger verdreht an.
    ops.sort((a, b) => (a.ts || 0) - (b.ts || 0)
      || String(a.c || '').localeCompare(String(b.c || ''))
      || (a.seq || 0) - (b.seq || 0));
    let applied = 0;
    const fehlgeschlagen = [];
    for (const op of ops) {
      if (op.uid && (this._appliedForeignUids.has(op.uid) || (this._ownLogUids && this._ownLogUids.has(op.uid)))) continue;
      // Lamport-Uhr: eigene künftige Ops müssen NACH allem liegen, was wir
      // gesehen haben – sonst verliert ein Client mit nachgehender Uhr jede
      // kausal spätere Änderung in der ts-Sortierung der Empfänger.
      if (op.ts && op.ts > (this._maxSeenTs || 0)) this._maxSeenTs = op.ts;
      try {
        if (!this._lwwSkip(op)) {
          this.db.run(op.sql, op.params || []);
          this._notiereKeSpalten(op.sql, op.params, op.ts);
          applied++;
        }
      } catch(e) {
        fehlgeschlagen.push(op);
      }
      if (op.uid) this._appliedForeignUids.add(op.uid);
    }
    // Zweiter Durchlauf: Bei Uhren-Versatz zwischen Clients kann eine abhängige
    // Op (z.B. Ergebnis zu einem Termin) im selben Batch VOR ihrer Grundlage
    // einsortiert sein. Ein einzelner Wiederholungsversuch heilt das; was dann
    // noch scheitert, ist wirklich defekt und wird gemeldet.
    for (const op of fehlgeschlagen) {
      try {
        this.db.run(op.sql, op.params || []);
        this._notiereKeSpalten(op.sql, op.ts);
        applied++;
      } catch(e) {
        console.warn('[SyncV3] Op übersprungen:', e.message, (op.sql || '').slice(0, 60));
      }
    }
    if (applied) { try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {} }
    return applied;
  },

  // Spalten-Zeitstempel für kontrollergebnisse: merkt sich pro Zeile, welche
  // Spalte zuletzt WANN gesetzt wurde (aus eigenen wie fremden Ops). Grundlage
  // für den spaltenbewussten Last-Write-Wins-Guard in _lwwSkip.
  _colStamps: null,
  _keSpaltenAusSql(setTeil) {
    return (setTeil.match(/([a-z_]+)\s*=/gi) || [])
      .map(x => x.replace(/\s*=$/, '').trim().toLowerCase())
      .filter(c => c !== 'geaendert_am' && c !== 'geaendert_von');
  },
  _notiereKeSpalten(sql, params, ts) {
    try {
      if (!ts || !params || !/kontrollergebnisse/i.test(sql || '')) return;
      const m = String(sql).match(/^\s*UPDATE\s+kontrollergebnisse\s+SET\s([\s\S]*?)\s+WHERE\s+kontrolltermin_id=\?\s+AND\s+schueler_id=\?\s*$/i);
      if (!m || params.length < 2) return;
      const key = params[params.length - 2] + '_' + params[params.length - 1];
      const spalten = this._keSpaltenAusSql(m[1]);
      if (!spalten.length) return;
      if (!this._colStamps) this._colStamps = new Map();
      if (this._colStamps.size > 20000) this._colStamps.clear();
      const eintrag = this._colStamps.get(key) || {};
      spalten.forEach(c => { if (!eintrag[c] || eintrag[c] < ts) eintrag[c] = ts; });
      this._colStamps.set(key, eintrag);
    } catch(e) {}
  },

  // Veraltete Ops erkennen: Ein Client, der lange offline war, liefert Ops mit
  // altem Erfassungszeitpunkt nach. Verworfen wird eine Op nur, wenn die lokale
  // Zeile GENAU DIESELBEN Spalten bereits neuer gesetzt hat – früher wurde die
  // ganze Op verworfen, wodurch unbeteiligte Spalten (z.B. "anwesend") verloren
  // gingen, obwohl sie sich konfliktfrei mergen ließen.
  _lwwSkip(op) {
    try {
      const m = (op.sql || '').match(/^\s*UPDATE\s+kontrollergebnisse\s+SET\s([\s\S]*?)\s+WHERE\s+kontrolltermin_id=\?\s+AND\s+schueler_id=\?\s*$/i);
      if (!m || !op.params || op.params.length < 2) return false;
      const tsMatch = m[1].match(/geaendert_am='([^']+)'/);
      if (!tsMatch) return false;
      const ktId = op.params[op.params.length - 2];
      const sId = op.params[op.params.length - 1];
      const lokal = this.query('SELECT geaendert_am FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [ktId, sId])[0];
      if (!lokal) return false;
      const spalten = this._keSpaltenAusSql(m[1]);
      if (!spalten.length) return false;
      const opTs = op.ts || Date.parse(tsMatch[1].replace(' ', 'T'));
      // PRIMÄR spaltenbewusst entscheiden: verworfen wird nur, wenn JEDE
      // Nutzspalte der Op lokal nachweislich SPÄTER gesetzt wurde
      // (Spaltenstempel aus eigenen und fremden Ops). Andernfalls wird die Op
      // angewendet – der SQL-Replay mergt disjunkte Spalten von selbst. Das
      // frühere pauschale Verwerfen ließ z.B. ein offline gesetztes
      // "anwesend" verschwinden, obwohl der Kollege nur "ergebnis" geändert
      // hatte. Der Zeilen-Zeitstempel taugt hier nicht als Kriterium: eine
      // zuvor gemergte ältere Op kann geaendert_am zurückgesetzt haben.
      const eintrag = this._colStamps && this._colStamps.get(ktId + '_' + sId);
      if (eintrag) {
        return spalten.every(c => eintrag[c] && eintrag[c] > opTs);
      }
      // Fallback ohne Spaltenkenntnis (frisch nach Reload): Zeilen-Zeitstempel
      // wie früher – mit 5s-Toleranz gegen DEFAULT-now-Versatz beim Empfänger.
      if (!lokal.geaendert_am || lokal.geaendert_am <= tsMatch[1]) return false;
      const diffSek = (Date.parse(lokal.geaendert_am.replace(' ', 'T')) - Date.parse(tsMatch[1].replace(' ', 'T'))) / 1000;
      return diffSek > 5;
    } catch(e) { return false; }
  },

  // ── Bootstrap nach dem Laden der Snapshot-Datei ──
  async _bootstrapV3() {
    const dir = this._syncDirV3();
    if (!dir) { this._v3Ready = false; return; }
    this._appliedForeignUids = new Set();
    this._ownLogUids = new Set();
    this._logOffsets = {};
    this._myLogSize = 0;
    // Eigene Log-Generation fortsetzen (nach Reload/Neustart)
    try {
      const eigen = this._oplogPrefix() + this._getClientId() + '_g';
      let maxGen = 0;
      for await (const [name] of dir.entries()) {
        if (!name.startsWith(eigen) || !name.endsWith('.jsonl')) continue;
        const n = parseInt(name.slice(eigen.length), 10);
        if (!isNaN(n) && n > maxGen) maxGen = n;
      }
      this._logGen = maxGen;
    } catch(e) {}
    let meta = null;
    try {
      const h = await dir.getFileHandle(this._snapMetaName(), { create: false });
      meta = JSON.parse(await (await h.getFile()).text());
    } catch(e) { /* erste Nutzung: kein Snapshot-Meta → Logs komplett anwenden */ }
    const baseOffsets = (meta && meta.offsets) || {};
    const prefix = this._oplogPrefix();
    const mine = this._myOplogName();
    const batch = [];
    try {
      for await (const entry of dir.entries()) {
        const name = entry[0], h = entry[1];
        if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) continue;
        let f;
        try { f = await h.getFile(); } catch(e) { continue; }
        let off = baseOffsets[name] || 0;
        if (f.size < off) off = 0;
        // Offset = KONSUMIERTE Bytes, nicht Dateigröße: Endet die Datei mitten
        // in einer halb geschriebenen Zeile (SMB-Flush), wird diese Op beim
        // nächsten Poll ab der Zeilengrenze nachgelesen. Mit "= f.size" wäre
        // sie für immer übersprungen worden – und eine spätere Kompaktierung
        // hätte sie als abgedeckt markiert, ohne dass sie je in einem
        // Snapshot stand.
        let gelesen = off;
        if (f.size > off) {
          const text = await f.slice(off).text();
          const chunk = text.slice(0, text.lastIndexOf('\n') + 1);
          gelesen = off + new TextEncoder().encode(chunk).length;
          const istEigenes = name.startsWith(this._oplogPrefix() + this._getClientId() + '_g');
          chunk.split('\n').forEach(l => {
            if (!l.trim()) return;
            if (istEigenes) {
              try { const op = JSON.parse(l); if (op.uid) this._ownLogUids.add(op.uid); batch.push(l); } catch(e) {}
            } else batch.push(l);
          });
        }
        if (name === mine) this._myLogSize = gelesen;
        else this._logOffsets[name] = gelesen;
      }
      // Endet das EIGENE aktuelle Log in einer angerissenen Zeile (Absturz
      // mitten im Append), nicht dahinter weiterschreiben – das ergäbe eine
      // unlesbare Doppelzeile für alle Leser. Stattdessen sauber auf eine neue
      // Generation drehen; der Lesestand der alten Datei ist notiert.
      try {
        const fh = await dir.getFileHandle(mine, { create: false });
        const echt = (await fh.getFile()).size;
        if (echt > this._myLogSize) {
          this._logOffsets[mine] = this._myLogSize;
          this._logGen++;
          this._myLogSize = 0;
          console.warn('[SyncV3] Eigenes Log endet in halber Zeile – neue Generation ' + this._logGen);
        }
      } catch(e) { /* eigenes Log existiert noch nicht */ }
      // Eigene wie fremde Ops in globaler ts-Ordnung anwenden (eigene sind im
      // Snapshot evtl. noch nicht enthalten); _ownLogUids ist bereits gefüllt,
      // daher eigene NICHT über das uid-Set ausschließen: temporär leeren Set nutzen
      const ownUids = this._ownLogUids;
      this._ownLogUids = new Set();
      this._applyOps(batch);
      this._ownLogUids = ownUids;
      this._snapGen = (meta && meta.gen) || 0;
      this._v3Ready = true;
      console.log(`[SyncV3] Bootstrap: ${batch.length} Log-Ops angewendet (${Object.keys(this._logOffsets).length + 1} Logs)`);
      // Große Logs nach dem Start kompaktieren (beschleunigt künftige Starts)
      setTimeout(async () => {
        try { if (await this._compactionDue()) this._compact('start'); } catch(e) {}
      }, 20000);
    } catch(e) {
      console.warn('[SyncV3] Bootstrap-Fehler:', e.message);
      this._v3Ready = true; // Polling darf trotzdem starten
    }
  },

  // ── Kompaktierung: Snapshot (DB-Datei) aktualisieren, mit Lock ──
  async _compactionDue() {
    try {
      const dir = this._syncDirV3();
      if (!dir) return false;
      // Nur Bytes zählen, die der Snapshot noch NICHT abdeckt. Die Gesamtgröße
      // wäre irreführend: verwaiste (aber vollständig abgedeckte) Logs toter
      // Clients ließen sonst jede 5 Minuten eine sinnlose Kompaktierung samt
      // Lock-Kontention anlaufen.
      let covered = {};
      try {
        const mh = await dir.getFileHandle(this._snapMetaName(), { create: false });
        covered = JSON.parse(await (await mh.getFile()).text())?.offsets || {};
      } catch(e) {}
      let offen = 0;
      const prefix = this._oplogPrefix();
      for await (const entry of dir.entries()) {
        const name = entry[0], h = entry[1];
        if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) continue;
        try { offen += Math.max(0, (await h.getFile()).size - (covered[name] || 0)); } catch(e) {}
      }
      return offen > 1500000; // ~1,5 MB ungedeckte Ops → kompakt
    } catch(e) { return false; }
  },
  async _compact(reason) {
    if (this._tabIsPrimary === false) return false; // Zweit-Tab kompaktiert nie
    if (this._compactInProgress || !this.db || !this.dbFileHandle) return false;
    this._compactInProgress = true;
    let writable = null;
    try {
      const gotLock = await this._acquireLock();
      if (!gotLock) return false; // ein anderer kompaktiert bereits – egal
      // 1) Eigene Ops sichern + alle fremden Logs vollständig einziehen
      await this._saveV3();
      await this._pollOplogs();
      // 2) Offsets = eigener LESESTAND. Ein erneuter Verzeichnis-Scan würde
      // Änderungen, die gerade WÄHREND der Kompaktierung angehängt wurden, als
      // "im Snapshot enthalten" markieren, obwohl der Snapshot aus dem Speicher
      // stammt – sie würden anschließend beim Rotieren verworfen.
      const dir = this._syncDirV3();
      const offsets = { ...this._logOffsets, [this._myOplogName()]: this._myLogSize };
      // 2b) Generation MONOTON halten: snapmeta frisch von der Platte lesen.
      // Der lokale _snapGen kann veraltet sein (fremde Kompaktierung noch nicht
      // gesehen) – zwei Clients schrieben dann DIESELBE Generationsnummer und
      // der jeweils andere lud den neuen Snapshot nie.
      let diskGen = 0;
      try {
        const mh = await dir.getFileHandle(this._snapMetaName(), { create: false });
        diskGen = JSON.parse(await (await mh.getFile()).text())?.gen || 0;
      } catch(e) {}
      if (diskGen > (this._snapGen || 0)) {
        // Es gibt einen Snapshot, den wir noch nicht übernommen haben – NICHT
        // blind überschreiben, erst regulär nachladen (nächster Poll).
        console.warn(`[SyncV3] Kompaktierung abgebrochen: fremder Snapshot gen ${diskGen} noch nicht übernommen`);
        return false;
      }
      // 3) Memory-Export → Snapshot-Datei (mit Timeout + Zombie-Abort).
      // Vorher Lock auffrischen: _saveV3 + _pollOplogs können auf langsamem
      // Laufwerk zusammen >150s brauchen – ohne Heartbeat gälte unser Lock als
      // stale und ein zweiter Client kompaktierte parallel.
      await this._refreshLock();
      const data = this.db.export();
      const writeOp = async () => {
        writable = await this.dbFileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        writable = null;
      };
      try {
        await Promise.race([
          writeOp(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Snapshot-Write Timeout')), 120000)),
        ]);
      } catch(err) {
        if (writable) { try { await Promise.race([writable.abort(), new Promise(r => setTimeout(r, 15000))]); } catch(_) {} writable = null; }
        throw err;
      }
      // 4) snapmeta schreiben (Lock nochmals auffrischen – der Write kann bis
      // zu 120s gedauert haben)
      await this._refreshLock();
      const metaHandle = await dir.getFileHandle(this._snapMetaName(), { create: true });
      const mw = await metaHandle.createWritable();
      this._snapGen = Math.max(diskGen, this._snapGen || 0) + 1;
      await mw.write(JSON.stringify({ offsets, gen: this._snapGen, t: new Date().toISOString(), by: this._getClientId(), grund: reason }));
      await mw.close();
      try { const f2 = await this.dbFileHandle.getFile(); this.dbLastModified = f2.lastModified; this._lastFileSize = f2.size; } catch(e) {}
      await this._writeSyncMarker();
      // 5) Tote Logs aufräumen: Dateien verwaister Clients (PC-Tausch, neues
      // Browserprofil) rotieren nie selbst und ließen _compactionDue sonst
      // dauerhaft anschlagen. Löschen ist sicher, wenn ALLES im Snapshot steckt
      // (Offset >= Größe) und die Datei seit Tagen unverändert ist.
      try {
        const prefix = this._oplogPrefix();
        const eigen = prefix + this._getClientId() + '_g';
        for await (const [name, fh] of dir.entries()) {
          if (!name.startsWith(prefix) || !name.endsWith('.jsonl') || name.startsWith(eigen)) continue;
          try {
            const f = await fh.getFile();
            if ((offsets[name] || 0) >= f.size && Date.now() - f.lastModified > 3 * 86400000) {
              await dir.removeEntry(name);
              console.log('[SyncV3] Verwaistes Log entfernt:', name);
            }
          } catch(e) {}
        }
      } catch(e) {}
      console.log(`[SyncV3] Snapshot kompaktiert (${reason})`);
      return true;
    } catch(e) {
      console.warn('[SyncV3] Kompaktierung fehlgeschlagen:', e.message);
      return false;
    } finally {
      await this._releaseLock();
      this._compactInProgress = false;
    }
  },

  // Eigenes Log leeren, wenn der Snapshot es vollständig abdeckt
  // Hat ein anderer Rechner den Snapshot ersetzt (Kompaktierung oder
  // IBYKUS-Import)? Dann muss dieser Client ihn neu laden – sonst überschreibt
  // seine nächste eigene Kompaktierung den fremden Stand mit seinem älteren
  // Speicherabbild (der komplette Import wäre weg).
  async _pruefeFremdenSnapshot() {
    if (this._compactInProgress || this._appendInProgress) return;
    try {
      const dir = this._syncDirV3();
      const h = await dir.getFileHandle(this._snapMetaName(), { create: false });
      const meta = JSON.parse(await (await h.getFile()).text());
      const gen = meta?.gen || 0;
      if (!gen || gen <= (this._snapGen || 0)) return;
      if (meta.by === this._getClientId()) { this._snapGen = gen; return; }
      console.log(`[SyncV3] Fremder Snapshot erkannt (Generation ${gen}) – lade neu`);
      const file = await this.dbFileHandle.getFile();
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      const neu = new SQL.Database(new Uint8Array(buf));
      // Sanity: niemals gegen eine leer gelesene Datei tauschen
      const tabellen = neu.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table'");
      if (!tabellen.length || tabellen[0].values[0][0] < 3) { neu.close(); return; }
      const alt = this.db;
      this.db = neu;
      try { alt.close(); } catch(e) {}
      this.migrateDB();
      this._snapGen = gen;
      this._logOffsets = { ...(meta.offsets || {}) };
      this._appliedForeignUids = new Set();
      this._ownLogUids = new Set();
      // EIGENE Ops retten: Der fremde Kompaktierer hat unser Log nur bis zu
      // SEINEM Lesestand in den Snapshot übernommen. Alles dahinter steht zwar
      // in unserer Log-Datei, würde aber nie wieder eingelesen (_pollOplogs
      // überspringt das eigene Log) – die Änderungen wären am eigenen
      // Bildschirm weg und nach unserer nächsten Kompaktierung ÜBERALL.
      // Deshalb: eigene Log-Dateien ab dem meta-Offset nachspielen.
      const eigenPrefix = this._oplogPrefix() + this._getClientId() + '_g';
      for await (const [name, fh] of dir.entries()) {
        if (!name.startsWith(eigenPrefix) || !name.endsWith('.jsonl')) continue;
        let f; try { f = await fh.getFile(); } catch(e) { continue; }
        let off = (meta.offsets || {})[name] || 0;
        if (f.size < off) off = 0;
        if (f.size > off) {
          const text = await f.slice(off).text();
          const chunk = text.slice(0, text.lastIndexOf('\n') + 1);
          let nachgespielt = 0;
          chunk.split('\n').forEach(l => {
            if (!l.trim()) return;
            try {
              const op = JSON.parse(l);
              if (op.uid) this._ownLogUids.add(op.uid);
              if (op.sql) { try { this.db.run(op.sql, op.params || []); nachgespielt++; } catch(e) {} }
            } catch(e) {}
          });
          if (nachgespielt) console.log(`[SyncV3] ${nachgespielt} eigene Ops nach Snapshot-Tausch nachgespielt (${name})`);
        }
        if (name === this._myOplogName()) this._myLogSize = f.size;
        else this._logOffsets[name] = f.size;
      }
      // Ungespeicherte Puffer-Ops ebenfalls auf die frische DB anwenden –
      // sie waren nur auf der alten Arbeitskopie sichtbar.
      if (this._dirtyOps.length) {
        for (const o of this._dirtyOps) {
          try { this.db.run(o.sql, o.params || []); } catch(e) {}
        }
      }
      try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
      this._smartRefresh();
    } catch(e) { console.warn('[SyncV3] Snapshot-Prüfung:', e.message); }
  },

  async _rotateOwnLogIfCovered() {
    try {
      if (this._tabIsPrimary === false) return; // Zweit-Tab: nicht rotieren/prunen
      if (this._dirtyOps.length || this._appendInProgress || !this._myLogSize) return;
      const dir = this._syncDirV3();
      const h = await dir.getFileHandle(this._snapMetaName(), { create: false });
      const meta = JSON.parse(await (await h.getFile()).text());
      const aktuell = this._myOplogName();
      const covered = meta?.offsets?.[aktuell];
      if (covered == null) return;
      const fh = await dir.getFileHandle(aktuell, { create: false });
      const size = (await fh.getFile()).size;
      if (size > 0 && covered >= size) {
        // Neue Generation beginnen; die alte Datei bleibt zunächst liegen,
        // damit Leser sie zu Ende lesen können.
        // WICHTIG: (a) Lesestand der alten Datei eintragen – sie zählt ab jetzt
        // in _pollOplogs als "fremdes" Log; ohne Offset würde sie ab Byte 0
        // gelesen und die eigene komplette Historie erneut angewendet
        // (Selbst-Replay, überschreibt zwischenzeitliche Änderungen der
        // Kollegen). (b) _ownLogUids NICHT leeren – es ist die zweite
        // Verteidigungslinie gegen genau dieses Re-Apply.
        this._logOffsets[aktuell] = size;
        this._logGen++;
        this._myLogSize = 0;
        await this._pruneAlteGenerationen(dir);
        console.log('[SyncV3] Eigenes Log rotiert → Generation ' + this._logGen);
      }
    } catch(e) { /* meta/log fehlt – ok */ }
  },
  // Nur die letzten beiden eigenen Generationen aufheben
  async _pruneAlteGenerationen(dir) {
    try {
      const eigen = this._oplogPrefix() + this._getClientId() + '_g';
      const gens = [];
      for await (const [name] of dir.entries()) {
        if (!name.startsWith(eigen) || !name.endsWith('.jsonl')) continue;
        const n = parseInt(name.slice(eigen.length), 10);
        if (!isNaN(n)) gens.push(n);
      }
      gens.sort((a, b) => b - a);
      for (const n of gens.slice(2)) {
        try { await dir.removeEntry(eigen + n + '.jsonl'); } catch(e) {}
      }
    } catch(e) {}
  },

  // ═══════════════════════════════════════════
  //  LÖSCHEN MIT KASKADE
  //  PRAGMA foreign_keys ist in sql.js standardmäßig AUS, die ON DELETE
  //  CASCADE im Schema greifen also nie. Ohne diese Helfer blieben nach jedem
  //  Löschen verwaiste Zeilen liegen: unsichtbar, aber weiterhin in Ampel,
  //  Statistik und Mängelcode-Auswertung mitgezählt.
  // ═══════════════════════════════════════════
  deleteSchuelerKaskade(id, opts) {
    if (!id) return;
    if (!(opts && opts.ohnePapierkorb)) {
      try {
        const s = this.query('SELECT * FROM schueler WHERE id=?', [id])[0];
        if (s) {
          this._papierkorbAblegen('schueler', id, `${s.nachname}, ${s.vorname}`, {
            schueler: 'WHERE id=?',
            kw_status: 'WHERE schueler_id=?',
            kontrollergebnisse: 'WHERE schueler_id=?',
            kw_maengel: 'WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE schueler_id=?)',
            durchsicht_snapshots: 'WHERE schueler_id=?',
            wiedervorlagen: 'WHERE schueler_id=?',
            wiedervorlage_notizen: 'WHERE wiedervorlage_id IN (SELECT id FROM wiedervorlagen WHERE schueler_id=?)',
            ausbildungsphasen: 'WHERE schueler_id=?',
            schueler_bemerkungen: 'WHERE schueler_id=?',
            schueler_dateien: 'WHERE schueler_id=?',
            kontrolltermin_schueler: 'WHERE schueler_id=?',
          }, [id]);
          // Löschung im Änderungs-Logbuch festhalten (Nachvollziehbarkeit / IBYKUS-Abgleich)
          try { this.logChange(id, 'datensatz', `${s.nachname}, ${s.vorname}` + (s.ibykus_id ? ` (IBYKUS ${s.ibykus_id})` : ''), 'gelöscht', 'geloescht'); } catch(e) {}
        }
      } catch(e) { console.warn('Papierkorb:', e); }
    }
    ['DELETE FROM kw_maengel WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE schueler_id=?)',
     'DELETE FROM wiedervorlage_notizen WHERE wiedervorlage_id IN (SELECT id FROM wiedervorlagen WHERE schueler_id=?)',
     'DELETE FROM durchsicht_snapshots WHERE schueler_id=?',
     'DELETE FROM wiedervorlagen WHERE schueler_id=?',
     'DELETE FROM kontrollergebnisse WHERE schueler_id=?',
     'DELETE FROM kw_status WHERE schueler_id=?',
     'DELETE FROM ausbildungsphasen WHERE schueler_id=?',
     'DELETE FROM schueler_bemerkungen WHERE schueler_id=?',
     'DELETE FROM schueler_dateien WHERE schueler_id=?',
     'DELETE FROM kontrolltermin_schueler WHERE schueler_id=?',
     'DELETE FROM aktive_sitzung WHERE schueler_id=?',
     'DELETE FROM schueler WHERE id=?',
    ].forEach(sql => { try { this.run(sql, [id]); } catch(e) { /* Tabelle evtl. nicht vorhanden */ } });
  },
  deleteTerminKaskade(id, opts) {
    if (!id) return;
    if (!(opts && opts.ohnePapierkorb)) {
      try {
        const t = this.query('SELECT * FROM kontrolltermine WHERE id=?', [id])[0];
        if (t) {
          const bs = this.getTerminSchule(id);
          const n = this.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=?', [id]) || 0;
          this._papierkorbAblegen('termin', id, `${t.geplant_datum || ''}${bs ? ' · ' + bs.name : ''}${t.bemerkung ? ' · ' + t.bemerkung : ''} (${n} Ergebnis-Zeilen)`, {
            kontrolltermine: 'WHERE id=?',
            kontrolltermin_klassen: 'WHERE kontrolltermin_id=?',
            kontrolltermin_schueler: 'WHERE kontrolltermin_id=?',
            kontrollergebnisse: 'WHERE kontrolltermin_id=?',
            kw_maengel: 'WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)',
            durchsicht_snapshots: 'WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)',
            wiedervorlagen: 'WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)',
            wiedervorlage_notizen: 'WHERE wiedervorlage_id IN (SELECT id FROM wiedervorlagen WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?))',
          }, [id]);
        }
      } catch(e) { console.warn('Papierkorb:', e); }
    }
    ['DELETE FROM kw_maengel WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)',
     'DELETE FROM durchsicht_snapshots WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)',
     'DELETE FROM wiedervorlagen WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)',
     'DELETE FROM kontrollergebnisse WHERE kontrolltermin_id=?',
     'DELETE FROM kontrolltermin_klassen WHERE kontrolltermin_id=?',
     'DELETE FROM kontrolltermin_schueler WHERE kontrolltermin_id=?',
     'DELETE FROM aktive_sitzung WHERE kontrolltermin_id=?',
     'DELETE FROM kontrolltermine WHERE id=?',
    ].forEach(sql => { try { this.run(sql, [id]); } catch(e) {} });
  },
  deleteKlasseKaskade(id) {
    if (!id) return;
    ['UPDATE schueler SET klasse_id=NULL WHERE klasse_id=?',
     'UPDATE kontrolltermine SET klasse_id=NULL WHERE klasse_id=?',
     'DELETE FROM kontrolltermin_klassen WHERE klasse_id=?',
     'DELETE FROM klassen WHERE id=?',
    ].forEach(sql => { try { this.run(sql, [id]); } catch(e) {} });
  },
  deleteSchuleKaskade(id) {
    if (!id) return;
    try {
      this.query('SELECT id FROM klassen WHERE berufsschule_id=?', [id]).forEach(k => this.deleteKlasseKaskade(k.id));
    } catch(e) {}
    ['DELETE FROM blockplan WHERE berufsschule_id=?',
     'DELETE FROM berufsschulen WHERE id=?',
    ].forEach(sql => { try { this.run(sql, [id]); } catch(e) {} });
  },
  deleteBetriebKaskade(id) {
    if (!id) return;
    ['UPDATE schueler SET betrieb_id=NULL WHERE betrieb_id=?',
     'DELETE FROM ausbilder WHERE betrieb_id=?',
     'DELETE FROM betriebe WHERE id=?',
    ].forEach(sql => { try { this.run(sql, [id]); } catch(e) {} });
  },
  deleteJahrgangKaskade(id) {
    if (!id) return;
    ['UPDATE schueler SET jahrgang_id=NULL WHERE jahrgang_id=?',
     'UPDATE klassen SET jahrgang_id=NULL WHERE jahrgang_id=?',
     'UPDATE kontrolltermine SET jahrgang_id=NULL WHERE jahrgang_id=?',
     'DELETE FROM abschlussjahrgaenge WHERE id=?',
    ].forEach(sql => { try { this.run(sql, [id]); } catch(e) {} });
  },

  // ═══════════════════════════════════════════
  //  PAPIERKORB
  //  Gelöschte Azubis und Termine landen samt aller abhängigen Zeilen als
  //  JSON im Papierkorb (90 Tage) und lassen sich in den Einstellungen mit
  //  einem Klick wiederherstellen. Die Zeilen behalten ihre IDs, Verknüpfungen
  //  bleiben also intakt; der Re-INSERT hebt die Tombstones automatisch auf.
  // ═══════════════════════════════════════════
  PAPIERKORB_MAX_BYTES: 400000,
  _papierkorbAblegen(art, refId, label, tabellen, params) {
    const daten = {};
    Object.entries(tabellen).forEach(([tab, where]) => {
      try { const rows = this.query(`SELECT * FROM ${tab} ${where}`, params); if (rows.length) daten[tab] = rows; } catch(e) {}
    });
    let json = JSON.stringify(daten);
    let gekuerzt = '';
    // Zu große Pakete (sehr viele Durchsichtsbogen-Snapshots) ohne Snapshots ablegen –
    // die Kontrollergebnisse selbst bleiben vollständig erhalten
    if (json.length > this.PAPIERKORB_MAX_BYTES && daten.durchsicht_snapshots) {
      delete daten.durchsicht_snapshots; gekuerzt = ' – ohne PDF-Snapshots'; json = JSON.stringify(daten);
    }
    if (json.length > this.PAPIERKORB_MAX_BYTES) { console.warn('Papierkorb: Paket zu groß, nicht abgelegt'); return; }
    const anzahl = Object.values(daten).reduce((n, r) => n + r.length, 0);
    this.run('INSERT INTO bhk_papierkorb (art, ref_id, label, daten, geloescht_von) VALUES (?,?,?,?,?)',
      [art, refId, `${label}${gekuerzt} · ${anzahl} Zeilen`, json, this.currentUser || '']);
  },
  papierkorbListe() {
    try { return this.query('SELECT id, art, ref_id, label, geloescht_von, geloescht_am, length(daten) AS bytes FROM bhk_papierkorb ORDER BY geloescht_am DESC'); }
    catch(e) { return []; }
  },
  // Reihenfolge: Eltern vor Kindern (FKs werden zwar nicht erzwungen, aber
  // _rewriteKeRef & Co. erwarten vorhandene Elternzeilen)
  PAPIERKORB_REIHENFOLGE: ['schueler','kontrolltermine','kontrolltermin_klassen','kontrolltermin_schueler',
    'kontrollergebnisse','kw_status','kw_maengel','durchsicht_snapshots','wiedervorlagen','wiedervorlage_notizen',
    'ausbildungsphasen','schueler_bemerkungen','schueler_dateien'],
  papierkorbWiederherstellen(pkId) {
    const e = this.query('SELECT * FROM bhk_papierkorb WHERE id=?', [pkId])[0];
    if (!e) return { ok: false, grund: 'Eintrag nicht gefunden' };
    let daten;
    try { daten = JSON.parse(e.daten); } catch(err) { return { ok: false, grund: 'Daten nicht lesbar' }; }
    // Hauptzeile schon wieder vorhanden (z.B. per Import neu angelegt)? Dann nicht doppelt anlegen
    const haupt = e.art === 'schueler' ? 'schueler' : 'kontrolltermine';
    if (this.scalar(`SELECT COUNT(*) FROM ${haupt} WHERE id=?`, [e.ref_id])) {
      return { ok: false, grund: (e.art === 'schueler' ? 'Azubi' : 'Termin') + ' existiert bereits wieder – Papierkorb-Eintrag wird verworfen', vorhanden: true };
    }
    let zeilen = 0;
    this.PAPIERKORB_REIHENFOLGE.forEach(tab => {
      const rows = daten[tab];
      if (!rows || !rows.length) return;
      let cols;
      try { cols = new Set(this.query(`PRAGMA table_info(${tab})`).map(r => r.name)); } catch(err) { return; }
      rows.forEach(row => {
        const keys = Object.keys(row).filter(k => cols.has(k));
        if (!keys.length) return;
        try {
          this.run(`INSERT OR IGNORE INTO ${tab} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => row[k]));
          zeilen++;
        } catch(err) { console.warn('Papierkorb-Restore', tab, err.message); }
      });
    });
    if (e.art === 'schueler') { try { this.logChange(e.ref_id, 'datensatz', 'gelöscht', 'wiederhergestellt', 'wiederhergestellt'); } catch(err) {} }
    this.run('DELETE FROM bhk_papierkorb WHERE id=?', [pkId]);
    try { this.invalidateTerminCache && this.invalidateTerminCache(); } catch(err) {}
    return { ok: true, zeilen };
  },
  papierkorbEintragLoeschen(pkId) { this.run('DELETE FROM bhk_papierkorb WHERE id=?', [pkId]); },
  papierkorbLeeren() { this.run('DELETE FROM bhk_papierkorb'); },

  // ═══════════════════════════════════════════
  //  BACKUP-WIEDERHERSTELLUNG
  // ═══════════════════════════════════════════
  async listBackups() {
    if (!this.backupsDirHandle) return [];
    const out = [];
    try {
      for await (const entry of this.backupsDirHandle.values()) {
        if (entry.kind !== 'file' || !entry.name.startsWith('backup_') || !entry.name.endsWith('.sqlite')) continue;
        try { const f = await entry.getFile(); out.push({ name: entry.name, size: f.size, lastModified: f.lastModified }); } catch(e) {}
      }
    } catch(e) {}
    return out.sort((a, b) => b.name.localeCompare(a.name));
  },
  // Stellt ein Backup als neuen gemeinsamen Stand her: eigene Änderungen werden
  // vorher weggeschrieben, der aktuelle Stand als Sicherung abgelegt, dann wird
  // das Backup als Snapshot kompaktiert – die anderen Rechner übernehmen ihn
  // beim nächsten Abgleich (neue Snapshot-Generation).
  async restoreBackup(name) {
    if (!this.backupsDirHandle || !this.dbFileHandle || !this.db) { this.toast('Kein Datenbank-Ordner verbunden', 'error'); return false; }
    if (this._tabIsPrimary === false) { this.toast('Bitte im ersten geöffneten Tab wiederherstellen', 'warning'); return false; }
    this.showLoading && this.showLoading('Backup wird geprüft…');
    let neu = null;
    try {
      const fh = await this.backupsDirHandle.getFileHandle(name, { create: false });
      const buf = await (await fh.getFile()).arrayBuffer();
      const SQL = await App._getSqlJs();
      neu = new SQL.Database(new Uint8Array(buf));
      const check = neu.exec('PRAGMA integrity_check');
      const ok = check[0] && check[0].values[0] && check[0].values[0][0];
      if (ok !== 'ok') throw new Error('Integritätsprüfung fehlgeschlagen: ' + ok);
      // 1) Eigene ungesicherte Änderungen wegschreiben + aktuellen Stand sichern
      this.showLoading && this.showLoading('Aktueller Stand wird gesichert…');
      try { await this.mergeAndSave(true); } catch(e) { console.warn('Vor Wiederherstellung:', e); }
      await this.createBackup('vor-wiederherstellung');
      // 2) Umschalten
      this.showLoading && this.showLoading('Backup wird eingespielt…');
      const alt = this.db;
      this.db = neu; neu = null;
      try { alt.close(); } catch(e) {}
      this.migrateDB();
      this._dirtyOps = [];
      this._opsInFlight = [];
      try { await this._persistDirtyOps(); } catch(e) {}
      try { if (typeof GlobalSearch !== 'undefined') GlobalSearch._hayCache = null; } catch(e) {}
      // 3) Als neuen Snapshot schreiben (v3: Kompaktierung mit neuer Generation)
      await this.fullSave();
      this.unsavedChanges = false;
      this.hideLoading && this.hideLoading();
      this.renderCurrentView();
      this.toast(`Backup „${name}" wiederhergestellt – die anderen Rechner übernehmen den Stand automatisch`, 'success');
      return true;
    } catch(e) {
      console.error('Wiederherstellung fehlgeschlagen:', e);
      try { neu && neu.close(); } catch(_) {}
      this.hideLoading && this.hideLoading();
      this.toast('Wiederherstellung fehlgeschlagen: ' + e.message + ' – Stand wird von der Platte neu geladen', 'error');
      try { await this.reloadFromFile(); } catch(_) {}
      return false;
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
    if (this._saveCooldownUntil && Date.now() < this._saveCooldownUntil) return;

    // Sync-v3: Ops ans eigene Log anhängen statt die geteilte Datei zu beschreiben
    if (this._v3Active() && this._v3Ready) return this._saveV3();
    // v3-Verzeichnis vorhanden, aber Bootstrap läuft noch: AUFSCHIEBEN statt in
    // den v2-Direktschreibpfad zu fallen. Der v2-Pfad ersetzt die geteilte
    // .sqlite ohne snapmeta-Update – kein anderer v3-Client erführe je davon,
    // und die nächste fremde Kompaktierung überschriebe die Änderungen.
    if (this._v3Active() && !this._v3Ready) {
      setTimeout(() => this.scheduleAutoSave(), 2000);
      return;
    }

    this._mergeInProgress = true;
    try {
      // Retry-SCHLEIFE statt Rekursion/setTimeout: (a) await-Semantik bleibt
      // erhalten (Aufrufer weiß, wann wirklich gespeichert ist), (b) das
      // finally eines äußeren Aufrufs kann nie das Lock eines inneren
      // Retry-Aufrufs freigeben (Ownership pro Versuch).
      for (let attempt = 1; attempt <= 5; attempt++) {
        const status = await this._mergeAttempt(force);
        if (status !== 'retry') break;
      }
    } finally {
      this._mergeInProgress = false;
    }
  },
  // Ein einzelner Merge-Save-Versuch. Rückgabe: 'ok' | 'retry' | 'stop'.
  async _mergeAttempt(force) {
    const t0 = Date.now();
    try {
      // 0) Acquire lock file to prevent concurrent writes
      const lockAcquired = await this._acquireLock();
      if (!lockAcquired) {
        document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-yellow"></span>Warte (anderer User speichert)…';
        setTimeout(() => this.scheduleAutoSave(), 3000);
        return 'stop';
      }

      // 1) Read disk version
      const file = await this.dbFileHandle.getFile();
      const buf = await file.arrayBuffer();
      const SQL = await App._getSqlJs();
      const diskDb = new SQL.Database(new Uint8Array(buf));

      // 1b) Sanity-Check: Wenn die Disk-DB leer/korrupt gelesen wurde (SMB-Glitch),
      // NIEMALS die gute Datei damit überschreiben.
      try {
        const diskTables = diskDb.exec("SELECT COUNT(*) FROM sqlite_master WHERE type='table'");
        const tableCount = diskTables.length ? diskTables[0].values[0][0] : 0;
        const memSchueler = this.scalar('SELECT COUNT(*) FROM schueler') || 0;
        if (tableCount < 3 && memSchueler > 0) {
          diskDb.close();
          console.error('[Save] Disk-DB unlesbar/leer gelesen – Save abgebrochen (Schutz vor Überschreiben)');
          this.toast('Netzlaufwerk-Lesefehler – Speichern übersprungen, wird erneut versucht', 'warning');
          setTimeout(() => this.scheduleAutoSave(), 5000);
          return 'stop';
        }
      } catch(e) {
        diskDb.close();
        this.toast('Disk-DB nicht lesbar – Speichern übersprungen', 'warning');
        setTimeout(() => this.scheduleAutoSave(), 5000);
        return 'stop';
      }

      // 2) Ensure diskDb has the same schema
      this._migrateDiskDb(diskDb);

      // 2c) KE-Id-Reconciliation VOR dem Replay: hat ein anderer Client dieselbe
      // Kontrollergebnis-Zeile (Natural Key) mit anderer id auf der Disk angelegt,
      // übernehmen wir die Disk-id lokal + in allen pendenten Ops.
      this._reconcileKeIds(diskDb);

      // 3) Replay our dirty ops onto diskDb (idempotent via Ledger)
      const ops = [...this._dirtyOps];
      let replayErrors = 0;
      let permanentlyDropped = 0;
      const retryOps = []; // fehlgeschlagen, aber < 3 Versuche → beim nächsten Save erneut
      const appliedStmt = (() => {
        try { return diskDb.prepare('SELECT 1 FROM bhk_applied_ops WHERE op_uid=?'); } catch(e) { return null; }
      })();
      const wasApplied = (uid) => {
        if (!appliedStmt || !uid) return false;
        try { appliedStmt.bind([uid]); const hit = appliedStmt.step(); appliedStmt.reset(); return hit; } catch(e) { return false; }
      };
      ops.forEach((op) => {
        try {
          // Bereits angewendet (Crash/Retry nach Disk-Write)? → überspringen statt doppeln
          if (wasApplied(op.uid)) return;
          diskDb.run(op.sql, op.params);
          if (op.uid) { try { diskDb.run('INSERT OR IGNORE INTO bhk_applied_ops (op_uid,ts) VALUES (?,?)', [op.uid, new Date().toISOString()]); } catch(e) {} }
        } catch(e) {
          op._retries = (op._retries || 0) + 1;
          replayErrors++;
          console.warn('Merge-replay skip:', e.message, op.sql.substring(0, 60));
          if (op._retries >= 3) permanentlyDropped++;
          else retryOps.push(op);
        }
      });
      if (appliedStmt) { try { appliedStmt.free(); } catch(e) {} }
      // Ledger begrenzen (die letzten ~5000 Ops reichen für jedes Crash-Fenster)
      try { diskDb.run('DELETE FROM bhk_applied_ops WHERE rowid NOT IN (SELECT rowid FROM bhk_applied_ops ORDER BY rowid DESC LIMIT 5000)'); } catch(e) {}
      if (permanentlyDropped) {
        console.error(`Permanently dropped ${permanentlyDropped} ops after 3 failed replays`);
      }

      // 3b) Pre-write version check: detect if another user saved between our read and now
      const freshToken = await this._readMarkerToken();
      if (freshToken && freshToken !== this._lastSyncVersion) {
        diskDb.close();
        // Fremdes Token als gesehen übernehmen – der Retry liest die Disk sofort
        // neu, damit ist der fremde Stand enthalten. Ohne das dreht der Retry
        // endlos (Livelock), weil derselbe Marker immer wieder "neu" ist.
        this._lastSyncVersion = freshToken;
        console.log('[Save] Marker changed during save → retry with fresh disk data');
        return 'retry';
      }

      // 3c) Lock-Heartbeat: Timestamp auffrischen, damit ein langsamer Save
      // (Lesen+Migrieren+Replay können >30s dauern) nicht als stale gestohlen wird.
      await this._refreshLock();

      // 4) Write merged diskDb back to file (adaptive timeout based on connection speed)
      const data = diskDb.export();
      const timeoutMs = this._networkQuality === 'good' ? 30000
        : this._networkQuality === 'slow' ? 60000 : 120000;
      let writable = null;
      const writeOp = async () => {
        writable = await this.dbFileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        writable = null;
      };
      try {
        await Promise.race([
          writeOp(),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Schreibvorgang Timeout (${timeoutMs/1000}s) – Netzlaufwerk reagiert nicht`)), timeoutMs))
        ]);
      } catch(writeErr) {
        // Zombie-Write verhindern: Der Timeout gewinnt nur das Race – der Write
        // läuft im Hintergrund WEITER und würde beim späteren close() die Datei
        // atomar ersetzen (überschreibt dann den Save eines anderen Nutzers,
        // dessen Lock wir gleich freigeben). abort() verwirft die Swap-Datei.
        if (writable) {
          try {
            await Promise.race([writable.abort(), new Promise(r => setTimeout(r, 15000))]);
          } catch(_) {}
          writable = null;
        }
        throw writeErr;
      }

      // 5) Import other prüfer's changes into our in-memory DB
      this._importFromDisk(diskDb);

      // 6) Update timestamp + clear tracking
      const f2 = await this.dbFileHandle.getFile();
      this.dbLastModified = f2.lastModified; this._lastFileSize = f2.size;
      // Behalte: fehlgeschlagene Ops (mit Retry-Budget) + Ops die WÄHREND des Saves dazukamen
      const opsSet = new Set(ops);
      this._dirtyOps = [...retryOps, ...this._dirtyOps.filter(o => !opsSet.has(o))];
      this.unsavedChanges = this._dirtyOps.length > 0;
      this.saveCount++;
      this._saveRetryCount = 0;
      this._saveCooldownUntil = null;

      diskDb.close();

      // 7) Track timing for adaptive scheduling + update network quality
      this._lastSaveDurationMs = Date.now() - t0;
      this._updateNetworkQuality();

      // Update UI
      const timeStr = new Date().toLocaleTimeString('de-DE');
      const durSec = (this._lastSaveDurationMs / 1000).toFixed(1);
      document.getElementById('dbLastSaved').textContent = `✓ ${timeStr} (#${this.saveCount}, ${durSec}s)`;
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-green"></span>Gespeichert';

      this._broadcastChange();
      // Marker awaited und VOR dem Lock-Release (finally): ein fire-and-forget-
      // Marker kann nach dem Release den frischen Marker eines anderen Nutzers
      // überschreiben und dessen Save für alle maskieren.
      await this._writeSyncMarker();
      this._persistDirtyOps();

      if (permanentlyDropped) {
        this.toast(`⚠︎ ${permanentlyDropped} Änderung(en) endgültig fehlgeschlagen und verworfen. Bitte Daten prüfen.`, 'error');
      } else if (replayErrors > 0) {
        console.warn(`Merge-save: ${ops.length} ops replayed, ${replayErrors} skipped (will retry)`);
      }
      return 'ok';
    } catch(e) {
      this._saveRetryCount = (this._saveRetryCount || 0) + 1;
      this._lastSaveDurationMs = Date.now() - t0;
      this._updateNetworkQuality();

      const isStale = e.name === 'InvalidStateError' || e.message?.includes('state');
      const isPermission = e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.message?.includes('not allowed');
      const isTimeout = e.message?.includes('Timeout');

      if (isStale && this.dirHandle && this._saveRetryCount <= 3) {
        try {
          const oldName = this.dbFileHandle?.name || 'berichtsheftkontrolle.sqlite';
          this.dbFileHandle = await this.dirHandle.getFileHandle(oldName, { create: false });
          console.log('[Save] retry ' + this._saveRetryCount + '/3');
          return 'retry';
        } catch(reacquireErr) {}
      }

      // Adaptive cooldown: 30s (good), 45s (slow), 60s (very-slow)
      const cooldownMs = this._networkQuality === 'good' ? 30000
        : this._networkQuality === 'slow' ? 45000 : 60000;
      if (this._saveRetryCount >= 3 || isPermission) {
        this._saveCooldownUntil = Date.now() + cooldownMs;
        this._saveRetryCount = 0;
        document.getElementById('dbStatusIndicator').innerHTML = `<span class="dot dot-yellow"></span>Warte ${cooldownMs/1000}s…`;
        console.warn('[Save] Cooldown ' + cooldownMs/1000 + 's nach ' + (isPermission ? 'Permission-Error' : isTimeout ? 'Timeout' : '3 Fehlversuchen'));
        const now = Date.now();
        if (!this._lastReconnectAttempt || (now - this._lastReconnectAttempt > 60000)) {
          this._lastReconnectAttempt = now;
          await this.tryReconnect();
        }
        return 'stop';
      }

      if (this._saveRetryCount <= 2) {
        console.error('Merge-save error:', e);
      }
      document.getElementById('dbStatusIndicator').innerHTML = '<span class="dot dot-red"></span>Fehler';
      return 'stop';
    } finally {
      // Lock-Ownership endet mit diesem Versuch; der nächste acquiriert neu
      await this._releaseLock();
    }
  },

  /**
   * Import other prüfer's changes from diskDb into our in-memory DB
   * Uses timestamp + geaendert_von for intelligent conflict resolution
   */
  _conflicts: [], // [{schueler_id, schueler_name, local_pruefer, disk_pruefer, field, resolved}]

  /**
   * Apply schema migrations to diskDb so dirty-op replay doesn't fail
   * on missing columns/tables. Mirrors the ALTERs from migrateDB().
   */
  _migrateDiskDb(diskDb) {
    const run = (sql) => { try { diskDb.run(sql); } catch(e) { if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) console.warn('DiskDB-Migration:', e.message, sql.substring(0,60)); } };
    // Tables
    run(`CREATE TABLE IF NOT EXISTS aktive_sitzung (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER, schueler_id INTEGER,
      pruefer TEXT DEFAULT '', seit TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(kontrolltermin_id, pruefer)
    )`);
    run(`CREATE TABLE IF NOT EXISTS betriebe (
      id INTEGER PRIMARY KEY AUTOINCREMENT, betriebsnummer TEXT DEFAULT '',
      name TEXT NOT NULL, firma TEXT DEFAULT '', ansprechpartner TEXT DEFAULT '',
      strasse TEXT DEFAULT '', plz TEXT DEFAULT '', ort TEXT DEFAULT '',
      telefon TEXT DEFAULT '', fax TEXT DEFAULT '', email TEXT DEFAULT '',
      UNIQUE(betriebsnummer)
    )`);
    // kontrollergebnisse columns
    run("ALTER TABLE kontrollergebnisse ADD COLUMN geprueft_kws TEXT DEFAULT '{}'");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN durchsicht_nr INTEGER DEFAULT 1");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN bescheinigungen_anzahl INTEGER DEFAULT 0");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN anwesend INTEGER DEFAULT 1");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN geaendert_von TEXT DEFAULT ''");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN zulassung_ap INTEGER DEFAULT 0");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN pruefungsausschuss INTEGER DEFAULT 0");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN zulassung_manuell INTEGER DEFAULT 0");
    run("ALTER TABLE kontrollergebnisse ADD COLUMN fehltage_pauschal INTEGER DEFAULT 0");
    // schueler columns
    run("ALTER TABLE schueler ADD COLUMN betrieb_id INTEGER DEFAULT NULL");
    run("ALTER TABLE schueler ADD COLUMN status TEXT DEFAULT 'aktiv'");
    run("ALTER TABLE schueler ADD COLUMN ap_zugelassen INTEGER DEFAULT 0");
    run("ALTER TABLE schueler ADD COLUMN ap_bestanden INTEGER DEFAULT 0");
    run("ALTER TABLE schueler ADD COLUMN inaktiv_grund TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN inaktiv_datum TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN zustaendiges_amt TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN telefon TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN email TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN geschlecht TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN schulabschluss TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN pruefungserfolg TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN pruefungserfolg_wdh1 TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN pruefungserfolg_wdh2 TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN bav_status TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN zwischenpruefung TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN landesfachklasse TEXT DEFAULT ''");
    // berufsschulen columns
    run("ALTER TABLE berufsschulen ADD COLUMN email_cc TEXT DEFAULT ''");
    run("ALTER TABLE berufsschulen ADD COLUMN ansprechpartner_json TEXT DEFAULT '[]'");
    // betriebe columns
    run("ALTER TABLE betriebe ADD COLUMN vorname TEXT DEFAULT ''");
    run("ALTER TABLE betriebe ADD COLUMN zusatzbezeichnung TEXT DEFAULT ''");
    // kontrolltermine columns
    run("ALTER TABLE kontrolltermine ADD COLUMN typ TEXT DEFAULT 'schulkontrolle'");
    run("ALTER TABLE kontrolltermine ADD COLUMN berufsschule_id INTEGER DEFAULT NULL");
    // kw_status: Tabelle kann auf sehr alten Disk-DBs komplett fehlen –
    // ohne CREATE schlagen alle kw_status-Replays still fehl (Parität zu migrateDB!)
    run(`CREATE TABLE IF NOT EXISTS kw_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER NOT NULL REFERENCES schueler(id),
      ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
      kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
      maengel_codes TEXT DEFAULT '', behobene_codes TEXT DEFAULT '', fehltage INTEGER DEFAULT 0,
      geprueft INTEGER DEFAULT 0, bemerkung TEXT DEFAULT '',
      erstellt_bei INTEGER DEFAULT NULL, behoben_bei INTEGER DEFAULT NULL,
      UNIQUE(schueler_id, ausbildungsjahr, kalenderwoche))`);
    // kw_status columns
    run("ALTER TABLE kw_status ADD COLUMN bemerkung TEXT DEFAULT ''");
    // Schueler-Bemerkungen + Dateien
    run(`CREATE TABLE IF NOT EXISTS schueler_bemerkungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER REFERENCES schueler(id),
      text TEXT DEFAULT '',
      erstellt_von TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    )`);
    run(`CREATE TABLE IF NOT EXISTS schueler_dateien (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER REFERENCES schueler(id),
      dateiname TEXT NOT NULL,
      original_name TEXT NOT NULL,
      beschreibung TEXT DEFAULT '',
      dateityp TEXT DEFAULT '',
      groesse INTEGER DEFAULT 0,
      erstellt_von TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    )`);
    // Ausbilder table
    run(`CREATE TABLE IF NOT EXISTS ausbilder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      betrieb_id INTEGER REFERENCES betriebe(id),
      nachname TEXT DEFAULT '',
      vorname TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      mobil TEXT DEFAULT '',
      funktion TEXT DEFAULT ''
    )`);
    // Junction tables for multi-class termine + einsendungen
    run(`CREATE TABLE IF NOT EXISTS kontrolltermin_klassen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER REFERENCES kontrolltermine(id) ON DELETE CASCADE,
      klasse_id INTEGER REFERENCES klassen(id),
      UNIQUE(kontrolltermin_id, klasse_id)
    )`);
    run(`CREATE TABLE IF NOT EXISTS kontrolltermin_schueler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrolltermin_id INTEGER REFERENCES kontrolltermine(id) ON DELETE CASCADE,
      schueler_id INTEGER REFERENCES schueler(id),
      UNIQUE(kontrolltermin_id, schueler_id)
    )`);
    // Durchsichtsbögen-Archiv (Definition identisch zu SCHEMA halten!)
    run(`CREATE TABLE IF NOT EXISTS durchsicht_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrollergebnis_id INTEGER REFERENCES kontrollergebnisse(id),
      schueler_id INTEGER REFERENCES schueler(id),
      snapshot_datum TEXT NOT NULL,
      kw_daten_json TEXT DEFAULT '{}',
      geprueft_kws_json TEXT DEFAULT '{}',
      pflichtteile_json TEXT DEFAULT '{}',
      ergebnis TEXT DEFAULT '',
      bemerkung TEXT DEFAULT '',
      pruefer TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime'))
    )`);
    // Fehlende Spalten auf Bestands-DBs nachrüsten (ältere _migrateDiskDb-Version hatte andere Definition)
    run("ALTER TABLE durchsicht_snapshots ADD COLUMN kontrollergebnis_id INTEGER");
    run("ALTER TABLE durchsicht_snapshots ADD COLUMN erstellt_am TEXT DEFAULT ''");
    // Blockplan table (Definition identisch zu SCHEMA)
    run(`CREATE TABLE IF NOT EXISTS blockplan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      berufsschule_id INTEGER REFERENCES berufsschulen(id),
      schuljahr TEXT DEFAULT '2025/2026',
      lehrjahr INTEGER DEFAULT 1,
      kalenderwoche INTEGER NOT NULL,
      UNIQUE(berufsschule_id, schuljahr, lehrjahr, kalenderwoche)
    )`);
    // Prüfer-Eindeutigkeit wie in der Arbeitskopie: Tabelle sicherstellen,
    // deduplizieren, dann Unique-Index – sonst verhält sich die Disk-DB bei
    // INSERTs anders als die In-Memory-DB (ON CONFLICT(name) braucht den Index)
    run(`CREATE TABLE IF NOT EXISTS pruefer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      email TEXT DEFAULT '',
      aktiv INTEGER DEFAULT 1
    )`);
    try { diskDb.run(`DELETE FROM pruefer WHERE id NOT IN (SELECT MIN(id) FROM pruefer GROUP BY name)`); } catch(e) {}
    run('CREATE UNIQUE INDEX IF NOT EXISTS idx_pruefer_name ON pruefer(name)');
    // Ausbildungsphasen + erweiterte Schüler-Felder
    run(`CREATE TABLE IF NOT EXISTS ausbildungsphasen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schueler_id INTEGER NOT NULL REFERENCES schueler(id),
      von TEXT NOT NULL, bis TEXT,
      typ TEXT NOT NULL CHECK (typ IN ('ausbildung','unterbrechung')),
      betrieb TEXT, teilzeit_prozent INTEGER DEFAULT 100,
      grund TEXT, pauschal_fehltage_e INTEGER DEFAULT 0,
      pauschal_fehltage_u INTEGER DEFAULT 0, anmerkung TEXT
    )`);
    run("ALTER TABLE schueler ADD COLUMN regulaer_dauer_monate INTEGER DEFAULT 36");
    run("ALTER TABLE schueler ADD COLUMN verkuerzung_monate INTEGER DEFAULT 0");
    run("ALTER TABLE schueler ADD COLUMN vorzeitige_zulassung INTEGER DEFAULT 0");
    run("ALTER TABLE schueler ADD COLUMN vollzeit_wochenstunden REAL DEFAULT 39");
    run("ALTER TABLE schueler ADD COLUMN beruf_id TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN geburtsdatum TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN zp_termin TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN ap_termin TEXT DEFAULT ''");
    run("ALTER TABLE schueler ADD COLUMN brutto_lohn REAL DEFAULT 0");
    run(`CREATE TABLE IF NOT EXISTS aenderungslog (
      id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER, schueler_name TEXT DEFAULT '',
      feld TEXT NOT NULL, alter_wert TEXT DEFAULT '', neuer_wert TEXT DEFAULT '',
      aktion TEXT DEFAULT 'geaendert', bearbeiter TEXT DEFAULT '',
      zeitpunkt TEXT DEFAULT (datetime('now','localtime')),
      ibykus_relevant INTEGER DEFAULT 1, exportiert INTEGER DEFAULT 0
    )`);
    // kw_maengel table (legacy, aber Replay-Ziel)
    run(`CREATE TABLE IF NOT EXISTS kw_maengel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kontrollergebnis_id INTEGER REFERENCES kontrollergebnisse(id),
      ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
      kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
      maengel_codes TEXT DEFAULT '', fehltage INTEGER DEFAULT 0,
      UNIQUE(kontrollergebnis_id, ausbildungsjahr, kalenderwoche)
    )`);
    run(`CREATE TABLE IF NOT EXISTS wiedervorlage_notizen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wiedervorlage_id INTEGER REFERENCES wiedervorlagen(id),
      notiz TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime')),
      erstellt_von TEXT DEFAULT ''
    )`);
    // Tombstones (Replay-Ziel für Lösch-Propagation)
    run(`CREATE TABLE IF NOT EXISTS bhk_tombstones (
      tabelle TEXT NOT NULL, key TEXT NOT NULL,
      geloescht_am TEXT DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (tabelle, key))`);
    // Papierkorb: gelöschte Azubis/Termine samt abhängiger Zeilen (90 Tage)
    run(`CREATE TABLE IF NOT EXISTS bhk_papierkorb (
      id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT NOT NULL, ref_id INTEGER,
      label TEXT DEFAULT '', daten TEXT NOT NULL, geloescht_von TEXT DEFAULT '',
      geloescht_am TEXT DEFAULT (datetime('now','localtime')))`);
    run("DELETE FROM bhk_papierkorb WHERE geloescht_am < datetime('now','localtime','-90 days')");
    run(`CREATE TABLE IF NOT EXISTS import_historie (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zeitpunkt TEXT DEFAULT (datetime('now','localtime')),
      typ TEXT DEFAULT 'azubis',
      datei TEXT DEFAULT '',
      bearbeiter TEXT DEFAULT '',
      zeilen INTEGER DEFAULT 0,
      neu INTEGER DEFAULT 0,
      aktualisiert INTEGER DEFAULT 0,
      uebersprungen INTEGER DEFAULT 0,
      fehler INTEGER DEFAULT 0,
      datums_fehler INTEGER DEFAULT 0,
      datumsformat TEXT DEFAULT '',
      details_json TEXT DEFAULT '[]'
    )`);
    // Idempotenz-Ledger: verhindert Doppel-Anwendung von Ops nach Crash/Retry
    run(`CREATE TABLE IF NOT EXISTS bhk_applied_ops (op_uid TEXT PRIMARY KEY, ts TEXT DEFAULT '')`);
    // UNIQUE-Index gegen doppelte Kontrollergebnisse bei gleichzeitiger Auto-Erstellung
    try {
      diskDb.run("DELETE FROM kontrollergebnisse WHERE id NOT IN (SELECT MIN(id) FROM kontrollergebnisse GROUP BY kontrolltermin_id, schueler_id)");
      diskDb.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_termin_schueler ON kontrollergebnisse(kontrolltermin_id, schueler_id)");
    } catch(e) {}
    // ── CHECK-Constraint-Rebuilds (spiegeln migrateDB) ──
    // Ohne diese schlagen Replays auf alten Disk-DBs still fehl (AJ 4, neue Berufe, F/H-Jahrgänge)
    const rebuild = (name, checkSig, createSql, copySql) => {
      try {
        const res = diskDb.exec(`SELECT sql FROM sqlite_master WHERE name='${name}'`);
        const chk = res.length && res[0].values.length ? (res[0].values[0][0] || '') : '';
        if (chk.includes(checkSig)) {
          diskDb.run(`CREATE TABLE ${name}_new AS SELECT * FROM ${name}`);
          diskDb.run(`DROP TABLE ${name}`);
          diskDb.run(createSql);
          diskDb.run(copySql);
          diskDb.run(`DROP TABLE ${name}_new`);
        }
      } catch(e) { console.warn(`DiskDB rebuild ${name}:`, e.message); }
    };
    rebuild('kw_status', 'IN (1,2,3)',
      `CREATE TABLE kw_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER NOT NULL REFERENCES schueler(id),
        ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
        kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
        maengel_codes TEXT DEFAULT '', behobene_codes TEXT DEFAULT '', fehltage INTEGER DEFAULT 0,
        geprueft INTEGER DEFAULT 0, bemerkung TEXT DEFAULT '',
        erstellt_bei INTEGER DEFAULT NULL, behoben_bei INTEGER DEFAULT NULL,
        UNIQUE(schueler_id, ausbildungsjahr, kalenderwoche))`,
      `INSERT OR IGNORE INTO kw_status (id,schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,behobene_codes,fehltage,geprueft,bemerkung,erstellt_bei,behoben_bei) SELECT id,schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,COALESCE(behobene_codes,''),fehltage,geprueft,COALESCE(bemerkung,''),erstellt_bei,behoben_bei FROM kw_status_new`);
    rebuild('kw_maengel', 'IN (1,2,3)',
      `CREATE TABLE kw_maengel (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kontrollergebnis_id INTEGER NOT NULL REFERENCES kontrollergebnisse(id),
        ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
        kalenderwoche INTEGER, maengel_codes TEXT DEFAULT '', fehltage INTEGER DEFAULT 0,
        UNIQUE(kontrollergebnis_id, ausbildungsjahr, kalenderwoche))`,
      `INSERT OR IGNORE INTO kw_maengel SELECT * FROM kw_maengel_new`);
    rebuild('fachrichtungen', "IN ('Gärtner','Fachwerker')",
      `CREATE TABLE fachrichtungen (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL DEFAULT '', bezeichnung TEXT NOT NULL, typ TEXT DEFAULT 'Gärtner', UNIQUE(code))`,
      `INSERT OR IGNORE INTO fachrichtungen SELECT * FROM fachrichtungen_new`);
    rebuild('abschlussjahrgaenge', "IN ('Sommer','Winter')",
      `CREATE TABLE abschlussjahrgaenge (
        id INTEGER PRIMARY KEY AUTOINCREMENT, bezeichnung TEXT NOT NULL UNIQUE,
        typ TEXT NOT NULL DEFAULT '', jahr INTEGER, pruefungstermin TEXT DEFAULT '', aktiv INTEGER DEFAULT 1)`,
      `INSERT OR IGNORE INTO abschlussjahrgaenge SELECT * FROM abschlussjahrgaenge_new`);
  },

  /**
   * KE-Id-Reconciliation: gleiche Kontrollergebnis-Zeile (kontrolltermin_id +
   * schueler_id), aber unterschiedliche id lokal vs. Disk (Auto-Anlage-Race,
   * INSERT OR IGNORE hat auf der Disk verloren). Die Disk-id ist autoritativ:
   * lokale Zeile + alle FK-Verweise + pendente Op-Parameter übernehmen sie.
   */
  _reconcileKeIds(diskDb) {
    try {
      const disk = [];
      const stmt = diskDb.prepare('SELECT id, kontrolltermin_id, schueler_id FROM kontrollergebnisse');
      while (stmt.step()) disk.push(stmt.getAsObject());
      stmt.free();
      if (!disk.length) return;
      const diskByKey = new Map(disk.map(r => [r.kontrolltermin_id + '_' + r.schueler_id, r.id]));
      const local = this.query('SELECT id, kontrolltermin_id, schueler_id FROM kontrollergebnisse');
      local.forEach(l => {
        const dId = diskByKey.get(l.kontrolltermin_id + '_' + l.schueler_id);
        if (dId == null || dId === l.id) return;
        // FK-Verweise umziehen, dann die Zeile selbst
        ['kw_maengel', 'wiedervorlagen', 'durchsicht_snapshots'].forEach(t => {
          try { this._runSilent(`UPDATE ${t} SET kontrollergebnis_id=? WHERE kontrollergebnis_id=?`, [dId, l.id]); } catch(e) {}
        });
        // Auch die KE-Verweise in kw_status (erstellt_bei / behoben_bei)
        try { this._runSilent('UPDATE kw_status SET erstellt_bei=? WHERE erstellt_bei=?', [dId, l.id]); } catch(e) {}
        try { this._runSilent('UPDATE kw_status SET behoben_bei=? WHERE behoben_bei=?', [dId, l.id]); } catch(e) {}
        try {
          this._runSilent('UPDATE kontrollergebnisse SET id=? WHERE id=?', [dId, l.id]);
        } catch(e) {
          // Ziel-id existiert lokal bereits (Duplikat aus früherem Import) → Duplikat entfernen
          try { this._runSilent('DELETE FROM kontrollergebnisse WHERE id=?', [l.id]); } catch(e2) {}
        }
        // Pendente Ops: kontrollergebnis_id-Parameter positionsgenau umschreiben
        this._dirtyOps.forEach(op => {
          if (!/kontrollergebnis_id/i.test(op.sql)) return;
          const pi = this._paramIndexForColumn(op.sql, 'kontrollergebnis_id');
          if (pi >= 0 && pi < op.params.length && op.params[pi] === l.id) op.params[pi] = dId;
        });
        console.log(`[Sync] KE-Id reconciled: lokal ${l.id} → Disk ${dId} (Termin ${l.kontrolltermin_id}, Schüler ${l.schueler_id})`);
      });
    } catch(e) { console.warn('KE-Reconcile:', e.message); }
  },

  _importFromDisk(diskDb) {
    const myPruefer = (KontrolleHandler?.activePruefer || '').toLowerCase();
    // Build set of schueler_ids with pending dirty ops (don't overwrite these!)
    const dirtySchuelerIds = new Set();
    // kw_status-Zeilen mit pendenten lokalen Ops (Natural Key s_aj_kw) –
    // deren Felder dürfen beim Import nicht überschrieben werden.
    const dirtyKwKeys = new Set();
    const dirtyKwIds = new Set();
    const dirtyKeIds = new Set();
    this._dirtyOps.forEach(op => {
      const m = op.sql.match(/schueler_id[=,]\s*\?/i);
      if (m && op.params) {
        // Find the param index that corresponds to schueler_id
        const sqlBefore = op.sql.substring(0, op.sql.indexOf(m[0]));
        const paramIdx = (sqlBefore.match(/\?/g) || []).length;
        if (op.params[paramIdx]) dirtySchuelerIds.add(op.params[paramIdx]);
      }
      // Häufigste Op-Form ist "UPDATE <tabelle> ... WHERE id=?" – die id ist der
      // letzte Parameter. Der schueler_id-Regex oben greift dort nicht.
      if (/^\s*UPDATE\s+kontrollergebnisse\b/i.test(op.sql) && /WHERE\s+id\s*=\s*\?\s*$/i.test(op.sql)) {
        const id = op.params[op.params.length - 1];
        if (id != null) dirtyKeIds.add(id);
      }
      if (/kw_status/i.test(op.sql)) {
        if (/WHERE\s+id\s*=\s*\?\s*$/i.test(op.sql)) {
          const id = op.params[op.params.length - 1];
          if (id != null) dirtyKwIds.add(id);
        }
        const mCols = op.sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+kw_status\s*\(([^)]*)\)/i);
        if (mCols) {
          const cols = mCols[1].split(',').map(c => c.trim().toLowerCase());
          const si = cols.indexOf('schueler_id'), ai = cols.indexOf('ausbildungsjahr'), ki = cols.indexOf('kalenderwoche');
          if (si >= 0 && ai >= 0 && ki >= 0 && op.params.length > Math.max(si, ai, ki)) {
            dirtyKwKeys.add(op.params[si] + '_' + op.params[ai] + '_' + op.params[ki]);
          }
        }
      }
    });
    // ids → natürliche Schlüssel auflösen (lokale DB kennt die Zeilen)
    dirtyKwIds.forEach(id => {
      const r = this.query('SELECT schueler_id,ausbildungsjahr,kalenderwoche FROM kw_status WHERE id=?', [id])[0];
      if (r) dirtyKwKeys.add(r.schueler_id + '_' + r.ausbildungsjahr + '_' + r.kalenderwoche);
    });
    dirtyKeIds.forEach(id => {
      const sid = this.scalar('SELECT schueler_id FROM kontrollergebnisse WHERE id=?', [id]);
      if (sid != null) dirtySchuelerIds.add(sid);
    });

    try {
      // ── 0) KE-Ids angleichen + Tombstones anwenden ──
      this._reconcileKeIds(diskDb);
      // Löschungen anderer Clients übernehmen; eigene Tombstones blockieren Re-Import
      const tsSet = new Set();
      try {
        const localTs = new Set(this.query("SELECT tabelle||'|'||key AS k FROM bhk_tombstones").map(r => r.k));
        this._readTable(diskDb, 'bhk_tombstones').forEach(t => {
          const k = t.tabelle + '|' + t.key;
          if (!localTs.has(k)) {
            this._runSilent('INSERT OR REPLACE INTO bhk_tombstones (tabelle,key,geloescht_am) VALUES (?,?,?)',
              [t.tabelle, t.key, t.geloescht_am || '']);
            const keyCols = this.NATURAL_KEYS[t.tabelle] || ['id'];
            const vals = String(t.key).split('_');
            if (vals.length === keyCols.length) {
              try {
                this._runSilent(`DELETE FROM ${t.tabelle} WHERE ${keyCols.map(c => c + '=?').join(' AND ')}`, vals);
                this._importChangeCount++;
              } catch(e) {}
            }
          }
        });
        this.query("SELECT tabelle||'|'||key AS k FROM bhk_tombstones").forEach(r => tsSet.add(r.k));
      } catch(e) { /* bhk_tombstones evtl. noch nicht vorhanden */ }
      const tomb = (tabelle, ...vals) => tsSet.has(tabelle + '|' + vals.map(v => String(v)).join('_'));

      // ── 1) kontrollergebnisse: COLUMN-LEVEL merge ──
      const diskKE = [];
      const stmtKe = diskDb.prepare('SELECT * FROM kontrollergebnisse');
      while (stmtKe.step()) diskKE.push(stmtKe.getAsObject());
      stmtKe.free();

      const mergeColumns = ['ergebnis','p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen',
        'bescheinigungen_anzahl','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb',
        'fehltage_gesamt','fehltage_pauschal','anwesend','bemerkung','durchsicht_nr','geprueft_kws',
        'zulassung_ap','pruefungsausschuss','sachberichte_anzahl','geaendert_von','geaendert_am'];

      diskKE.forEach(dke => {
        const local = this.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?',
          [dke.kontrolltermin_id, dke.schueler_id]);

        if (!local.length) {
          if (tomb('kontrollergebnisse', dke.kontrolltermin_id, dke.schueler_id)) return;
          // Row exists on disk but not locally → import fully
          this._runSilent('INSERT OR IGNORE INTO kontrollergebnisse (kontrolltermin_id,schueler_id,ergebnis,p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb,fehltage_gesamt,anwesend,bemerkung,durchsicht_nr,geprueft_kws,zulassung_ap,pruefungsausschuss,sachberichte_anzahl,erstellt_am,geaendert_am,geaendert_von) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [dke.kontrolltermin_id,dke.schueler_id,dke.ergebnis,dke.p_1_1_ausbildungsplan,dke.p_1_4_auszubildende,dke.p_1_5_bescheinigungen,dke.bescheinigungen_anzahl,dke.f_1_2_vertragliche_regelungen,dke.f_1_6_ausbildungsbetrieb,dke.fehltage_gesamt,dke.anwesend,dke.bemerkung,dke.durchsicht_nr,dke.geprueft_kws,dke.zulassung_ap??0,dke.pruefungsausschuss??0,dke.sachberichte_anzahl??0,dke.erstellt_am||'',dke.geaendert_am||'',dke.geaendert_von||'']);
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
        const kwKey = dkw.schueler_id + '_' + dkw.ausbildungsjahr + '_' + dkw.kalenderwoche;
        const localDirty = dirtyKwKeys.has(kwKey);
        const local = this.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?',
          [dkw.schueler_id, dkw.ausbildungsjahr, dkw.kalenderwoche]);
        if (!local.length) {
          if (tomb('kw_status', dkw.schueler_id, dkw.ausbildungsjahr, dkw.kalenderwoche)) return;
          // New KW data from disk → import (inkl. bemerkung – fehlte früher)
          this._runSilent('INSERT OR IGNORE INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,behobene_codes,fehltage,geprueft,bemerkung,erstellt_bei,behoben_bei) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [dkw.schueler_id,dkw.ausbildungsjahr,dkw.kalenderwoche,dkw.maengel_codes,dkw.behobene_codes,dkw.fehltage,dkw.geprueft,dkw.bemerkung||'',dkw.erstellt_bei,dkw.behoben_bei]);
          this._importChangeCount++;
        } else {
          const lkw = local[0];
          // If disk has more behobene_codes, merge them (Union, immer sicher)
          if (dkw.behobene_codes && dkw.behobene_codes !== lkw.behobene_codes) {
            const localBehoben = (lkw.behobene_codes || '').split(',').filter(Boolean);
            const diskBehoben = (dkw.behobene_codes || '').split(',').filter(Boolean);
            const merged = [...new Set([...localBehoben, ...diskBehoben])].join(',');
            if (merged !== lkw.behobene_codes) {
              this._runSilent('UPDATE kw_status SET behobene_codes=? WHERE id=?', [merged, lkw.id]);
            }
          }
          if (localDirty) return; // ungespeicherte lokale Eingaben nie überschreiben
          // Zeile lokal NICHT dirty → geänderte Felder des anderen Prüfers übernehmen
          // (früher wurden maengel_codes/fehltage/geprueft/bemerkung NIE importiert →
          // Lost Update beim nächsten eigenen Schreiben auf dieselbe Zeile)
          const fieldUpdates = [];
          const fieldValues = [];
          ['maengel_codes','fehltage','geprueft','bemerkung','erstellt_bei','behoben_bei'].forEach(col => {
            const dv = dkw[col] ?? (col === 'fehltage' || col === 'geprueft' ? 0 : '');
            const lv = lkw[col] ?? (col === 'fehltage' || col === 'geprueft' ? 0 : '');
            if (String(dv) !== String(lv)) { fieldUpdates.push(col + '=?'); fieldValues.push(dkw[col] ?? null); }
          });
          if (fieldUpdates.length) {
            fieldValues.push(lkw.id);
            this._runSilent('UPDATE kw_status SET ' + fieldUpdates.join(',') + ' WHERE id=?', fieldValues);
            this._importChangeCount++;
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
            if (tomb('kw_maengel', dkm.kontrollergebnis_id, dkm.ausbildungsjahr, dkm.kalenderwoche)) return;
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
      try {
      const diskKT = this._readTable(diskDb, 'kontrolltermine');
      const localKTIds = new Set(this.query('SELECT id FROM kontrolltermine').map(r => r.id));
      diskKT.forEach(dkt => {
        if (!localKTIds.has(dkt.id)) {
          if (tomb('kontrolltermine', dkt.id)) return;
          this._runSilent('INSERT INTO kontrolltermine (id,betrieb_id,klasse_id,jahrgang_id,geplant_datum,durchgefuehrt_datum,pruefer,status,typ,bemerkung) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [dkt.id,dkt.betrieb_id??null,dkt.klasse_id??null,dkt.jahrgang_id??null,dkt.geplant_datum,dkt.durchgefuehrt_datum||'',dkt.pruefer||'',dkt.status||'geplant',dkt.typ||'schulkontrolle',dkt.bemerkung||'']);
          this._importChangeCount++;
        } else {
          // Update status + pruefer if disk is newer
          const lkt = this.query('SELECT * FROM kontrolltermine WHERE id=?', [dkt.id])[0];
          if (lkt && dkt.status !== lkt.status) {
            this._runSilent('UPDATE kontrolltermine SET status=?,pruefer=?,bemerkung=? WHERE id=?',
              [dkt.status, dkt.pruefer||lkt.pruefer, dkt.bemerkung||lkt.bemerkung, dkt.id]);
            this._importChangeCount++;
          }
        }
      });
      } catch(e) { console.warn('Sync kontrolltermine:', e.message); }

      // ── 5) kontrolltermin_klassen: additive sync ──
      try {
      const diskTKK = this._readTable(diskDb, 'kontrolltermin_klassen');
      const localTKK = new Set(this.query('SELECT kontrolltermin_id||"_"||klasse_id as k FROM kontrolltermin_klassen').map(r => r.k));
      diskTKK.forEach(d => {
        const key = d.kontrolltermin_id + '_' + d.klasse_id;
        if (!localTKK.has(key)) {
          if (tomb('kontrolltermin_klassen', d.kontrolltermin_id, d.klasse_id)) return;
          this._runSilent('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id,klasse_id) VALUES (?,?)',
            [d.kontrolltermin_id, d.klasse_id]);
          this._importChangeCount++;
        }
      });
      } catch(e) { console.warn('Sync kontrolltermin_klassen:', e.message); }

      // ── 6) kontrolltermin_schueler: additive sync ──
      try {
        const diskTKS = this._readTable(diskDb, 'kontrolltermin_schueler');
        const localTKS = new Set(this.query('SELECT kontrolltermin_id||"_"||schueler_id as k FROM kontrolltermin_schueler').map(r => r.k));
        diskTKS.forEach(d => {
          const key = d.kontrolltermin_id + '_' + d.schueler_id;
          if (!localTKS.has(key)) {
            if (tomb('kontrolltermin_schueler', d.kontrolltermin_id, d.schueler_id)) return;
            this._runSilent('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id,schueler_id) VALUES (?,?)',
              [d.kontrolltermin_id, d.schueler_id]);
            this._importChangeCount++;
          }
        });
      } catch(e) {} // table may not exist in older DBs

      // ── 7) wiedervorlagen: import new + update status ──
      try {
      const diskWV = this._readTable(diskDb, 'wiedervorlagen');
      const localWVIds = new Set(this.query('SELECT id FROM wiedervorlagen').map(r => r.id));
      diskWV.forEach(d => {
        if (!localWVIds.has(d.id)) {
          if (tomb('wiedervorlagen', d.id)) return;
          this._runSilent('INSERT INTO wiedervorlagen (id,kontrollergebnis_id,schueler_id,art,frist_datum,erinnerung_datum,status,erledigt_datum,erledigt_bemerkung,erstellt_am) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [d.id,d.kontrollergebnis_id,d.schueler_id,d.art||'',d.frist_datum,d.erinnerung_datum||'',d.status||'offen',d.erledigt_datum||'',d.erledigt_bemerkung||'',d.erstellt_am||'']);
          this._importChangeCount++;
        } else {
          const lw = this.query('SELECT status,frist_datum,erledigt_datum,erledigt_bemerkung FROM wiedervorlagen WHERE id=?', [d.id])[0];
          if (lw && (d.status !== lw.status || d.frist_datum !== lw.frist_datum
              || (d.erledigt_datum||'') !== (lw.erledigt_datum||'') || (d.erledigt_bemerkung||'') !== (lw.erledigt_bemerkung||''))) {
            this._runSilent('UPDATE wiedervorlagen SET status=?,frist_datum=?,erledigt_datum=?,erledigt_bemerkung=? WHERE id=?',
              [d.status, d.frist_datum, d.erledigt_datum||'', d.erledigt_bemerkung||'', d.id]);
            this._importChangeCount++;
          }
        }
      });
      } catch(e) { console.warn('Sync wiedervorlagen:', e.message); }

      // ── 8) wiedervorlage_notizen: additive ──
      try {
      const diskWN = this._readTable(diskDb, 'wiedervorlage_notizen');
      const localWNIds = new Set(this.query('SELECT id FROM wiedervorlage_notizen').map(r => r.id));
      diskWN.forEach(d => {
        if (!localWNIds.has(d.id)) {
          if (tomb('wiedervorlage_notizen', d.id)) return;
          this._runSilent('INSERT INTO wiedervorlage_notizen (id,wiedervorlage_id,notiz,erstellt_am,erstellt_von) VALUES (?,?,?,?,?)',
            [d.id,d.wiedervorlage_id,d.notiz||'',d.erstellt_am||'',d.erstellt_von||'']);
          this._importChangeCount++;
        }
      });
      } catch(e) { console.warn('Sync wv_notizen:', e.message); }

      // ── 9) durchsicht_snapshots: additive ──
      try {
      const diskDS = this._readTable(diskDb, 'durchsicht_snapshots');
      const localDSIds = new Set(this.query('SELECT id FROM durchsicht_snapshots').map(r => r.id));
      diskDS.forEach(d => {
        if (!localDSIds.has(d.id)) {
          if (tomb('durchsicht_snapshots', d.id)) return;
          this._runSilent('INSERT INTO durchsicht_snapshots (id,kontrollergebnis_id,schueler_id,snapshot_datum,kw_daten_json,geprueft_kws_json,pflichtteile_json,ergebnis,bemerkung,pruefer,erstellt_am) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [d.id,d.kontrollergebnis_id??null,d.schueler_id,d.snapshot_datum||'',d.kw_daten_json||'{}',d.geprueft_kws_json||'{}',d.pflichtteile_json||'{}',d.ergebnis||'',d.bemerkung||'',d.pruefer||'',d.erstellt_am||'']);
          this._importChangeCount++;
        }
      });
      } catch(e) { console.warn('Sync snapshots:', e.message); }

      // ── 10) schueler: import new students ──
      try {
      const diskS = this._readTable(diskDb, 'schueler');
      const localSIds = new Set(this.query('SELECT id FROM schueler').map(r => r.id));
      // Spaltenliste dynamisch (Schnittmenge Disk-Zeile / lokales Schema):
      // eine feste 16-Spalten-Liste hat ~20 Felder (Beruf, Dauer, ZP/AP-Termine,
      // Bruttolohn, Status …) verworfen – Folge-Saves löschten sie dauerhaft.
      const schuelerCols = this.query('PRAGMA table_info(schueler)').map(c => c.name);
      diskS.forEach(d => {
        if (!localSIds.has(d.id)) {
          if (tomb('schueler', d.id)) return;
          const cols = schuelerCols.filter(c => c in d);
          this._runSilent(`INSERT OR IGNORE INTO schueler (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            cols.map(c => d[c] ?? null));
          this._importChangeCount++;
        }
      });
      } catch(e) { console.warn('Sync schueler:', e.message); }

      // ── 11) Show conflicts if any ──
      if (this._conflicts.length > 0) {
        this._showConflicts();
      }

    } catch(e) {
      console.warn('Import-from-disk error:', e);
      this.toast('Sync-Fehler beim Laden. Daten ggf. nicht aktuell.', 'warning');
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
      this.toast(`⚠︎ Sync-Konflikt: <strong>${c.disk_pruefer}</strong> hat ${c.schueler_name} ebenfalls bearbeitet. Neuerer Stand übernommen.`, 'warning');
    } else {
      this.toast(`⚠︎ ${entries.length} Sync-Konflikte erkannt. Neuerer Stand wurde jeweils übernommen.`, 'warning');
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
    // Students from linked classes – nur AKTIVE (konsistent mit der Zählung im
    // Termin-Dialog und dem Aufräumen in saveTermin; bereits kontrollierte,
    // inzwischen inaktive Azubis kommen über den KE-Zweig unten wieder herein)
    let schueler = [];
    if (klassenIds.length) {
      const placeholders = klassenIds.map(() => '?').join(',');
      schueler = this.query(`SELECT * FROM schueler WHERE klasse_id IN (${placeholders}) AND aktiv=1`, klassenIds);
    }
    // Students directly linked (Einsendungen / manuell hinzugefügt)
    const direkt = this.query(`SELECT s.* FROM schueler s JOIN kontrolltermin_schueler kts ON kts.schueler_id=s.id WHERE kts.kontrolltermin_id=?`, [terminId]);
    // Schüler mit vorhandenem Kontrollergebnis IMMER einbeziehen: sie wurden
    // real kontrolliert (z.B. am Kontrolltag ad hoc hinzugefügte LFK-Gäste
    // oder inzwischen inaktive Azubis) – ohne diesen Zweig fehlten genau
    // ihre Bögen in sämtlichen Termin-Exporten.
    const mitKE = this.query(`SELECT DISTINCT s.* FROM schueler s JOIN kontrollergebnisse ke ON ke.schueler_id=s.id WHERE ke.kontrolltermin_id=?`, [terminId]);
    // Merge without duplicates
    const ids = new Set(schueler.map(s => s.id));
    direkt.forEach(s => { if (!ids.has(s.id)) { schueler.push(s); ids.add(s.id); } });
    mitKE.forEach(s => { if (!ids.has(s.id)) { schueler.push(s); ids.add(s.id); } });
    return schueler.sort((a,b) => (a.nachname||'').localeCompare(b.nachname||''));
  },

  // Einheitlicher Dateiname: Umlaute transliteriert, Sonderzeichen → _,
  // Teile mit _ verbunden (z.B. safeFilename(['Uebergabe','Amt 94','BS Freiburg','2026-09-15'],'xlsx'))
  safeFilename(teile, ext) {
    const tr = (s) => String(s ?? '').replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue').replace(/ß/g,'ss')
      .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    const name = (Array.isArray(teile) ? teile : [teile]).map(tr).filter(Boolean).join('_');
    return ext ? `${name}.${ext.replace(/^\./, '')}` : name;
  },

  // Eigenes Amt (RP Freiburg): Azubis mit anderem zustaendiges_amt werden an
  // unseren Schulen MIT kontrolliert; ihre Ergebnisse gehen danach an den
  // zuständigen Ausbildungsberater des anderen Bezirks.
  EIGENES_AMT: '93',

  // Schule, AN DER der Termin stattfindet: explizites Feld (berufsschule_id,
  // z.B. LFK-Standort) mit Fallback auf die Stammschule der ersten Klasse.
  getTerminSchule(terminId) {
    const t = this.query('SELECT berufsschule_id FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (t && t.berufsschule_id) {
      const bs = this.query('SELECT * FROM berufsschulen WHERE id=?', [t.berufsschule_id])[0];
      if (bs) return bs;
    }
    const klassen = this.getTerminKlassen(terminId);
    if (klassen.length) return this.query('SELECT * FROM berufsschulen WHERE id=?', [klassen[0].berufsschule_id])[0] || null;
    return null;
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
    const ortBs = this.getTerminSchule(t.id);
    const schule = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : '');
    const frAj = this.formatTerminFrAj(t.id);
    const count = this.getTerminSchuelerCount(t.id);
    const isEins = t.typ === 'einsendung';
    const kw = 'KW' + this._isoKW(new Date(t.geplant_datum + 'T00:00:00'));
    const datum = (t.geplant_datum || '').replace(/(\d{4})-(\d{2})-(\d{2})/, '$3.$2.$1');
    const parts = [`${kw} ${datum}`];
    if (isEins) {
      parts.push('✉︎ Einsendung');
    } else if (schule) {
      parts.push(schule);
    }
    if (frAj && frAj !== '–') parts.push(frAj);
    parts.push(`${count} Sch.`);
    if (t.pruefer) parts.push(t.pruefer);
    const label = parts.join(' – ') + ` (${t.status || 'geplant'})`;
    return t.bemerkung ? `${label} — ${t.bemerkung}` : label;
  },

  generateTerminTitel(terminId) {
    const t = this.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!t) return '';
    const klassen = this.getTerminKlassen(terminId);
    const isEins = t.typ === 'einsendung';
    const frAj = this.formatTerminFrAj(terminId);
    if (isEins) {
      const schueler = this.query(`SELECT s.nachname, s.vorname FROM kontrolltermin_schueler kts JOIN schueler s ON kts.schueler_id=s.id WHERE kts.kontrolltermin_id=?`, [terminId]);
      if (schueler.length <= 3) return 'Einsendung ' + schueler.map(s => `${s.nachname}`).join(', ');
      return `Einsendung ${schueler.length} Azubis` + (frAj && frAj !== '–' ? ` ${frAj}` : '');
    }
    const schule = klassen.length ? klassen[0].schule : '';
    const parts = [];
    if (frAj && frAj !== '–') parts.push(frAj);
    if (schule) parts.push(schule);
    return parts.join(' ') || 'Durchsicht';
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
  isVerkuerzer(beginn, ende, schuelerId) {
    if (schuelerId) {
      const s = this.query('SELECT verkuerzung_monate, regulaer_dauer_monate FROM schueler WHERE id=?', [schuelerId])[0];
      if (s && s.verkuerzung_monate > 0) return true;
    }
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
    // regulaer_dauer_monate/verkuerzung_monate MÜSSEN mitselektiert werden –
    // sie werden unten für das Phasen-Ende gebraucht (fehlten früher → immer
    // 36 Monate/0 Verkürzung, Verkürzer bekamen ein Raster zu viel).
    const s = this.query('SELECT ausbildungsbeginn, ausbildungsende, regulaer_dauer_monate, verkuerzung_monate FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s?.ausbildungsbeginn) return [1, 2, 3];
    const d1 = this._parseDate(s.ausbildungsbeginn);
    if (!d1) return [1, 2, 3];

    // Effektives Ende: Phasen → berechnetes Vertragsende, sonst DB-Feld
    let d2 = s.ausbildungsende ? this._parseDate(s.ausbildungsende) : null;
    if (typeof AzubiRechner !== 'undefined') {
      try {
        const phasen = AzubiRechner.getPhasen(schuelerId);
        if (phasen.length) {
          const phasenMit = AzubiRechner.phasenMitEnden(phasen, s.regulaer_dauer_monate || 36, s.verkuerzung_monate || 0);
          const berechnetesEnde = AzubiRechner.vertragsendeAusPhasen(phasenMit);
          if (berechnetesEnde) d2 = berechnetesEnde;
        }
      } catch(e) {}
    }
    if (!d2) return [1, 2, 3];

    // Anzahl der Ausbildungsjahre aus der VERTRAGSDAUER, nicht aus überspannten
    // Kalender-Schuljahren: Eine feste Schuljahresgrenze kann 1.8.- und
    // 1.9.-Verträge nicht gleichzeitig richtig zählen (Sep-Grenze → jeder
    // August-Beginner bekam ein Raster zu viel, Aug-Grenze → jeder
    // September-Beginner). Die Dauer ist von der Grenze unabhängig.
    const endeExkl = new Date(d2); endeExkl.setDate(endeExkl.getDate() + 1);
    let monate = (endeExkl.getFullYear() - d1.getFullYear()) * 12 + (endeExkl.getMonth() - d1.getMonth());
    if (endeExkl.getDate() < d1.getDate()) monate -= 1;
    const numSY = Math.max(1, Math.min(4, Math.ceil(monate / 12)));

    if (numSY <= 1) return [3];
    if (numSY === 2) return [2, 3];
    if (numSY === 3) return [1, 2, 3];
    return Array.from({length: numSY}, (_, i) => i + 1);
  },

  // ── Aktuelles Ausbildungsjahr berechnen (phasen-aware wenn verfügbar) ──
  getCurrentAJ(beginn, schuelerId) {
    if (!beginn) return null;
    if (schuelerId && typeof AzubiRechner !== 'undefined') {
      const phasen = AzubiRechner.getPhasen(schuelerId);
      if (phasen.length) {
        const s = this.query('SELECT regulaer_dauer_monate, verkuerzung_monate FROM schueler WHERE id=?', [schuelerId])[0];
        const R = AzubiRechner;
        const phasenMit = R.phasenMitEnden(phasen, s?.regulaer_dauer_monate || 36, s?.verkuerzung_monate || 0);
        const heute = new Date();
        const erbrachtVZ = phasenMit
          .filter(p => p.typ === 'ausbildung')
          .reduce((sum, p) => {
            const von = R.parseISO(p.von);
            const bis = p.bis ? R.parseISO(p.bis) : heute;
            const eff = bis < heute ? bis : heute;
            if (eff < von) return sum;
            return sum + R.diffMonths(von, eff) * ((p.teilzeit_prozent || 100) / 100);
          }, 0);
        // Obergrenze = tatsächliche Anzahl Ausbildungsjahre (Verlängerer haben 4)
        const maxAjP = Math.max(...(this.getSchuelerAJs(schuelerId) || [3]));
        return Math.min(maxAjP, Math.max(1, Math.floor((erbrachtVZ + (s?.verkuerzung_monate || 0)) / 12) + 1));
      }
    }
    const d = this._parseDate(beginn);
    if (!d) return null;
    const now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months < 0) return 1;
    const maxAj = schuelerId ? Math.max(...(this.getSchuelerAJs(schuelerId) || [3])) : 3;
    return Math.min(Math.floor(months / 12) + 1, maxAj);
  },

  // Ausbildungsjahr, in dem sich der Azubi an einem STICHTAG befindet (nicht
  // heute): Monate seit Ausbildungsbeginn / 12, gedeckelt auf die Zahl der
  // tatsächlichen Ausbildungsjahre (Verkürzer/Verlängerer).
  getAJAtDate(beginn, datum, schuelerId) {
    const d = this._parseDate(beginn);
    const ref = datum instanceof Date ? datum : this._parseDate(datum);
    if (!d || !ref) return null;
    const months = (ref.getFullYear() - d.getFullYear()) * 12 + (ref.getMonth() - d.getMonth());
    if (months < 0) return 1;
    const maxAj = schuelerId ? Math.max(...(this.getSchuelerAJs(schuelerId) || [3])) : 3;
    return Math.min(Math.floor(months / 12) + 1, maxAj);
  },

  // Zu welchem Ausbildungsjahr gehört eine Kalenderwoche, die bei einer
  // Durchsicht am Stichtag "bis KW x geprüft" gemeldet wird? Liegt die KW in
  // der Schuljahres-Reihenfolge (36…52, 1…35) NICHT hinter der KW des
  // Stichtags, ist es das Ausbildungsjahr des Stichtags – sonst das davor
  // (z.B. Nacherfassung im September für "geprüft bis KW 30").
  // Rückgabe: { aj, kw } oder null.
  ajKwFuerStichtag(schuelerId, datum, kw) {
    kw = parseInt(kw);
    if (!kw || kw < 1 || kw > 53) return null;
    if (kw === 53) kw = 52;
    const s = this.query('SELECT ausbildungsbeginn FROM schueler WHERE id=?', [schuelerId])[0];
    const ref = datum instanceof Date ? datum : this._parseDate(datum);
    if (!s || !ref) return null;
    const ajs = this.getSchuelerAJs(schuelerId) || [1, 2, 3];
    const order = [36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35];
    let aj = this.getAJAtDate(s.ausbildungsbeginn, ref, schuelerId) || ajs[0];
    const kwStichtag = this._isoKW(ref);
    if (order.indexOf(kw) > order.indexOf(kwStichtag)) aj = aj - 1;
    if (aj < ajs[0]) aj = ajs[0];
    if (aj > ajs[ajs.length - 1]) aj = ajs[ajs.length - 1];
    return { aj, kw };
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
    const fr = this.query('SELECT code, bezeichnung, typ FROM fachrichtungen WHERE id=?', [fachrichtungId])[0];
    if (!fr) return 2;
    if (fr.typ === 'Fachwerker' || (fr.bezeichnung||'').toLowerCase().includes('fachwerker') || (fr.bezeichnung||'').toLowerCase().includes('fachpraktiker')) return 1;
    if (fr.code === '036' || fr.code === '176' || (fr.bezeichnung||'').toLowerCase().includes('galabau')) return 6;
    return 2;
  },

  isFachwerker(fachrichtungId) {
    if (!fachrichtungId) return false;
    const fr = this.query('SELECT typ, bezeichnung FROM fachrichtungen WHERE id=?', [fachrichtungId])[0];
    if (!fr) return false;
    return fr.typ === 'Fachwerker' || (fr.bezeichnung||'').toLowerCase().includes('fachwerker') || (fr.bezeichnung||'').toLowerCase().includes('fachpraktiker');
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
  // Jeder Filter akzeptiert auch eine LISTE von Werten (Mehrfachauswahl).
  // Jahrgang + ZP zusammen wirken als VEREINIGUNG (siehe gf()).
  // Gibt Array von { schule, isLFK, schueler: [...], klasse_ids: Set } zurück.
  getStandortgruppen(opts) {
    if (!opts) opts = {};
    const liste = (v) => v == null || v === '' ? [] : (Array.isArray(v) ? v : [v]);
    const jgIds = this._safeIntList(liste(opts.jahrgangId));
    const frIds = this._safeIntList(liste(opts.fachrichtungId));
    const amts = this._safeStrList(liste(opts.amt));
    const zps = this._safeStrList(liste(opts.zwischenpruefung));
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
    const jgC = jgIds.length ? `s.jahrgang_id IN (${jgIds.join(',')})` : '';
    const zpC = zps.length ? `s.zwischenpruefung IN (${this._sqlInStr(zps)})` : '';
    if (jgC && zpC) sql += ` AND (${jgC} OR ${zpC})`;
    else if (jgC) sql += ` AND ${jgC}`;
    else if (zpC) sql += ` AND ${zpC}`;
    if (frIds.length) sql += ` AND s.fachrichtung_id IN (${frIds.join(',')})`;
    if (amts.length) sql += ` AND s.zustaendiges_amt IN (${this._sqlInStr(amts)})`;
    sql += ' ORDER BY s.nachname, s.vorname';

    let schuelerList = this.query(sql);
    // Lehrjahr-Filter, z.B. [2,3] für die Nov./Dez.-Kontrolle "alle 2.+3.
    // Lehrjahr an der Schule". Primär aus dem AKTUELLEN Ausbildungsjahr des
    // Azubis berechnet (Ausbildungsbeginn/Phasen – berücksichtigt Verkürzer),
    // Fallback ist das Lehrjahr-Feld der Stammklasse. Azubis, deren Lehrjahr
    // sich nicht bestimmen lässt, bleiben SICHTBAR statt still zu verschwinden.
    const ljs = this._safeIntList(liste(opts.lehrjahre));
    if (ljs.length) {
      schuelerList = schuelerList.filter(s => {
        let aj = null;
        try { aj = this.getCurrentAJ(s.ausbildungsbeginn, s.id); } catch(e) {}
        if (aj == null && s.lehrjahr) aj = s.lehrjahr;
        return aj == null ? true : ljs.includes(aj);
      });
    }
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
        // KWs 31-35 (Indizes 47-51) = August, also Schuljahresgrenze → ganzes
        // Raster aktiv. Ein Vertrag ab 1.8. hat sein erstes volles Rasterjahr
        // ab September; die Augustwochen davor liegen vor dem ersten Raster.
        if (startIdx > 0 && startIdx < 47) {
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

      // Unterbrechungs-Phasen als inaktive KWs markieren
      if (typeof AzubiRechner !== 'undefined') {
        const phasen = AzubiRechner.getPhasen(schuelerId);
        const unterbrechungen = phasen.filter(p => p.typ === 'unterbrechung' && p.von && p.bis);
        const sy = firstSY !== null ? firstSY + idx : null;
        const syStart = sy ? new Date(sy, 8, 1) : null; // Sep 1
        const syEnd = sy ? new Date(sy + 1, 7, 31) : null; // Aug 31
        unterbrechungen.forEach(u => {
          const uVon = AzubiRechner.parseISO(u.von);
          const uBis = AzubiRechner.parseISO(u.bis);
          if (!syStart || !syEnd) return;
          if (uBis < syStart || uVon > syEnd) return;
          const effVon = uVon < syStart ? syStart : uVon;
          const effBis = uBis > syEnd ? syEnd : uBis;
          let cur = new Date(effVon);
          while (cur <= effBis) {
            const kw = this._isoKW(cur);
            if (!inactive.includes(kw)) inactive.push(kw);
            cur.setDate(cur.getDate() + 7);
          }
        });
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

  // ── Änderungs-Logbuch (für IBYKUS-Nachtrag) ──
  IBYKUS_FELDER: ['nachname','vorname','ausbildungsbeginn','ausbildungsende','ausbildungsstaette','fachrichtung_id','klasse_id','jahrgang_id','betrieb_id','status','aktiv','ap_zugelassen','ap_bestanden','zwischenpruefung','zustaendiges_amt','landesfachklasse','inaktiv_datum','inaktiv_grund'],
  logChange(schuelerId, feld, alterWert, neuerWert, aktion) {
    if (String(alterWert) === String(neuerWert)) return;
    const s = this.query('SELECT nachname, vorname FROM schueler WHERE id=?', [schuelerId])[0];
    const name = s ? `${s.nachname}, ${s.vorname}` : `ID ${schuelerId}`;
    const bearbeiter = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || '';
    const ibykusRelevant = this.IBYKUS_FELDER.includes(feld) ? 1 : 0;
    this.run("INSERT INTO aenderungslog (schueler_id, schueler_name, feld, alter_wert, neuer_wert, aktion, bearbeiter, ibykus_relevant) VALUES (?,?,?,?,?,?,?,?)",
      [schuelerId, name, feld, String(alterWert ?? ''), String(neuerWert ?? ''), aktion || 'geaendert', bearbeiter, ibykusRelevant]);
  },

  // ── Ampel-System: Schüler-Status auf Basis der letzten Kontrolle ──
  // Returns {color:'green'|'yellow'|'red'|'gray', icon:'<span style="color:var(--clr-green)">●</span>'|'<span style="color:var(--clr-amber)">◐</span>'|'<span style="color:var(--clr-red)">◆</span>'|'<span style="color:var(--clr-sage-light)">○</span>', label:'...', prevErgebnis:'...', wvOffen:bool}
  getSchuelerAmpel(schuelerId) {
    const lastKE = this.query(`SELECT ke.ergebnis, ke.kontrolltermin_id, kt.geplant_datum
      FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`, [schuelerId]);
    const wvOffen = this.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [schuelerId]) > 0;
    const offeneMaengel = this.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != '' AND maengel_codes != 'H'", [schuelerId]) || 0;

    if (!lastKE.length) return { color: 'gray', icon: '<span style="color:var(--clr-sage-light)">○</span>', label: 'Noch nie kontrolliert', prevErgebnis: '', wvOffen, offeneMaengel };
    const e = lastKE[0].ergebnis;
    if (e === 'in_ordnung' && !wvOffen && offeneMaengel === 0) {
      return { color: 'green', icon: '<span style="color:var(--clr-green)">●</span>', label: 'Letzte Kontrolle OK', prevErgebnis: e, wvOffen, offeneMaengel };
    }
    if (e === 'nachholung_naechste_durchsicht' || e === 'sachberichte_wetter_email' || e === 'berichte_bis_termin_email') {
      return { color: 'yellow', icon: '<span style="color:var(--clr-amber)">◐</span>', label: 'Nachholung/E-Mail nötig', prevErgebnis: e, wvOffen, offeneMaengel };
    }
    if (e === 'persoenliche_vorlage_rp' || e === 'post_an_rp' || wvOffen) {
      return { color: 'red', icon: '<span style="color:var(--clr-red)">◆</span>', label: 'Eskalation / WV offen', prevErgebnis: e, wvOffen, offeneMaengel };
    }
    return { color: 'yellow', icon: '<span style="color:var(--clr-amber)">◐</span>', label: 'Mängel vorhanden', prevErgebnis: e, wvOffen, offeneMaengel };
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

  // ═══════════════════════════════════════════
  //  VORLAGEN für den Schriftverkehr (E-Mails, Briefe)
  //  Jede Vorlage hat Betreff + Text mit {Platzhaltern}. Die Standardtexte
  //  stehen hier; in den Einstellungen können sie überschrieben werden
  //  (einstellungen: vorlage_<typ>_betreff / vorlage_<typ>_body). Unbekannte
  //  Platzhalter bleiben sichtbar stehen statt "undefined" zu erzeugen.
  // ═══════════════════════════════════════════
  VORLAGEN: {
    schule_anfrage: { titel: 'Schule: Terminanfrage (vor der Kontrolle)',
      platzhalter: ['schule','schule_ort','datum','wochentag','gruppen','azubi_liste','anzahl','dauer','anzahl_pruefer','raumhinweis','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Terminanfrage Berichtsheftkontrolle – {gruppen_kurz} – {schule} – {datum}',
      body: `Sehr geehrte Damen und Herren,

im Rahmen der Überwachung der Berufsausbildung im Gartenbau möchte das Regierungspräsidium Freiburg die Berichtsheftführung der Auszubildenden kontrollieren.

Wir würden gerne am {wochentag}, den {datum}, an der {schule}{schule_ort} die Berichtsheftkontrolle durchführen.

Betroffene Fachrichtungen und Ausbildungsjahre:
{gruppen}

Betroffene Auszubildende ({anzahl}):
{azubi_liste}

Voraussichtliche Dauer: ca. {dauer} (ca. 10 Min. pro Berichtsheft, {anzahl_pruefer} Prüfer)
Prüfer: {pruefer}

Könnten Sie uns bitte mitteilen, ob dieser Termin für Sie möglich ist? Wir benötigen {raumhinweis}.

Die Auszubildenden werden gebeten, ihre vollständigen und unterschriebenen Berichtshefte einschließlich aller Ausbildungsnachweise am Kontrolltag bereitzuhalten. Die Berichtshefte sollen geordnet nach Kalenderwochen vorliegen.

Falls der vorgeschlagene Termin nicht möglich ist, schlagen Sie uns bitte Alternativtermine in der gleichen oder folgenden Woche vor.

Vielen Dank für Ihre Unterstützung.

Mit freundlichen Grüßen
{pruefer}
{rp_adresse}` },
    schule_ergebnis: { titel: 'Schule: Ergebnis-Mitteilung (nach der Kontrolle)',
      platzhalter: ['schule','schule_ort','datum','gruppen','anzahl','ergebnisse','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Ergebnisse Berichtsheftkontrolle – {gruppen_kurz} – {schule} – {datum}',
      body: `Sehr geehrte Damen und Herren,

am {datum} wurde an der {schule}{schule_ort} die Berichtsheftkontrolle durchgeführt.

Kontrollierte Fachrichtungen/Ausbildungsjahre:
{gruppen}

Ergebnisse ({anzahl} Auszubildende):
{ergebnisse}
Bei Auszubildenden mit Beanstandungen wurden die Ausbildungsbetriebe gesondert angeschrieben.

Vielen Dank für die Bereitstellung der Räumlichkeiten und die gute Zusammenarbeit.

Mit freundlichen Grüßen
{pruefer}
{rp_adresse}` },
    betrieb_bcc: { titel: 'Betriebe: Serien-E-Mail Terminankündigung (BCC)',
      platzhalter: ['datum','schule','schule_ort','fachrichtung','klassen','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftdurchsicht am {datum} – {schule}',
      body: `Sehr geehrte Ausbilderinnen und Ausbilder,

im Rahmen der Berufsausbildung zum/zur {fachrichtung} findet am {datum} an der {schule}{schule_ort} eine Durchsicht der Berichtshefte (Ausbildungsnachweise) statt.

Bitte stellen Sie sicher, dass Ihr Auszubildender/Ihre Auszubildende das Berichtsheft vollständig und ordnungsgemäß geführt zur Durchsicht mitbringt.

Folgende Unterlagen werden geprüft:
- Individueller Ausbildungsplan (ausgefüllt und unterschrieben)
- Sachberichte / Wochenberichte (lückenlos geführt)
- Bescheinigungen über überbetriebliche Ausbildung
- Unterschriften des Ausbilders/der Ausbilderin

Bei Rückfragen stehe ich Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
{pruefer}
{rp_adresse}` },
    betrieb_ankuendigung: { titel: 'Betrieb: Terminankündigung (individuell)',
      platzhalter: ['anrede','datum','schule','schule_ort','fachrichtung','klassen','azubi_block','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftkontrolle am {datum} – {azubi_namen}',
      body: `Sehr geehrte Damen und Herren,{anrede}

am {datum} findet an der {schule}{schule_ort} die Berichtsheftkontrolle für {fachrichtung} ({klassen}) statt.

Folgende Ihrer Auszubildenden sind betroffen:
{azubi_block}

Bitte stellen Sie sicher, dass die Berichtshefte vollständig geführt, mit allen erforderlichen Unterschriften versehen und am Kontrolltag in der Berufsschule vorliegen.

Geprüft werden: Individueller Ausbildungsplan, Sachberichte/Wochenberichte (lückenlos), ÜBA-Bescheinigungen, Unterschriften.

Mit freundlichen Grüßen
{pruefer}
{rp_adresse}` },
    betrieb_maengel: { titel: 'Betrieb: Mängelmitteilung (nach der Kontrolle)',
      platzhalter: ['anrede','datum','schule','schule_ort','azubi_block','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftkontrolle – Ergebnis für {azubi_namen}',
      body: `Sehr geehrte Damen und Herren,{anrede}

am {datum} wurde an der {schule}{schule_ort} die Berichtsheftkontrolle durchgeführt.

Für folgende Ihrer Auszubildenden ergab sich Handlungsbedarf:

{azubi_block}

Wir bitten Sie, dafür Sorge zu tragen, dass die genannten Mängel zeitnah behoben werden.

Bitte beachten Sie, dass ein ordnungsgemäß geführtes Berichtsheft Voraussetzung für die Zulassung zur Abschlussprüfung ist (§ 43 Abs. 1 Nr. 2 BBiG).

Mit freundlichen Grüßen
{pruefer}
{rp_adresse}` },
    betrieb_ok: { titel: 'Betrieb: Bestätigung „ohne Beanstandung" (nach der Kontrolle)',
      platzhalter: ['anrede','datum','schule','schule_ort','azubi_block','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftkontrolle am {datum} – ohne Beanstandung ({azubi_namen})',
      body: `Sehr geehrte Damen und Herren,{anrede}

am {datum} wurde an der {schule}{schule_ort} die Berichtsheftkontrolle durchgeführt.

Die Berichtshefte folgender Auszubildender waren ohne Beanstandung:
{azubi_block}

Vielen Dank für die sorgfältige Begleitung der Ausbildungsnachweise – es besteht kein weiterer Handlungsbedarf.

Mit freundlichen Grüßen
{pruefer}
{rp_adresse}` },
    brief_betrieb: { titel: 'Betrieb: Anschreiben als Brief (PDF-Seriendruck)',
      platzhalter: ['datum','schule','schule_ort','klassen','fachrichtung','azubi_liste','pruefer','rp_name'],
      betreff: 'Berichtsheftkontrolle am {datum}',
      body: `Sehr geehrte Damen und Herren,

am {datum} findet an der {schule}{schule_ort} die Berichtsheftkontrolle für die Klasse(n) {klassen} ({fachrichtung}) statt.

Folgende Ihrer Auszubildenden sind betroffen:
{azubi_liste}

Bitte stellen Sie sicher, dass die Berichtshefte Ihrer Auszubildenden vollständig geführt, mit allen erforderlichen Unterschriften versehen und am Kontrolltag in der Berufsschule vorliegen.

Fehlende oder mangelhafte Berichtshefte können die Zulassung zur Abschlussprüfung gefährden.

Mit freundlichen Grüßen

{pruefer}
{rp_name}` },
    wv_mahnung: { titel: 'Wiedervorlage: Mängelmitteilung mit Frist',
      platzhalter: ['anrede','azubi','maengel','frist','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftkontrolle – Mängel im Berichtsheft von {azubi}',
      body: `Sehr geehrte Damen und Herren,{anrede}

bei der Berichtsheftkontrolle Ihres/Ihrer Auszubildenden {azubi} wurden folgende Mängel festgestellt:

{maengel}

Wir bitten Sie, dafür Sorge zu tragen, dass die genannten Mängel bis spätestens {frist} behoben werden.

Bitte beachten Sie, dass ein ordnungsgemäß geführtes Berichtsheft Voraussetzung für die Zulassung zur Abschlussprüfung ist (§ 43 Abs. 1 Nr. 2 BBiG).

Den Durchsichtsbogen der letzten Kontrolle fügen wir als Anlage bei.

Mit freundlichen Grüßen
{pruefer}
{pruefer_email}
{rp_adresse}

Anlage: Durchsichtsbogen {azubi}` },
    wv_erinnerung: { titel: 'Wiedervorlage: Erinnerung bei überschrittener Frist',
      platzhalter: ['anrede','azubi','maengel','frist_alt','frist_neu','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Erinnerung: Mängel im Berichtsheft von {azubi} – Frist {frist_alt} überschritten',
      body: `Sehr geehrte Damen und Herren,{anrede}

mit unserer Mitteilung hatten wir Sie gebeten, die bei der Berichtsheftkontrolle festgestellten Mängel im Berichtsheft Ihres/Ihrer Auszubildenden {azubi} bis zum {frist_alt} beheben zu lassen. Ein Nachweis liegt uns bisher nicht vor.

Offene Mängel:
{maengel}

Wir bitten Sie, das vollständige Berichtsheft bis spätestens {frist_neu} vorzulegen bzw. die Behebung der Mängel zu bestätigen.

Bitte beachten Sie, dass ein ordnungsgemäß geführtes Berichtsheft Voraussetzung für die Zulassung zur Abschlussprüfung ist (§ 43 Abs. 1 Nr. 2 BBiG).

Mit freundlichen Grüßen
{pruefer}
{pruefer_email}
{rp_adresse}` },
    nachholung: { titel: 'Betrieb: Nachhol-Aufforderung (am Kontrolltag abwesend)',
      platzhalter: ['anrede','azubi_block','datum','schule','frist','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftkontrolle am {datum} – Nachholung für {azubi_namen}',
      body: `Sehr geehrte Damen und Herren,{anrede}

am {datum} wurde an der {schule} die Berichtsheftkontrolle durchgeführt. Folgende Ihrer Auszubildenden waren an diesem Tag nicht anwesend, ihr Berichtsheft konnte daher nicht geprüft werden:
{azubi_block}

Wir bitten Sie, das vollständig geführte und unterschriebene Berichtsheft bis spätestens {frist} zur Durchsicht vorzulegen (per Post an die unten genannte Adresse oder nach Absprache persönlich).

Bitte beachten Sie, dass ein ordnungsgemäß geführtes Berichtsheft Voraussetzung für die Zulassung zur Abschlussprüfung ist (§ 43 Abs. 1 Nr. 2 BBiG).

Mit freundlichen Grüßen
{pruefer}
{pruefer_email}
{rp_adresse}` },
    amt_uebergabe: { titel: 'Fremdes Amt: Übergabeschreiben zu mitkontrollierten Azubis',
      platzhalter: ['amt','amt_name','schule','datum','anzahl','azubi_liste','anlagen','pruefer','pruefer_email','rp_adresse'],
      betreff: 'Berichtsheftkontrolle {schule} am {datum} – Ergebnisse für Auszubildende aus Ihrem Zuständigkeitsbereich ({amt})',
      body: `Sehr geehrte Kolleginnen und Kollegen,

bei der Berichtsheftkontrolle am {datum} an der {schule} haben wir auch {anzahl} Auszubildende aus Ihrem Zuständigkeitsbereich ({amt_name}) mitkontrolliert:
{azubi_liste}

Die Durchsichtsbögen und eine Übergabeliste mit den Ergebnissen fügen wir als Anlage bei. Eventuelle Wiedervorlagen/Nachholungen bitten wir in Ihrer Zuständigkeit weiterzuverfolgen.

Bei Rückfragen stehe ich gerne zur Verfügung.

Mit freundlichen Grüßen
{pruefer}
{pruefer_email}
{rp_adresse}

Anlagen: {anlagen}` },
  },
  getVorlage(typ) {
    const def = this.VORLAGEN[typ];
    if (!def) return null;
    const betreff = this.scalar("SELECT wert FROM einstellungen WHERE schluessel=?", ['vorlage_' + typ + '_betreff']);
    const body = this.scalar("SELECT wert FROM einstellungen WHERE schluessel=?", ['vorlage_' + typ + '_body']);
    return { ...def, betreff: (betreff && betreff.trim()) ? betreff : def.betreff, body: (body && body.trim()) ? body : def.body,
      angepasst: !!((betreff && betreff.trim()) || (body && body.trim())) };
  },
  saveVorlage(typ, betreff, body) {
    if (!this.VORLAGEN[typ]) return;
    const def = this.VORLAGEN[typ];
    // Standardtext = Überschreibung entfernen
    const b = (betreff || '').trim() === def.betreff.trim() ? '' : (betreff || '');
    const t = (body || '').trim() === def.body.trim() ? '' : (body || '');
    this.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES (?,?)", ['vorlage_' + typ + '_betreff', b]);
    this.run("INSERT OR REPLACE INTO einstellungen (schluessel,wert) VALUES (?,?)", ['vorlage_' + typ + '_body', t]);
  },
  resetVorlage(typ) {
    this.run("DELETE FROM einstellungen WHERE schluessel IN (?,?)", ['vorlage_' + typ + '_betreff', 'vorlage_' + typ + '_body']);
  },
  // Platzhalter ersetzen: {name} → ctx.name; unbekannte bleiben stehen
  fuellePlatzhalter(text, ctx) {
    return String(text || '').replace(/\{([a-z_]+)\}/g, (m, k) => (ctx && ctx[k] != null) ? String(ctx[k]) : m);
  },
  renderVorlage(typ, ctx) {
    const v = this.getVorlage(typ);
    if (!v) return { betreff: '', body: '' };
    return { betreff: this.fuellePlatzhalter(v.betreff, ctx), body: this.fuellePlatzhalter(v.body, ctx) };
  },
  // Gemeinsame Absenderdaten für Vorlagen
  absenderCtx(prueferName) {
    const rpAdressePost = this.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_adresse_post'") || 'Regierungspräsidium Freiburg';
    const rpEmail = this.scalar("SELECT wert FROM einstellungen WHERE schluessel='rp_email'") || '';
    // Prüfer-Datensatz finden: erst der volle Name ("Nachname, Vorname"),
    // dann die Teile einer Prüferliste ("Pix, Zilz")
    const kandidaten = [(prueferName || '').trim(), ...(prueferName || '').split(',').map(x => x.trim())].filter(Boolean);
    let pr = null;
    for (const k of kandidaten) { pr = this.query('SELECT * FROM pruefer WHERE name=?', [k])[0]; if (pr) break; }
    return {
      pruefer: prueferName || 'Ausbildungsberater',
      pruefer_email: (pr && pr.email) || rpEmail || '',
      rp_adresse: rpAdressePost,
      rp_email: rpEmail,
      rp_name: 'Regierungspräsidium Freiburg',
      datum_heute: new Date().toLocaleDateString('de-DE'),
    };
  },
  // E-Mail-Adressen fremder Ämter (Einstellungen, JSON {amt: email})
  aemterEmails() {
    try { return JSON.parse(this.scalar("SELECT wert FROM einstellungen WHERE schluessel='aemter_email'") || '{}') || {}; }
    catch(e) { return {}; }
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
    try { if (typeof AzubiRechner !== 'undefined') AzubiRechner._loadCustomTarife(); } catch(e) {}
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
    // Zurück-Taste bei offenem Modal: Modal schließen statt Ansicht verlassen
    window.addEventListener('popstate', () => {
      const overlay = document.getElementById('modalOverlay');
      if (App._modalHistoryPushed && overlay && overlay.classList.contains('active')) {
        App._modalHistoryPushed = false;
        App.closeModal(true);
      }
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
    // Papierkorb (gelöschte Azubis/Termine, 90 Tage) – auch auf Bestands-DBs
    try {
      this.db.run(`CREATE TABLE IF NOT EXISTS bhk_papierkorb (
        id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT NOT NULL, ref_id INTEGER,
        label TEXT DEFAULT '', daten TEXT NOT NULL, geloescht_von TEXT DEFAULT '',
        geloescht_am TEXT DEFAULT (datetime('now','localtime')))`);
      this.db.run("DELETE FROM bhk_papierkorb WHERE geloescht_am < datetime('now','localtime','-90 days')");
    } catch(e) { console.warn('Papierkorb-Migration:', e); }
    try {
      // Ensure new tables exist (SCHEMA handles CREATE IF NOT EXISTS)
      // wiedervorlage_notizen fehlte als einzige Zusatztabelle in beiden
      // Migrationen: auf gewachsenen Datenbanken schlugen alle Abfragen darauf fehl.
      this.db.run(`CREATE TABLE IF NOT EXISTS wiedervorlage_notizen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wiedervorlage_id INTEGER REFERENCES wiedervorlagen(id),
      notiz TEXT DEFAULT '',
      erstellt_am TEXT DEFAULT (datetime('now','localtime')),
      erstellt_von TEXT DEFAULT ''
    )`);
      // Import-Historie (nachvollziehbar, wer wann was importiert hat)
      this.db.run(`CREATE TABLE IF NOT EXISTS import_historie (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zeitpunkt TEXT DEFAULT (datetime('now','localtime')),
      typ TEXT DEFAULT 'azubis',
      datei TEXT DEFAULT '',
      bearbeiter TEXT DEFAULT '',
      zeilen INTEGER DEFAULT 0,
      neu INTEGER DEFAULT 0,
      aktualisiert INTEGER DEFAULT 0,
      uebersprungen INTEGER DEFAULT 0,
      fehler INTEGER DEFAULT 0,
      datums_fehler INTEGER DEFAULT 0,
      datumsformat TEXT DEFAULT '',
      details_json TEXT DEFAULT '[]'
    )`);
      // Idempotenz-Ledger auch in der Arbeitskopie vorhalten
      this.db.run(`CREATE TABLE IF NOT EXISTS bhk_applied_ops (op_uid TEXT PRIMARY KEY, ts TEXT DEFAULT '')`);
      // Tombstones (Lösch-Propagation) – auch auf Bestands-DBs anlegen + alte Einträge räumen
      this.db.run(`CREATE TABLE IF NOT EXISTS bhk_tombstones (
        tabelle TEXT NOT NULL, key TEXT NOT NULL,
        geloescht_am TEXT DEFAULT (datetime('now','localtime')),
        PRIMARY KEY (tabelle, key))`);
      try { this.db.run("DELETE FROM bhk_tombstones WHERE geloescht_am < datetime('now','localtime','-60 days')"); } catch(e) {}
      this.db.run(`CREATE TABLE IF NOT EXISTS bhk_papierkorb (
        id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT NOT NULL, ref_id INTEGER,
        label TEXT DEFAULT '', daten TEXT NOT NULL, geloescht_von TEXT DEFAULT '',
        geloescht_am TEXT DEFAULT (datetime('now','localtime')))`);
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
      // Manuelle Abwahl der AP-Zulassung dauerhaft merken (war nur im Speicher →
      // nach Reload bzw. beim Kollegen setzte die Automatik sie wieder auf 1)
      if (!keCols.includes('zulassung_manuell')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN zulassung_manuell INTEGER DEFAULT 0");
      }
      // Pauschal nacherfasste Fehltage (nicht KW-genau, z.B. aus dem Papierbogen):
      // fehltage_gesamt = Summe der KW-Einträge + dieser Pauschalwert
      if (!keCols.includes('fehltage_pauschal')) {
        this.db.run("ALTER TABLE kontrollergebnisse ADD COLUMN fehltage_pauschal INTEGER DEFAULT 0");
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
      try { this.db.run("ALTER TABLE kontrolltermine ADD COLUMN berufsschule_id INTEGER DEFAULT NULL"); } catch(e) {}
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
      // Remove LLM settings (CSO security requirement)
      try { this.db.run("DELETE FROM einstellungen WHERE schluessel LIKE 'llm_%'"); } catch(e) {}
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
      // kw_maengel VOR dem COUNT anlegen: Auf einer Alt-DB ohne diese Tabelle
      // warf der COUNT und riss das ganze try mit – schueler_bemerkungen,
      // schueler_dateien und ausbilder wurden dann nie angelegt (Schülerakte
      // und Ausbilder-Verwaltung liefen still ins Leere).
      this.db.run(`CREATE TABLE IF NOT EXISTS kw_maengel (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kontrollergebnis_id INTEGER REFERENCES kontrollergebnisse(id),
        ausbildungsjahr INTEGER CHECK (ausbildungsjahr BETWEEN 1 AND 4),
        kalenderwoche INTEGER CHECK (kalenderwoche BETWEEN 1 AND 53),
        maengel_codes TEXT DEFAULT '',
        fehltage INTEGER DEFAULT 0,
        UNIQUE(kontrollergebnis_id, ausbildungsjahr, kalenderwoche)
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
      // Schueler-Bemerkungen (notes per student)
      this.db.run(`CREATE TABLE IF NOT EXISTS schueler_bemerkungen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schueler_id INTEGER REFERENCES schueler(id),
        text TEXT DEFAULT '',
        erstellt_von TEXT DEFAULT '',
        erstellt_am TEXT DEFAULT (datetime('now','localtime'))
      )`);
      // Schueler-Dateien (file attachments per student)
      this.db.run(`CREATE TABLE IF NOT EXISTS schueler_dateien (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schueler_id INTEGER REFERENCES schueler(id),
        dateiname TEXT NOT NULL,
        original_name TEXT NOT NULL,
        beschreibung TEXT DEFAULT '',
        dateityp TEXT DEFAULT '',
        groesse INTEGER DEFAULT 0,
        erstellt_von TEXT DEFAULT '',
        erstellt_am TEXT DEFAULT (datetime('now','localtime'))
      )`);
      // Ausbilder table for Betriebe
      this.db.run(`CREATE TABLE IF NOT EXISTS ausbilder (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        betrieb_id INTEGER REFERENCES betriebe(id),
        nachname TEXT DEFAULT '',
        vorname TEXT DEFAULT '',
        telefon TEXT DEFAULT '',
        email TEXT DEFAULT '',
        mobil TEXT DEFAULT '',
        funktion TEXT DEFAULT ''
      )`);
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

    // ── Ausbildungsphasen + erweiterte Schüler-Felder ──
    try {
      this.db.run(`CREATE TABLE IF NOT EXISTS ausbildungsphasen (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schueler_id INTEGER NOT NULL REFERENCES schueler(id),
        von TEXT NOT NULL, bis TEXT,
        typ TEXT NOT NULL CHECK (typ IN ('ausbildung','unterbrechung')),
        betrieb TEXT, teilzeit_prozent INTEGER DEFAULT 100,
        grund TEXT, pauschal_fehltage_e INTEGER DEFAULT 0,
        pauschal_fehltage_u INTEGER DEFAULT 0, anmerkung TEXT
      )`);
      try { this.db.run("ALTER TABLE schueler ADD COLUMN regulaer_dauer_monate INTEGER DEFAULT 36"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN verkuerzung_monate INTEGER DEFAULT 0"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN vorzeitige_zulassung INTEGER DEFAULT 0"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN vollzeit_wochenstunden REAL DEFAULT 39"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN beruf_id TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN geburtsdatum TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN zp_termin TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN ap_termin TEXT DEFAULT ''"); } catch(e) {}
      try { this.db.run("ALTER TABLE schueler ADD COLUMN brutto_lohn REAL DEFAULT 0"); } catch(e) {}
      // UNIQUE-Index gegen doppelte Kontrollergebnisse (2 Prüfer öffnen denselben Termin)
      try {
        this.db.run("DELETE FROM kontrollergebnisse WHERE id NOT IN (SELECT MIN(id) FROM kontrollergebnisse GROUP BY kontrolltermin_id, schueler_id)");
        this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_termin_schueler ON kontrollergebnisse(kontrolltermin_id, schueler_id)");
      } catch(e) { console.warn('KE-Unique-Index:', e.message); }
      this.db.run(`CREATE TABLE IF NOT EXISTS aenderungslog (
        id INTEGER PRIMARY KEY AUTOINCREMENT, schueler_id INTEGER, schueler_name TEXT DEFAULT '',
        feld TEXT NOT NULL, alter_wert TEXT DEFAULT '', neuer_wert TEXT DEFAULT '',
        aktion TEXT DEFAULT 'geaendert', bearbeiter TEXT DEFAULT '',
        zeitpunkt TEXT DEFAULT (datetime('now','localtime')),
        ibykus_relevant INTEGER DEFAULT 1, exportiert INTEGER DEFAULT 0
      )`);
    } catch(e) { console.warn('Ausbildungsphasen-Migration:', e); }

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
    // KW-Selektion + Popover aufräumen (verhindert stale DOM-Referenzen)
    if (typeof KWNav !== 'undefined') {
      try { KWNav.clearSelection(); KWNav.closePopover(); } catch(e) {}
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
    const today = todayStr();
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
      banner.innerHTML = `<span style="color:var(--clr-red)">◆</span> Verbindung zur Datenbank getrennt – Änderungen werden lokal gehalten <button class="btn btn-sm" style="background:#e8a820;color:#fff;border:none;margin-left:8px;padding:3px 12px;font-size:11px" onclick="App.tryReconnect()">↻ Erneut verbinden</button>`;
    } else {
      banner.style.background = '#fef7ec'; banner.style.color = '#92400e';
      banner.innerHTML = '<span style="color:var(--clr-amber)">◐</span> Verbindungsversuch…';
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
    t.textContent = msg;
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
    // Zurück-Taste (v.a. Mobile) soll das Modal schließen, nicht die Ansicht
    // verlassen: einen History-Eintrag pushen, den popstate wieder konsumiert.
    if (!this._modalHistoryPushed) {
      try { history.pushState({ bhkModal: true }, ''); this._modalHistoryPushed = true; } catch(e) {}
    }
    setTimeout(() => TableSort.initAll(), 50);
  },
  closeModal(fromPopstate = false) {
    document.getElementById('modalOverlay').classList.remove('active');
    // KW-Modal-Kontext aufräumen: bleibt er stehen, schreibt ein späterer
    // Tastendruck (O/Enter) in einem FREMDEN Dialog auf die zuletzt
    // betrachtete Kalenderwoche.
    try { if (typeof KontrolleHandler !== 'undefined') KontrolleHandler._kwModalContext = null; } catch(e) {}
    // Modal-History-Eintrag wieder entfernen (außer die Zurück-Taste hat ihn
    // bereits konsumiert) – sonst müsste man nach dem X-Klick 2× zurück drücken
    if (this._modalHistoryPushed && !fromPopstate) {
      this._modalHistoryPushed = false;
      try { history.back(); } catch(e) {}
    } else {
      this._modalHistoryPushed = false;
    }
  },

  // ── ICS Export ──
  exportICS(events, dateiname) {
    // Feldinhalte nach RFC 5545 maskieren – ein Komma im Schulnamen zerbrach
    // sonst die SUMMARY-Zeile
    const esc5545 = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Berichtsheftkontrolle//DE\r\nCALSCALE:GREGORIAN\r\n';
    events.forEach((e, i) => {
      const dtStart = e.date.replace(/-/g, '');
      ics += `BEGIN:VEVENT\r\nUID:bhk-${dtStart}-${i}@berichtsheftkontrolle\r\nDTSTART;VALUE=DATE:${dtStart}\r\nSUMMARY:${esc5545(e.title)}\r\nDESCRIPTION:${esc5545(e.description || '')}\r\nEND:VEVENT\r\n`;
    });
    ics += 'END:VCALENDAR';
    const blob = new Blob([ics], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = dateiname || `BH-Kontrolltermine_${todayStr()}.ics`;
    a.click();
  },
};
