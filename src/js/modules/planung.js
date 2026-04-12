const PlanungHandler = {
  filterStatus(status) {
    const rows = document.querySelectorAll('#planTableBody tr');
    let visible = 0;
    rows.forEach(r => {
      if (status === 'all') { r.style.display = ''; visible++; }
      else { const show = r.dataset.status === status; r.style.display = show ? '' : 'none'; if (show) visible++; }
    });
    // Update count in dropdown label
    const sel = document.getElementById('planFilter');
    if (sel) {
      const opt = sel.options[sel.selectedIndex];
      const base = opt.textContent.replace(/ \(\d+\)$/, '');
      opt.textContent = base + ' (' + visible + ')';
    }
  },

  addTermin() {
    this._editTerminId = null;
    const gfK = App.gf('klassen');
    const gfS = App.gf('schueler');
    const klassen = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jg_bez,
      fr.bezeichnung as fr_bez, fr.typ as fr_typ, fr.id as fr_id,
      (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as schueler_count
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id
      WHERE 1=1${gfK}
      ORDER BY bs.name, k.klassenbezeichnung`);
    const pruefer = App.query('SELECT * FROM pruefer WHERE aktiv=1 ORDER BY name');
    const allSchueler = App.query(`SELECT s.*, COALESCE(b.name, s.ausbildungsstaette) as betrieb_display FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id WHERE s.aktiv=1${gfS} ORDER BY s.nachname, s.vorname`);

    // Filter options – reguläre Schulen + aktuelle LFK-Schulen
    const lfkSchulen = App.query("SELECT DISTINCT landesfachklasse FROM schueler WHERE aktiv=1 AND landesfachklasse != ''").map(r => r.landesfachklasse);
    const schulen = [...new Set([...klassen.map(k => k.schule), ...lfkSchulen])].sort();
    const jahrgaenge = [...new Set(klassen.map(k => k.jg_bez).filter(Boolean))].sort();
    const fachrichtungen = [...new Set(klassen.map(k => (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '')).filter(Boolean))].sort();
    const zpValues = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != '' ORDER BY zwischenpruefung");
    const amtValues = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE aktiv=1 AND zustaendiges_amt != '' ORDER BY zustaendiges_amt");
    // Pre-compute per-class: which ZP values + which Amt values
    const classZP = {}, classAmt = {};
    klassen.forEach(k => {
      const zps = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE klasse_id=? AND aktiv=1 AND zwischenpruefung != ''", [k.id]);
      classZP[k.id] = zps.map(r => r.zwischenpruefung);
      const amts = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE klasse_id=? AND aktiv=1 AND zustaendiges_amt != ''", [k.id]);
      classAmt[k.id] = amts.map(r => r.zustaendiges_amt);
    });
    this._terminClassZP = classZP;
    this._terminClassAmt = classAmt;

    // Group classes by school for display
    const bySchool = {};
    klassen.forEach(k => {
      if (!bySchool[k.schule]) bySchool[k.schule] = [];
      bySchool[k.schule].push(k);
    });

    App.openModal('Neuer Kontrolltermin / Einsendung', `
      <!-- Typ-Toggle -->
      <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--clr-sand);border-radius:var(--radius);overflow:hidden">
        <button id="btnTypSchule" class="btn" style="flex:1;border-radius:0;border:none;background:var(--clr-forest);color:white;font-size:13px;padding:8px" onclick="document.getElementById('sectionEinsendungExtra').style.display='none';this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypEinsend').style.background='var(--clr-warm)';document.getElementById('btnTypEinsend').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='schulkontrolle'">
          🏫 Schulkontrolle
        </button>
        <button id="btnTypEinsend" class="btn" style="flex:1;border-radius:0;border:none;background:var(--clr-warm);color:var(--clr-text);font-size:13px;padding:8px" onclick="document.getElementById('sectionEinsendungExtra').style.display='';this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypSchule').style.background='var(--clr-warm)';document.getElementById('btnTypSchule').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='einsendung'">
          📬 Einsendung / Einzelprüfung
        </button>
      </div>
      <input type="hidden" id="mKtTyp" value="schulkontrolle">

      <!-- GEMEINSAM: Filter + Klassenauswahl + Smart-Standort (für beide Modi) -->
      <div class="form-group">
        <label>Klassen / Gruppen auswählen</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">📅 Abschlussprüfung: Alle</option>
            ${jahrgaenge.map(j => `<option value="${esc(j)}">${App.jgLabel(j)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">📝 Zwischenprüfung: Alle</option>
            ${zpValues.map(z => `<option value="${esc(z.zwischenpruefung)}">${App.zpLabel(z.zwischenpruefung)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">🏫 Schule: Alle</option>
            ${schulen.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">🏛 Amt: Alle</option>
            ${amtValues.map(a => `<option value="${esc(a.zustaendiges_amt)}">${a.zustaendiges_amt} ${App.AEMTER[a.zustaendiges_amt]||''}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">🌿 Fachrichtung: Alle</option>
            ${fachrichtungen.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
          </select>
        </div>
        <div id="terminKlassenList" style="max-height:200px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);padding:8px">
          ${Object.entries(bySchool).map(([schule, kls]) => `
            <div class="termin-school-group" data-school="${esc(schule)}" style="margin-bottom:8px">
              <div style="font-weight:600;font-size:12px;color:var(--clr-forest);margin-bottom:4px;border-bottom:1px solid var(--clr-sand);padding-bottom:2px">${esc(schule)}</div>
              ${kls.map(k => {
                const frLabel = (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '');
                return `<div class="check-row termin-kl-row" data-jg="${esc(k.jg_bez||'')}" data-bs="${esc(k.schule)}" data-fr="${esc(frLabel)}" data-kid="${k.id}">
                <input type="checkbox" class="chk-termin-kl" value="${k.id}" data-jg="${k.jahrgang_id}" data-bs="${k.berufsschule_id||""}" onchange="PlanungHandler.updateBpHint&&PlanungHandler.updateBpHint()">
                <span style="font-size:13px">${esc(k.klassenbezeichnung)} <small style="color:var(--clr-text-light)">(${k.schueler_count} Sch.)</small></span>
              </div>`}).join('')}
            </div>
          `).join('')}
        </div>
        <div style="font-size:10px;color:var(--clr-text-light);margin-top:4px">Filter grenzen die Klassenliste ein. Mehrere Klassen gleichzeitig auswählbar.</div>
      </div>

      <!-- Smart-Standort: Zeigt aktuelle Schulstandorte inkl. Landesfachklassen -->
      <div id="smartStandortBox" style="display:none;margin-top:12px;padding:12px 16px;background:linear-gradient(135deg,#f0e6f6,#e8d5f5);border:1px solid #d4b8e8;border-radius:var(--radius)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <strong style="font-size:13px;color:#7b2fa0">🏫 Aktuelle Schulstandorte</strong>
          <span style="font-size:11px;color:var(--clr-text-light)">(Berücksichtigt Landesfachklassen)</span>
        </div>
        <div id="smartStandortContent"></div>
      </div>

      <!-- NUR BEI EINSENDUNG: Zusätzlich einzelne Schüler manuell hinzufügen -->
      <div id="sectionEinsendungExtra" style="display:none;margin-top:12px;padding:12px 16px;background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius)">
        <div class="form-group" style="margin-bottom:8px">
          <label style="font-weight:600;color:var(--clr-forest)">Zusätzlich einzelne Schüler hinzufügen (optional)</label>
          <input class="form-control" id="mKtEinsendSuche" placeholder="Name eingeben…" style="margin-bottom:6px" oninput="PlanungHandler._searchEinsendSchueler(this.value)">
          <div id="mKtEinsendResults" style="max-height:150px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);display:none"></div>
        </div>
        <div id="mKtEinsendSelected" style="display:flex;flex-wrap:wrap;gap:4px"></div>
        <div id="einsendCountInfo" style="font-size:11px;color:var(--clr-text-light);margin-top:4px"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Datum</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="date" class="form-control" id="mKtDatum" value="${new Date().toISOString().split('T')[0]}" onchange="PlanungHandler._updateKwHighlight()" style="flex:1">
            <span id="mKtKwLabel" style="font-size:12px;color:var(--clr-forest);font-weight:600;white-space:nowrap"></span>
          </div>
        </div>
        <div class="form-group"><label>Prüfer</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0">
            ${pruefer.map(p => `<label style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--clr-warm);border-radius:6px;cursor:pointer;font-size:13px;border:1px solid var(--clr-sand)">
              <input type="checkbox" class="chk-pruefer" value="${esc(p.name)}" checked style="accent-color:var(--clr-forest)"> ${esc(p.name)}
            </label>`).join('')}
          </div>
        </div>
      </div>
      <div class="form-group"><label>Bemerkung</label><textarea class="form-control" id="mKtBem" rows="2"></textarea></div>
      <div id="bpKwPicker" style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="color:var(--clr-forest)">📅 KW-Kalender – Klick = Datum setzen</strong>
          <div style="display:flex;gap:8px;font-size:10px">
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--clr-green);border-radius:2px;vertical-align:middle"></span> Alle LJ</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#a7d7a7;border-radius:2px;vertical-align:middle"></span> Teilweise</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--clr-sand);border-radius:2px;vertical-align:middle"></span> Kein LJ / Ferien</span>
          </div>
        </div>
        <div id="bpKwGrid" style="color:var(--clr-text-light)">Klassen auswählen…</div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="PlanungHandler.saveTermin()">Speichern</button>`);
    this._einsendSchuelerIds = [];
    this._einsendSchuelerData = allSchueler;
    this._standortSchuelerIds = [];
    setTimeout(() => { PlanungHandler._updateKwHighlight(); PlanungHandler.updateBpHint(); }, 50);
  },

  _terminClassZP: {},
  _terminClassAmt: {},

  _filterTerminKlassen() {
    const container = document.getElementById('terminKlassenList');
    if (!container) return;
    const selects = container.parentElement.querySelectorAll('select');
    const fJg = selects[0]?.value || '';
    const fZp = selects[1]?.value || '';
    const fBs = selects[2]?.value || '';
    const fAmt = selects[3]?.value || '';
    const fFr = selects[4]?.value || '';

    let visibleCount = 0;
    container.querySelectorAll('.termin-kl-row').forEach(row => {
      const kid = parseInt(row.dataset.kid);
      let show = true;
      if (fJg && row.dataset.jg !== fJg) show = false;
      if (fBs && row.dataset.bs !== fBs) show = false;
      if (fFr && row.dataset.fr !== fFr) show = false;
      if (fZp && !(this._terminClassZP[kid] || []).includes(fZp)) show = false;
      if (fAmt && !(this._terminClassAmt[kid] || []).includes(fAmt)) show = false;
      row.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });
    // Hide empty school groups
    container.querySelectorAll('.termin-school-group').forEach(g => {
      const rows = g.querySelectorAll('.termin-kl-row');
      const hasVisible = [...rows].some(r => r.style.display !== 'none');
      g.style.display = hasVisible ? '' : 'none';
    });

    // Smart-Standort aktualisieren bei jedem aktiven Filter
    this._updateSmartStandort({ jg: fJg, zp: fZp, bs: fBs, amt: fAmt, fr: fFr });
  },

  _updateSmartStandort(filters) {
    const box = document.getElementById('smartStandortBox');
    const content = document.getElementById('smartStandortContent');
    if (!box || !content) return;

    const { jg, zp, bs, amt, fr } = filters || {};

    // Nur anzeigen wenn mindestens ein Filter aktiv
    if (!jg && !fr && !amt && !zp && !bs) { box.style.display = 'none'; return; }

    // Jahrgang-ID ermitteln
    let jgId = null;
    if (jg) {
      const jgRow = App.query('SELECT id FROM abschlussjahrgaenge WHERE bezeichnung=?', [jg])[0];
      if (jgRow) jgId = jgRow.id;
    }
    // Fachrichtung-ID ermitteln
    let frId = null;
    if (fr) {
      const cleanLabel = fr.replace(/^FW:\s*/, '');
      const isFW = fr.startsWith('FW:');
      const frRow = App.query('SELECT id FROM fachrichtungen WHERE bezeichnung=? AND typ=?', [cleanLabel, isFW ? 'Fachwerker' : 'Gärtner'])[0];
      if (frRow) frId = frRow.id;
    }

    const opts = {};
    if (jgId) opts.jahrgangId = jgId;
    if (frId) opts.fachrichtungId = frId;
    if (amt) opts.amt = amt;
    if (zp) opts.zwischenpruefung = zp;

    const gruppen = App.getStandortgruppen(opts);
    if (!gruppen.length) {
      box.style.display = '';
      content.innerHTML = '<div style="font-size:12px;color:var(--clr-text-light);padding:4px">Keine Schüler für diese Filterauswahl gefunden.</div>';
      return;
    }

    // Wenn Schule gefiltert: nur Gruppen an dieser Schule ODER LFK-Gruppen dort zeigen
    const filtered = bs ? gruppen.filter(g => g.schule.toLowerCase().includes(bs.toLowerCase())) : gruppen;

    // Check ob es LFK-Schüler gibt
    const hasAnyLFK = filtered.some(g => g.hasLFK);

    // Filter-Label für Anzeige
    const activeFilters = [];
    if (jg) activeFilters.push(jg);
    if (fr) activeFilters.push(fr);
    if (amt) activeFilters.push(`Amt ${amt}`);
    if (zp) activeFilters.push(`ZP ${zp}`);
    if (bs) activeFilters.push(bs);

    box.style.display = '';
    content.innerHTML = `<div style="font-size:11px;color:var(--clr-text-light);margin-bottom:6px">
        Filter: <strong>${activeFilters.join(' + ')}</strong> → ${gruppen.reduce((s,g) => s + g.schueler.length, 0)} Schüler an ${filtered.length} Standort${filtered.length !== 1 ? 'en' : ''}
      </div>`
    + filtered.map(g => {
      const lfkCount = g.schueler.filter(s => App.getAktuelleSchule(s).isLandesfachklasse).length;
      const regCount = g.schueler.length - lfkCount;
      const klasseIds = [...g.klasse_ids];

      // Schüler-Details für Tooltip
      const schuelerNames = g.schueler.slice(0, 8).map(s => `${s.nachname}, ${s.vorname}`).join('\n');
      const moreHint = g.schueler.length > 8 ? `\n… und ${g.schueler.length - 8} weitere` : '';

      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:4px;background:white;border-radius:6px;border:1px solid #d4b8e8;cursor:pointer;transition:all .15s"
        onmouseenter="this.style.borderColor='#7b2fa0';this.style.boxShadow='0 1px 4px rgba(123,47,160,0.2)'"
        onmouseleave="this.style.borderColor='#d4b8e8';this.style.boxShadow='none'"
        onclick="PlanungHandler._selectStandort([${klasseIds.join(',')}], [${g.schueler.map(s => s.id).join(',')}])"
        title="${schuelerNames}${moreHint}">
        <div style="flex:1">
          <strong style="font-size:13px;color:var(--clr-forest-dark)">${esc(g.schule)}</strong>
          <div style="font-size:11px;color:var(--clr-text-light)">
            ${g.schueler.length} Schüler${regCount && lfkCount ? ` (${regCount} regulär + ${lfkCount} LFK)` : lfkCount ? ' (alle LFK)' : ''}
          </div>
        </div>
        ${g.hasLFK ? '<span style="font-size:10px;padding:2px 8px;background:#e8d5f5;color:#7b2fa0;border-radius:10px;font-weight:600">LFK</span>' : ''}
        <span style="font-size:11px;color:var(--clr-forest);font-weight:600">Auswählen →</span>
      </div>`;
    }).join('')
    + (hasAnyLFK ? `<div style="font-size:10px;color:#7b2fa0;margin-top:6px;padding:4px 0">
      ℹ️ <strong>LFK</strong> = Schüler an Landesfachklasse (besuchen diese Schule statt ihrer regulären Berufsschule)
    </div>` : '');
  },

  _selectStandort(klasseIds, schuelerIds) {
    // Alle Klassen-Checkboxen abwählen
    document.querySelectorAll('.chk-termin-kl').forEach(c => c.checked = false);
    // Die Klassen dieser Standortgruppe auswählen
    klasseIds.forEach(kid => {
      const cb = document.querySelector(`.chk-termin-kl[value="${kid}"]`);
      if (cb) cb.checked = true;
    });
    // Schüler-IDs merken für LFK-Zuordnung beim Speichern
    this._standortSchuelerIds = schuelerIds;
    // Visuelles Feedback
    App.toast(`${schuelerIds.length} Schüler ausgewählt`, 'success');
    // Blockplan-KW-Kalender aktualisieren
    this.updateBpHint && this.updateBpHint();
  },

  _addEinsendGruppe(ids, label) {
    let added = 0;
    ids.forEach(id => {
      if (!this._einsendSchuelerIds.includes(id)) {
        this._einsendSchuelerIds.push(id);
        added++;
      }
    });
    this._renderEinsendSelected();
    App.toast(`${added} Schüler aus "${label}" hinzugefügt`, 'success');
  },

  _renderEinsendSelected() {
    const sel = document.getElementById('mKtEinsendSelected');
    const info = document.getElementById('einsendCountInfo');
    if (!sel) return;

    if (!this._einsendSchuelerIds.length) {
      sel.innerHTML = '';
      if (info) info.textContent = '';
      return;
    }

    sel.innerHTML = this._einsendSchuelerIds.map(sid => {
      const s = this._einsendSchuelerData.find(x => x.id === sid);
      return `<span style="display:inline-flex;align-items:center;gap:3px;padding:3px 8px;background:var(--clr-green-light);border-radius:12px;font-size:12px">
        ${esc(s?.nachname||'?')}, ${esc(s?.vorname||'?')}
        <span style="cursor:pointer;color:var(--clr-red);font-weight:bold" onclick="PlanungHandler._removeEinsendSchueler(${sid})">✕</span>
      </span>`;
    }).join('');
    if (info) info.innerHTML = `<strong>${this._einsendSchuelerIds.length}</strong> Schüler ausgewählt · <a href="#" onclick="PlanungHandler._einsendSchuelerIds=[];PlanungHandler._renderEinsendSelected();return false" style="color:var(--clr-red);font-size:11px">Alle entfernen</a>`;
  },

  _einsendSchuelerIds: [],
  _einsendSchuelerData: [],

  _searchEinsendSchueler(q) {
    const results = document.getElementById('mKtEinsendResults');
    if (!results) return;
    if (!q || q.length < 2) { results.style.display = 'none'; return; }
    const ql = q.toLowerCase();
    const matches = this._einsendSchuelerData.filter(s =>
      !this._einsendSchuelerIds.includes(s.id) &&
      ((s.nachname||'').toLowerCase().includes(ql) || (s.vorname||'').toLowerCase().includes(ql) || (s.betrieb_display||'').toLowerCase().includes(ql))
    ).slice(0, 10);
    if (!matches.length) { results.innerHTML = '<div style="padding:6px;font-size:12px;color:var(--clr-text-light)">Keine Treffer</div>'; results.style.display = ''; return; }
    results.innerHTML = matches.map(s => `<div style="padding:4px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--clr-sand)" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''" onclick="PlanungHandler._addEinsendSchueler(${s.id})">
      <strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)} <span style="color:var(--clr-text-light)">· ${esc(s.betrieb_display||'–')}</span>
    </div>`).join('');
    results.style.display = '';
  },

  _addEinsendSchueler(id) {
    if (this._einsendSchuelerIds.includes(id)) return;
    this._einsendSchuelerIds.push(id);
    this._renderEinsendSelected();
    document.getElementById('mKtEinsendSuche').value = '';
    document.getElementById('mKtEinsendResults').style.display = 'none';
  },

  _removeEinsendSchueler(id) {
    this._einsendSchuelerIds = this._einsendSchuelerIds.filter(x => x !== id);
    this._renderEinsendSelected();
  },
  updateBpHint() {
    const grid = document.getElementById('bpKwGrid');
    if (!grid) return;

    // Get school IDs: from checkboxes (addTermin) or from existing termin (editTermin)
    let schulIds = [];
    const checked = [...document.querySelectorAll('.chk-termin-kl:checked')];
    if (checked.length) {
      schulIds = [...new Set(checked.map(c => c.dataset.bs).filter(Boolean).map(Number))];
    } else if (this._editTerminId) {
      // editTermin: get classes from existing termin
      const klassen = App.getTerminKlassen(this._editTerminId);
      schulIds = [...new Set(klassen.map(k => k.berufsschule_id).filter(Boolean))];
    }
    if (!schulIds.length) { grid.textContent = 'Klassen auswählen…'; return; }
    const sj = (() => { const now = new Date(); return now.getMonth() >= 7 ? `${now.getFullYear()}/${now.getFullYear()+1}` : `${now.getFullYear()-1}/${now.getFullYear()}`; })();
    const sjParts = sj.split('/');
    const year1 = parseInt(sjParts[0]), year2 = parseInt(sjParts[1]);

    // Collect blockplan data per KW: how many LJs present
    const kwData = {}; // kw → { ljs: Set, totalLjs: number }
    let totalLjs = 0;
    schulIds.forEach(bsId => {
      const ljs = App.query('SELECT DISTINCT lehrjahr FROM blockplan WHERE berufsschule_id=? AND schuljahr=?', [bsId, sj]).map(r => r.lehrjahr);
      totalLjs = Math.max(totalLjs, ljs.length);
      ljs.forEach(lj => {
        App.query('SELECT kalenderwoche FROM blockplan WHERE berufsschule_id=? AND schuljahr=? AND lehrjahr=?', [bsId, sj, lj]).forEach(r => {
          if (!kwData[r.kalenderwoche]) kwData[r.kalenderwoche] = new Set();
          kwData[r.kalenderwoche].add(lj);
        });
      });
    });

    if (!Object.keys(kwData).length) {
      grid.innerHTML = 'Keine Blockplan-Daten → <a href="#" onclick="App.navigate(\'stammdaten\');setTimeout(()=>StammdatenTab.show(\'blockplan\'),100);App.closeModal();return false" style="color:var(--clr-forest)">Blockpläne pflegen</a>';
      return;
    }

    // ISO KW to Monday helper
    function kwMon(kw, yr) {
      const j4 = new Date(yr, 0, 4);
      const d = (j4.getDay() + 6) % 7;
      const w1 = new Date(j4); w1.setDate(j4.getDate() - d);
      const m = new Date(w1); m.setDate(w1.getDate() + (kw - 1) * 7);
      return m;
    }

    // Build KW list (Schuljahr order)
    const kwList = [];
    for (let kw = 36; kw <= 52; kw++) kwList.push({ kw, yr: year1 });
    for (let kw = 1; kw <= 35; kw++) kwList.push({ kw, yr: year2 });

    const months = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    let lastM = -1;
    const selectedDate = document.getElementById('mKtDatum')?.value || '';

    let html = '<div style="display:flex;flex-wrap:wrap;gap:2px;user-select:none">';
    kwList.forEach(({kw, yr}) => {
      const mon = kwMon(kw, yr);
      const m = mon.getMonth();
      if (m !== lastM) {
        html += `<div style="width:100%;font-size:9px;color:var(--clr-sage);font-weight:600;margin-top:3px">${months[m]} ${yr}</div>`;
        lastM = m;
      }
      const d = kwData[kw];
      const ljCount = d ? d.size : 0;
      const isAll = ljCount >= totalLjs && totalLjs > 0;
      const isSome = ljCount > 0 && !isAll;
      const bg = isAll ? 'var(--clr-green)' : isSome ? '#a7d7a7' : 'var(--clr-sand)';
      const fg = isAll ? '#fff' : isSome ? '#2d5a2d' : 'var(--clr-text-light)';
      const dateStr = `${yr}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}`;
      const isSelected = selectedDate === dateStr;
      const border = isSelected ? '2px solid var(--clr-forest)' : '1px solid transparent';
      const ljTip = d ? `LJ ${[...d].join('+')} anwesend` : 'Keine Blockplan-Daten';
      html += `<div onclick="document.getElementById('mKtDatum').value='${dateStr}';PlanungHandler._updateKwHighlight()"
        style="width:30px;height:22px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;background:${bg};color:${fg};font-weight:${isAll?'700':'400'};border:${border}"
        title="KW ${kw} · ${String(mon.getDate()).padStart(2,'0')}.${String(m+1).padStart(2,'0')}.${yr} · ${ljTip}">${kw}</div>`;
    });
    html += '</div>';
    grid.innerHTML = html;
    this._updateKwHighlight();
  },

  _updateKwHighlight() {
    const dt = document.getElementById('mKtDatum')?.value;
    const label = document.getElementById('mKtKwLabel');
    if (!dt || !label) return;
    const d = new Date(dt);
    // ISO week number
    const tmp = new Date(d.getTime()); tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
    const kw = Math.ceil(((tmp - new Date(tmp.getFullYear(), 0, 4)) / 86400000 + ((new Date(tmp.getFullYear(), 0, 4).getDay() + 6) % 7) + 1) / 7);
    label.textContent = `KW ${kw}`;
    // Highlight selected in grid
    document.querySelectorAll('#bpKwGrid > div > div').forEach(el => {
      const dateStr = el.getAttribute('onclick')?.match(/'(\d{4}-\d{2}-\d{2})'/)?.[1];
      if (dateStr === dt) el.style.border = '2px solid var(--clr-forest)';
      else el.style.border = '1px solid transparent';
    });
  },

  saveTermin(id) {
    const dt = document.getElementById('mKtDatum').value;
    const pr = [...document.querySelectorAll('.chk-pruefer:checked')].map(c => c.value).join(', ');
    const bem = document.getElementById('mKtBem').value.trim();
    const typ = document.getElementById('mKtTyp')?.value || 'schulkontrolle';
    
    // Get selected class IDs (Schulkontrolle)
    const selectedKlassen = [...document.querySelectorAll('.chk-termin-kl:checked')].map(c => parseInt(c.value));
    // Get selected students (Einsendung) + Smart-Standort LFK-Schüler
    const selectedSchueler = this._einsendSchuelerIds || [];
    const standortSchueler = this._standortSchuelerIds || [];

    if (!dt) return App.toast('Datum ist Pflicht', 'error');
    if (!pr) return App.toast('Mindestens ein Prüfer muss ausgewählt werden', 'error');
    if (!selectedKlassen.length && !selectedSchueler.length && !standortSchueler.length) return App.toast('Mindestens eine Klasse oder einen Schüler auswählen', 'error');
    
    // Get jahrgang from first selected class
    const firstChecked = document.querySelector('.chk-termin-kl:checked');
    const jgId = firstChecked?.dataset?.jg || null;
    
    if (id) {
      App.run('UPDATE kontrolltermine SET geplant_datum=?,pruefer=?,bemerkung=?,jahrgang_id=?,typ=? WHERE id=?', [dt,pr,bem,jgId,typ,id]);
      // Update junction table
      App.run('DELETE FROM kontrolltermin_klassen WHERE kontrolltermin_id=?', [id]);
      selectedKlassen.forEach(klId => {
        App.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [id, klId]);
      });
      // Keep legacy klasse_id for backward compat
      if (selectedKlassen.length) App.run('UPDATE kontrolltermine SET klasse_id=? WHERE id=?', [selectedKlassen[0], id]);
      // Update individual student links (Einsendung + Smart-Standort LFK-Schüler)
      App.run('DELETE FROM kontrolltermin_schueler WHERE kontrolltermin_id=?', [id]);
      const allExtraSchuelerEdit = [...new Set([...selectedSchueler, ...standortSchueler])];
      allExtraSchuelerEdit.forEach(sid => {
        App.run('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)', [id, sid]);
      });

      // Verwaiste Kontrollergebnisse aufräumen: Schüler, die nicht mehr zum Termin gehören
      // (weder über Klassen noch über Einzel-Zuordnung), deren KE-Daten aber noch existieren
      const validSchuelerIds = new Set();
      // Schüler aus verknüpften Klassen
      if (selectedKlassen.length) {
        const klPh = selectedKlassen.map(() => '?').join(',');
        App.query(`SELECT id FROM schueler WHERE klasse_id IN (${klPh}) AND aktiv=1`, selectedKlassen)
          .forEach(s => validSchuelerIds.add(s.id));
      }
      // Einzeln verknüpfte Schüler
      allExtraSchuelerEdit.forEach(sid => validSchuelerIds.add(sid));
      // Orphan-KE finden und löschen
      const orphanKE = App.query('SELECT schueler_id FROM kontrollergebnisse WHERE kontrolltermin_id=?', [id])
        .filter(ke => !validSchuelerIds.has(ke.schueler_id));
      if (orphanKE.length) {
        const orphanIds = orphanKE.map(ke => ke.schueler_id);
        const oPh = orphanIds.map(() => '?').join(',');
        App.run(`DELETE FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id IN (${oPh})`, [id, ...orphanIds]);
      }
    } else {
      App.run('INSERT INTO kontrolltermine (klasse_id,jahrgang_id,geplant_datum,pruefer,bemerkung,typ) VALUES (?,?,?,?,?,?)',
        [selectedKlassen[0] || null, jgId, dt, pr, bem, typ]);
      // Get the new termin ID
      const newId = App.scalar('SELECT id FROM kontrolltermine WHERE rowid=last_insert_rowid()');
      if (newId) {
        selectedKlassen.forEach(klId => {
          App.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [newId, klId]);
        });
        // Link individual students (Einsendung + Smart-Standort LFK-Schüler)
        const allExtraSchueler = [...new Set([...selectedSchueler, ...standortSchueler])];
        allExtraSchueler.forEach(sid => {
          App.run('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)', [newId, sid]);
        });
      }
    }
    App.invalidateTerminCache();
    App.closeModal();
    Views.planung();
    App.toast('Termin gespeichert', 'success');
  },
  editTermin(id) {
    this._editTerminId = id;
    const t = App.query('SELECT * FROM kontrolltermine WHERE id=?', [id])[0];
    const gfK = App.gf('klassen');
    const gfS = App.gf('schueler');
    const klassen = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jg_bez,
      fr.bezeichnung as fr_bez, fr.typ as fr_typ, fr.id as fr_id,
      (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as schueler_count
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id
      WHERE 1=1${gfK}
      ORDER BY bs.name, k.klassenbezeichnung`);
    const pruefer = App.query('SELECT * FROM pruefer WHERE aktiv=1 ORDER BY name');
    const selectedIds = App.getTerminKlassenIds(id);
    // Ensure already-selected classes are visible even if filtered out
    selectedIds.forEach(sid => { if (!klassen.find(k => k.id === sid)) {
      const extra = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jg_bez, fr.bezeichnung as fr_bez, fr.typ as fr_typ, fr.id as fr_id, (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as schueler_count FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id WHERE k.id=?`, [sid])[0];
      if (extra) klassen.push(extra);
    }});

    // Load already-linked individual students
    const linkedSchuelerIds = App.query('SELECT schueler_id FROM kontrolltermin_schueler WHERE kontrolltermin_id=?', [id]).map(r => r.schueler_id);
    const allSchueler = App.query(`SELECT s.*, COALESCE(b.name, s.ausbildungsstaette) as betrieb_display FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id WHERE s.aktiv=1${gfS} ORDER BY s.nachname, s.vorname`);
    const isEinsendung = t.typ === 'einsendung';

    // Filter options – reguläre Schulen + aktuelle LFK-Schulen
    const lfkSchulen = App.query("SELECT DISTINCT landesfachklasse FROM schueler WHERE aktiv=1 AND landesfachklasse != ''").map(r => r.landesfachklasse);
    const schulen = [...new Set([...klassen.map(k => k.schule), ...lfkSchulen])].sort();
    const jahrgaenge = [...new Set(klassen.map(k => k.jg_bez).filter(Boolean))].sort();
    const fachrichtungen = [...new Set(klassen.map(k => (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '')).filter(Boolean))].sort();
    const zpValues = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != '' ORDER BY zwischenpruefung");
    const amtValues = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE aktiv=1 AND zustaendiges_amt != '' ORDER BY zustaendiges_amt");
    // Pre-compute per-class: which ZP values + which Amt values
    const classZP = {}, classAmt = {};
    klassen.forEach(k => {
      const zps = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE klasse_id=? AND aktiv=1 AND zwischenpruefung != ''", [k.id]);
      classZP[k.id] = zps.map(r => r.zwischenpruefung);
      const amts = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE klasse_id=? AND aktiv=1 AND zustaendiges_amt != ''", [k.id]);
      classAmt[k.id] = amts.map(r => r.zustaendiges_amt);
    });
    this._terminClassZP = classZP;
    this._terminClassAmt = classAmt;

    // Group classes by school for display
    const bySchool = {};
    klassen.forEach(k => {
      if (!bySchool[k.schule]) bySchool[k.schule] = [];
      bySchool[k.schule].push(k);
    });

    App.openModal('Termin bearbeiten', `
      <!-- Typ-Toggle -->
      <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--clr-sand);border-radius:var(--radius);overflow:hidden">
        <button id="btnTypSchule" class="btn" style="flex:1;border-radius:0;border:none;background:${isEinsendung ? 'var(--clr-warm)' : 'var(--clr-forest)'};color:${isEinsendung ? 'var(--clr-text)' : 'white'};font-size:13px;padding:8px" onclick="document.getElementById('sectionEinsendungExtra').style.display='none';this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypEinsend').style.background='var(--clr-warm)';document.getElementById('btnTypEinsend').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='schulkontrolle'">
          🏫 Schulkontrolle
        </button>
        <button id="btnTypEinsend" class="btn" style="flex:1;border-radius:0;border:none;background:${isEinsendung ? 'var(--clr-forest)' : 'var(--clr-warm)'};color:${isEinsendung ? 'white' : 'var(--clr-text)'};font-size:13px;padding:8px" onclick="document.getElementById('sectionEinsendungExtra').style.display='';this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypSchule').style.background='var(--clr-warm)';document.getElementById('btnTypSchule').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='einsendung'">
          📬 Einsendung / Einzelprüfung
        </button>
      </div>
      <input type="hidden" id="mKtTyp" value="${esc(t.typ || 'schulkontrolle')}">

      <div class="form-group">
        <label>Klassen / Gruppen auswählen</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">📅 Abschlussprüfung: Alle</option>
            ${jahrgaenge.map(j => `<option value="${esc(j)}">${App.jgLabel(j)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">📝 Zwischenprüfung: Alle</option>
            ${zpValues.map(z => `<option value="${esc(z.zwischenpruefung)}">${App.zpLabel(z.zwischenpruefung)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">🏫 Schule: Alle</option>
            ${schulen.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">🏛 Amt: Alle</option>
            ${amtValues.map(a => `<option value="${esc(a.zustaendiges_amt)}">${a.zustaendiges_amt} ${App.AEMTER[a.zustaendiges_amt]||''}</option>`).join('')}
          </select>
          <select class="form-control" style="width:auto;font-size:11px;padding:2px 6px" onchange="PlanungHandler._filterTerminKlassen()">
            <option value="">🌿 Fachrichtung: Alle</option>
            ${fachrichtungen.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}
          </select>
        </div>
        <div id="terminKlassenList" style="max-height:200px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);padding:8px">
          ${Object.entries(bySchool).map(([schule, kls]) => `
            <div class="termin-school-group" data-school="${esc(schule)}" style="margin-bottom:8px">
              <div style="font-weight:600;font-size:12px;color:var(--clr-forest);margin-bottom:4px;border-bottom:1px solid var(--clr-sand);padding-bottom:2px">${esc(schule)}</div>
              ${kls.map(k => {
                const frLabel = (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '');
                return `<div class="check-row termin-kl-row" data-jg="${esc(k.jg_bez||'')}" data-bs="${esc(k.schule)}" data-fr="${esc(frLabel)}" data-kid="${k.id}">
                <input type="checkbox" class="chk-termin-kl" value="${k.id}" data-jg="${k.jahrgang_id}" data-bs="${k.berufsschule_id||""}" onchange="PlanungHandler.updateBpHint&&PlanungHandler.updateBpHint()" ${selectedIds.includes(k.id)?'checked':''}>
                <span style="font-size:13px">${esc(k.klassenbezeichnung)} <small style="color:var(--clr-text-light)">(${k.schueler_count} Sch.)</small></span>
              </div>`}).join('')}
            </div>
          `).join('')}
        </div>
        <div style="font-size:10px;color:var(--clr-text-light);margin-top:4px">Filter grenzen die Klassenliste ein. Mehrere Klassen gleichzeitig auswählbar.</div>
      </div>

      <!-- Smart-Standort: Zeigt aktuelle Schulstandorte inkl. Landesfachklassen -->
      <div id="smartStandortBox" style="display:none;margin-top:12px;padding:12px 16px;background:linear-gradient(135deg,#f0e6f6,#e8d5f5);border:1px solid #d4b8e8;border-radius:var(--radius)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <strong style="font-size:13px;color:#7b2fa0">🏫 Aktuelle Schulstandorte</strong>
          <span style="font-size:11px;color:var(--clr-text-light)">(Berücksichtigt Landesfachklassen)</span>
        </div>
        <div id="smartStandortContent"></div>
      </div>

      <!-- NUR BEI EINSENDUNG: Zusätzlich einzelne Schüler manuell hinzufügen -->
      <div id="sectionEinsendungExtra" style="display:${isEinsendung ? '' : 'none'};margin-top:12px;padding:12px 16px;background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius)">
        <div class="form-group" style="margin-bottom:8px">
          <label style="font-weight:600;color:var(--clr-forest)">Zusätzlich einzelne Schüler hinzufügen (optional)</label>
          <input class="form-control" id="mKtEinsendSuche" placeholder="Name eingeben…" style="margin-bottom:6px" oninput="PlanungHandler._searchEinsendSchueler(this.value)">
          <div id="mKtEinsendResults" style="max-height:150px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);display:none"></div>
        </div>
        <div id="mKtEinsendSelected" style="display:flex;flex-wrap:wrap;gap:4px"></div>
        <div id="einsendCountInfo" style="font-size:11px;color:var(--clr-text-light);margin-top:4px"></div>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Geplantes Datum</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="date" class="form-control" id="mKtDatum" value="${t.geplant_datum}" onchange="PlanungHandler._updateKwHighlight()" style="flex:1">
            <span id="mKtKwLabel" style="font-size:12px;color:var(--clr-forest);font-weight:600;white-space:nowrap"></span>
          </div>
        </div>
        <div class="form-group"><label>Prüfer (mehrere möglich)</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;padding:6px 0">
            ${(() => { const current = (t.pruefer||'').split(',').map(s=>s.trim()).filter(Boolean); return pruefer.map(p => `<label style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--clr-warm);border-radius:6px;cursor:pointer;font-size:13px;border:1px solid var(--clr-sand)">
              <input type="checkbox" class="chk-pruefer" value="${esc(p.name)}" ${current.includes(p.name)?'checked':''} style="accent-color:var(--clr-forest)"> ${esc(p.name)}
            </label>`).join(''); })()}
          </div>
        </div>
      </div>
      <div class="form-group"><label>Bemerkung</label><textarea class="form-control" id="mKtBem" rows="2">${esc(t.bemerkung)}</textarea></div>
      <div id="bpKwPicker" style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:11px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="color:var(--clr-forest)">📅 KW-Kalender – Klick = Datum setzen</strong>
          <div style="display:flex;gap:8px;font-size:10px">
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--clr-green);border-radius:2px;vertical-align:middle"></span> Alle LJ</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#a7d7a7;border-radius:2px;vertical-align:middle"></span> Teilweise</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:var(--clr-sand);border-radius:2px;vertical-align:middle"></span> Kein LJ</span>
          </div>
        </div>
        <div id="bpKwGrid" style="color:var(--clr-text-light)">Wird geladen…</div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="PlanungHandler.saveTermin(${id})">Speichern</button>`);
    // Initialize state for Einsendung / Smart-Standort
    this._einsendSchuelerIds = [...linkedSchuelerIds];
    this._einsendSchuelerData = allSchueler;
    this._standortSchuelerIds = [];
    // Pre-render linked students
    if (linkedSchuelerIds.length) this._renderEinsendSelected();
    setTimeout(() => { PlanungHandler._updateKwHighlight(); PlanungHandler.updateBpHint(); }, 50);
  },
  deleteTermin(id) {
    if (!confirm('Termin löschen?')) return;
    App.run('DELETE FROM kontrolltermin_klassen WHERE kontrolltermin_id=?', [id]);
    App.run('DELETE FROM kontrolltermine WHERE id=?', [id]);
    App.invalidateTerminCache();
    Views.planung();
  },
  exportICS() {
    const termine = App.query(`SELECT kt.*
      FROM kontrolltermine kt
      WHERE kt.status='geplant' ORDER BY kt.geplant_datum`);
    if (!termine.length) return App.toast('Keine Termine zum Exportieren', 'warning');
    App.exportICS(termine.map(t => {
      const klassen = App.getTerminKlassen(t.id);
      const schule = klassen.length ? klassen[0].schule : '?';
      const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
      return {
        date: t.geplant_datum,
        title: `BH-Kontrolle: ${schule} – ${klassenStr}`,
        description: `Prüfer: ${t.pruefer}`
      };
    }));
    App.toast('ICS-Datei exportiert', 'success');
  },

  // ── Batch PDF: Alle Durchsichtsbögen eines Kontrolltermins ──
  exportTerminPDF(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return App.toast('Termin nicht gefunden', 'error');
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
    const schule = klassen.length ? klassen[0].schule : '?';
    const fachrichtung = [...new Set(klassen.map(k => k.fachrichtung).filter(Boolean))].join(', ') || '';
    // Enrich termin object for PDF
    termin.klassenbezeichnung = klassenStr;
    termin.schule = schule;
    termin.fachrichtung = fachrichtung;
    termin.lehrjahr = '';
    const schuelerList = App.getTerminSchueler(terminId);
    if (!schuelerList.length) return App.toast('Keine Schüler für diesen Termin', 'warning');
    PDFExport.generateBatch(doc => doc, termin, terminId, schuelerList);
  },

  // ── Jahresplanungs-Assistent ──
  jahresplanAssistent() {
    const gfK = App.gf('klassen');
    const klassen = App.query(`SELECT k.*, bs.name as schule, bs.ort as schule_ort, j.bezeichnung as jg_bez,
      (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as schueler_count
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      WHERE (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) > 0${gfK}
      ORDER BY bs.name, k.klassenbezeichnung`);
    const pruefer = App.query('SELECT * FROM pruefer WHERE aktiv=1 ORDER BY name');
    if (!klassen.length) return App.toast('Keine Klassen mit aktiven Schülern vorhanden', 'warning');

    // Group by school
    const bySchool = {};
    klassen.forEach(k => {
      const key = `${k.schule} (${k.schule_ort})`;
      if (!bySchool[key]) bySchool[key] = [];
      bySchool[key].push(k);
    });

    const today = new Date();
    const defaultStart = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
    const endYear = today.getMonth() >= 7 ? today.getFullYear() + 1 : today.getFullYear();
    const defaultEnd = `${endYear}-07-31`;

    App.openModal('📅 Jahresplanungs-Assistent', `
      <p style="font-size:13px;color:var(--clr-text-light);margin-bottom:12px">
        Erstellt automatisch Kontrolltermine für alle ausgewählten Klassen. Die Termine werden gleichmäßig über den Zeitraum verteilt.
      </p>
      <div class="form-row">
        <div class="form-group"><label>Zeitraum von</label><input type="date" class="form-control" id="jpStart" value="${defaultStart}"></div>
        <div class="form-group"><label>Zeitraum bis</label><input type="date" class="form-control" id="jpEnd" value="${defaultEnd}"></div>
      </div>
      <div class="form-group">
        <label>Prüfer zuweisen</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">
          ${pruefer.map(p => `<label style="display:flex;align-items:center;gap:4px;padding:3px 8px;background:var(--clr-warm);border-radius:6px;cursor:pointer;font-size:12px;border:1px solid var(--clr-sand)">
            <input type="checkbox" class="jp-pruefer" value="${esc(p.name)}" checked style="accent-color:var(--clr-forest)"> ${esc(p.name)}
          </label>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--clr-text-light);margin-top:2px">Alle markierten Prüfer werden jedem Termin zugewiesen</div>
      </div>
      <div class="form-group">
        <label>Klassen auswählen</label>
        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);padding:8px">
          ${Object.entries(bySchool).map(([school, kls]) => `
            <div style="margin-bottom:8px">
              <div style="font-weight:600;font-size:12px;color:var(--clr-sage);margin-bottom:4px">${esc(school)}</div>
              ${kls.map(k => `<label style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:13px;cursor:pointer">
                <input type="checkbox" class="jp-kl" value="${k.id}" checked>
                ${esc(k.klassenbezeichnung)} <span style="color:var(--clr-text-light);font-size:11px">(${k.schueler_count} Schüler)</span>
              </label>`).join('')}
            </div>
          `).join('')}
        </div>
      </div>
      <div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px;color:var(--clr-text-light)" id="jpPreview">
        Vorschau: ${klassen.length} Termine werden erstellt
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="PlanungHandler.doJahresplan()">Termine erstellen</button>`);
  },

  doJahresplan() {
    const start = new Date(document.getElementById('jpStart').value);
    const end = new Date(document.getElementById('jpEnd').value);
    if (isNaN(start) || isNaN(end) || start >= end) return App.toast('Ungültiger Zeitraum', 'error');

    const selectedIds = [...document.querySelectorAll('.jp-kl:checked')].map(c => parseInt(c.value));
    if (!selectedIds.length) return App.toast('Keine Klassen ausgewählt', 'warning');

    const prueferNames = [...document.querySelectorAll('.jp-pruefer:checked')].map(c => c.value).join(', ');

    // Calculate evenly spaced dates
    const totalDays = Math.floor((end - start) / 86400000);
    const gap = Math.max(Math.floor(totalDays / selectedIds.length), 1);
    let count = 0;

    selectedIds.forEach((klasseId, i) => {
      const d = new Date(start.getTime() + i * gap * 86400000);
      // Skip weekends
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      if (d > end) d.setTime(end.getTime());

      const dateStr = d.toISOString().split('T')[0];
      const pr = prueferNames || '';
      const klasse = App.query('SELECT jahrgang_id FROM klassen WHERE id=?', [klasseId])[0];
      const jgId = klasse?.jahrgang_id || 1;

      App.run('INSERT INTO kontrolltermine (klasse_id, jahrgang_id, geplant_datum, pruefer, status) VALUES (?,?,?,?,?)',
        [klasseId, jgId, dateStr, pr, 'geplant']);
      const terminId = App.scalar('SELECT last_insert_rowid()');
      App.run('INSERT INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [terminId, klasseId]);
      count++;
    });

    App.invalidateTerminCache();
    App.closeModal();
    Views.planung();
    App.toast(`${count} Termine erstellt (${document.getElementById('jpStart').value} bis ${document.getElementById('jpEnd').value})`, 'success');
  }
};
