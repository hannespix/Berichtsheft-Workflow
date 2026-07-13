// ╔══════════════════════════════════════════════════════════════╗
// ║  GLOBALE SUCHE (Ctrl+K)                                      ║
// ║  Fuzzy + Multi-Token über ALLE Felder, mit Relevanz-Ranking  ║
// ╚══════════════════════════════════════════════════════════════╝
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
    document.getElementById('globalSearchResults').innerHTML = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Name, Betrieb, Schule, Klasse, Ort, Tel, E-Mail, Bemerkungen… – mehrere Begriffe kombinierbar, Tippfehler werden toleriert</div>';
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

  // ═══ Such-Engine ═══
  // Normalisierung: Kleinschreibung, deutsche Umlaute (ä→ae …), Akzente weg.
  // Damit findet "mueller" den "Müller" und "Jose" den "José".
  _norm(s) {
    return String(s ?? '').toLowerCase()
      .replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue').replace(/\u00df/g, 'ss')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  },
  // Zweite Variante ohne Umlaut-Expansion (ü→u statt ü→ue): "muler" (Tippfehler)
  // liegt sonst 2 Edits von "mueller" entfernt, aber nur 1 von "muller"
  _norm2(s) {
    return String(s ?? '').toLowerCase().replace(/\u00df/g, 'ss')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  },
  _tokenize(q) {
    return this._norm(q).split(/[,;\s]+/).map(t => t.trim()).filter(Boolean);
  },
  // Bounded Levenshtein mit Frühabbruch (Rückgabe max+1 = "zu weit weg")
  _lev(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  },
  // Score eines Tokens gegen einen Heuhaufen (0 = kein Treffer).
  // Stufen: ganzes Wort > Wortanfang > Teilstring > Fuzzy (Tippfehler).
  _tokenScore(token, hay) {
    if (hay.full.includes(token)) {
      for (const w of hay.words) {
        if (w === token) return 100;
        if (w.startsWith(token)) return 80;
      }
      return 60;
    }
    // Fuzzy nur ab 4 Zeichen (sonst zu viel Rauschen); 2 Fehler ab 7 Zeichen
    const maxDist = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
    if (!maxDist) return 0;
    for (const w of hay.words) {
      if (w.length < 3) continue;
      if (this._lev(token, w, maxDist) <= maxDist) return 40;
      // Fuzzy-Wortanfang: "muler" trifft auch "mullerbach"
      if (w.length > token.length + maxDist &&
          this._lev(token, w.slice(0, token.length + 1), maxDist) <= maxDist) return 32;
    }
    return 0;
  },
  // Heuhaufen aus Feldwerten bauen (einmal pro Zeile)
  _hay(values) {
    const joined = values.filter(v => v !== null && v !== undefined && v !== '').join(' ');
    // Beide Normalisierungsvarianten in den Heuhaufen (mueller UND muller)
    const full = this._norm(joined) + ' ' + this._norm2(joined);
    return { full, words: [...new Set(full.split(/[^a-z0-9@.\-]+/).filter(Boolean))] };
  },
  // Gesamt-Score: ALLE Tokens müssen treffen (UND, jeder Token in irgendeinem
  // Feld); Treffer in Primärfeldern (Namen, Nummern) geben Bonus
  _score(tokens, hay, primaryHay) {
    let total = 0;
    for (const t of tokens) {
      const s = this._tokenScore(t, hay);
      if (!s) return 0;
      total += s;
      if (primaryHay && this._tokenScore(t, primaryHay)) total += 20;
    }
    return total;
  },

  search(q) {
    q = q.trim();
    const res = document.getElementById('globalSearchResults');
    if (q.length < 2) { res.innerHTML = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Mindestens 2 Zeichen…</div>'; this._results = []; return; }

    const tokens = this._tokenize(q);
    if (!tokens.length) { res.innerHTML = ''; this._results = []; return; }
    let html = '';
    this._results = [];
    this._selectedIdx = -1;

    // ── Azubis: ALLE Felder inkl. Betrieb, Schule, Klasse, Bemerkungen; auch inaktive ──
    const schuelerAll = App.query(`SELECT s.*, k.klassenbezeichnung, k.lehrjahr, bs.name as schule, bs.ort as schule_ort,
        b.name as b_name, b.ort as b_ort, b.email as b_email, b.telefon as b_tel, b.betriebsnummer as b_nr,
        b.strasse as b_str, b.plz as b_plz, b.ansprechpartner as b_ansp, b.zusatzbezeichnung as b_zusatz,
        j.bezeichnung as jahrgang, fr.bezeichnung as fr_name, fr.code as fr_code,
        (SELECT GROUP_CONCAT(text, ' ') FROM schueler_bemerkungen WHERE schueler_id = s.id) as bem_text
      FROM schueler s
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON s.fachrichtung_id=fr.id`);
    const schueler = [];
    for (const s of schuelerAll) {
      const hay = this._hay([s.nachname, s.vorname, s.ibykus_id, s.email, s.telefon, s.ausbildungsstaette,
        s.zustaendiges_amt, s.bav_status, s.status, s.geschlecht, s.schulabschluss, s.beruf_id,
        s.ausbildungsbeginn, s.ausbildungsende, s.geburtsdatum, s.inaktiv_grund,
        s.b_name, s.b_ort, s.b_email, s.b_tel, s.b_nr, s.b_str, s.b_plz, s.b_ansp, s.b_zusatz,
        s.schule, s.schule_ort, s.klassenbezeichnung, s.jahrgang, s.fr_name, s.fr_code, s.bem_text]);
      const primary = this._hay([s.nachname, s.vorname, s.b_name, s.ibykus_id]);
      let score = this._score(tokens, hay, primary);
      if (score) {
        if (!s.aktiv) score -= 25; // inaktive weiter hinten einsortieren
        schueler.push({ s, score });
      }
    }
    schueler.sort((a, b) => b.score - a.score || String(a.s.nachname).localeCompare(String(b.s.nachname)));
    const sTop = schueler.slice(0, 20);

    if (sTop.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase">Azubis (' + (schueler.length > 20 ? '20 von ' + schueler.length : schueler.length) + ')</div>';
      sTop.forEach(({ s }) => {
        const ampel = App.getSchuelerAmpel(s.id);
        const ktrls = App.query('SELECT ke.ergebnis, kt.geplant_datum FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id WHERE ke.schueler_id=? AND ke.ergebnis!="" ORDER BY kt.geplant_datum DESC LIMIT 3', [s.id]);
        const snapCnt = App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE schueler_id=?', [s.id]) || 0;
        const oMgl = App.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes!=''", [s.id]) || 0;
        const wvO = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id]) || 0;
        const idx = this._results.length;
        this._results.push({ type: 'schueler', id: s.id, action: () => { App.navigate('stammdaten'); setTimeout(() => { StammdatenTab.show('azubis', document.querySelector('.tab-btn')); setTimeout(() => { StammdatenTab._azubiSearch = s.nachname; StammdatenTab.azubis(document.getElementById('stammdatenContent')); }, 50); }, 100); } });

        html += `<div class="gs-row" role="option" tabindex="-1" data-idx="${idx}" style="padding:8px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer${s.aktiv ? '' : ';opacity:0.65'}" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:14px" title="${esc(ampel.label)}">${ampel.icon}</span>
            <div style="flex:1;min-width:0">
              <div><strong>${esc(s.nachname)}, ${esc(s.vorname)}</strong>
                ${s.aktiv ? '' : '<span style="font-size:9px;padding:1px 4px;background:var(--clr-sand);color:var(--clr-text-light);border-radius:6px;margin-left:4px">inaktiv</span>'}
                ${oMgl > 0 ? '<span style="font-size:9px;padding:1px 4px;background:var(--clr-red);color:white;border-radius:6px;margin-left:4px" title="' + oMgl + ' KW(s) mit offenen Mängeln">' + oMgl + 'M</span>' : ''}
                ${wvO ? '<span style="font-size:9px;padding:1px 4px;background:var(--clr-amber);color:white;border-radius:6px;margin-left:2px" title="Offene Wiedervorlage">WV</span>' : ''}
              </div>
              <div style="font-size:11px;color:var(--clr-text-light);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:2px">
                <span>${esc(s.b_name || s.ausbildungsstaette || '')}</span>
                ${s.b_ort ? '<span>' + esc(s.b_ort) + '</span>' : ''}
                ${s.schule ? '<span>' + esc(s.schule) + '</span>' : ''}
                ${s.klassenbezeichnung ? '<span>' + esc(s.klassenbezeichnung) + '</span>' : ''}
                ${s.jahrgang ? '<span style="font-weight:600">' + esc(s.jahrgang) + '</span>' : ''}
              </div>
              <div style="font-size:10px;color:var(--clr-sage);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:1px">
                ${s.telefon ? '<span>☎︎ ' + esc(s.telefon) + '</span>' : ''}${s.email ? '<span>✉︎ ' + esc(s.email) + '</span>' : ''}
                ${!s.telefon && s.b_tel ? '<span>☎︎ ' + esc(s.b_tel) + ' (Betrieb)</span>' : ''}
                ${!s.email && s.b_email ? '<span>✉︎ ' + esc(s.b_email) + ' (Betrieb)</span>' : ''}
                ${s.ibykus_id ? '<span>ID:' + esc(s.ibykus_id) + '</span>' : ''}
                ${s.zustaendiges_amt ? '<span>Amt:' + esc(s.zustaendiges_amt) + '</span>' : ''}
              </div>
            </div>
            <div style="display:flex;gap:2px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;max-width:120px">
              ${ktrls.map(ke => '<span style="font-size:9px;padding:1px 4px;border-radius:4px;background:' + (ke.ergebnis === 'in_ordnung' ? 'var(--clr-green-light);color:var(--clr-green)' : 'var(--clr-red-light);color:var(--clr-red)') + '">' + formatDate(ke.geplant_datum).substring(0, 6) + '</span>').join('')}
              ${snapCnt ? '<span style="font-size:9px;padding:1px 4px;border-radius:4px;background:var(--clr-blue-light);color:var(--clr-blue)">' + snapCnt + 'x</span>' : ''}
            </div>
          </div>
        </div>`;
      });
    }

    // ── Betriebe: alle Spalten ──
    const betriebeAll = App.query(`SELECT *, (SELECT COUNT(*) FROM schueler WHERE betrieb_id=betriebe.id AND aktiv=1) as cnt FROM betriebe`);
    const betriebe = [];
    for (const b of betriebeAll) {
      const hay = this._hay([b.name, b.vorname, b.firma, b.ansprechpartner, b.strasse, b.plz, b.ort,
        b.telefon, b.fax, b.email, b.betriebsnummer, b.zusatzbezeichnung]);
      const score = this._score(tokens, hay, this._hay([b.name, b.betriebsnummer]));
      if (score) betriebe.push({ b, score });
    }
    betriebe.sort((x, y) => y.score - x.score || String(x.b.name).localeCompare(String(y.b.name)));
    const bTop = betriebe.slice(0, 8);
    if (bTop.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Betriebe (' + betriebe.length + ')</div>';
      bTop.forEach(({ b }) => {
        const idx = this._results.length;
        this._results.push({ type: 'betrieb', id: b.id, action: () => { App.navigate('stammdaten'); setTimeout(() => StammdatenTab.show('betriebe'), 100); setTimeout(() => StammdatenTab.showBetriebAzubis(b.id), 200); } });
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span></span>
          <div style="flex:1;min-width:0">
            <div><strong>${esc(b.name)}</strong>${b.vorname ? ' ' + esc(b.vorname) : ''} <span style="color:var(--clr-text-light);font-size:12px">${esc(b.ort || '')} · ${b.cnt} Azubis</span></div>
            <div style="font-size:10px;color:var(--clr-sage);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:1px">
              ${b.telefon ? '<span>☎︎ ' + esc(b.telefon) + '</span>' : ''}
              ${b.email ? '<span>✉︎ ' + esc(b.email) + '</span>' : ''}
              ${b.betriebsnummer ? '<span>Nr:' + esc(b.betriebsnummer) + '</span>' : ''}
              ${b.strasse ? '<span>' + esc(b.strasse) + ', ' + esc(b.plz || '') + ' ' + esc(b.ort || '') + '</span>' : ''}
            </div>
          </div>
        </div>`;
      });
    }

    // ── Ausbilder: alle Spalten + Betrieb ──
    const ausbilderAll = App.query(`SELECT a.*, b.name as betrieb_name, b.ort as betrieb_ort, b.id as betrieb_id FROM ausbilder a LEFT JOIN betriebe b ON a.betrieb_id=b.id`);
    const ausbilder = [];
    for (const a of ausbilderAll) {
      const hay = this._hay([a.nachname, a.vorname, a.telefon, a.email, a.mobil, a.funktion, a.betrieb_name, a.betrieb_ort]);
      const score = this._score(tokens, hay, this._hay([a.nachname, a.vorname]));
      if (score) ausbilder.push({ a, score });
    }
    ausbilder.sort((x, y) => y.score - x.score || String(x.a.nachname).localeCompare(String(y.a.nachname)));
    const aTop = ausbilder.slice(0, 8);
    if (aTop.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Ausbilder (' + ausbilder.length + ')</div>';
      aTop.forEach(({ a }) => {
        const idx = this._results.length;
        this._results.push({ type: 'ausbilder', id: a.id, action: () => { App.navigate('stammdaten'); if (a.betrieb_id) { setTimeout(() => StammdatenTab.showBetriebAzubis(a.betrieb_id), 200); } else { setTimeout(() => StammdatenTab.show('betriebe'), 100); } } });
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span></span>
          <div style="flex:1;min-width:0">
            <div><strong>${esc((a.vorname ? a.vorname + ' ' : '') + a.nachname)}</strong>${a.funktion ? ' <span style="color:var(--clr-text-light);font-size:12px">(' + esc(a.funktion) + ')</span>' : ''}</div>
            <div style="font-size:10px;color:var(--clr-sage);display:flex;flex-wrap:wrap;gap:2px 8px;margin-top:1px">
              ${a.betrieb_name ? '<span>' + esc(a.betrieb_name) + (a.betrieb_ort ? ' (' + esc(a.betrieb_ort) + ')' : '') + '</span>' : ''}
              ${a.telefon ? '<span>☎︎ ' + esc(a.telefon) + '</span>' : ''}
              ${a.mobil ? '<span>☎︎ ' + esc(a.mobil) + '</span>' : ''}
              ${a.email ? '<span>✉︎ ' + esc(a.email) + '</span>' : ''}
            </div>
          </div>
        </div>`;
      });
    }

    // ── Schulen: alle Spalten inkl. Ansprechpartner/Lehrer (JSON) ──
    const schulenAll = App.query(`SELECT *, (SELECT COUNT(*) FROM klassen WHERE berufsschule_id=berufsschulen.id) as kl_cnt, (SELECT COUNT(*) FROM schueler sq JOIN klassen kq ON sq.klasse_id=kq.id WHERE kq.berufsschule_id=berufsschulen.id AND sq.aktiv=1) as s_cnt FROM berufsschulen`);
    const schulen = [];
    for (const sc of schulenAll) {
      let anspText = '';
      try { anspText = (JSON.parse(sc.ansprechpartner_json || '[]') || []).map(x => Object.values(x || {}).join(' ')).join(' '); } catch (e) {}
      const hay = this._hay([sc.name, sc.ort, sc.strasse, sc.plz, sc.telefon, sc.email, sc.email_cc, anspText]);
      const score = this._score(tokens, hay, this._hay([sc.name]));
      if (score) schulen.push({ sc, score });
    }
    schulen.sort((x, y) => y.score - x.score || String(x.sc.name).localeCompare(String(y.sc.name)));
    const schTop = schulen.slice(0, 5);
    if (schTop.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Schulen (' + schulen.length + ')</div>';
      schTop.forEach(({ sc }) => {
        const idx = this._results.length;
        this._results.push({ type: 'schule', id: sc.id, action: () => { App.navigate('stammdaten'); setTimeout(() => StammdatenTab.show('schulen'), 100); } });
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span></span>
          <div style="flex:1"><strong>${esc(sc.name)}</strong> <span style="color:var(--clr-text-light);font-size:12px">${esc(sc.ort || '')} · ${sc.kl_cnt} Klassen · ${sc.s_cnt} Azubis</span></div>
          ${sc.email ? '<a href="mailto:' + esc(sc.email) + '" onclick="event.stopPropagation()" style="font-size:10px;color:var(--clr-forest);text-decoration:none">Mail</a>' : ''}
        </div>`;
      });
    }

    // ── Klassen ──
    const klassenAll = App.query(`SELECT k.*, bs.name as schule, bs.ort as schule_ort, j.bezeichnung as jahrgang, (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as cnt FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id`);
    const klassen = [];
    for (const k of klassenAll) {
      const hay = this._hay([k.klassenbezeichnung, k.lehrjahr, k.schule, k.schule_ort, k.jahrgang]);
      const score = this._score(tokens, hay, this._hay([k.klassenbezeichnung]));
      if (score) klassen.push({ k, score });
    }
    klassen.sort((x, y) => y.score - x.score || String(x.k.klassenbezeichnung).localeCompare(String(y.k.klassenbezeichnung)));
    const kTop = klassen.slice(0, 6);
    if (kTop.length) {
      html += '<div style="padding:4px 12px;font-size:10px;font-weight:600;color:var(--clr-sage);text-transform:uppercase;margin-top:4px">Klassen (' + klassen.length + ')</div>';
      kTop.forEach(({ k }) => {
        const idx = this._results.length;
        this._results.push({ type: 'klasse', id: k.id, action: () => { App.navigate('stammdaten'); setTimeout(() => StammdatenTab.show('klassen'), 100); } });
        html += `<div class="gs-row" role="option" data-idx="${idx}" style="padding:6px 12px;border-bottom:1px solid var(--clr-sand);cursor:pointer;display:flex;align-items:center;gap:8px" onmouseenter="this.style.background='var(--clr-warm)';GlobalSearch._selectedIdx=${idx}" onmouseleave="this.style.background=''" onclick="GlobalSearch._selectedIdx=${idx};GlobalSearch._activate()">
          <span></span>
          <div style="flex:1"><strong>${esc(k.klassenbezeichnung)}</strong> <span style="color:var(--clr-text-light);font-size:12px">${esc(k.schule)} · ${esc(k.jahrgang || '')} · ${k.cnt} Azubis</span></div>
        </div>`;
      });
    }

    if (!html) html = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Keine Ergebnisse – auch mit Tippfehler-Toleranz nicht. Anders schreiben oder weniger Begriffe?</div>';
    res.innerHTML = html;
  },

  showCheatSheet() {
    App.openModal('⌨︎ Tastenkürzel', `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:4px 16px;font-size:13px">
        <strong style="color:var(--clr-forest)">Ctrl+K</strong><span>Globale Suche</span>
        <strong style="color:var(--clr-forest)">Ctrl+S</strong><span>Datenbank speichern</span>
        <strong style="color:var(--clr-forest)">Ctrl+Z / Y</strong><span>Undo / Redo</span>
        <strong style="color:var(--clr-forest)">Ctrl+← / →</strong><span>Vorh. / Nächster Schüler</span>
        <strong style="color:var(--clr-forest)">Alt+1–8</strong><span>Navigation (Dashboard…Einstellungen)</span>
        <strong style="color:var(--clr-forest)">F1 oder ?</strong><span>Diese Hilfe anzeigen</span>
        <strong style="color:var(--clr-forest)">F5</strong><span>Datenbank von Disk neu laden</span>
        <strong style="color:var(--clr-forest)">Escape</strong><span>Modal / Sidebar schließen</span>
        <strong style="color:var(--clr-forest)">/</strong><span>Schüler suchen (Kontrolle)</span>
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
