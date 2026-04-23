const SchuelerView = {
  _initialized: false,
  filters: { search:'', jahrgang:'', schule:'', fachrichtung:'', klasse:'', betrieb:'', lehrjahr:'' },
  sortCol: 'nachname',
  sortDir: 'asc',
  page: 0,
  pageSize: 50,

  init() {
    this._initialized = true;
    this.filters = { search:'', jahrgang:'', schule:'', fachrichtung:'', klasse:'', betrieb:'', lehrjahr:'' };
    this.sortCol = 'nachname';
    this.sortDir = 'asc';
    this.page = 0;
  },

  getFilteredData() {
    let sql = `SELECT s.*,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      f.code as fr_code,
      k.klassenbezeichnung, k.lehrjahr,
      bs.name as schule,
      j.bezeichnung as jahrgang,
      s.landesfachklasse
      FROM schueler s
      LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      WHERE 1=1`;
    if (!this.showInaktive) sql += ' AND s.aktiv=1';
    // Apply global BG filter
    sql += App.gf('schueler');
    const params = [];

    if (this.filters.search) {
      sql += ` AND (s.nachname LIKE ? OR s.vorname LIKE ? OR s.ausbildungsstaette LIKE ? OR s.ibykus_id LIKE ?)`;
      const q = `%${this.filters.search}%`;
      params.push(q, q, q, q);
    }
    if (this.filters.jahrgang) { sql += ' AND s.jahrgang_id = ?'; params.push(parseInt(this.filters.jahrgang)); }
    if (this.filters.schule) { sql += ' AND bs.name = ?'; params.push(this.filters.schule); }
    if (this.filters.fachrichtung) { sql += ' AND s.fachrichtung_id = ?'; params.push(parseInt(this.filters.fachrichtung)); }
    if (this.filters.klasse) { sql += ' AND s.klasse_id = ?'; params.push(parseInt(this.filters.klasse)); }
    if (this.filters.lehrjahr) { sql += ' AND k.lehrjahr = ?'; params.push(parseInt(this.filters.lehrjahr)); }
    if (this.filters.betrieb) { sql += ' AND s.ausbildungsstaette LIKE ?'; params.push(`%${this.filters.betrieb}%`); }

    // Sort
    const sortMap = {
      nachname: 's.nachname', vorname: 's.vorname', betrieb: 's.ausbildungsstaette',
      fachrichtung: 'f.bezeichnung', schule: 'bs.name', klasse: 'k.klassenbezeichnung',
      lehrjahr: 'k.lehrjahr', jahrgang: 'j.bezeichnung'
    };
    const sortField = sortMap[this.sortCol] || 's.nachname';
    sql += ` ORDER BY ${sortField} ${this.sortDir === 'desc' ? 'DESC' : 'ASC'}, s.nachname ASC`;

    return App.query(sql, params);
  },

  getFilterOptions() {
    const aktiv = this.showInaktive ? '' : 'AND s.aktiv=1';
    const gf = App.gf('schueler');
    return {
      jahrgaenge: App.query(`SELECT DISTINCT j.id, j.bezeichnung FROM schueler s JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id WHERE 1=1 ${aktiv}${gf} ORDER BY j.jahr DESC`),
      schulen: App.query(`SELECT DISTINCT bs.name FROM schueler s JOIN klassen k ON s.klasse_id=k.id JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE 1=1 ${aktiv}${gf} ORDER BY bs.name`).map(r => r.name),
      fachrichtungen: App.query(`SELECT DISTINCT f.id, CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || f.bezeichnung as label FROM schueler s JOIN fachrichtungen f ON s.fachrichtung_id=f.id WHERE 1=1 ${aktiv}${gf} ORDER BY f.typ, f.bezeichnung`),
      klassen: App.query(`SELECT DISTINCT k.id, k.klassenbezeichnung, bs.name as schule FROM schueler s JOIN klassen k ON s.klasse_id=k.id JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE 1=1 ${aktiv}${gf} ORDER BY bs.name, k.klassenbezeichnung`),
      betriebe: App.query(`SELECT DISTINCT s.ausbildungsstaette FROM schueler s WHERE s.ausbildungsstaette != '' ${aktiv} ORDER BY s.ausbildungsstaette`).map(r => r.ausbildungsstaette),
    };
  },

  setFilter(key, value) {
    this.filters[key] = value;
    this.page = 0;
    this.render();
  },

  setSort(col) {
    if (this.sortCol === col) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortCol = col; this.sortDir = 'asc'; }
    this.render();
  },

  clearFilters() {
    this.filters = { search:'', jahrgang:'', schule:'', fachrichtung:'', klasse:'', betrieb:'', lehrjahr:'' };
    this.page = 0;
    this.render();
  },

  showInaktive: false,
  toggleInaktive() {
    this.showInaktive = !this.showInaktive;
    this.page = 0;
    this.render();
  },

  abschliessenJahrgang() {
    const jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC');
    App.openModal('🎓 Jahrgang abschließen', `
      <p style="font-size:13px;margin-bottom:12px">Alle Schüler eines Jahrgangs als <strong>"AP bestanden"</strong> markieren und <strong>inaktiv</strong> setzen. Die Daten bleiben für Statistiken erhalten.</p>
      <div class="form-group"><label>Jahrgang auswählen</label><select class="form-control" id="mAbschlJG">
        ${jahrgaenge.map(j => {
          const cnt = App.scalar('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=? AND aktiv=1', [j.id]) || 0;
          return `<option value="${j.id}">${esc(j.bezeichnung)} (${cnt} aktive Schüler)</option>`;
        }).join('')}
      </select></div>
      <div style="padding:8px;background:var(--clr-amber-light);border-radius:var(--radius);font-size:12px;margin-bottom:8px">
        ⚠ Schüler mit offenen Wiedervorlagen oder unvollständigen Pflichtteilen werden markiert aber trotzdem abgeschlossen. Prüfen Sie vorher die Übersicht.
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-success" onclick="SchuelerView.doAbschliessen()">🎓 Jahrgang abschließen</button>`);
  },

  doAbschliessen() {
    const jgId = document.getElementById('mAbschlJG').value;
    if (!jgId) return App.toast('Kein Jahrgang ausgewählt', 'error');
    const jgName = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jgId]);
    const count = App.scalar('SELECT COUNT(*) FROM schueler WHERE jahrgang_id=? AND aktiv=1', [jgId]) || 0;
    if (!count) return App.toast('Keine aktiven Schüler in diesem Jahrgang', 'warning');
    if (!confirm(`${count} Schüler im Jahrgang "${jgName}" als AP-bestanden markieren und inaktiv setzen?`)) return;

    const today = new Date().toISOString().split('T')[0];
    App.run(`UPDATE schueler SET aktiv=0, status='ap_bestanden', ap_bestanden=1, inaktiv_datum=?, inaktiv_grund='Jahrgang abgeschlossen' WHERE jahrgang_id=? AND aktiv=1`, [today, jgId]);
    // Also close open Wiedervorlagen
    App.run(`UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung='Jahrgang abgeschlossen' WHERE schueler_id IN (SELECT id FROM schueler WHERE jahrgang_id=?) AND status IN ('offen','ueberfaellig')`, [today, jgId]);

    App.closeModal();
    this.render();
    App.toast(`${count} Schüler im Jahrgang ${jgName} abgeschlossen`, 'success');
  },

  render() {
    const c = document.getElementById('schuelerViewContainer');
    if (!c) return;
    const allData = this.getFilteredData();
    const opts = this.getFilterOptions();
    const totalAll = App.scalar(`SELECT COUNT(*) FROM schueler WHERE ${this.showInaktive ? '1=1' : 'aktiv=1'}`) || 0;
    const totalInaktive = App.scalar('SELECT COUNT(*) FROM schueler WHERE aktiv=0') || 0;
    const filtered = allData.length;
    const isFiltered = Object.values(this.filters).some(v => v);

    // Pagination
    const totalPages = Math.ceil(filtered / this.pageSize) || 1;
    if (this.page >= totalPages) this.page = totalPages - 1;
    const pageData = allData.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);

    // Jahrgang buttons
    const jgCounts = App.query(`SELECT j.bezeichnung, j.id, COUNT(s.id) as cnt
      FROM abschlussjahrgaenge j LEFT JOIN schueler s ON s.jahrgang_id=j.id AND s.aktiv=1
      GROUP BY j.id HAVING cnt > 0 ORDER BY j.jahr DESC`);

    const sortIcon = (col) => this.sortCol === col ? (this.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    const thSort = (col, label) => `<th style="cursor:pointer;user-select:none;white-space:nowrap" onclick="SchuelerView.setSort('${col}')">${label}${sortIcon(col)}</th>`;

    c.innerHTML = `

      <div class="card">
        <div class="card-header">
          Schüler (${isFiltered ? `${filtered} von ${totalAll}` : totalAll})
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="ImportHandler.addManually()">+ Manuell</button>
            <button class="btn btn-sm btn-secondary" onclick="SchuelerView.abschliessenJahrgang()" title="Alle Schüler eines Jahrgangs als AP-bestanden markieren + inaktiv setzen">🎓 Jahrgang abschließen</button>
            ${totalAll ? `<button class="btn btn-sm btn-danger" onclick="ImportHandler.deleteAllJahrgang()">Alle löschen</button>` : ''}
          </div>
        </div>

        <!-- Filter Bar -->
        <div style="display:flex;gap:6px;padding:8px 0;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--clr-sand);margin-bottom:8px">
          <div class="search-box" style="flex:1;min-width:180px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="form-control" placeholder="Suche (Name, Betrieb, ID...)" value="${esc(this.filters.search)}" oninput="SchuelerView.setFilter('search',this.value)" style="font-size:12px;padding-left:32px">
          </div>
          <select class="form-control" style="width:auto;font-size:12px;padding:5px 8px" onchange="SchuelerView.setFilter('jahrgang',this.value)">
            <option value="">Alle Jahrgänge</option>
            ${opts.jahrgaenge.map(j => `<option value="${j.id}" ${this.filters.jahrgang==j.id?'selected':''}>${esc(j.bezeichnung)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:12px;padding:5px 8px" onchange="SchuelerView.setFilter('schule',this.value)">
            <option value="">Alle Schulen</option>
            ${opts.schulen.map(s => `<option value="${esc(s)}" ${this.filters.schule===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:12px;padding:5px 8px" onchange="SchuelerView.setFilter('fachrichtung',this.value)">
            <option value="">Alle Fachrichtungen</option>
            ${opts.fachrichtungen.map(f => `<option value="${f.id}" ${this.filters.fachrichtung==f.id?'selected':''}>${esc(f.label)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:12px;padding:5px 8px" onchange="SchuelerView.setFilter('klasse',this.value)">
            <option value="">Alle Klassen</option>
            ${opts.klassen.map(k => `<option value="${k.id}" ${this.filters.klasse==k.id?'selected':''}>${esc(k.schule)} – ${esc(k.klassenbezeichnung)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:12px;padding:5px 8px" onchange="SchuelerView.setFilter('lehrjahr',this.value)">
            <option value="">Alle LJ</option>
            <option value="1" ${this.filters.lehrjahr==='1'?'selected':''}>1. LJ</option>
            <option value="2" ${this.filters.lehrjahr==='2'?'selected':''}>2. LJ</option>
            <option value="3" ${this.filters.lehrjahr==='3'?'selected':''}>3. LJ</option>
          </select>
          ${isFiltered ? `<button class="btn btn-sm" style="font-size:11px;padding:4px 8px;background:var(--clr-red-light);color:var(--clr-red);border:1px solid var(--clr-red)" onclick="SchuelerView.clearFilters()">✕ Filter zurücksetzen</button>` : ''}
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;margin-left:auto;color:var(--clr-text-light)">
            <input type="checkbox" ${this.showInaktive?'checked':''} onchange="SchuelerView.toggleInaktive()"> Inaktive zeigen${totalInaktive ? ` (${totalInaktive})` : ''}
          </label>
        </div>

        <!-- Bulk Action Bar -->
        <div id="bulkBarSchueler" style="display:none;padding:8px 12px;background:var(--clr-forest);color:white;border-radius:var(--radius);margin-bottom:8px;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
          <strong><span id="bulkCountS">0</span> ausgewählt</strong>
          <span style="opacity:0.4">│</span>
          <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkSchueler.assignKlasse()">Klasse zuordnen</button>
          <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkSchueler.assignJahrgang()">Jahrgang ändern</button>
          <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkSchueler.assignFachrichtung()">Fachrichtung</button>
          <button class="btn btn-sm" style="background:var(--clr-green);color:white;border:none" onclick="StammdatenTab.quickEinsendung(BulkSchueler.getSelected())">📋 Einzelprüfung</button>
          <button class="btn btn-sm" style="background:var(--clr-red);color:white;border:none" onclick="BulkSchueler.deleteSelected()">Löschen</button>
          <span style="margin-left:auto;opacity:0.6;cursor:pointer" onclick="BulkSchueler.deselectAll()">✕ Abwählen</span>
        </div>

        <!-- Table -->
        ${filtered > 0 ? `
        <div style="overflow-x:auto">
        <table class="data-table"><thead><tr>
          <th style="width:30px"><input type="checkbox" id="chkAllS" onchange="BulkSchueler.toggleAll(this.checked)"></th>
          ${thSort('nachname','Name')}
          ${thSort('vorname','Vorname')}
          ${thSort('betrieb','Betrieb')}
          <th>Kontakt</th>
          ${thSort('fachrichtung','Fachrichtung')}
          ${thSort('schule','Schule')}
          ${thSort('klasse','Klasse')}
          ${thSort('lehrjahr','LJ')}
          ${thSort('jahrgang','Jahrgang')}
          <th>Status</th>
          <th>Aktionen</th>
        </tr></thead><tbody>
          ${pageData.map(s => {
            const statusLabels = {aktiv:'Aktiv',ap_zugelassen:'AP zug.',ap_bestanden:'Bestanden',abgebrochen:'Abgebr.',verlaengert:'Verl.'};
            const statusCls = (s.status||'aktiv') === 'aktiv' ? '' : ((s.status === 'ap_bestanden') ? 'badge-ok' : (s.status === 'abgebrochen' ? 'badge-overdue' : 'badge-open'));
            return `<tr style="${s.aktiv ? '' : 'opacity:0.6;background:var(--clr-warm)'}">
            <td><input type="checkbox" class="chk-s" value="${s.id}" onchange="BulkSchueler.updateBar()"></td>
            <td><strong>${esc(s.nachname)}</strong></td>
            <td>${esc(s.vorname)}</td>
            <td title="${esc(s.ausbildungsstaette)}">${esc((s.ausbildungsstaette||'').substring(0,30))}</td>
            <td style="font-size:10px">${s.email ? `<a href="mailto:${esc(s.email)}" style="color:var(--clr-forest)">${esc(s.email)}</a>` : ''}${s.email && s.telefon ? '<br>' : ''}${s.telefon ? `<a href="tel:${esc(s.telefon)}" style="color:var(--clr-text-light)">${esc(s.telefon)}</a>` : ''}${!s.email && !s.telefon ? '<span style="color:var(--clr-sand)">–</span>' : ''}</td>
            <td><small>${esc(s.fachrichtung||'–')}</small></td>
            <td><small>${(() => { const ak = App.getAktuelleSchule(s); return esc(ak.schule||'–') + (ak.isLandesfachklasse ? ' <span style="font-size:9px;padding:1px 5px;background:#e8d5f5;color:#7b2fa0;border-radius:8px" title="Landesfachklasse (regulär: '+esc(s.schule||'–')+')">LFK</span>' : ''); })()}</small></td>
            <td><small>${esc(s.klassenbezeichnung||'–')}</small></td>
            <td>${s.lehrjahr||'–'}</td>
            <td><small>${esc(s.jahrgang||'–')}</small></td>
            <td>${statusCls ? `<span class="badge-status ${statusCls}" style="font-size:10px">${statusLabels[s.status]||s.status||'Aktiv'}</span>` : '<span style="font-size:10px;color:var(--clr-text-light)">Aktiv</span>'}</td>
            <td class="btn-group">
              <button class="btn-icon btn-sm" title="Bearbeiten" onclick="ImportHandler.editSchueler(${s.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
              </button>
              <button class="btn-icon btn-sm" title="Azubi-Dashboard" onclick="AzubiDashboard.open(${s.id})" style="font-size:12px">&#127891;</button>
              <button class="btn-icon btn-sm" title="Akte: Bemerkungen & Dateien" onclick="SchuelerAkte.open(${s.id})" style="font-size:12px">&#128209;</button>
              <button class="btn-icon btn-sm" title="Löschen" onclick="ImportHandler.deleteSchueler(${s.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </td>
          </tr>`;}).join('')}
        </tbody></table>
        </div>
        <!-- Pagination -->
        ${totalPages > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 4px;font-size:12px;color:var(--clr-text-light)">
          <span>Seite ${this.page+1} von ${totalPages} (${filtered} Schüler${isFiltered?' gefiltert':''})</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-secondary" ${this.page<=0?'disabled':''} onclick="SchuelerView.page=0;SchuelerView.render()">«</button>
            <button class="btn btn-sm btn-secondary" ${this.page<=0?'disabled':''} onclick="SchuelerView.page--;SchuelerView.render()">‹</button>
            <button class="btn btn-sm btn-secondary" ${this.page>=totalPages-1?'disabled':''} onclick="SchuelerView.page++;SchuelerView.render()">›</button>
            <button class="btn btn-sm btn-secondary" ${this.page>=totalPages-1?'disabled':''} onclick="SchuelerView.page=${totalPages-1};SchuelerView.render()">»</button>
          </div>
        </div>` : `<div style="padding:4px;font-size:12px;color:var(--clr-text-light)">${filtered} Schüler</div>`}
        ` : '<div class="empty-state"><h3>Keine Schüler gefunden</h3><p>Keine Treffer. <br><button class=&quot;btn btn-sm btn-secondary&quot; style=&quot;margin-top:8px&quot; onclick=&quot;SchuelerView.clearFilters()&quot;>Filter zurücksetzen</button></p></div>'}
      </div>`;
  }
};
