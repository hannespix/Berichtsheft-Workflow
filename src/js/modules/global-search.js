const GlobalSearch = {
  _debounce: null,
  _selectedIdx: -1,
  _results: [], // array of {type, id, action}

  open() {
    const el = document.getElementById('globalSearchOverlay');
    el.style.display = '';
    const inp = document.getElementById('globalSearchInput');
    inp.value = '';
    inp.focus();
    this._selectedIdx = -1;
    this._results = [];
    document.getElementById('globalSearchResults').innerHTML = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Name, Betrieb, Schule, Klasse, Ort, Tel, E-Mail…</div>';
  },

  close() {
    document.getElementById('globalSearchOverlay').style.display = 'none';
  },

  _doSearch(val) {
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.search(val), 180);
  },

  _handleKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); this._activate(); }
    else if (e.key === 'Escape') { this.close(); }
  },

  _move(dir) {
    if (!this._results.length) return;
    this._selectedIdx = Math.max(-1, Math.min(this._results.length - 1, this._selectedIdx + dir));
    const rows = document.querySelectorAll('#globalSearchResults .gs-row');
    rows.forEach((r, i) => {
      r.style.background = i === this._selectedIdx ? 'var(--clr-leaf-light)' : '';
      r.setAttribute('aria-selected', i === this._selectedIdx ? 'true' : 'false');
    });
    if (this._selectedIdx >= 0 && rows[this._selectedIdx]) {
      rows[this._selectedIdx].scrollIntoView({ block: 'nearest' });
    }
  },

  _activate() {
    if (this._selectedIdx >= 0 && this._selectedIdx < this._results.length) {
      const r = this._results[this._selectedIdx];
      this.close();
      if (r.action) r.action();
    }
  },

  search(q) {
    q = q.trim();
    const res = document.getElementById('globalSearchResults');
    if (q.length < 2) { res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Mindestens 2 Zeichen…</div>'; this._results = []; return; }

    const tokens = q.split(/[,;\s]+/).map(t => t.trim()).filter(t => t.length > 0);
    let html = '';
    this._results = [];
    this._selectedIdx = -1;

    // ── Schüler (ALL, no global filter) ──
    let sWhere = 's.aktiv=1';
    const sParams = [];
    tokens.forEach(t => {
      const p = `%${t}%`;
      sWhere += " AND (s.nachname LIKE ? OR s.vorname LIKE ? OR s.ausbildungsstaette LIKE ? OR s.ibykus_id LIKE ? OR s.email LIKE ? OR s.telefon LIKE ? OR s.zustaendiges_amt LIKE ? OR s.bav_status LIKE ? OR b.name LIKE ? OR b.ort LIKE ? OR b.email LIKE ? OR b.telefon LIKE ? OR b.betriebsnummer LIKE ? OR bs.name LIKE ? OR k.klassenbezeichnung LIKE ? OR fr.bezeichnung LIKE ?)";
      sParams.push(p,p,p,p,p,p,p,p,p,p,p,p,p,p,p,p);
    });
    const schueler = App.query(`SELECT s.*, k.klassenbezeichnung, bs.name as schule, b.name as b_name, b.ort as b_ort, b.email as b_email, b.telefon as b_tel, b.betriebsnummer as b_nr, b.strasse as b_str, b.plz as b_plz, b.id as b_dbid, j.bezeichnung as jahrgang, fr.bezeichnung as fr_name FROM schueler s LEFT JOIN klassen k ON s.klasse_id=k.id LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id WHERE ${sWhere} ORDER BY s.nachname LIMIT 20`, sParams);

    if (schueler.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase">Azubis ('+schueler.length+')</div>';
      schueler.forEach(s => {
        const ampel = App.getSchuelerAmpel(s.id);
        const ktrls = App.query('SELECT ke.ergebnis, kt.geplant_datum FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? AND ke.ergebnis!="" ORDER BY kt.geplant_datum DESC LIMIT 3', [s.id]);
        const snapCnt = App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id=?', [s.id]) || 0;
        const oMgl = App.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes!=''", [s.id]) || 0;
        const wvO = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id]) || 0;
        const idx = this._results.length;
        this._results.push({ type: 'schueler', id: s.id, action: () => { App.navigate('stammdaten'); setTimeout(()=>{ StammdatenTab.show('azubis', document.querySelector('.tab-btn')); setTimeout(()=>{ StammdatenTab._azubiSearch = s.nachname; StammdatenTab.azubis(document.getElementById('stammdatenContent')); }, 50); }, 100); }});

        html += `<div class="gs-row" role="option" tabindex="-1" data-idx="${idx}" style="padding:8px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:14px" title="${esc(ampel.label)}">${ampel.icon}</span>
            <div style="flex:1;min-width:0">
              <div><strong>${esc(s.nachname)}, ${esc(s.vorname)}</strong>
                ${oMgl > 0 ? '<span style="font-size:9px;padding:1px 4px;background:var(--clr-red);color:white;border-radius:6px;margin-left:4px" title="'+oMgl+' KW(s) mit offenen Mängeln">'+oMgl+'M</span>' : ''}
                ${wvO ? '<span style="font-size:9px;padding:1px 4px;background:var(--clr-amber);color:white;border-radius:6px;margin-left:2px" title="Offene Wiedervorlage">WV</span>' : ''}
              </div>
              <div style="font-size:11px;color:var(--clr-text-light);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:2px">
                <span>${esc(s.b_name||s.ausbildungsstaette||'')}</span>
                ${s.b_ort ? '<span>'+esc(s.b_ort)+'</span>' : ''}
                ${s.schule ? '<span>'+esc(s.schule)+'</span>' : ''}
                ${s.klassenbezeichnung ? '<span>'+esc(s.klassenbezeichnung)+'</span>' : ''}
                ${s.jahrgang ? '<span style="font-weight:600">'+esc(s.jahrgang)+'</span>' : ''}
              </div>
              <div style="font-size:10px;color:var(--clr-sage);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:1px">
                ${s.telefon ? '<span>📞 '+esc(s.telefon)+'</span>' : ''}${s.email ? '<span>✉ '+esc(s.email)+'</span>' : ''}
                ${!s.telefon && s.b_tel ? '<span>📞 '+esc(s.b_tel)+' (Betrieb)</span>' : ''}
                ${!s.email && s.b_email ? '<span>✉ '+esc(s.b_email)+' (Betrieb)</span>' : ''}
                ${s.ibykus_id ? '<span>ID:'+esc(s.ibykus_id)+'</span>' : ''}
                ${s.zustaendiges_amt ? '<span>Amt:'+esc(s.zustaendiges_amt)+'</span>' : ''}
              </div>
            </div>
            <div style="display:flex;gap:2px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;max-width:120px">
              ${ktrls.map(ke => '<span style="font-size:9px;padding:1px 4px;border-radius:4px;background:'+(ke.ergebnis==='in_ordnung'?'var(--clr-green-light);color:var(--clr-green)':'var(--clr-red-light);color:var(--clr-red)')+'">'+formatDate(ke.geplant_datum).substring(0,6)+'</span>').join('')}
              ${snapCnt ? '<span style="font-size:9px;padding:1px 4px;border-radius:4px;background:var(--clr-blue-light);color:var(--clr-blue)">'+snapCnt+'x</span>' : ''}
            </div>
          </div>
        </div>`;
      });
    }

    // ── Betriebe (ALL, no global filter) ──
    let bWhere = '1=1';
    const bParams = [];
    tokens.forEach(t => { const p=`%${t}%`; bWhere += " AND (name LIKE ? OR ort LIKE ? OR email LIKE ? OR telefon LIKE ? OR vorname LIKE ? OR betriebsnummer LIKE ? OR zusatzbezeichnung LIKE ? OR strasse LIKE ? OR plz LIKE ?)"; bParams.push(p,p,p,p,p,p,p,p,p); });
    const betriebe = App.query(`SELECT *, (SELECT COUNT(*) FROM schueler WHERE betrieb_id=betriebe.id AND aktiv=1) as cnt FROM betriebe WHERE ${bWhere} ORDER BY name LIMIT 5`, bParams);
    if (betriebe.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Betriebe ('+betriebe.length+')</div>';
      betriebe.forEach(b => {
        const idx = this._results.length;
        this._results.push({ type: 'betrieb', id: b.id, action: () => { App.navigate('stammdaten'); setTimeout(()=>StammdatenTab.show('betriebe'), 100); setTimeout(()=>StammdatenTab.showBetriebAzubis(b.id), 200); }});
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span>🏢</span>
          <div style="flex:1;min-width:0">
            <div><strong>${esc(b.name)}</strong>${b.vorname?' '+esc(b.vorname):''} <span style="color:var(--clr-text-light);font-size:12px">${esc(b.ort||'')} · ${b.cnt} Azubis</span></div>
            <div style="font-size:10px;color:var(--clr-sage);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:1px">
              ${b.telefon ? '<span>📞 '+esc(b.telefon)+'</span>' : ''}
              ${b.email ? '<span>✉ '+esc(b.email)+'</span>' : ''}
              ${b.betriebsnummer ? '<span>Nr:'+esc(b.betriebsnummer)+'</span>' : ''}
              ${b.strasse ? '<span>'+esc(b.strasse)+', '+esc(b.plz||'')+' '+esc(b.ort||'')+'</span>' : ''}
            </div>
          </div>
        </div>`;
      });
    }

    // ── Schulen (ALL) ──
    let schWhere = '1=1';
    const schParams = [];
    tokens.forEach(t => { const p=`%${t}%`; schWhere += " AND (name LIKE ? OR ort LIKE ? OR email LIKE ? OR email_cc LIKE ?)"; schParams.push(p,p,p,p); });
    const schulen = App.query(`SELECT *, (SELECT COUNT(*) FROM klassen WHERE berufsschule_id=berufsschulen.id) as kl_cnt, (SELECT COUNT(*) FROM schueler sq JOIN klassen kq ON sq.klasse_id=kq.id WHERE kq.berufsschule_id=berufsschulen.id AND sq.aktiv=1) as s_cnt FROM berufsschulen WHERE ${schWhere} ORDER BY name LIMIT 5`, schParams);
    if (schulen.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Schulen ('+schulen.length+')</div>';
      schulen.forEach(s => {
        const idx = this._results.length;
        this._results.push({ type: 'schule', id: s.id, action: () => { App.navigate('stammdaten'); setTimeout(()=>StammdatenTab.show('schulen'), 100); }});
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span>🏫</span>
          <div style="flex:1"><strong>${esc(s.name)}</strong> <span style="color:var(--clr-text-light);font-size:12px">${esc(s.ort||'')} · ${s.kl_cnt} Klassen · ${s.s_cnt} Azubis</span></div>
          ${s.email ? '<a href="mailto:'+esc(s.email)+'" onclick="event.stopPropagation()" style="font-size:10px;color:var(--clr-forest);text-decoration:none">Mail</a>' : ''}
        </div>`;
      });
    }

    // ── Klassen ──
    const like = `%${q}%`;
    const klassen = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jahrgang, (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as cnt FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id WHERE (k.klassenbezeichnung LIKE ? OR bs.name LIKE ?) ORDER BY bs.name LIMIT 5`, [like, like]);
    if (klassen.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Klassen ('+klassen.length+')</div>';
      klassen.forEach(k => {
        const idx = this._results.length;
        this._results.push({ type: 'klasse', id: k.id, action: () => { App.navigate('stammdaten'); setTimeout(()=>StammdatenTab.show('klassen'), 100); }});
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span>📚</span>
          <div style="flex:1"><strong>${esc(k.klassenbezeichnung)}</strong> <span style="color:var(--clr-text-light);font-size:12px">${esc(k.schule)} · ${esc(k.jahrgang||'')} · ${k.cnt} Azubis</span></div>
        </div>`;
      });
    }

    if (!html) html = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Keine Ergebnisse</div>';
    res.innerHTML = html;
  },

  showCheatSheet() {
    App.openModal('⌨️ Tastenkürzel', `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:4px 16px;font-size:13px">
        <strong style="color:var(--clr-forest)">Ctrl+K</strong><span>Globale Suche</span>
        <strong style="color:var(--clr-forest)">Ctrl+S</strong><span>Datenbank speichern</span>
        <strong style="color:var(--clr-forest)">Ctrl+Z / Y</strong><span>Undo / Redo</span>
        <strong style="color:var(--clr-forest)">Ctrl+← / →</strong><span>Vorh. / Nächster Schüler</span>
        <strong style="color:var(--clr-forest)">Alt+1–7</strong><span>Navigation (Dashboard…Berichte)</span>
        <strong style="color:var(--clr-forest)">F1 oder ?</strong><span>Diese Hilfe anzeigen</span>
        <strong style="color:var(--clr-forest)">F5</strong><span>Datenbank von Disk neu laden</span>
        <strong style="color:var(--clr-forest)">Escape</strong><span>Modal / Sidebar schließen</span>
        <div style="grid-column:span 2;border-top:1px solid var(--clr-sand);margin:6px 0;padding-top:6px;font-weight:600;color:var(--clr-forest)">KW-Grid (Kontrolle)</div>
        <strong style="color:var(--clr-forest)">A–I</strong><span>Mängelcode setzen</span>
        <strong style="color:var(--clr-forest)">0–5</strong><span>Fehltage setzen</span>
        <strong style="color:var(--clr-forest)">Entf / Backspace</strong><span>Zelle löschen</span>
        <strong style="color:var(--clr-forest)">Pfeiltasten</strong><span>Navigation im Grid</span>
        <strong style="color:var(--clr-forest)">Tab</strong><span>Nächste Zelle</span>
      </div>
    `, '<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>');
  }
};
