// ╔══════════════════════════════════════════════════════════════╗
// ║  HANDLER MODULES                                             ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Modal Sub-Tab Helper ──
function _switchModalTab(tabId, btn) {
  document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById(tabId);
  if (el) el.classList.add('active');
  if (btn) btn.classList.add('active');
}
function _makeModalWide() {
  const m = document.getElementById('modalContent');
  if (m) m.classList.add('modal-wide');
}

// ── Stammdaten Tabs ──
const StammdatenTab = {
  show(tab, btnEl) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) { btnEl.classList.add('active'); }
    else {
      // Find the correct tab button by onclick content
      document.querySelectorAll('.tab-btn').forEach(b => {
        const oc = b.getAttribute('onclick') || '';
        if (oc.includes("'" + tab + "'")) b.classList.add('active');
      });
    }
    const c = document.getElementById('stammdatenContent');
    if (tab === 'azubis') this.azubis(c);
    else if (tab === 'jahrgaenge') this.jahrgaenge(c);
    else if (tab === 'schulen') this.schulen(c);
    else if (tab === 'klassen') this.klassen(c);
    else if (tab === 'betriebe') this.betriebe(c);
    else if (tab === 'blockplan') this.blockplan(c);
    else if (tab === 'pruefer') this.pruefer(c);
  },

  _azubiSearch: '',
  _azubiFilter: {},
  _azubiPage: 0,
  _azubiDebounce: null,
  // Extra filters are now global (App.extraFilters) - no local definitions needed

  _azubiDoSearch(val) {
    this._azubiSearch = val;
    this._azubiPage = 0;
    clearTimeout(this._azubiDebounce);
    this._azubiDebounce = setTimeout(() => {
      const c = document.getElementById('stammdatenContent');
      if (c) this._renderAzubiTable(c);
    }, 300);
  },

  azubis(c) {
    this._renderAzubiSearch(c);
    this._renderAzubiTable(c);
  },

  _renderAzubiSearch(c) {
    const q = this._azubiSearch || '';
    const fil = this._azubiFilter || {};
    // Only show jahrgänge/schulen that match global filters
    const gfK = App.gf('klassen');
    const jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC');
    const schulen = App.query(`SELECT DISTINCT bs.* FROM berufsschulen bs WHERE 1=1${App.gf('schulen')} ORDER BY bs.name`);

    // Global filter indicator
    const globalInfo = [];
    if (App.filterAmt.length && App.filterAmt[0] !== '-1') globalInfo.push('§ ' + (App.filterAmt.length === 1 ? App.amtLabel(App.filterAmt[0]) : App.filterAmt.length + ' Ämter'));
    if (App.filterFachrichtungen.length) {
      const btn = document.getElementById('bgFilterBtn');
      globalInfo.push('' + (btn ? btn.textContent.replace(' ▾','') : App.filterFachrichtungen.length + ' Berufe'));
    }
    if (App.filterJahrgang.length && App.filterJahrgang[0] !== -1) {
      const names = App.filterJahrgang.map(id => App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [id])).filter(Boolean);
      globalInfo.push('' + (names.length <= 2 ? names.join(', ') : names.length + ' JG'));
    }
    const globalBadge = globalInfo.length ? `<span style="font-size:10px;color:var(--clr-sage);padding:2px 6px;background:var(--clr-warm);border-radius:6px">${globalInfo.join(' · ')}</span>` : '';

    c.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
      <input class="form-control" id="azubiSearchInput" placeholder="Name, Betrieb, Ort, Schule, Tel, E-Mail..." value="${esc(q)}" style="flex:1;min-width:200px"
        oninput="StammdatenTab._azubiDoSearch(this.value)">
      <select class="form-control" style="width:auto" onchange="StammdatenTab._azubiFilter.jahrgang=this.value?parseInt(this.value):null;StammdatenTab._azubiPage=0;StammdatenTab._renderAzubiTable(document.getElementById('stammdatenContent'))">
        <option value="">Alle JG</option>
        ${jahrgaenge.map(j => `<option value="${j.id}" ${fil.jahrgang==j.id?'selected':''}>${esc(j.bezeichnung)}</option>`).join('')}
      </select>
      <select class="form-control" style="width:auto" onchange="StammdatenTab._azubiFilter.schule=this.value?parseInt(this.value):null;StammdatenTab._azubiPage=0;StammdatenTab._renderAzubiTable(document.getElementById('stammdatenContent'))">
        <option value="">Alle Schulen</option>
        ${schulen.map(s2 => `<option value="${s2.id}" ${fil.schule==s2.id?'selected':''}>${esc(s2.name)}</option>`).join('')}
      </select>
      ${globalBadge}
      ${fil.drillDown ? `<span style="font-size:11px;padding:3px 8px;background:var(--clr-amber-light);border:1px solid var(--clr-amber);border-radius:6px;display:flex;align-items:center;gap:4px">${esc(fil.drillDown.label)} <span style="cursor:pointer;color:var(--clr-red);font-weight:bold" onclick="StammdatenTab._azubiFilter.drillDown=null;StammdatenTab._azubiPage=0;StammdatenTab._renderAzubiTable(document.getElementById('stammdatenContent'))">✕</span></span>` : ''}
      <span id="azubiCount" style="font-size:12px;color:var(--clr-text-light)"></span>
      <div style="margin-left:auto;display:flex;gap:4px">
        <button class="btn btn-sm btn-secondary" onclick="StammdatenTab._exportAzubiExcel()" title="Gefilterte Liste als Excel exportieren" style="font-size:11px;padding:4px 8px">Excel</button>
        <button class="btn btn-sm btn-secondary" onclick="StammdatenTab._copyAzubiTable()" title="Tabelle in Zwischenablage kopieren" style="font-size:11px;padding:4px 8px">▤ Kopieren</button>
      </div>
    </div>
    <div id="azubiTableContainer"></div>`;
  },

  _renderAzubiTable(c) {
    const container = document.getElementById('azubiTableContainer') || c;
    const q = this._azubiSearch || '';
    const fil = this._azubiFilter || {};
    // Apply ALL global filters (Berufsgruppe + Jahrgang + Amt)
    let where = 's.aktiv=1' + App.gf('schueler');
    const params = [];

    // Split query into tokens (by comma, space, semicolon) → ALL must match
    if (q) {
      const tokens = q.split(/[,;\s]+/).map(t => t.trim()).filter(t => t.length > 0);
      tokens.forEach(token => {
        const p = `%${token}%`;
        where += " AND (s.nachname LIKE ? OR s.vorname LIKE ? OR s.ausbildungsstaette LIKE ? OR b.name LIKE ? OR s.ibykus_id LIKE ? OR s.email LIKE ? OR s.telefon LIKE ? OR s.zustaendiges_amt LIKE ? OR s.bav_status LIKE ? OR b.email LIKE ? OR b.telefon LIKE ? OR b.ort LIKE ? OR b.betriebsnummer LIKE ? OR bs.name LIKE ? OR k.klassenbezeichnung LIKE ? OR j.bezeichnung LIKE ? OR fr.bezeichnung LIKE ?)";
        params.push(p,p,p,p,p,p,p,p,p,p,p,p,p,p,p,p,p);
      });
    }
    // Local filters (additional refinement on top of global)
    if (fil.jahrgang) { where += ' AND s.jahrgang_id=?'; params.push(fil.jahrgang); }
    if (fil.schule) { where += ' AND k.berufsschule_id=?'; params.push(fil.schule); }
    // Drill-down filter (from dashboard clicks)
    if (fil.drillDown) { where += ' AND (' + fil.drillDown.where + ')'; }
    // If global "Inaktive Schüler" extra filter is active, remove the s.aktiv=1 constraint
    const ef = App._extraFilterSql();
    if (ef.overrideAktiv) { where = where.replace('s.aktiv=1', '1=1'); }
    // Store for export
    this._lastAzubiWhere = where;
    this._lastAzubiParams = [...params];
    const azubis = App.query(`SELECT s.*, b.name as b_name, b.email as b_email, b.telefon as b_tel, b.ort as b_ort, k.klassenbezeichnung, bs.name as schule, j.bezeichnung as jahrgang, fr.bezeichnung as fachrichtung, fr.typ as fr_typ, fr.code as fr_code FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN klassen k ON s.klasse_id=k.id LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id WHERE ${where} ORDER BY s.nachname, s.vorname`, params);

    // Update count label
    const countEl = document.getElementById('azubiCount');
    if (countEl) countEl.textContent = `${azubis.length} Treffer`;

    // Only update the table, not the search bar (preserves cursor position)
    container.innerHTML = `
    <!-- Bulk Action Bar -->
    <div id="bulkBarAzubi" style="display:none;padding:8px 12px;background:var(--clr-forest);color:white;border-radius:var(--radius);margin-bottom:8px;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
      <strong><span id="bulkCountAzubi">0</span> ausgewählt</strong>
      <span style="opacity:0.4">│</span>
      <button class="btn btn-sm" style="background:var(--clr-red);color:white;border:none" onclick="StammdatenTab._bulkDeleteAzubis()">Löschen</button>
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="StammdatenTab._bulkSetInaktiv()">⏸︎ Inaktiv setzen</button>
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkSchueler.assignKlasse()">Klasse zuordnen</button>
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkSchueler.assignJahrgang()">Jahrgang ändern</button>
      <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="BulkSchueler.assignFachrichtung()">Fachrichtung ändern</button>
      <button class="btn btn-sm" style="background:var(--clr-green);color:white;border:none" onclick="StammdatenTab.quickEinsendung(StammdatenTab._bulkGetSelected())">▤ Einzelprüfung erstellen</button>
      <span style="margin-left:auto;opacity:0.6;cursor:pointer" onclick="StammdatenTab._bulkDeselectAll()">✕ Abwählen</span>
    </div>
    <div class="card" style="overflow-x:auto"><table class="data-table table-sticky-name"><thead><tr><th style="width:30px"><input type="checkbox" id="chkAllAzubi" onchange="StammdatenTab._bulkToggleAll(this.checked)"></th><th>Name</th><th>Betrieb</th><th>Schule/Klasse</th><th>JG</th><th>FR</th><th>Kontakt</th><th>Kontrollen</th><th></th></tr></thead><tbody>
      ${azubis.length===0?'<tr><td colspan="9" style="text-align:center;color:var(--clr-text-light);padding:24px">Keine Azubis gefunden</td></tr>':''}
      ${azubis.map(s => {
        const ktrls = App.query('SELECT ke.*, kt.geplant_datum FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? AND ke.ergebnis != "" ORDER BY kt.geplant_datum DESC', [s.id]);
        const snpCnt = App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id=?', [s.id])||0;
        const oMgl = App.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != '' AND maengel_codes != 'H'", [s.id])||0;
        const wvO = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id])||0;
        const amp = App.getSchuelerAmpel(s.id);
        const vk = App.isVerkuerzer(s.ausbildungsbeginn, s.ausbildungsende, s.id);
        return `<tr style="${oMgl>0?'background:var(--clr-red-light)':wvO?'background:var(--clr-amber-light)':''}">
          <td><input type="checkbox" class="chk-azubi" value="${s.id}" onchange="StammdatenTab._bulkUpdateBar()"></td>
          <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)} <span title="${esc(amp.label)}">${amp.icon}</span>
            ${vk?'<span style="font-size:9px;padding:1px 4px;background:#e8d5f5;color:#7b2fa0;border-radius:8px" title="Verkürzte Ausbildung (weniger als 3 Jahre)">V</span>':''}
            ${oMgl>0?'<span style="font-size:9px;padding:1px 4px;background:var(--clr-red);color:white;border-radius:8px" title="'+oMgl+' Kalenderwoche(n) mit offenen Mängeln (ohne Fehltage)">'+oMgl+'M</span>':''}
            ${wvO?'<span style="font-size:9px;padding:1px 4px;background:var(--clr-amber);color:white;border-radius:8px" title="Offene oder überfällige Wiedervorlage vorhanden">WV</span>':''}
            <div style="font-size:10px;color:var(--clr-text-light)">${esc(s.ibykus_id||'')}${s.zustaendiges_amt && s.zustaendiges_amt !== '93' ? ' <span style="padding:0 3px;background:var(--clr-blue-light);border-radius:4px;font-weight:600">'+esc(App.amtLabel(s.zustaendiges_amt))+'</span>' : ''}</div></td>
          <td>${s.betrieb_id ? `<a href="#" onclick="StammdatenTab.showBetriebAzubis(${s.betrieb_id});return false" style="color:var(--clr-forest);font-weight:600;font-size:12px;text-decoration:underline" title="Alle Azubis dieses Betriebs">${esc(s.b_name||s.ausbildungsstaette||'')}</a>` : `<strong style="font-size:12px">${esc(s.b_name||s.ausbildungsstaette||'')}</strong>`}${s.b_ort?'<div style="font-size:10px;color:var(--clr-text-light)">'+esc(s.b_ort)+'</div>':''}</td>
          <td style="font-size:12px">${(() => { const ak = App.getAktuelleSchule(s); return (s.klasse_id ? `<a href="#" onclick="StammdatenTab.showKlasseAzubis(${s.klasse_id});return false" style="color:var(--clr-forest);text-decoration:underline" title="Alle Schüler dieser Klasse">${esc(ak.schule||'')}</a>` : esc(ak.schule||'')) + (ak.isLandesfachklasse ? ' <span style="font-size:9px;padding:1px 4px;background:#e8d5f5;color:#7b2fa0;border-radius:8px" title="Landesfachklasse (regulär: '+esc(s.schule||'')+')" >LFK</span>' : ''); })()}<div style="font-size:10px;color:var(--clr-text-light)">${esc(s.klassenbezeichnung||'')}</div></td>
          <td style="font-size:12px">${esc(s.jahrgang||'')}</td>
          <td style="font-size:11px">${s.fr_typ==='Fachwerker'?'FW ':''}${esc(s.fachrichtung||'')}</td>
          <td style="font-size:11px;white-space:nowrap">
            ${s.b_tel?'<a href="tel:'+esc(s.b_tel)+'" style="color:var(--clr-forest)" title="Betrieb: '+esc(s.b_tel)+'">Tel</a> ':''}
            ${s.b_email?'<a href="mailto:'+esc(s.b_email)+'" style="color:var(--clr-forest)" title="Betrieb: '+esc(s.b_email)+'">Mail</a> ':''}
            ${s.email?'<a href="mailto:'+esc(s.email)+'" style="color:var(--clr-blue)" title="Azubi: '+esc(s.email)+'">Azu</a> ':''}
            ${s.telefon?'<a href="tel:'+esc(s.telefon)+'" style="color:var(--clr-blue)" title="Azubi: '+esc(s.telefon)+'">Mob</a>':''}
            ${!s.b_tel&&!s.b_email&&!s.email&&!s.telefon?'-':''}
          </td>
          <td style="font-size:10px">
            ${ktrls.slice(0,3).map(ke=>'<a href="#" onclick="App.navigate(\'kontrolle\');setTimeout(()=>{document.getElementById(\'selKontrolltermin\').value='+ke.kontrolltermin_id+';KontrolleHandler.loadTermin('+ke.kontrolltermin_id+');setTimeout(()=>{const idx=KontrolleHandler.currentSchuelerList.findIndex(x=>x.id==='+s.id+');if(idx>=0){KontrolleHandler.currentIndex=idx;KontrolleHandler._viewMode=\'einzeln\';KontrolleHandler.enterSch\u00fcler();}},200)},100);return false" style="display:inline-block;padding:1px 5px;margin:1px;border-radius:6px;text-decoration:none;background:'+(ke.ergebnis==='in_ordnung'?'var(--clr-green-light)':'var(--clr-red-light)')+';color:'+(ke.ergebnis==='in_ordnung'?'var(--clr-green)':'var(--clr-red)')+'" title="'+formatDate(ke.geplant_datum)+'">'+(ke.ergebnis==='in_ordnung'?'OK':'!')+' '+formatDate(ke.geplant_datum).substring(0,6)+'</a>').join('')}
            ${ktrls.length===0?'<a href="#" onclick="StammdatenTab.quickEinsendung(['+s.id+']);return false" style="font-size:9px;color:var(--clr-forest);text-decoration:none" title="Neue Einzelprüfung erstellen">+ Prüfung</a>':''}
            ${snpCnt?' <a href="#" onclick="StammdatenTab.showAzubiSnapshots('+s.id+');return false" style="padding:1px 5px;border-radius:6px;background:var(--clr-blue-light);color:var(--clr-blue);text-decoration:none" title="Archivierte B\u00f6gen">'+snpCnt+'x</a>':''}
          </td>
          <td class="btn-group" style="white-space:nowrap"><button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:11px" onclick="ImportHandler.editSchueler(${s.id})" title="Stammdaten bearbeiten">✎</button>${typeof AzubiDashboard!=='undefined'&&AzubiDashboard.isEnabled()?`<button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:11px" onclick="AzubiDashboard.open(${s.id})" title="Azubi-Dashboard">${svgIcon('dashboard', 13)}</button>`:''}<button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:11px" onclick="SchuelerAkte.open(${s.id})" title="Akte: Bemerkungen & Dateien">${svgIcon('akte', 13)}</button></td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
  },

  // ── Bulk operations for Azubi table ──
  _bulkGetSelected() { return [...document.querySelectorAll('.chk-azubi:checked')].map(c => parseInt(c.value)); },
  _bulkToggleAll(checked) { document.querySelectorAll('.chk-azubi').forEach(c => c.checked = checked); this._bulkUpdateBar(); },
  _bulkDeselectAll() { document.querySelectorAll('.chk-azubi').forEach(c => c.checked = false); const ca = document.getElementById('chkAllAzubi'); if (ca) ca.checked = false; this._bulkUpdateBar(); },
  _bulkUpdateBar() {
    const ids = this._bulkGetSelected();
    const bar = document.getElementById('bulkBarAzubi');
    const cnt = document.getElementById('bulkCountAzubi');
    if (cnt) cnt.textContent = ids.length;
    if (bar) bar.style.display = ids.length > 0 ? 'flex' : 'none';
    // Sync BulkSchueler so its methods work with our checkboxes
    BulkSchueler.getSelected = () => this._bulkGetSelected();
  },

  _bulkDeleteAzubis() {
    const ids = this._bulkGetSelected();
    if (!ids.length) return;
    const names = ids.slice(0, 5).map(id => {
      const s = App.query('SELECT nachname, vorname FROM schueler WHERE id=?', [id])[0];
      return s ? `${s.nachname}, ${s.vorname}` : '?';
    });
    // Check for linked data
    const ph = ids.join(',');
    const withKE = App.scalar(`SELECT COUNT(DISTINCT schueler_id) FROM kontrollergebnisse WHERE schueler_id IN (${ph})`) || 0;
    const withWV = App.scalar(`SELECT COUNT(DISTINCT schueler_id) FROM wiedervorlagen WHERE schueler_id IN (${ph})`) || 0;
    const withKW = App.scalar(`SELECT COUNT(DISTINCT schueler_id) FROM kw_status WHERE schueler_id IN (${ph})`) || 0;

    let warnText = '';
    if (withKE || withWV || withKW) {
      const parts = [];
      if (withKE) parts.push(`${withKE} mit Kontrollergebnissen`);
      if (withWV) parts.push(`${withWV} mit Wiedervorlagen`);
      if (withKW) parts.push(`${withKW} mit KW-Daten`);
      warnText = parts.join(', ') + ' — alle verknüpften Daten werden mitgelöscht!';
    }

    // Two-step confirmation: modal with number-typing safety
    App.openModal(`${ids.length} Azubis löschen`, `
      <div style="background:var(--clr-red-light);border:1px solid var(--clr-red);border-radius:var(--radius);padding:12px;margin-bottom:12px">
        <strong style="color:var(--clr-red)">Achtung: Diese Aktion kann nicht rückgängig gemacht werden!</strong>
        ${warnText ? `<div style="margin-top:6px;font-size:12px;color:var(--clr-red)">${esc(warnText)}</div>` : ''}
      </div>
      <div style="font-size:13px;margin-bottom:12px">
        <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;max-height:120px;overflow-y:auto">
          ${names.map(n => `<div>• ${esc(n)}</div>`).join('')}
          ${ids.length > 5 ? `<div style="color:var(--clr-text-light)">… und ${ids.length - 5} weitere</div>` : ''}
        </div>
      </div>
      <div class="form-group">
        <label style="color:var(--clr-red);font-weight:700">Zur Bestätigung bitte die Anzahl eingeben: <code style="font-size:16px">${ids.length}</code></label>
        <input class="form-control" id="bulkDeleteConfirmInput" placeholder="Anzahl eingeben…" autocomplete="off" style="border-color:var(--clr-red)">
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn" style="background:var(--clr-red);color:white" id="bulkDeleteBtn" onclick="StammdatenTab._doDeleteAzubis()" disabled>Endgültig löschen</button>`);
    setTimeout(() => {
      const inp = document.getElementById('bulkDeleteConfirmInput');
      const btn = document.getElementById('bulkDeleteBtn');
      if (inp && btn) inp.addEventListener('input', () => { btn.disabled = inp.value.trim() !== String(ids.length); });
    }, 50);
  },

  _doDeleteAzubis() {
    const ids = this._bulkGetSelected();
    const inp = document.getElementById('bulkDeleteConfirmInput');
    if (!inp || inp.value.trim() !== String(ids.length)) return;
    // Über die zentrale Kaskade, damit keine abhängige Tabelle vergessen wird
    // (die frühere Liste ließ Snapshots, Phasen und Mängel-Altdaten zurück).
    ids.forEach(id => App.deleteSchuelerKaskade(id));
    App.closeModal();
    App.toast(`${ids.length} Azubis und alle verknüpften Daten gelöscht`, 'success');
    this._renderAzubiTable(document.getElementById('stammdatenContent'));
  },

  _bulkSetInaktiv() {
    const ids = this._bulkGetSelected();
    if (!ids.length) return;
    if (!confirm(`${ids.length} Azubis auf inaktiv setzen?`)) return;
    const today = todayStr();
    ids.forEach(id => App.run("UPDATE schueler SET aktiv=0, status='inaktiv', inaktiv_datum=? WHERE id=?", [today, id]));
    App.toast(`${ids.length} Azubis auf inaktiv gesetzt`, 'success');
    this._bulkDeselectAll();
    this._renderAzubiTable(document.getElementById('stammdatenContent'));
  },

  _getFilteredAzubis() {
    const where = this._lastAzubiWhere || 's.aktiv=1';
    const params = this._lastAzubiParams || [];
    return App.query(`SELECT s.*, b.name as b_name, b.email as b_email, b.telefon as b_tel, b.ort as b_ort, b.plz as b_plz,
      k.klassenbezeichnung, bs.name as schule, j.bezeichnung as jahrgang,
      fr.bezeichnung as fachrichtung, fr.typ as fr_typ
      FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id WHERE ${where} ORDER BY s.nachname, s.vorname`, params);
  },

  _exportAzubiExcel() {
    const azubis = this._getFilteredAzubis();
    if (!azubis.length) return App.toast('Keine Daten zum Exportieren', 'warning');
    const headers = ['Nachname','Vorname','Betrieb','Ort','PLZ','Schule','Klasse','Jahrgang','Fachrichtung',
      'Ausb.beginn','Ausb.ende','Amt','Geschlecht','Schulabschluss','Telefon (Azubi)','E-Mail (Azubi)',
      'Tel (Betrieb)','E-Mail (Betrieb)','BAV-Status','Zwischenprüfung','Landesfachklasse','iBykus-ID','Status'];
    const rows = azubis.map(s => [
      s.nachname, s.vorname, s.b_name || s.ausbildungsstaette || '', s.b_ort || '', s.b_plz || '',
      s.schule || '', s.klassenbezeichnung || '', s.jahrgang || '',
      (s.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (s.fachrichtung || ''),
      s.ausbildungsbeginn || '', s.ausbildungsende || '',
      s.zustaendiges_amt ? (s.zustaendiges_amt + ' ' + (App.AEMTER[s.zustaendiges_amt]||'')) : '',
      s.geschlecht || '', s.schulabschluss || '', s.telefon || '', s.email || '',
      s.b_tel || '', s.b_email || '', s.bav_status || '', s.zwischenpruefung || '',
      s.landesfachklasse || '', s.ibykus_id || '', s.aktiv ? 'Aktiv' : 'Inaktiv'
    ]);
    // Build Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Column widths
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length, ...rows.slice(0, 20).map(r => String(r[i] || '').length), 8) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Azubis');
    const filterLabels = this._getActiveFilterLabels();
    if (filterLabels.length) {
      const infoWs = XLSX.utils.aoa_to_sheet([['Aktive Filter'], ...filterLabels.map(l => [l]), [], ['Anzahl Ergebnisse', azubis.length], ['Exportiert am', new Date().toLocaleString('de-DE')]]);
      XLSX.utils.book_append_sheet(wb, infoWs, 'Filter-Info');
    }
    XLSX.writeFile(wb, `Azubi-Liste_${todayStr()}.xlsx`);
    App.toast(`${azubis.length} Azubis als Excel exportiert`, 'success');
  },

  _copyAzubiTable() {
    const azubis = this._getFilteredAzubis();
    if (!azubis.length) return App.toast('Keine Daten zum Kopieren', 'warning');
    const headers = ['Nachname','Vorname','Betrieb','Ort','Schule','Klasse','Jahrgang','Fachrichtung','Amt','Telefon','E-Mail'];
    const rows = azubis.map(s => [
      s.nachname, s.vorname, s.b_name || s.ausbildungsstaette || '', s.b_ort || '',
      s.schule || '', s.klassenbezeichnung || '', s.jahrgang || '',
      (s.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (s.fachrichtung || ''),
      s.zustaendiges_amt || '', s.telefon || s.b_tel || '', s.email || s.b_email || ''
    ].join('\t')).join('\n');
    const text = headers.join('\t') + '\n' + rows;
    navigator.clipboard.writeText(text).then(() => {
      App.toast(`${azubis.length} Azubis in Zwischenablage kopiert (Tab-getrennt, z.B. für Excel)`, 'success');
    }).catch(() => App.toast('Kopieren fehlgeschlagen', 'error'));
  },

  _getActiveFilterLabels() {
    const labels = [];
    const fil = this._azubiFilter || {};
    if (this._azubiSearch) labels.push('Suche: ' + this._azubiSearch);
    if (fil.jahrgang) { const j = App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [fil.jahrgang]); if (j) labels.push('Jahrgang: ' + j); }
    if (fil.schule) { const s = App.scalar('SELECT name FROM berufsschulen WHERE id=?', [fil.schule]); if (s) labels.push('Schule: ' + s); }
    if (fil.drillDown) labels.push('Drill-Down: ' + fil.drillDown.label);
    (App.extraFilters || []).forEach(f => {
      if (!f.value) return;
      const def = App.extraFilterDefs[f.field];
      if (def) labels.push(def.label + ': ' + f.value);
    });
    if (App.filterAmt.length) labels.push('Amt (global): ' + App.filterAmt.join(', '));
    if (App.filterFachrichtungen.length) labels.push('Berufe (global): ' + App.filterFachrichtungen.length + ' ausgewählt');
    if (App.filterJahrgang.length) labels.push('Jahrgang (global): ' + App.filterJahrgang.length + ' ausgewählt');
    return labels;
  },

  quickEinsendung(schuelerIds) {
    if (!schuelerIds || !schuelerIds.length) return;
    const jgId = App.query('SELECT jahrgang_id FROM schueler WHERE id=?', [schuelerIds[0]])[0]?.jahrgang_id;
    const today = todayStr();
    const names = schuelerIds.map(id => {
      const s = App.query('SELECT nachname, vorname FROM schueler WHERE id=?', [id])[0];
      return s ? `${s.nachname}, ${s.vorname}` : '';
    }).filter(Boolean);
    const autoTitel = names.length <= 3 ? 'Einzelprüfung ' + names.join('; ') : `Einzelprüfung ${names.length} Azubis`;
    App.run("INSERT INTO kontrolltermine (jahrgang_id, geplant_datum, typ, bemerkung) VALUES (?,?,?,?)",
      [jgId || null, today, 'einsendung', autoTitel]);
    const terminId = App.scalar("SELECT MAX(id) FROM kontrolltermine");
    schuelerIds.forEach(sid => {
      App.run("INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)", [terminId, sid]);
    });
    App.toast(`Einzelprüfung erstellt (${schuelerIds.length} Azubi${schuelerIds.length > 1 ? 's' : ''})`, 'success');
    App.navigate('kontrolle');
    setTimeout(() => {
      const sel = document.getElementById('selKontrolltermin');
      if (sel) { sel.value = terminId; KontrolleHandler.loadTermin(terminId); }
    }, 200);
  },

  showAzubiSnapshots(sid) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [sid])[0];
    if (!s) return;
    const snaps = App.query('SELECT * FROM durchsicht_snapshots WHERE schueler_id=? ORDER BY snapshot_datum DESC', [sid]);
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail',berichte_bis_termin_email:'E-Mail',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};
    App.openModal('Durchsichtsb\u00f6gen: '+s.nachname+', '+s.vorname, `
      <div style="font-size:13px;margin-bottom:12px">${esc(s.ausbildungsstaette||'')} - ${snaps.length} archivierte B\u00f6gen</div>
      ${snaps.length ? `<table class="data-table"><thead><tr><th>Nr.</th><th>Datum</th><th>Pr\u00fcfer</th><th>Ergebnis</th><th>Aktion</th></tr></thead><tbody>
        ${snaps.map((snap, i) => `<tr><td>${snaps.length-i}</td><td>${formatDate(snap.snapshot_datum)}</td><td>${esc(snap.pruefer||'')}</td><td>${eLbl[snap.ergebnis]||snap.ergebnis||'-'}</td>
          <td><button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.viewSnapshot(${snap.id})" style="font-size:10px">Anzeigen</button>
          <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.exportSnapshotPDF(${snap.id})" style="font-size:10px">PDF</button></td></tr>`).join('')}
      </tbody></table>` : '<p style="color:var(--clr-text-light)">Noch keine Durchsichtsb\u00f6gen.</p>'}
    `, '<button class="btn btn-secondary" onclick="App.closeModal()">Schlie\u00dfen</button>');
  },

  jahrgaenge(c) {
    const rows = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ');
    c.innerHTML = `
      <div class="toolbar"><div class="toolbar-left"></div><div class="toolbar-right">
        <button class="btn btn-primary" onclick="StammdatenTab.addJahrgang()">+ Neuer Abschlussjahrgang</button>
      </div></div>
      <div class="card"><table class="data-table"><thead><tr><th>Bezeichnung</th><th>Typ</th><th>Jahr</th><th>Prüfungstermin</th><th>Schüler</th><th>Aktionen</th></tr></thead><tbody>
        ${rows.map(r => {
          const bgFR = App.filterFachrichtungen.length ? ` AND fachrichtung_id IN (${App.filterFachrichtungen.join(',')})` : '';
          const cnt = App.scalar(`SELECT COUNT(*) FROM schueler WHERE jahrgang_id=?${bgFR}`, [r.id]) || 0;
          const cntAktiv = App.scalar(`SELECT COUNT(*) FROM schueler WHERE jahrgang_id=? AND aktiv=1${bgFR}`, [r.id]) || 0;
          return `<tr>
          <td><strong>${esc(r.bezeichnung)}</strong></td>
          <td>${esc(r.typ)}</td>
          <td>${r.jahr}</td>
          <td>${r.pruefungstermin ? formatDate(r.pruefungstermin) : '–'}</td>
          <td>${cntAktiv > 0 ? `<a href="#" onclick="StammdatenTab._azubiFilter={jahrgang:${r.id}};StammdatenTab._azubiSearch='';StammdatenTab._azubiPage=0;StammdatenTab.show('azubis');return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline" title="Azubis dieses Jahrgangs anzeigen">${cntAktiv}</a>` : '0'}${cnt !== cntAktiv ? ` <span style="color:var(--clr-text-light);font-size:11px">(+${cnt-cntAktiv} inaktiv)</span>` : ''}</td>
          <td class="btn-group">
            <button class="btn btn-sm btn-secondary" onclick="App.setJgFilterDirect(${r.id});App.navigate('dashboard')" title="Dashboard auf diesen Jahrgang filtern">▤ Filtern</button>
            <button class="btn-icon btn-sm" onclick="StammdatenTab.deleteJahrgang(${r.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
          </td>
        </tr>`;}).join('')}
      </tbody></table></div>`;
  },

  addJahrgang() {
    const year = new Date().getFullYear();
    App.openModal('Neuer Abschlussjahrgang', `
      <div class="form-row">
        <div class="form-group"><label>Typ</label><select class="form-control" id="mJgTyp" onchange="document.getElementById('mJgBez').value=this.value.charAt(0)+document.getElementById('mJgJahr').value">
          <option value="Sommer">Sommer</option>
          <option value="Winter">Winter</option>
        </select></div>
        <div class="form-group"><label>Jahr</label><input type="number" class="form-control" id="mJgJahr" value="${year+2}" min="2020" max="2040" onchange="document.getElementById('mJgBez').value=document.getElementById('mJgTyp').value.charAt(0)+this.value"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Bezeichnung</label><input class="form-control" id="mJgBez" value="S${year+2}"></div>
        <div class="form-group"><label>Prüfungstermin</label><input type="date" class="form-control" id="mJgPruef"></div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.saveJahrgang()">Speichern</button>`);
  },
  saveJahrgang() {
    const bez = document.getElementById('mJgBez').value.trim();
    const typ = document.getElementById('mJgTyp').value;
    const jahr = parseInt(document.getElementById('mJgJahr').value);
    const pruef = document.getElementById('mJgPruef').value;
    if (!bez || !jahr) return App.toast('Bitte Bezeichnung und Jahr ausfüllen', 'error');
    App.run('INSERT INTO abschlussjahrgaenge (bezeichnung, typ, jahr, pruefungstermin) VALUES (?,?,?,?)', [bez, typ, jahr, pruef]);
    App.closeModal();
    // (jahrgang refresh no longer needed)
    StammdatenTab.show('jahrgaenge');
    App.toast('Jahrgang angelegt', 'success');
  },
  deleteJahrgang(id) {
    if (!confirm('Jahrgang wirklich löschen?')) return;
    App.deleteJahrgangKaskade(id);
    // (jahrgang refresh no longer needed)
    StammdatenTab.show('jahrgaenge');
  },

  schulen(c) {
    const gf = App.gf('schulen');
    const sfr = App.filterFachrichtungen.length ? ` AND fachrichtung_id IN (${App.filterFachrichtungen.join(',')})` : '';
    const sjg = App.filterJahrgang.length ? ` AND jahrgang_id IN (${App.filterJahrgang.join(',')})` : '';
    const rows = App.query(`SELECT bs.*, 
      (SELECT COUNT(*) FROM klassen kq WHERE kq.berufsschule_id=bs.id${sfr.replace('fachrichtung_id','kq.fachrichtung_id')}${sjg.replace('jahrgang_id','kq.jahrgang_id')}) as klassen_cnt,
      (SELECT COUNT(*) FROM schueler sq JOIN klassen kq ON sq.klasse_id=kq.id WHERE kq.berufsschule_id=bs.id AND sq.aktiv=1${sfr.replace('fachrichtung_id','sq.fachrichtung_id')}${sjg.replace('jahrgang_id','sq.jahrgang_id')}) as schueler_cnt
      FROM berufsschulen bs WHERE 1=1${gf} ORDER BY bs.name`);
    c.innerHTML = `
      <div class="toolbar"><div class="toolbar-left">
        <span style="font-size:13px;color:var(--clr-text-light)">${rows.length} Schulen</span>
      </div><div class="toolbar-right">
        <button class="btn btn-primary" onclick="StammdatenTab.addSchule()">+ Neue Berufsschule</button>
      </div></div>
      <div id="bulkBarSchulen" style="display:none;padding:8px 12px;background:var(--clr-forest);color:white;border-radius:var(--radius);margin-bottom:8px;align-items:center;gap:8px;font-size:13px">
        <strong><span id="bulkCntSch">0</span> ausgewählt</strong>
        <span style="opacity:0.4">│</span>
        <button class="btn btn-sm" style="background:var(--clr-red);color:white;border:none" onclick="StammdatenTab.bulkDeleteSchulen()">Löschen</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="StammdatenTab.bulkMergeSchulen()">Zusammenführen</button>
        <span style="margin-left:auto;opacity:0.6;cursor:pointer" onclick="document.querySelectorAll('.chk-sch').forEach(c=>c.checked=false);StammdatenTab.updateBulkSchulen()">✕</span>
      </div>
      <div class="card"><table class="data-table"><thead><tr>
        <th style="width:30px"><input type="checkbox" onchange="document.querySelectorAll('.chk-sch').forEach(c=>c.checked=this.checked);StammdatenTab.updateBulkSchulen()"></th>
        <th>Name</th><th>Ort</th><th>Ansprechpartner</th><th>Kontakt</th><th>Klassen</th><th>Schüler</th><th>Aktionen</th>
      </tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td><input type="checkbox" class="chk-sch" value="${r.id}" onchange="StammdatenTab.updateBulkSchulen()"></td>
          <td><strong>${esc(r.name)}</strong></td>
          <td>${esc(r.ort)}</td>
          <td>${esc(r.ansprechpartner)}</td>
          <td>${r.email ? `<a href="mailto:${esc(r.email)}" style="color:var(--clr-forest)">${esc(r.email)}</a>` : ''}${r.telefon ? `${r.email ? '<br>' : ''}<a href="tel:${esc(r.telefon)}" style="color:var(--clr-text-light)">${esc(r.telefon)}</a>` : ''}</td>
          <td>${r.klassen_cnt > 0 ? `<a href="#" onclick="StammdatenTab.showSchuleKlassen(${r.id});return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline" title="Klassen anzeigen">${r.klassen_cnt}</a>` : '0'}</td>
          <td>${r.schueler_cnt > 0 ? `<a href="#" onclick="StammdatenTab.showSchuleAzubis(${r.id});return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline">${r.schueler_cnt}</a>` : '0'}</td>
          <td class="btn-group">
            <button class="btn-icon btn-sm" onclick="StammdatenTab.editSchule(${r.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
            <button class="btn-icon btn-sm" onclick="StammdatenTab.deleteSchule(${r.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>`;
  },
  updateBulkSchulen() {
    const ids = [...document.querySelectorAll('.chk-sch:checked')].map(c=>parseInt(c.value));
    const bar = document.getElementById('bulkBarSchulen');
    document.getElementById('bulkCntSch').textContent = ids.length;
    bar.style.display = ids.length > 0 ? 'flex' : 'none';
  },
  bulkDeleteSchulen() {
    const ids = [...document.querySelectorAll('.chk-sch:checked')].map(c=>parseInt(c.value));
    if (!ids.length) return;
    if (!confirm(`${ids.length} Schulen löschen? Zugehörige Klassen werden ebenfalls gelöscht.`)) return;
    ids.forEach(id => {
      App.run('DELETE FROM klassen WHERE berufsschule_id=?', [id]);
      App.deleteSchuleKaskade(id);
    });
    App.toast(`${ids.length} Schulen gelöscht`, 'success');
    StammdatenTab.show('schulen');
  },
  bulkMergeSchulen() {
    const ids = [...document.querySelectorAll('.chk-sch:checked')].map(c=>parseInt(c.value));
    if (ids.length < 2) return App.toast('Mindestens 2 Schulen zum Zusammenführen auswählen', 'warning');
    const schulen = ids.map(id => App.query('SELECT * FROM berufsschulen WHERE id=?',[id])[0]).filter(Boolean);
    App.openModal('Schulen zusammenführen', `
      <p style="font-size:13px;margin-bottom:12px">Alle Klassen und Schüler der ausgewählten Schulen werden auf <strong>eine Ziel-Schule</strong> übertragen. Die anderen werden gelöscht.</p>
      <div class="form-group"><label>Ziel-Schule (bleibt bestehen)</label><select class="form-control" id="mMergeTarget">
        ${schulen.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.doMergeSchulen([${ids}])">Zusammenführen</button>`);
  },
  async doMergeSchulen(ids) {
    const targetId = parseInt(document.getElementById('mMergeTarget').value);
    const others = ids.filter(id => id !== targetId);
    // Sicherheits-Backup vor Zusammenführung
    if (App.createBackup) try { await App.createBackup(); } catch(e) { console.warn('Backup:', e); }
    others.forEach(id => {
      App.run('UPDATE klassen SET berufsschule_id=? WHERE berufsschule_id=?', [targetId, id]);
      App.deleteSchuleKaskade(id);
    });
    App.closeModal();
    App.toast(`${others.length} Schulen in Ziel zusammengeführt`, 'success');
    StammdatenTab.show('schulen');
  },
  addSchule() {
    App.openModal('Neue Berufsschule', `
      <div class="modal-tabs">
        <button class="modal-tab-btn active" onclick="_switchModalTab('mSchTab1',this)">Stammdaten</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mSchTab2',this)">Ansprechpartner</button>
      </div>
      <div id="mSchTab1" class="modal-tab-content active">
        <div class="form-group"><label>Name *</label><input class="form-control" id="mSchName"></div>
        <div class="form-row">
          <div class="form-group"><label>Ort</label><input class="form-control" id="mSchOrt"></div>
          <div class="form-group"><label>Telefon</label><input class="form-control" id="mSchTel"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>E-Mail (Hauptadresse)</label><input class="form-control" id="mSchEmail" placeholder="sekretariat@schule.de"></div>
          <div class="form-group"><label>CC-Adressen (kommagetrennt)</label><input class="form-control" id="mSchEmailCC" placeholder="lehrer@schule.de"></div>
        </div>
        <div class="form-group"><label>Hauptansprechpartner</label><input class="form-control" id="mSchAP"></div>
      </div>
      <div id="mSchTab2" class="modal-tab-content">
        <p style="font-size:11px;color:var(--clr-text-light);margin-bottom:8px">Beliebig viele Ansprechpartner mit Kontaktdaten hinterlegen:</p>
        <div id="mSchAPList"></div>
        <button class="btn btn-sm btn-secondary" style="margin-top:4px" onclick="StammdatenTab._addAPRow()">+ Ansprechpartner</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.saveSchule()">Speichern</button>`);
    _makeModalWide();
  },
  _addAPRow() {
    const list = document.getElementById('mSchAPList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'form-row';
    row.style = 'margin-bottom:4px;align-items:center;flex-wrap:wrap';
    row.innerHTML = '<input class="form-control mSchAPName" placeholder="Name" style="flex:1;min-width:100px;font-size:12px"><input class="form-control mSchAPRole" placeholder="Beschreibung/Rolle" style="flex:1;min-width:100px;font-size:12px"><input class="form-control mSchAPEmail" placeholder="E-Mail" style="flex:1;min-width:100px;font-size:12px"><input class="form-control mSchAPTel" placeholder="Telefon" style="flex:1;min-width:90px;font-size:12px"><input class="form-control mSchAPMobil" placeholder="Mobil" style="flex:1;min-width:90px;font-size:12px"><button class="btn btn-sm" style="color:var(--clr-red);padding:2px 6px" onclick="this.closest(\'.form-row\').remove()">&#10005;</button>';
    list.appendChild(row);
  },
  saveSchule(id) {
    const n = document.getElementById('mSchName').value.trim();
    if (!n) return App.toast('Name ist Pflichtfeld', 'error');
    const o = document.getElementById('mSchOrt').value.trim();
    const ap = document.getElementById('mSchAP').value.trim();
    const em = document.getElementById('mSchEmail').value.trim();
    const tel = document.getElementById('mSchTel').value.trim();
    const cc = document.getElementById('mSchEmailCC')?.value?.trim() || '';
    // Collect Ansprechpartner list
    const apNames = document.querySelectorAll('.mSchAPName');
    const apRoles = document.querySelectorAll('.mSchAPRole');
    const apEmails = document.querySelectorAll('.mSchAPEmail');
    const apTels = document.querySelectorAll('.mSchAPTel');
    const apMobils = document.querySelectorAll('.mSchAPMobil');
    const apJson = [];
    apNames.forEach((el, i) => {
      const name = el.value.trim();
      if (name) apJson.push({ name, rolle: apRoles[i]?.value?.trim()||'', email: apEmails[i]?.value?.trim()||'', telefon: apTels[i]?.value?.trim()||'', mobil: apMobils[i]?.value?.trim()||'' });
    });
    const apJsonStr = JSON.stringify(apJson);
    if (id) {
      App.run('UPDATE berufsschulen SET name=?,ort=?,ansprechpartner=?,email=?,telefon=?,email_cc=?,ansprechpartner_json=? WHERE id=?', [n,o,ap,em,tel,cc,apJsonStr,id]);
    } else {
      App.run('INSERT INTO berufsschulen (name,ort,ansprechpartner,email,telefon,email_cc,ansprechpartner_json) VALUES (?,?,?,?,?,?,?)', [n,o,ap,em,tel,cc,apJsonStr]);
    }
    App.closeModal();
    StammdatenTab.show('schulen');
    App.toast('Berufsschule gespeichert', 'success');
  },
  editSchule(id) {
    const r = App.query('SELECT * FROM berufsschulen WHERE id=?', [id])[0];
    const apList = (() => { try { return JSON.parse(r.ansprechpartner_json || '[]'); } catch(e) { return []; } })();
    App.openModal('Berufsschule bearbeiten', `
      <div class="modal-tabs">
        <button class="modal-tab-btn active" onclick="_switchModalTab('mSchTab1',this)">Stammdaten</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mSchTab2',this)">Ansprechpartner <span style="font-size:10px;color:var(--clr-text-light)">(${apList.length})</span></button>
      </div>
      <div id="mSchTab1" class="modal-tab-content active">
        <div class="form-group"><label>Name *</label><input class="form-control" id="mSchName" value="${esc(r.name)}"></div>
        <div class="form-row">
          <div class="form-group"><label>Ort</label><input class="form-control" id="mSchOrt" value="${esc(r.ort)}"></div>
          <div class="form-group"><label>Telefon</label><input class="form-control" id="mSchTel" value="${esc(r.telefon)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>E-Mail (Hauptadresse)</label><input class="form-control" id="mSchEmail" value="${esc(r.email)}" placeholder="sekretariat@schule.de"></div>
          <div class="form-group"><label>CC-Adressen (kommagetrennt)</label><input class="form-control" id="mSchEmailCC" value="${esc(r.email_cc || '')}" placeholder="lehrer@schule.de, fachbereich@schule.de"></div>
        </div>
        <div class="form-group"><label>Hauptansprechpartner (Kurzform)</label><input class="form-control" id="mSchAP" value="${esc(r.ansprechpartner)}"></div>
      </div>
      <div id="mSchTab2" class="modal-tab-content">
        <p style="font-size:11px;color:var(--clr-text-light);margin-bottom:8px">Beliebig viele Ansprechpartner mit Kontaktdaten hinterlegen:</p>
        <div id="mSchAPList" style="margin-top:6px">
          ${apList.map(ap => `<div class="form-row" style="margin-bottom:4px;align-items:center;flex-wrap:wrap">
            <input class="form-control mSchAPName" value="${esc(ap.name||'')}" placeholder="Name" style="flex:1;min-width:100px;font-size:12px">
            <input class="form-control mSchAPRole" value="${esc(ap.rolle||'')}" placeholder="Beschreibung/Rolle" style="flex:1;min-width:100px;font-size:12px">
            <input class="form-control mSchAPEmail" value="${esc(ap.email||'')}" placeholder="E-Mail" style="flex:1;min-width:100px;font-size:12px">
            <input class="form-control mSchAPTel" value="${esc(ap.telefon||'')}" placeholder="Telefon" style="flex:1;min-width:90px;font-size:12px">
            <input class="form-control mSchAPMobil" value="${esc(ap.mobil||'')}" placeholder="Mobil" style="flex:1;min-width:90px;font-size:12px">
            <button class="btn btn-sm" style="color:var(--clr-red);padding:2px 6px" onclick="this.closest('.form-row').remove()">&#10005;</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-sm btn-secondary" style="margin-top:4px" onclick="StammdatenTab._addAPRow()">+ Ansprechpartner</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.saveSchule(${id})">Speichern</button>`);
    _makeModalWide();
  },
  deleteSchule(id) {
    if (!confirm('Berufsschule löschen?')) return;
    App.deleteSchuleKaskade(id);
    StammdatenTab.show('schulen');
  },

  klassen(c) {
    const gf = App.gf('klassen');
    const rows = App.query(`SELECT k.*, bs.name as schule, 
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      j.bezeichnung as jahrgang
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN fachrichtungen f ON k.fachrichtung_id=f.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      WHERE 1=1${gf}
      ORDER BY bs.name, j.jahr DESC, k.klassenbezeichnung`);
    c.innerHTML = `
      <div class="toolbar"><div class="toolbar-left">
        <span style="font-size:13px;color:var(--clr-text-light)">${rows.length} Klassen</span>
      </div><div class="toolbar-right">
        <button class="btn btn-primary" onclick="StammdatenTab.addKlasse()">+ Neue Klasse</button>
      </div></div>
      <div id="bulkBarKlassen" style="display:none;padding:8px 12px;background:var(--clr-forest);color:white;border-radius:var(--radius);margin-bottom:8px;align-items:center;gap:8px;font-size:13px">
        <strong><span id="bulkCntKl">0</span> ausgewählt</strong>
        <span style="opacity:0.4">│</span>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="StammdatenTab.bulkMoveKlassen()">Schule ändern</button>
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:white;border:none" onclick="StammdatenTab.bulkSetJahrgangKlassen()">Jahrgang ändern</button>
        <button class="btn btn-sm" style="background:var(--clr-red);color:white;border:none" onclick="StammdatenTab.bulkDeleteKlassen()">Löschen</button>
        <span style="margin-left:auto;opacity:0.6;cursor:pointer" onclick="document.querySelectorAll('.chk-kl').forEach(c=>c.checked=false);StammdatenTab.updateBulkKlassen()">✕</span>
      </div>
      <div class="card"><table class="data-table"><thead><tr>
        <th style="width:30px"><input type="checkbox" onchange="document.querySelectorAll('.chk-kl').forEach(c=>c.checked=this.checked);StammdatenTab.updateBulkKlassen()"></th>
        <th>Berufsschule</th><th>Jahrgang</th><th>LJ</th><th>Fachrichtung</th><th>Bezeichnung</th><th>Schüler</th><th>Aktionen</th>
      </tr></thead><tbody>
        ${rows.map(r => {
          const cnt = App.scalar('SELECT COUNT(*) FROM schueler WHERE klasse_id=?', [r.id]) || 0;
          return `<tr>
            <td><input type="checkbox" class="chk-kl" value="${r.id}" onchange="StammdatenTab.updateBulkKlassen()"></td>
            <td><a href="#" onclick="StammdatenTab.showSchuleKlassen(${r.berufsschule_id});return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline" title="Klassen dieser Schule">${esc(r.schule)}</a></td>
            <td>${esc(r.jahrgang || '–')}</td>
            <td>${r.lehrjahr || '–'}</td>
            <td>${esc(r.fachrichtung || '–')}</td>
            <td>${esc(r.klassenbezeichnung)}</td>
            <td>${cnt > 0 ? `<a href="#" onclick="StammdatenTab.showKlasseAzubis(${r.id});return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline" title="Schüler anzeigen">${cnt}</a>` : '0'}</td>
            <td class="btn-group">
              <button class="btn-icon btn-sm" onclick="StammdatenTab.editKlasse(${r.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
              <button class="btn-icon btn-sm" onclick="StammdatenTab.deleteKlasse(${r.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
            </td>
          </tr>`}).join('')}
      </tbody></table></div>`;
  },
  updateBulkKlassen() {
    const ids = [...document.querySelectorAll('.chk-kl:checked')].map(c=>parseInt(c.value));
    const bar = document.getElementById('bulkBarKlassen');
    document.getElementById('bulkCntKl').textContent = ids.length;
    bar.style.display = ids.length > 0 ? 'flex' : 'none';
  },
  bulkDeleteKlassen() {
    const ids = [...document.querySelectorAll('.chk-kl:checked')].map(c=>parseInt(c.value));
    if (!ids.length) return;
    const total = ids.reduce((s,id) => s + (App.scalar('SELECT COUNT(*) FROM schueler WHERE klasse_id=?',[id])||0), 0);
    if (!confirm(`${ids.length} Klassen löschen?${total ? ` ${total} Schüler werden entkoppelt.` : ''}`)) return;
    ids.forEach(id => {
      App.run('UPDATE schueler SET klasse_id=NULL WHERE klasse_id=?', [id]);
      App.run('DELETE FROM kontrolltermin_klassen WHERE klasse_id=?', [id]);
      App.deleteKlasseKaskade(id);
    });
    App.toast(`${ids.length} Klassen gelöscht`, 'success');
    StammdatenTab.show('klassen');
  },
  bulkMoveKlassen() {
    const ids = [...document.querySelectorAll('.chk-kl:checked')].map(c=>parseInt(c.value));
    if (!ids.length) return;
    const schulen = App.query('SELECT * FROM berufsschulen ORDER BY name');
    App.openModal(`${ids.length} Klassen → Schule ändern`, `
      <div class="form-group"><label>Neue Berufsschule</label><select class="form-control" id="mBulkKlSchule">
        ${schulen.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.doBulkMoveKlassen([${ids}])">Zuordnen</button>`);
  },
  doBulkMoveKlassen(ids) {
    const sid = document.getElementById('mBulkKlSchule').value;
    ids.forEach(id => App.run('UPDATE klassen SET berufsschule_id=? WHERE id=?', [sid, id]));
    App.closeModal();
    App.toast(`${ids.length} Klassen verschoben`, 'success');
    StammdatenTab.show('klassen');
  },
  bulkSetJahrgangKlassen() {
    const ids = [...document.querySelectorAll('.chk-kl:checked')].map(c=>parseInt(c.value));
    if (!ids.length) return;
    const jgs = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ');
    App.openModal(`${ids.length} Klassen → Jahrgang ändern`, `
      <div class="form-group"><label>Neuer Jahrgang</label><select class="form-control" id="mBulkKlJG">
        ${jgs.map(j => `<option value="${j.id}">${esc(j.bezeichnung)}</option>`).join('')}
      </select></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.doBulkJGKlassen([${ids}])">Zuordnen</button>`);
  },
  doBulkJGKlassen(ids) {
    const jgId = document.getElementById('mBulkKlJG').value;
    ids.forEach(id => App.run('UPDATE klassen SET jahrgang_id=? WHERE id=?', [jgId, id]));
    App.closeModal();
    App.toast(`${ids.length} Klassen aktualisiert`, 'success');
    StammdatenTab.show('klassen');
  },
  addKlasse() {
    const gfSch = App.gf('schulen');
    const schulen = App.query(`SELECT * FROM berufsschulen WHERE 1=1${gfSch} ORDER BY name`);
    const bgFR = App.filterFachrichtungen.length ? ` WHERE id IN (${App.filterFachrichtungen.join(',')})` : '';
    const frs = App.query(`SELECT * FROM fachrichtungen${bgFR} ORDER BY typ, bezeichnung`);
    const jgs = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ');
    App.openModal('Neue Klasse', `
      <div class="form-group"><label>Berufsschule</label><select class="form-control" id="mKlSchule">
        ${schulen.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
      </select></div>
      <div class="form-row">
        <div class="form-group"><label>Jahrgang (AP)</label><select class="form-control" id="mKlJG">
          <option value="">–</option>
          ${jgs.map(j => `<option value="${j.id}" ${j.aktiv?'selected':''}>${esc(j.bezeichnung)}${j.typ ? ' ('+j.typ+' '+j.jahr+')' : ''}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Fachrichtung</label><select class="form-control" id="mKlFR">
          <option value="">– Alle –</option>
          ${frs.map(f => `<option value="${f.id}">${esc(f.typ + ': ' + f.bezeichnung)} (${f.code})</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Lehrjahr (optional, Info)</label><select class="form-control" id="mKlLJ">
          <option value="">–</option><option value="1">1. Lehrjahr</option><option value="2">2. Lehrjahr</option><option value="3">3. Lehrjahr</option>
        </select></div>
        <div class="form-group"><label>Klassenbezeichnung</label><input class="form-control" id="mKlBez" placeholder="z.B. GaLaBau S2028"></div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.saveKlasse()">Speichern</button>`);
  },
  saveKlasse(id) {
    const bs = document.getElementById('mKlSchule').value;
    const lj = document.getElementById('mKlLJ').value || null;
    const fr = document.getElementById('mKlFR').value || null;
    const bez = document.getElementById('mKlBez').value.trim();
    const jg = document.getElementById('mKlJG')?.value || null;
    if (!bs) return App.toast('Bitte Schule wählen', 'error');
    if (id) {
      App.run('UPDATE klassen SET berufsschule_id=?,jahrgang_id=?,lehrjahr=?,fachrichtung_id=?,klassenbezeichnung=? WHERE id=?', [bs,jg,lj,fr,bez,id]);
    } else {
      App.run('INSERT INTO klassen (berufsschule_id,jahrgang_id,lehrjahr,fachrichtung_id,klassenbezeichnung) VALUES (?,?,?,?,?)',
        [bs, jg, lj, fr, bez]);
    }
    App.closeModal();
    StammdatenTab.show('klassen');
    App.toast('Klasse gespeichert', 'success');
  },
  editKlasse(id) {
    const r = App.query('SELECT * FROM klassen WHERE id=?', [id])[0];
    const gfSch = App.gf('schulen');
    let schulen = App.query(`SELECT * FROM berufsschulen WHERE 1=1${gfSch} ORDER BY name`);
    if (r.berufsschule_id && !schulen.find(s => s.id === r.berufsschule_id)) {
      const cur = App.query('SELECT * FROM berufsschulen WHERE id=?', [r.berufsschule_id])[0];
      if (cur) schulen.unshift(cur);
    }
    const bgFR = App.filterFachrichtungen.length ? ` WHERE id IN (${App.filterFachrichtungen.join(',')})` : '';
    let frs = App.query(`SELECT * FROM fachrichtungen${bgFR} ORDER BY typ, bezeichnung`);
    if (r.fachrichtung_id && !frs.find(f => f.id === r.fachrichtung_id)) {
      const cur = App.query('SELECT * FROM fachrichtungen WHERE id=?', [r.fachrichtung_id])[0];
      if (cur) frs.unshift(cur);
    }
    const jgs = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC, typ');
    App.openModal('Klasse bearbeiten', `
      <div class="form-group"><label>Berufsschule</label><select class="form-control" id="mKlSchule">
        ${schulen.map(s => `<option value="${s.id}" ${s.id===r.berufsschule_id?'selected':''}>${esc(s.name)}</option>`).join('')}
      </select></div>
      <div class="form-row">
        <div class="form-group"><label>Jahrgang (AP)</label><select class="form-control" id="mKlJG">
          <option value="">–</option>
          ${jgs.map(j => `<option value="${j.id}" ${j.id===r.jahrgang_id?'selected':''}>${esc(j.bezeichnung)}${j.typ ? ' ('+j.typ+' '+j.jahr+')' : ''}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Fachrichtung</label><select class="form-control" id="mKlFR">
          <option value="">– Alle –</option>
          ${frs.map(f => `<option value="${f.id}" ${f.id===r.fachrichtung_id?'selected':''}>${esc(f.typ + ': ' + f.bezeichnung)} (${f.code})</option>`).join('')}
        </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Lehrjahr (optional, Info)</label><select class="form-control" id="mKlLJ">
          <option value="" ${!r.lehrjahr?'selected':''}>–</option>
          <option value="1" ${r.lehrjahr===1?'selected':''}>1. Lehrjahr</option>
          <option value="2" ${r.lehrjahr===2?'selected':''}>2. Lehrjahr</option>
          <option value="3" ${r.lehrjahr===3?'selected':''}>3. Lehrjahr</option>
        </select></div>
        <div class="form-group"><label>Klassenbezeichnung</label><input class="form-control" id="mKlBez" value="${esc(r.klassenbezeichnung)}"></div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.saveKlasse(${id})">Speichern</button>`);
  },
  deleteKlasse(id) {
    if (!confirm('Klasse löschen?')) return;
    App.run('DELETE FROM kontrolltermin_klassen WHERE klasse_id=?', [id]);
    App.deleteKlasseKaskade(id);
    StammdatenTab.show('klassen');
  },

  pruefer(c) {
    const rows = App.query('SELECT * FROM pruefer ORDER BY name');
    c.innerHTML = `
      <div class="toolbar"><div class="toolbar-left"></div><div class="toolbar-right">
        <button class="btn btn-primary" onclick="StammdatenTab.addPruefer()">+ Neuer Prüfer</button>
      </div></div>
      <div class="card"><table class="data-table"><thead><tr><th>Name</th><th>E-Mail</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td><strong>${esc(r.name)}</strong></td>
          <td>${esc(r.email)}</td>
          <td>${r.aktiv ? '<span class="badge-status badge-ok">Aktiv</span>' : '<span class="badge-status" style="background:#eee">Inaktiv</span>'}</td>
          <td><button class="btn-icon btn-sm" onclick="StammdatenTab.deletePruefer(${r.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>
        </tr>`).join('')}
      </tbody></table></div>`;
  },
  addPruefer() {
    App.openModal('Neuer Prüfer', `
      <div class="form-group"><label>Name</label><input class="form-control" id="mPrName"></div>
      <div class="form-group"><label>E-Mail</label><input class="form-control" id="mPrEmail"></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.savePruefer()">Speichern</button>`);
  },
  savePruefer() {
    const n = document.getElementById('mPrName').value.trim();
    if (!n) return App.toast('Name ist Pflichtfeld', 'error');
    App.run('INSERT INTO pruefer (name,email) VALUES (?,?)', [n, document.getElementById('mPrEmail').value.trim()]);
    App.closeModal();
    StammdatenTab.show('pruefer');
  },
  deletePruefer(id) {
    if (!confirm('Prüfer löschen?')) return;
    App.run('DELETE FROM pruefer WHERE id=?', [id]);
    StammdatenTab.show('pruefer');
  },

  // ════════════════════════════════════════
  //  BETRIEBE
  // ════════════════════════════════════════
  // ════════════════════════════════════════
  //  BLOCKPLÄNE
  // ════════════════════════════════════════
  blockplan(c) {
    const schulen = App.query('SELECT * FROM berufsschulen ORDER BY name');
    const currentSJ = (() => { const now = new Date(); return now.getMonth() >= 7 ? `${now.getFullYear()}/${now.getFullYear()+1}` : `${now.getFullYear()-1}/${now.getFullYear()}`; })();

    c.innerHTML = `
      <div class="toolbar"><div class="toolbar-left" style="gap:8px">
        <select class="form-control" id="bpSchule" style="width:auto" onchange="StammdatenTab._renderBlockplanGrid()">
          ${schulen.map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.ort)})</option>`).join('')}
        </select>
        <select class="form-control" id="bpSJ" style="width:120px" onchange="StammdatenTab._renderBlockplanGrid()">
          <option value="${currentSJ}">${currentSJ}</option>
          <option value="${parseInt(currentSJ)+1}/${parseInt(currentSJ)+2}">${parseInt(currentSJ)+1}/${parseInt(currentSJ)+2}</option>
        </select>
      </div><div class="toolbar-right">
        <button class="btn btn-sm btn-secondary" onclick="StammdatenTab._clearBlockplan()">Zurücksetzen</button>
      </div></div>
      <div class="card" style="padding:12px">
        <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
          Klicken Sie auf eine Kalenderwoche um die Anwesenheit zu markieren (grün = Schüler anwesend). Halten Sie die Maus gedrückt um mehrere KWs zu markieren.
        </p>
        <div id="blockplanGrid"></div>
      </div>
      <div class="card" style="margin-top:12px;padding:12px">
        <strong style="font-size:13px;color:var(--clr-forest)">Empfohlene Kontrollwochen</strong>
        <div id="blockplanEmpfehlung" style="margin-top:8px;font-size:12px"></div>
      </div>`;
    setTimeout(() => this._renderBlockplanGrid(), 50);
  },

  _renderBlockplanGrid() {
    const bsId = parseInt(document.getElementById('bpSchule')?.value);
    const sj = document.getElementById('bpSJ')?.value || '';
    if (!bsId) return;

    const grid = document.getElementById('blockplanGrid');
    if (!grid) return;

    // Parse Schuljahr "2025/2026" → years
    const sjParts = sj.split('/');
    const year1 = parseInt(sjParts[0]) || 2025; // Sep-Dec
    const year2 = parseInt(sjParts[1]) || year1 + 1; // Jan-Jul

    // ISO 8601: Monday of a given KW in a given year
    function kwToMonday(kw, year) {
      // Jan 4 is always in ISO week 1
      const jan4 = new Date(year, 0, 4);
      const dow = (jan4.getDay() + 6) % 7; // Mon=0
      const week1Mon = new Date(jan4);
      week1Mon.setDate(jan4.getDate() - dow);
      const monday = new Date(week1Mon);
      monday.setDate(week1Mon.getDate() + (kw - 1) * 7);
      return monday;
    }

    // Build KW list with real dates: KW 36-52 → year1, KW 1-35 → year2
    const kwList = [];
    for (let kw = 36; kw <= 52; kw++) kwList.push({ kw, year: year1, date: kwToMonday(kw, year1) });
    // Some years have KW 53
    const kw53test = kwToMonday(53, year1);
    if (kw53test.getFullYear() === year1 || (kw53test.getMonth() === 11 && kw53test.getDate() >= 28)) {
      kwList.push({ kw: 53, year: year1, date: kwToMonday(53, year1) });
    }
    for (let kw = 1; kw <= 35; kw++) kwList.push({ kw, year: year2, date: kwToMonday(kw, year2) });

    const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

    let html = '';
    [1,2,3].forEach(lj => {
      const present = new Set(App.query('SELECT kalenderwoche FROM blockplan WHERE berufsschule_id=? AND schuljahr=? AND lehrjahr=?', [bsId, sj, lj]).map(r => r.kalenderwoche));
      let lastMonth = -1;
      html += `<div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:12px;color:var(--clr-forest);margin-bottom:4px">Lehrjahr ${lj} <span style="font-weight:400;color:var(--clr-text-light)">(${present.size} Wochen markiert)</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;user-select:none">
          ${kwList.map(({kw, year, date}) => {
            const isPresent = present.has(kw);
            const m = date.getMonth();
            const showMonth = m !== lastMonth;
            lastMonth = m;
            const dateStr = `${String(date.getDate()).padStart(2,'0')}.${String(m+1).padStart(2,'0')}.`;
            return `${showMonth ? `<div style="width:100%;font-size:9px;color:var(--clr-sage);font-weight:600;margin-top:4px">${monthNames[m]} ${year}</div>` : ''}
            <div class="bp-kw" data-lj="${lj}" data-kw="${kw}" 
              style="width:32px;height:28px;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;cursor:pointer;border:1px solid ${isPresent?'var(--clr-green)':'var(--clr-sand)'};background:${isPresent?'var(--clr-green-light)':'var(--clr-white)'};color:${isPresent?'var(--clr-green)':'var(--clr-text-light)'};font-weight:${isPresent?'700':'400'}"
              onmousedown="StammdatenTab._toggleBpKW(this)" onmouseenter="if(event.buttons===1)StammdatenTab._toggleBpKW(this)"
              title="KW ${kw} · ${dateStr}${year}"><span style="font-size:10px;line-height:1">${kw}</span><span style="font-size:7px;opacity:0.7">${dateStr}</span></div>`;
          }).join('')}
        </div>
      </div>`;
    });
    grid.innerHTML = html;
    this._updateBlockplanEmpfehlung(bsId, sj);
  },

  _toggleBpKW(el) {
    const bsId = parseInt(document.getElementById('bpSchule')?.value);
    const sj = document.getElementById('bpSJ')?.value || '';
    const lj = parseInt(el.dataset.lj);
    const kw = parseInt(el.dataset.kw);
    const exists = App.scalar('SELECT COUNT(*) FROM blockplan WHERE berufsschule_id=? AND schuljahr=? AND lehrjahr=? AND kalenderwoche=?', [bsId, sj, lj, kw]);
    if (exists) {
      App.run('DELETE FROM blockplan WHERE berufsschule_id=? AND schuljahr=? AND lehrjahr=? AND kalenderwoche=?', [bsId, sj, lj, kw]);
      el.style.background = 'var(--clr-white)'; el.style.borderColor = 'var(--clr-sand)';
      el.style.color = 'var(--clr-text-light)'; el.style.fontWeight = '400';
    } else {
      App.run('INSERT OR IGNORE INTO blockplan (berufsschule_id,schuljahr,lehrjahr,kalenderwoche) VALUES (?,?,?,?)', [bsId, sj, lj, kw]);
      el.style.background = 'var(--clr-green-light)'; el.style.borderColor = 'var(--clr-green)';
      el.style.color = 'var(--clr-green)'; el.style.fontWeight = '700';
    }
    this._updateBlockplanEmpfehlung(bsId, sj);
  },


  _clearBlockplan() {
    const bsId = parseInt(document.getElementById('bpSchule')?.value);
    const sj = document.getElementById('bpSJ')?.value || '';
    if (!confirm('Blockplan für diese Schule/Schuljahr komplett löschen?')) return;
    App.run('DELETE FROM blockplan WHERE berufsschule_id=? AND schuljahr=?', [bsId, sj]);
    this._renderBlockplanGrid();
    App.toast('Blockplan zurückgesetzt', 'success');
  },

  _updateBlockplanEmpfehlung(bsId, sj) {
    const el = document.getElementById('blockplanEmpfehlung');
    if (!el) return;
    // Find weeks where ALL lehrjahre are present
    const allLJ = App.query('SELECT DISTINCT lehrjahr FROM blockplan WHERE berufsschule_id=? AND schuljahr=?', [bsId, sj]).map(r => r.lehrjahr);
    if (!allLJ.length) { el.innerHTML = '<span style="color:var(--clr-text-light)">Noch keine Anwesenheitswochen markiert.</span>'; return; }

    const kwSets = {};
    allLJ.forEach(lj => {
      App.query('SELECT kalenderwoche FROM blockplan WHERE berufsschule_id=? AND schuljahr=? AND lehrjahr=?', [bsId, sj, lj]).forEach(r => {
        if (!kwSets[r.kalenderwoche]) kwSets[r.kalenderwoche] = new Set();
        kwSets[r.kalenderwoche].add(lj);
      });
    });

    // Weeks where all present, some, or single LJ
    const allPresent = [], somePresent = {};
    Object.entries(kwSets).forEach(([kw, ljs]) => {
      if (ljs.size === allLJ.length) allPresent.push(parseInt(kw));
      else ljs.forEach(lj => { if (!somePresent[lj]) somePresent[lj] = []; somePresent[lj].push(parseInt(kw)); });
    });
    allPresent.sort((a,b) => a-b);

    let html = '';
    if (allPresent.length) {
      html += `<div style="padding:6px 10px;background:var(--clr-green-light);border-radius:var(--radius);margin-bottom:6px">
        <strong>Alle Lehrjahre gleichzeitig anwesend:</strong> KW ${allPresent.join(', ')} <span style="color:var(--clr-text-light)">(${allPresent.length} Wochen)</span>
      </div>`;
    }
    allLJ.forEach(lj => {
      const kws = App.query('SELECT kalenderwoche FROM blockplan WHERE berufsschule_id=? AND schuljahr=? AND lehrjahr=?', [bsId, sj, lj]).map(r => r.kalenderwoche).sort((a,b)=>a-b);
      html += `<div style="font-size:11px;padding:2px 0">LJ ${lj}: ${kws.length} Wochen (KW ${kws.join(', ')})</div>`;
    });
    el.innerHTML = html;
  },

  // ════════════════════════════════════════
  //  BETRIEBE
  // ════════════════════════════════════════
  betriebe(c) {
    // Auto-link: create betriebe from unlinked ausbildungsstaette
    this._autoLinkBetriebe();

    const gf = App.gf('betriebe');
    const sfr = App.filterFachrichtungen.length ? ` AND fachrichtung_id IN (${App.filterFachrichtungen.join(',')})` : '';
    const sjg = App.filterJahrgang.length ? ` AND jahrgang_id IN (${App.filterJahrgang.join(',')})` : '';
    const rows = App.query(`SELECT b.*,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.betrieb_id=b.id AND sq.aktiv=1${sfr.replace('fachrichtung_id','sq.fachrichtung_id')}${sjg.replace('jahrgang_id','sq.jahrgang_id')}) as azubi_count,
      (SELECT COUNT(*) FROM kontrollergebnisse ke JOIN schueler sm ON ke.schueler_id=sm.id WHERE sm.betrieb_id=b.id AND ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung'${sfr.replace('fachrichtung_id','sm.fachrichtung_id')}${sjg.replace('jahrgang_id','sm.jahrgang_id')}) as maengel_count,
      (SELECT COUNT(*) FROM ausbilder au WHERE au.betrieb_id=b.id) as ausbilder_count
      FROM betriebe b WHERE 1=1${gf} ORDER BY b.name`);

    c.innerHTML = `
      <div class="toolbar"><div class="toolbar-left">
        <span style="font-size:12px;color:var(--clr-text-light)">${rows.length} Betriebe</span>
        <input class="form-control" placeholder="Betrieb suchen…" style="width:200px;padding:4px 8px;font-size:12px" oninput="StammdatenTab._filterBetriebe(this.value)">
      </div><div class="toolbar-right">
        <button class="btn btn-sm btn-secondary" onclick="StammdatenTab._autoLinkBetriebe(true);StammdatenTab.show('betriebe')">Auto-Verknüpfen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.addBetrieb()">+ Neuer Betrieb</button>
      </div></div>
      <div class="card"><table class="data-table"><thead><tr>
        <th>Name</th><th>Ort</th><th>E-Mail</th><th>Telefon</th><th>Azubis</th><th>Ausbilder</th><th>Mängel</th><th>Aktionen</th>
      </tr></thead><tbody id="betriebeTableBody">
        ${rows.map(b => `<tr data-search="${(b.name+' '+(b.vorname||'')+' '+(b.zusatzbezeichnung||'')+' '+b.ort+' '+b.email).toLowerCase()}">
          <td>
            ${b.zusatzbezeichnung ? `<div style="font-size:10px;color:var(--clr-text-light)">${esc(b.zusatzbezeichnung)}</div>` : ''}
            <strong>${esc((b.vorname ? b.vorname + ' ' : '') + b.name)}</strong>
            ${b.betriebsnummer ? `<div style="font-size:9px;color:var(--clr-sage)">BNr: ${esc(b.betriebsnummer)}</div>` : ''}
          </td>
          <td>${b.strasse ? `${esc(b.strasse)}<br>` : ''}${esc(b.plz)} ${esc(b.ort)}</td>
          <td>${b.email ? `<a href="mailto:${esc(b.email)}" style="color:var(--clr-blue)">${esc(b.email)}</a>` : '<span style="color:var(--clr-text-light)">–</span>'}</td>
          <td>${b.telefon ? `<a href="tel:${esc(b.telefon)}" style="color:var(--clr-text)">${esc(b.telefon)}</a>` : '<span style="color:var(--clr-text-light)">–</span>'}</td>
          <td>${b.azubi_count > 0 ? `<a href="#" onclick="StammdatenTab.showBetriebAzubis(${b.id});return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline;cursor:pointer" title="Azubis anzeigen">${b.azubi_count}</a>` : '<span style="color:var(--clr-text-light)">0</span>'}</td>
          <td>${b.ausbilder_count > 0 ? `<a href="#" onclick="StammdatenTab.showBetriebAusbilder(${b.id});return false" style="color:var(--clr-forest);text-decoration:underline;cursor:pointer">${b.ausbilder_count}</a>` : '<span style="color:var(--clr-text-light)">–</span>'}</td>
          <td data-sort="${b.maengel_count}">${b.maengel_count > 0 ? `<a href="#" onclick="StammdatenTab.showBetriebAzubis(${b.id},'maengel');return false" class="badge-status badge-overdue" style="cursor:pointer" title="Beanstandete Azubis">${b.maengel_count}</a>` : '–'}</td>
          <td class="btn-group">
            <button class="btn-icon btn-sm" onclick="StammdatenTab.editBetrieb(${b.id})" title="Bearbeiten">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            </button>
            ${b.azubi_count === 0 ? `<button class="btn-icon btn-sm" onclick="StammdatenTab.deleteBetrieb(${b.id})" title="Löschen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody></table></div>`;
  },

  _filterBetriebe(q) {
    q = q.toLowerCase().trim();
    document.querySelectorAll('#betriebeTableBody tr').forEach(r => {
      r.style.display = !q || r.dataset.search.includes(q) ? '' : 'none';
    });
  },

  // Auto-link: match schueler.ausbildungsstaette → betriebe by name
  _autoLinkBetriebe(showToast) {
    // Find schueler without betrieb_id but with ausbildungsstaette text
    const unlinked = App.query("SELECT id, ausbildungsstaette FROM schueler WHERE betrieb_id IS NULL AND ausbildungsstaette != '' AND aktiv=1");
    if (!unlinked.length) { if (showToast) App.toast('Alle Schüler sind bereits verknüpft', 'success'); return; }

    let linked = 0, created = 0, fehler = 0;
    unlinked.forEach(s => {
      const name = s.ausbildungsstaette.replace(/\s*\(.*\)$/, '').trim(); // Remove "(Ort)" suffix
      // Try exact match
      let b = App.query('SELECT id FROM betriebe WHERE name=?', [name])[0];
      // Try contains match
      if (!b) b = App.query('SELECT id FROM betriebe WHERE name LIKE ?', [`%${name}%`])[0];
      if (!b && name.length > 5) b = App.query('SELECT id FROM betriebe WHERE ? LIKE "%"||name||"%"', [name])[0];

      if (b) {
        App.run('UPDATE schueler SET betrieb_id=? WHERE id=?', [b.id, s.id]);
        linked++;
      } else {
        // Create minimal betrieb entry from name.
        // betriebsnummer ausdrücklich NULL: der Vorgabewert '' ist UNIQUE, der
        // zweite Betrieb ohne Nummer scheiterte und riss die ganze Schleife mit.
        try {
          App.run('INSERT INTO betriebe (name,betriebsnummer) VALUES (?,NULL)', [name]);
          const newId = App.scalar('SELECT last_insert_rowid()');
          App.run('UPDATE schueler SET betrieb_id=? WHERE id=?', [newId, s.id]);
          created++;
        } catch(e) {
          console.warn('Betrieb konnte nicht angelegt werden:', name, e.message);
          fehler++;
        }
      }
    });
    if (showToast) App.toast(`${linked} verknüpft, ${created} neue Betriebe erstellt` + (fehler ? `, ${fehler} fehlgeschlagen` : ''), fehler ? 'warning' : 'success');
  },

  addBetrieb() {
    App.openModal('Neuer Betrieb', `
      <div class="modal-tabs">
        <button class="modal-tab-btn active" onclick="_switchModalTab('mBeTab1',this)">Stammdaten</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mBeTab2',this)">Adresse & Kontakt</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mBeTab3',this)">Ausbilder</button>
      </div>
      <div id="mBeTab1" class="modal-tab-content active">
        <div class="form-row">
          <div class="form-group"><label>Betriebsname (Nachname) *</label><input class="form-control" id="mBeName"></div>
          <div class="form-group"><label>Betriebsvorname</label><input class="form-control" id="mBeVorname"></div>
        </div>
        <div class="form-group"><label>Zusatzbezeichnung</label><input class="form-control" id="mBeZusatz" placeholder="z.B. Gartenbau GmbH & Co. KG"></div>
        <div class="form-group"><label>Betriebsnummer</label><input class="form-control" id="mBeBnr"></div>
      </div>
      <div id="mBeTab2" class="modal-tab-content">
        <div class="form-row">
          <div class="form-group"><label>Straße</label><input class="form-control" id="mBeStr"></div>
          <div class="form-group" style="max-width:100px"><label>PLZ</label><input class="form-control" id="mBePlz"></div>
          <div class="form-group"><label>Ort</label><input class="form-control" id="mBeOrt"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>E-Mail</label><input class="form-control" id="mBeEmail" type="email"></div>
          <div class="form-group"><label>Telefon</label><input class="form-control" id="mBeTel"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fax</label><input class="form-control" id="mBeFax"></div>
          <div class="form-group"><label>Ansprechpartner</label><input class="form-control" id="mBeAP"></div>
        </div>
      </div>
      <div id="mBeTab3" class="modal-tab-content">
        <div id="mBeAusbilderList"></div>
        <button class="btn btn-sm btn-secondary" style="margin-top:4px" onclick="StammdatenTab._addAusbilderRow()">+ Ausbilder</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.saveBetrieb()">Speichern</button>`);
    _makeModalWide();
  },

  saveBetrieb() {
    const n = document.getElementById('mBeName').value.trim();
    if (!n) return App.toast('Name ist Pflichtfeld', 'error');
    const zusatz = document.getElementById('mBeZusatz')?.value?.trim()||'';
    // Doppelte Betriebsnummer vorab abfangen: sonst warf der INSERT eine
    // Ausnahme, das Fenster blieb offen und der Nutzer bekam keine Erklärung.
    const bnrNeu = document.getElementById('mBeBnr').value.trim();
    if (bnrNeu && App.scalar('SELECT COUNT(*) FROM betriebe WHERE betriebsnummer=?', [bnrNeu])) {
      return App.toast(`Betriebsnummer ${bnrNeu} ist bereits vergeben`, 'error');
    }
    App.run('INSERT INTO betriebe (name,vorname,zusatzbezeichnung,firma,betriebsnummer,strasse,plz,ort,email,telefon,fax,ansprechpartner) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [n, document.getElementById('mBeVorname')?.value?.trim()||'',
       zusatz, zusatz,
       document.getElementById('mBeBnr').value.trim() || null,
       document.getElementById('mBeStr').value.trim(), document.getElementById('mBePlz').value.trim(),
       document.getElementById('mBeOrt').value.trim(),
       document.getElementById('mBeEmail').value.trim(), document.getElementById('mBeTel').value.trim(),
       document.getElementById('mBeFax')?.value?.trim()||'',
       document.getElementById('mBeAP')?.value?.trim()||'']);
    // Save Ausbilder for new Betrieb
    const newId = App.scalar('SELECT id FROM betriebe WHERE rowid=last_insert_rowid()');
    if (newId) {
      document.querySelectorAll('.mAuNach').forEach((el, i) => {
        const nachname = el.value.trim();
        const vorname = document.querySelectorAll('.mAuVor')[i]?.value?.trim()||'';
        if (!nachname && !vorname) return;
        App.run('INSERT INTO ausbilder (betrieb_id,nachname,vorname,funktion,telefon,email,mobil) VALUES (?,?,?,?,?,?,?)',
          [newId, nachname, vorname,
           document.querySelectorAll('.mAuFunk')[i]?.value?.trim()||'',
           document.querySelectorAll('.mAuTel')[i]?.value?.trim()||'',
           document.querySelectorAll('.mAuEmail')[i]?.value?.trim()||'',
           document.querySelectorAll('.mAuMobil')[i]?.value?.trim()||'']);
      });
    }
    App.closeModal(); StammdatenTab.show('betriebe');
    App.toast('Betrieb angelegt', 'success');
  },

  editBetrieb(id) {
    const b = App.query('SELECT * FROM betriebe WHERE id=?', [id])[0];
    if (!b) return;
    const ausbilder = App.query('SELECT * FROM ausbilder WHERE betrieb_id=? ORDER BY nachname', [id]);
    App.openModal('Betrieb bearbeiten', `
      <div class="modal-tabs">
        <button class="modal-tab-btn active" onclick="_switchModalTab('mBeTab1',this)">Stammdaten</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mBeTab2',this)">Adresse & Kontakt</button>
        <button class="modal-tab-btn" onclick="_switchModalTab('mBeTab3',this)">Ausbilder <span style="font-size:10px;color:var(--clr-text-light)">(${ausbilder.length})</span></button>
      </div>
      <div id="mBeTab1" class="modal-tab-content active">
        <div class="form-row">
          <div class="form-group"><label>Betriebsname (Nachname) *</label><input class="form-control" id="mBeName" value="${esc(b.name)}"></div>
          <div class="form-group"><label>Betriebsvorname</label><input class="form-control" id="mBeVorname" value="${esc(b.vorname||'')}"></div>
        </div>
        <div class="form-group"><label>Zusatzbezeichnung</label><input class="form-control" id="mBeZusatz" value="${esc(b.zusatzbezeichnung||b.firma||'')}" placeholder="z.B. Gartenbau GmbH & Co. KG"></div>
        <div class="form-group"><label>Betriebsnummer</label><input class="form-control" id="mBeBnr" value="${esc(b.betriebsnummer)}"></div>
      </div>
      <div id="mBeTab2" class="modal-tab-content">
        <div class="form-row">
          <div class="form-group"><label>Straße</label><input class="form-control" id="mBeStr" value="${esc(b.strasse)}"></div>
          <div class="form-group" style="max-width:100px"><label>PLZ</label><input class="form-control" id="mBePlz" value="${esc(b.plz)}"></div>
          <div class="form-group"><label>Ort</label><input class="form-control" id="mBeOrt" value="${esc(b.ort)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>E-Mail</label><input class="form-control" id="mBeEmail" type="email" value="${esc(b.email)}"></div>
          <div class="form-group"><label>Telefon</label><input class="form-control" id="mBeTel" value="${esc(b.telefon)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Fax</label><input class="form-control" id="mBeFax" value="${esc(b.fax||'')}"></div>
          <div class="form-group"><label>Ansprechpartner</label><input class="form-control" id="mBeAP" value="${esc(b.ansprechpartner||'')}"></div>
        </div>
      </div>
      <div id="mBeTab3" class="modal-tab-content">
        <div id="mBeAusbilderList">
          ${ausbilder.map(a => `<div class="form-row" style="margin-bottom:6px;align-items:center;flex-wrap:wrap">
            <input class="form-control mAuNach" value="${esc(a.nachname)}" placeholder="Nachname" style="flex:1;min-width:100px;font-size:12px">
            <input class="form-control mAuVor" value="${esc(a.vorname)}" placeholder="Vorname" style="flex:1;min-width:80px;font-size:12px">
            <input class="form-control mAuFunk" value="${esc(a.funktion)}" placeholder="Funktion" style="flex:1;min-width:80px;font-size:12px">
            <input class="form-control mAuTel" value="${esc(a.telefon)}" placeholder="Telefon" style="flex:1;min-width:90px;font-size:12px">
            <input class="form-control mAuEmail" value="${esc(a.email)}" placeholder="E-Mail" style="flex:1;min-width:120px;font-size:12px">
            <input class="form-control mAuMobil" value="${esc(a.mobil)}" placeholder="Mobil" style="flex:1;min-width:90px;font-size:12px">
            <button class="btn btn-sm" style="color:var(--clr-red);padding:2px 6px" onclick="this.closest('.form-row').remove()">&#10005;</button>
          </div>`).join('')}
        </div>
        <button class="btn btn-sm btn-secondary" style="margin-top:4px" onclick="StammdatenTab._addAusbilderRow()">+ Ausbilder</button>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="StammdatenTab.updateBetrieb(${id})">Speichern</button>`);
    _makeModalWide();
  },

  _addAusbilderRow() {
    const list = document.getElementById('mBeAusbilderList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'form-row';
    row.style = 'margin-bottom:6px;align-items:center;flex-wrap:wrap';
    row.innerHTML = '<input class="form-control mAuNach" placeholder="Nachname" style="flex:1;min-width:100px;font-size:12px"><input class="form-control mAuVor" placeholder="Vorname" style="flex:1;min-width:80px;font-size:12px"><input class="form-control mAuFunk" placeholder="Funktion" style="flex:1;min-width:80px;font-size:12px"><input class="form-control mAuTel" placeholder="Telefon" style="flex:1;min-width:90px;font-size:12px"><input class="form-control mAuEmail" placeholder="E-Mail" style="flex:1;min-width:120px;font-size:12px"><input class="form-control mAuMobil" placeholder="Mobil" style="flex:1;min-width:90px;font-size:12px"><button class="btn btn-sm" style="color:var(--clr-red);padding:2px 6px" onclick="this.closest(\'.form-row\').remove()">&#10005;</button>';
    list.appendChild(row);
  },
  updateBetrieb(id) {
    const n = document.getElementById('mBeName').value.trim();
    if (!n) return App.toast('Name ist Pflichtfeld', 'error');
    const zusatz = document.getElementById('mBeZusatz')?.value?.trim()||'';
    App.run('UPDATE betriebe SET name=?,vorname=?,zusatzbezeichnung=?,firma=?,betriebsnummer=?,strasse=?,plz=?,ort=?,email=?,telefon=?,fax=?,ansprechpartner=? WHERE id=?',
      [n, document.getElementById('mBeVorname')?.value?.trim()||'', zusatz, zusatz,
       document.getElementById('mBeBnr').value.trim(),
       document.getElementById('mBeStr').value.trim(), document.getElementById('mBePlz').value.trim(),
       document.getElementById('mBeOrt').value.trim(),
       document.getElementById('mBeEmail').value.trim(), document.getElementById('mBeTel').value.trim(),
       document.getElementById('mBeFax')?.value?.trim()||'',
       document.getElementById('mBeAP')?.value?.trim()||'', id]);
    // Save Ausbilder
    App.run('DELETE FROM ausbilder WHERE betrieb_id=?', [id]);
    document.querySelectorAll('.mAuNach').forEach((el, i) => {
      const nachname = el.value.trim();
      const vorname = document.querySelectorAll('.mAuVor')[i]?.value?.trim()||'';
      if (!nachname && !vorname) return;
      App.run('INSERT INTO ausbilder (betrieb_id,nachname,vorname,funktion,telefon,email,mobil) VALUES (?,?,?,?,?,?,?)',
        [id, nachname, vorname,
         document.querySelectorAll('.mAuFunk')[i]?.value?.trim()||'',
         document.querySelectorAll('.mAuTel')[i]?.value?.trim()||'',
         document.querySelectorAll('.mAuEmail')[i]?.value?.trim()||'',
         document.querySelectorAll('.mAuMobil')[i]?.value?.trim()||'']);
    });
    App.closeModal(); StammdatenTab.show('betriebe');
    App.toast('Betrieb aktualisiert', 'success');
  },

  showBetriebAusbilder(betriebId) {
    const b = App.query('SELECT * FROM betriebe WHERE id=?', [betriebId])[0];
    if (!b) return;
    const ausbilder = App.query('SELECT * FROM ausbilder WHERE betrieb_id=? ORDER BY nachname', [betriebId]);
    App.openModal(`Ausbilder – ${esc(b.name)}`, `
      ${!ausbilder.length ? '<p style="color:var(--clr-text-light)">Keine Ausbilder hinterlegt.</p>' : `
      <table class="data-table"><thead><tr><th>Name</th><th>Funktion</th><th>Telefon</th><th>E-Mail</th><th>Mobil</th></tr></thead><tbody>
        ${ausbilder.map(a => `<tr>
          <td><strong>${esc(a.nachname)}</strong>${a.vorname ? ', ' + esc(a.vorname) : ''}</td>
          <td style="font-size:12px">${esc(a.funktion || '–')}</td>
          <td style="font-size:12px">${a.telefon ? `<a href="tel:${esc(a.telefon)}" style="color:var(--clr-forest)">${esc(a.telefon)}</a>` : '–'}</td>
          <td style="font-size:12px">${a.email ? `<a href="mailto:${esc(a.email)}" style="color:var(--clr-blue)">${esc(a.email)}</a>` : '–'}</td>
          <td style="font-size:12px">${a.mobil ? `<a href="tel:${esc(a.mobil)}" style="color:var(--clr-forest)">${esc(a.mobil)}</a>` : '–'}</td>
        </tr>`).join('')}
      </tbody></table>`}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary" onclick="App.closeModal();StammdatenTab.editBetrieb(${betriebId})">Bearbeiten</button>`);
  },
  deleteBetrieb(id) {
    if (!confirm('Betrieb löschen? (Nur möglich wenn keine Azubis zugeordnet)')) return;
    App.run('UPDATE schueler SET betrieb_id=NULL WHERE betrieb_id=?', [id]);
    App.run('DELETE FROM ausbilder WHERE betrieb_id=?', [id]);
    App.deleteBetriebKaskade(id);
    StammdatenTab.show('betriebe');
  },

  // ── Modal: Klassen einer Schule ──
  showSchuleKlassen(schuleId) {
    const bs = App.query('SELECT * FROM berufsschulen WHERE id=?', [schuleId])[0];
    if (!bs) return;
    const klassen = App.query(`SELECT k.*, j.bezeichnung as jahrgang,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.klasse_id=k.id AND sq.aktiv=1) as cnt
      FROM klassen k LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      LEFT JOIN fachrichtungen f ON k.fachrichtung_id=f.id
      WHERE k.berufsschule_id=? ORDER BY j.jahr DESC, k.klassenbezeichnung`, [schuleId]);

    App.openModal(`${esc(bs.name)} – ${klassen.length} Klassen`, `
      ${bs.email ? `<div style="margin-bottom:8px;font-size:12px">✉︎ <a href="mailto:${esc(bs.email)}" style="color:var(--clr-forest)">${esc(bs.email)}</a>${bs.telefon ? ` · ☎︎ <a href="tel:${esc(bs.telefon)}" style="color:var(--clr-forest)">${esc(bs.telefon)}</a>` : ''}</div>` : ''}
      <table class="data-table">
        <thead><tr><th>Klasse</th><th>Jahrgang</th><th>Fachrichtung</th><th>Schüler</th><th></th></tr></thead>
        <tbody>${klassen.map(k => `<tr>
          <td><strong>${esc(k.klassenbezeichnung)}</strong></td>
          <td>${esc(k.jahrgang||'–')}</td>
          <td style="font-size:12px">${esc(k.fachrichtung||'–')}</td>
          <td>${k.cnt > 0 ? `<a href="#" onclick="App.closeModal();setTimeout(()=>StammdatenTab.showKlasseAzubis(${k.id}),100);return false" style="color:var(--clr-forest);font-weight:700;text-decoration:underline">${k.cnt}</a>` : '0'}</td>
          <td><button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="App.closeModal();StammdatenTab.editKlasse(${k.id})">✎</button></td>
        </tr>`).join('')}</tbody>
      </table>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-primary" onclick="App.closeModal();setTimeout(()=>StammdatenTab.showSchuleAzubis(${schuleId}),100)">Alle Schüler</button>`);
  },

  // ── Modal: Schüler einer Klasse ──
  showKlasseAzubis(klasseId) {
    const kl = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jahrgang,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      LEFT JOIN fachrichtungen f ON k.fachrichtung_id=f.id WHERE k.id=?`, [klasseId])[0];
    if (!kl) return;
    const azubis = App.query(`SELECT s.*,
      COALESCE(b.name, s.ausbildungsstaette) as betrieb_display, b.ort as b_ort, b.email as b_email, b.telefon as b_tel,
      (SELECT ke.ergebnis FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1) as letztes_ergebnis
      FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id
      WHERE s.klasse_id=? AND s.aktiv=1 ORDER BY s.nachname`, [klasseId]);

    const ampelIcon = (erg) => !erg ? '<span style="color:var(--clr-sage-light)">○</span>' : erg === 'in_ordnung' ? '<span style="color:var(--clr-green)">●</span>' : '<span style="color:var(--clr-red)">◆</span>';

    const bs = App.query('SELECT * FROM berufsschulen WHERE id=?', [kl.berufsschule_id])[0] || {};
    const ansprechpartner = (() => { try { return JSON.parse(bs.ansprechpartner_json || '[]'); } catch { return []; } })();

    App.openModal(`${esc(kl.klassenbezeichnung)} – ${esc(kl.schule)}`, `
      <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:180px;font-size:12px;color:var(--clr-text-light)">
          ${esc(kl.jahrgang||'')} · ${esc(kl.fachrichtung||'')} · ${azubis.length} Schüler
          ${bs.telefon ? '<br>☎︎ <a href="tel:' + esc(bs.telefon) + '" style="color:var(--clr-forest)">' + esc(bs.telefon) + '</a>' : ''}
          ${bs.email ? '<br>✉︎ <a href="mailto:' + esc(bs.email) + '" style="color:var(--clr-forest)">' + esc(bs.email) + '</a>' : ''}
        </div>
        ${ansprechpartner.length ? `<div style="flex:1;min-width:180px;font-size:12px;padding:6px 10px;background:var(--clr-warm);border-radius:var(--radius)">
          <strong style="font-size:11px;color:var(--clr-forest)">Ansprechpartner:</strong>
          ${ansprechpartner.map(a => `<div style="margin-top:3px">${esc(a.name||'')}${a.funktion ? ' <span style="color:var(--clr-text-light)">(' + esc(a.funktion) + ')</span>' : ''}
            ${a.telefon ? '<br>☎︎ <a href="tel:' + esc(a.telefon) + '" style="color:var(--clr-forest)">' + esc(a.telefon) + '</a>' : ''}
            ${a.email ? ' ✉︎ <a href="mailto:' + esc(a.email) + '" style="color:var(--clr-forest);font-size:11px">' + esc(a.email) + '</a>' : ''}
          </div>`).join('')}
        </div>` : (bs.ansprechpartner ? `<div style="flex:1;min-width:180px;font-size:12px;padding:6px 10px;background:var(--clr-warm);border-radius:var(--radius)">
          <strong style="font-size:11px;color:var(--clr-forest)">Ansprechpartner:</strong> ${esc(bs.ansprechpartner)}
        </div>` : '')}
      </div>
      <table class="data-table">
        <thead><tr><th></th><th>Name</th><th>Betrieb</th><th>Kontakt</th><th></th></tr></thead>
        <tbody>${azubis.map(s => `<tr>
          <td style="text-align:center">${ampelIcon(s.letztes_ergebnis)}</td>
          <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}</td>
          <td style="font-size:12px">${s.betrieb_id ? `<a href="#" onclick="App.closeModal();setTimeout(()=>StammdatenTab.showBetriebAzubis(${s.betrieb_id}),100);return false" style="color:var(--clr-forest);text-decoration:underline">${esc(s.betrieb_display||'')}</a>` : esc(s.betrieb_display||'–')}${s.b_ort ? '<div style="font-size:10px;color:var(--clr-text-light)">'+esc(s.b_ort)+'</div>' : ''}</td>
          <td style="font-size:11px;white-space:nowrap">
            ${s.b_tel ? '<a href="tel:'+esc(s.b_tel)+'" style="color:var(--clr-forest)" title="'+esc(s.b_tel)+'">Tel</a> ' : ''}
            ${s.b_email ? '<a href="mailto:'+esc(s.b_email)+'" style="color:var(--clr-forest)" title="'+esc(s.b_email)+'">Mail</a> ' : ''}
            ${s.email ? '<a href="mailto:'+esc(s.email)+'" style="color:var(--clr-blue)" title="'+esc(s.email)+'">Azu</a>' : ''}
          </td>
          <td><button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="App.closeModal();ImportHandler.editSchueler(${s.id})">✎</button></td>
        </tr>`).join('')}</tbody>
      </table>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary btn-sm" onclick="App.closeModal();StammdatenTab.editSchule(${kl.berufsschule_id})">✎ Schule bearbeiten</button>`);
    _makeModalWide();
  },

  showSchuleAzubis(schuleId) {
    const bs = App.query('SELECT * FROM berufsschulen WHERE id=?', [schuleId])[0];
    if (!bs) return;
    const azubis = App.query(`SELECT s.*,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      j.bezeichnung as jahrgang, k.klassenbezeichnung,
      COALESCE(b.name, s.ausbildungsstaette) as betrieb_display,
      (SELECT MAX(kt.geplant_datum) FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '') as letzte_kontrolle,
      (SELECT ke2.ergebnis FROM kontrollergebnisse ke2 JOIN kontrolltermine kt2 ON ke2.kontrolltermin_id=kt2.id WHERE ke2.schueler_id=s.id AND ke2.ergebnis != '' ORDER BY kt2.geplant_datum DESC LIMIT 1) as letztes_ergebnis,
      (SELECT ke3.kontrolltermin_id FROM kontrollergebnisse ke3 JOIN kontrolltermine kt3 ON ke3.kontrolltermin_id=kt3.id WHERE ke3.schueler_id=s.id AND ke3.ergebnis != '' ORDER BY kt3.geplant_datum DESC LIMIT 1) as letzter_termin_id
      FROM schueler s
      JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      WHERE k.berufsschule_id=? AND s.aktiv=1${App.gf('schueler')}
      ORDER BY k.klassenbezeichnung, s.nachname`, [schuleId]);

    const eLbl = {in_ordnung:'✓ OK',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail',berichte_bis_termin_email:'E-Mail',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};
    const ampelIcon = (erg) => !erg ? '<span style="color:var(--clr-sage-light)">○</span>' : erg === 'in_ordnung' ? '<span style="color:var(--clr-green)">●</span>' : '<span style="color:var(--clr-red)">◆</span>';

    App.openModal(`${azubis.length} Schüler – ${esc(bs.name)}${bs.ort ? ' (' + esc(bs.ort) + ')' : ''}`, `
      <table class="data-table">
        <thead><tr><th></th><th>Name</th><th>Klasse</th><th>Betrieb</th><th>Letzte Kontrolle</th><th>Kontakt</th><th></th></tr></thead>
        <tbody>
          ${azubis.map(s => `<tr>
            <td style="text-align:center;font-size:14px">${ampelIcon(s.letztes_ergebnis)}</td>
            <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}</td>
            <td style="font-size:11px">${esc(s.klassenbezeichnung || '–')}</td>
            <td style="font-size:11px">${esc(s.betrieb_display || '–')}</td>
            <td style="font-size:11px">${s.letzte_kontrolle ? `${formatDate(s.letzte_kontrolle)}<br><span style="color:${s.letztes_ergebnis === 'in_ordnung' ? 'var(--clr-green)' : 'var(--clr-red)'}">${eLbl[s.letztes_ergebnis] || '–'}</span>` : '<span style="color:var(--clr-amber)">noch nie</span>'}</td>
            <td style="font-size:10px">${s.email ? `<a href="mailto:${esc(s.email)}" style="color:var(--clr-forest)" title="${esc(s.email)}">✉︎</a> ` : ''}${s.telefon ? `<a href="tel:${esc(s.telefon)}" style="color:var(--clr-forest)" title="${esc(s.telefon)}">☎︎</a>` : ''}</td>
            <td class="btn-group" style="white-space:nowrap">
              <button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="App.closeModal();ImportHandler.editSchueler(${s.id})" title="Stammdaten">✎</button>
              ${s.letzter_termin_id ? `<button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="KontrolleHandler.goToKontrolle(${s.letzter_termin_id},${s.id})" title="Letzte Kontrolle">▤</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>`);
  },

  showBetriebAzubis(betriebId, filter) {
    const b = App.query('SELECT * FROM betriebe WHERE id=?', [betriebId])[0];
    if (!b) return;
    const bName = (b.vorname ? b.vorname + ' ' : '') + b.name;

    let sql = `SELECT s.*, 
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') as fachrichtung,
      j.bezeichnung as jahrgang,
      (SELECT MAX(kt.geplant_datum) FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=s.id AND ke.ergebnis != '') as letzte_kontrolle,
      (SELECT ke2.ergebnis FROM kontrollergebnisse ke2 JOIN kontrolltermine kt2 ON ke2.kontrolltermin_id=kt2.id WHERE ke2.schueler_id=s.id AND ke2.ergebnis != '' ORDER BY kt2.geplant_datum DESC LIMIT 1) as letztes_ergebnis,
      (SELECT ke3.kontrolltermin_id FROM kontrollergebnisse ke3 JOIN kontrolltermine kt3 ON ke3.kontrolltermin_id=kt3.id WHERE ke3.schueler_id=s.id AND ke3.ergebnis != '' ORDER BY kt3.geplant_datum DESC LIMIT 1) as letzter_termin_id
      FROM schueler s
      LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      WHERE s.betrieb_id=? AND s.aktiv=1${App.gf('schueler')}`;
    if (filter === 'maengel') sql += ` AND s.id IN (SELECT ke.schueler_id FROM kontrollergebnisse ke WHERE ke.ergebnis != '' AND ke.ergebnis != 'in_ordnung')`;
    sql += ' ORDER BY s.nachname';
    const azubis = App.query(sql, [betriebId]);

    const eLbl = {in_ordnung:'✓ OK',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail (Wetter)',berichte_bis_termin_email:'E-Mail (Berichte)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};
    const ampelIcon = (erg) => !erg ? '<span style="color:var(--clr-sage-light)">○</span>' : erg === 'in_ordnung' ? '<span style="color:var(--clr-green)">●</span>' : '<span style="color:var(--clr-red)">◆</span>';

    const title = filter === 'maengel'
      ? `<span style="color:var(--clr-red)">◆</span> Beanstandete Azubis – ${esc(bName)}`
      : `Azubis – ${esc(bName)}${b.zusatzbezeichnung ? ' · ' + esc(b.zusatzbezeichnung) : ''}`;

    const ausbilder = App.query('SELECT * FROM ausbilder WHERE betrieb_id=? ORDER BY nachname', [betriebId]);

    App.openModal(title, `
      <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:200px;font-size:12px;color:var(--clr-text-light)">
          ${b.email ? `✉︎ <a href="mailto:${esc(b.email)}" style="color:var(--clr-forest)">${esc(b.email)}</a><br>` : ''}
          ${b.telefon ? `☎︎ <a href="tel:${esc(b.telefon)}" style="color:var(--clr-forest)">${esc(b.telefon)}</a><br>` : ''}
          ${b.ort ? `${esc(b.strasse ? b.strasse + ', ' : '')}${esc(b.plz)} ${esc(b.ort)}` : ''}
        </div>
        ${ausbilder.length ? `<div style="flex:1;min-width:200px;font-size:12px;padding:6px 10px;background:var(--clr-warm);border-radius:var(--radius)">
          <strong style="font-size:11px;color:var(--clr-forest)">Ausbilder:</strong>
          ${ausbilder.map(a => `<div style="margin-top:3px">${esc((a.vorname ? a.vorname + ' ' : '') + a.nachname)}${a.funktion ? ' <span style="color:var(--clr-text-light)">(' + esc(a.funktion) + ')</span>' : ''}
            ${a.telefon ? '<br>☎︎ <a href="tel:' + esc(a.telefon) + '" style="color:var(--clr-forest)">' + esc(a.telefon) + '</a>' : ''}
            ${a.mobil ? ' ☎︎ <a href="tel:' + esc(a.mobil) + '" style="color:var(--clr-forest)">' + esc(a.mobil) + '</a>' : ''}
            ${a.email ? '<br>✉︎ <a href="mailto:' + esc(a.email) + '" style="color:var(--clr-forest);font-size:11px">' + esc(a.email) + '</a>' : ''}
          </div>`).join('')}
        </div>` : ''}
      </div>
      ${!azubis.length ? '<p style="color:var(--clr-text-light);font-size:13px">Keine Azubis gefunden.</p>' : `
      <table class="data-table">
        <thead><tr><th></th><th>Name</th><th>FR / JG</th><th>Letzte Kontrolle</th><th>Kontakt</th><th></th></tr></thead>
        <tbody>
          ${azubis.map(s => {
            const ampel = ampelIcon(s.letztes_ergebnis);
            return `<tr>
              <td style="text-align:center;font-size:14px">${ampel}</td>
              <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}</td>
              <td style="font-size:11px">${esc(s.fachrichtung || '–')}<br>${esc(s.jahrgang || '–')}</td>
              <td style="font-size:11px">${s.letzte_kontrolle ? `${formatDate(s.letzte_kontrolle)}<br><span style="color:${s.letztes_ergebnis === 'in_ordnung' ? 'var(--clr-green)' : 'var(--clr-red)'}">${eLbl[s.letztes_ergebnis] || s.letztes_ergebnis || '–'}</span>` : '<span style="color:var(--clr-amber)">noch nie</span>'}</td>
              <td style="font-size:10px">${s.email ? `<a href="mailto:${esc(s.email)}" style="color:var(--clr-forest)" title="${esc(s.email)}">✉︎</a> ` : ''}${s.telefon ? `<a href="tel:${esc(s.telefon)}" style="color:var(--clr-forest)" title="${esc(s.telefon)}">☎︎</a>` : ''}</td>
              <td class="btn-group" style="white-space:nowrap">
                <button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="App.closeModal();ImportHandler.editSchueler(${s.id})" title="Stammdaten bearbeiten">✎</button>
                ${s.letzter_termin_id ? `<button class="btn btn-sm btn-secondary" style="padding:2px 6px;font-size:10px" onclick="KontrolleHandler.goToKontrolle(${s.letzter_termin_id},${s.id})" title="Letzte Kontrolle öffnen">▤</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary btn-sm" onclick="App.closeModal();StammdatenTab.editBetrieb(${betriebId})">✎ Betrieb bearbeiten</button>`);
    _makeModalWide();
  },
};
