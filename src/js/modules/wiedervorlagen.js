const WiedervorlagenHandler = {
  // Filter der WV-Liste: „unerledigt" (offen + überfällig) ist der Standard –
  // „nur offene" versteckte die überfälligen, also die dringendsten
  // Eben geänderte Zeilen (erledigt / wieder geöffnet) bleiben trotz Filter
  // sichtbar, bis der Filter von Hand gewechselt oder die Ansicht verlassen
  // wird – sonst verschwände eine versehentlich erledigte Wiedervorlage sofort
  // aus „Unerledigt“ und ließe sich nicht an Ort und Stelle zurückstellen.
  _soeben: new Set(),
  filter(status, vonHand) {
    if (vonHand) this._soeben.clear();
    const rows = document.querySelectorAll('#wvTableBody tr');
    rows.forEach(r => {
      const st = r.dataset.status;
      let show;
      if (status === 'all') show = true;
      else if (status === 'unerledigt') show = st !== 'erledigt';
      else if (status === 'ohne_versand') show = st !== 'erledigt' && r.dataset.versand !== '1';
      else show = st === status;
      const eben = this._soeben.has(Number(r.dataset.id));
      if (eben) show = true;
      const hinweis = r.querySelector('.wv-soeben');
      if (hinweis) hinweis.hidden = !eben;
      r.style.display = show ? '' : 'none';
    });
  },
  // Liste und offene Seiten nach einer Statusänderung neu zeichnen; die
  // geänderte Zeile bleibt sichtbar und wird in den Blick geholt
  _auffrischen(ids, schuelerId) {
    (ids || []).forEach(id => this._soeben.add(Number(id)));
    try { if (App.currentView === 'wiedervorlagen') {
      Views.wiedervorlagen();
      const zeile = ids && ids.length === 1 && document.querySelector(`#wvTableBody tr[data-id="${Number(ids[0])}"]`);
      if (zeile && zeile.scrollIntoView) zeile.scrollIntoView({ block: 'nearest' });
    } } catch(e) {}
    try { if (schuelerId && typeof AzubiSeite !== 'undefined' && AzubiSeite.istOffen && AzubiSeite.istOffen(schuelerId)) AzubiSeite.render(); } catch(e) {}
    try { if (App.currentView === 'termin' && typeof TerminSeite !== 'undefined') TerminSeite.render(); } catch(e) {}
    try { App.updateBadges && App.updateBadges(); } catch(e) {}
  },

  // ── Status ändern (Spalte „Status“ der Liste) ──────────────────────────
  // Offen/Überfällig ↔ Erledigt. „Überfällig“ ist kein wählbarer Status,
  // sondern folgt aus der Frist.
  _statusNachFrist(frist) { return frist && frist < todayStr() ? 'ueberfaellig' : 'offen'; },
  statusWahlHtml(w) {
    const erledigt = w.status === 'erledigt';
    const wer = [w.nachname, w.vorname].filter(Boolean).join(', ');
    return `<select class="wv-status wv-status--${esc(w.status)}" aria-label="Status der Wiedervorlage${wer ? ' von ' + esc(wer) : ''} ändern" title="${erledigt ? 'Erledigt – „Wieder öffnen“ wählen, um die Wiedervorlage zurückzustellen' : 'Status ändern'}" onchange="WiedervorlagenHandler.statusSetzen(${w.id}, this.value, this)">
      <option value="offen"${erledigt ? '' : ' selected'}>${erledigt ? 'Wieder öffnen' : (w.status === 'ueberfaellig' ? 'Überfällig' : 'Offen')}</option>
      <option value="erledigt"${erledigt ? ' selected' : ''}>Erledigt</option>
    </select><div class="wv-soeben" hidden>eben geändert</div>`;
  },
  statusSetzen(id, wert, el) {
    const w = App.query('SELECT id, status FROM wiedervorlagen WHERE id=?', [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    // Die Auswahl zeigt weiter den gespeicherten Stand, bis der Dialog bestätigt ist
    if (el) el.value = w.status === 'erledigt' ? 'erledigt' : 'offen';
    if (wert === 'erledigt' && w.status !== 'erledigt') return this.erledigenDirekt(id);
    if (wert === 'offen' && w.status === 'erledigt') return this.wiederOeffnen(id);
  },

  // Wochen, die ÜBER eine Wiedervorlage als behoben markiert wurden, stehen in
  // wiedervorlagen.erledigt_behoben als [[aj, kw, 'A,B'], …] – nur so lässt
  // sich ein versehentliches Erledigen vollständig zurücknehmen.
  _behobenLesen(w) {
    try { const l = JSON.parse((w && w.erledigt_behoben) || '[]'); return Array.isArray(l) ? l.filter(z => Array.isArray(z) && z.length >= 3) : []; } catch(e) { return []; }
  },
  _behobenMerken(wvId, eintraege) {
    if (!wvId || !eintraege || !eintraege.length) return;
    try {
      const w = App.query('SELECT erledigt_behoben FROM wiedervorlagen WHERE id=?', [wvId])[0];
      if (!w) return;
      const map = new Map(this._behobenLesen(w).map(z => [z[0] + '_' + z[1], z]));
      eintraege.forEach(([aj, kw, codes]) => {
        const k = aj + '_' + kw, alt = map.get(k);
        const set = new Set([...(alt ? String(alt[2]).split(',') : []), ...String(codes || '').split(',')].filter(Boolean));
        if (set.size) map.set(k, [aj, kw, [...set].join(',')]);
      });
      // Eigene Anweisung: ein Rechner mit älterem Programmstand ohne diese
      // Spalte übernimmt die Statusänderung trotzdem
      App.run('UPDATE wiedervorlagen SET erledigt_behoben=? WHERE id=?', [JSON.stringify([...map.values()]), wvId]);
    } catch(e) { console.warn('erledigt_behoben:', e.message); }
  },
  // Was sich davon noch zurückholen lässt: Codes, die weiter als behoben
  // geführt werden und inzwischen nicht wieder als Mangel eingetragen sind
  _wochenZurueck(w) {
    const out = [];
    this._behobenLesen(w).forEach(([aj, kw, codes]) => {
      const row = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [w.schueler_id, aj, kw])[0];
      if (!row) return;
      const m = String(row.maengel_codes || '').split(',').filter(Boolean);
      const b = String(row.behobene_codes || '').split(',').filter(Boolean);
      const zur = String(codes || '').split(',').filter(c => c && b.includes(c) && !m.includes(c));
      if (zur.length) out.push({ row, aj, kw, m, b, zur });
    });
    return out;
  },
  _wochenZurueckholen(w) {
    const liste = this._wochenZurueck(w);
    liste.forEach(z => App.run('UPDATE kw_status SET maengel_codes=?, behobene_codes=? WHERE id=?',
      [[...new Set([...z.m, ...z.zur])].sort().join(','), z.b.filter(c => !z.zur.includes(c)).join(','), z.row.id]));
    return liste.length;
  },

  // Erledigte Wiedervorlage wieder öffnen (versehentlich erledigt)
  wiederOeffnen(id) {
    const w = App.query(`SELECT w.*, s.nachname, s.vorname, ke.ergebnis AS ke_ergebnis
      FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id WHERE w.id=?`, [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    if (w.status !== 'erledigt') return App.toast('Diese Wiedervorlage ist nicht erledigt', 'info');
    const wochen = this._wochenZurueck(w);
    const ohneDatum = !w.frist_datum;
    App.openModal('Wiedervorlage wieder öffnen – ' + esc(w.nachname) + ', ' + esc(w.vorname), `
      <p style="font-size:13px;margin-bottom:10px">Erledigt${w.erledigt_datum ? ' am <strong>' + formatDate(w.erledigt_datum) + '</strong>' : ''}${w.erledigt_bemerkung ? ' – ' + esc(w.erledigt_bemerkung) : ''}. Die Wiedervorlage (${wvArtLabel(w.art)}) wird wieder geöffnet; Erledigungsdatum und -bemerkung wandern als Notiz in den Verlauf.</p>
      <div class="form-row">
        <div class="form-group"><label for="mWvFristNeu">Frist</label><input type="date" class="form-control" id="mWvFristNeu" value="${esc(w.frist_datum || '')}">
          <div style="font-size:12px;color:var(--clr-text-light);margin-top:2px">${ohneDatum ? 'Leer = bei der nächsten Durchsicht (wie bisher).' : (w.frist_datum < todayStr() ? 'Die Frist ist abgelaufen – ohne neue Frist steht die Wiedervorlage sofort auf „Überfällig“.' : 'Die Frist läuft noch.')}</div>
        </div>
        <div class="form-group"><label for="mWvGrund">Grund (optional)</label><input type="text" class="form-control" id="mWvGrund" placeholder="z.B. versehentlich erledigt"></div>
      </div>
      ${wochen.length ? `<label style="display:flex;align-items:flex-start;gap:6px;font-size:13px;cursor:pointer;margin-bottom:8px">
        <input type="checkbox" id="mWvWochen" checked style="accent-color:var(--clr-forest);margin-top:2px"> <span>Die <strong>${wochen.length}</strong> über diese Wiedervorlage als behoben markierte${wochen.length === 1 ? ' Woche' : 'n Wochen'} wieder als offenen Mangel führen</span>
      </label>` : ''}
      ${w.ke_ergebnis === 'in_ordnung' ? '<p style="font-size:12px;color:var(--clr-amber);margin:0">Das Ergebnis der zugehörigen Durchsicht steht auf „In Ordnung“. Stimmt das nicht, bitte dort ebenfalls ändern (⋯ → Durchsicht öffnen).</p>' : ''}
    `, '<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button> <button class="btn btn-primary" onclick="WiedervorlagenHandler.doWiederOeffnen(' + id + ')">↺ Wieder öffnen</button>');
    setTimeout(() => document.getElementById('mWvGrund')?.focus(), 50);
  },
  // params (optional, für Tests und Sammelaktion): { frist, grund, wochen, still }
  doWiederOeffnen(id, params) {
    const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [id])[0];
    if (!w) { App.toast('Wiedervorlage nicht gefunden', 'error'); return null; }
    if (w.status !== 'erledigt') return null;
    const feld = document.getElementById('mWvFristNeu');
    const p = params || {
      frist: feld ? feld.value : undefined,
      grund: (document.getElementById('mWvGrund')?.value || '').trim(),
      wochen: !!document.getElementById('mWvWochen')?.checked,
    };
    const frist = p.frist === undefined || p.frist === null ? (w.frist_datum || '') : String(p.frist).trim();
    if (frist && !/^\d{4}-\d{2}-\d{2}$/.test(frist)) { App.toast('Bitte ein gültiges Datum als Frist angeben', 'warning'); return null; }
    const status = this._statusNachFrist(frist);
    const wochen = p.wochen ? this._wochenZurueckholen(w) : 0;
    App.run(`UPDATE wiedervorlagen SET status=?, frist_datum=?, erledigt_datum='', erledigt_bemerkung='', geaendert_am=datetime('now','localtime') WHERE id=?`, [status, frist, id]);
    if (wochen) { try { App.run("UPDATE wiedervorlagen SET erledigt_behoben='' WHERE id=?", [id]); } catch(e) {} }
    const wer = (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || App.currentUser || '';
    const teile = ['Wieder geöffnet – war' + (w.erledigt_datum ? ' am ' + formatDate(w.erledigt_datum) : '') + ' als erledigt markiert' + (w.erledigt_bemerkung ? ' (' + w.erledigt_bemerkung + ')' : '')];
    if ((w.frist_datum || '') !== frist) teile.push('Frist ' + (w.frist_datum ? formatDate(w.frist_datum) : 'nächste Durchsicht') + ' → ' + (frist ? formatDate(frist) : 'nächste Durchsicht'));
    if (wochen) teile.push(wochen + ' Woche' + (wochen === 1 ? '' : 'n') + ' wieder als offener Mangel');
    if (p.grund) teile.push('Grund: ' + p.grund);
    App.run('INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)', [id, teile.join(' · '), wer]);
    if (!p.still) {
      App.closeModal();
      this._auffrischen([id], w.schueler_id);
      App.toast(`Wiedervorlage wieder geöffnet (${status === 'ueberfaellig' ? 'überfällig' : 'offen'})${wochen ? ` · ${wochen} Woche${wochen === 1 ? '' : 'n'} wieder als offener Mangel` : ''}`, 'success');
    }
    return { status, frist, wochen };
  },

  erledigen(id) {
    // Look up the WV to find the kontrollergebnis and navigate to the Durchsicht
    const w = App.query('SELECT w.*, ke.kontrolltermin_id, w.schueler_id FROM wiedervorlagen w LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id WHERE w.id=?', [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');

    if (w.kontrolltermin_id) {
      // Navigate to Kontrolle view and open this student's Durchsicht
      KontrolleHandler.goToKontrolle(w.kontrolltermin_id, w.schueler_id);
      App.toast('Bitte Ergebnis auf „In Ordnung" setzen – Wiedervorlage wird automatisch erledigt', 'info');
    } else {
      // Fallback: kein Kontrolltermin verknüpft → direkt erledigen
      App.openModal('Wiedervorlage als erledigt markieren', '<div class="form-group"><label>Erledigungsdatum</label><input type="date" class="form-control" id="mWvDatum" value="' + todayStr() + '"></div><div class="form-group"><label>Bemerkung</label><textarea class="form-control" id="mWvBem" rows="2"></textarea></div>',
        '<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button> <button class="btn btn-success" onclick="WiedervorlagenHandler.doErledigen(' + id + ')">Als erledigt markieren</button>');
    }
  },
  NACHWEIS_ARTEN: { email: 'E-Mail', post: 'Post', persoenlich: 'persönlich vorgelegt', telefon: 'telefonisch bestätigt (nur mit anschließender Vorlage)', sonstig: 'sonstiger Nachweis' },
  // Beratungsgespräch mit dem Betrieb (§ 76 Abs. 1 BBiG: Förderung durch
  // Beratung) als Wiedervorlage vormerken – die Stufe zwischen Erinnerung und
  // Prüfungsausschuss, die in der Akte bisher fehlte. Frist aus den
  // Einstellungen, Notiz mit Anlass; Einladung über die Vorlage `beratung_betrieb`.
  async beratungAnlegen(schuelerId, params) {
    const s = App.query('SELECT s.*, b.name AS betrieb FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id WHERE s.id=?', [schuelerId])[0];
    if (!s) return App.toast('Azubi nicht gefunden', 'error');
    const p = params || {};
    const frist = p.frist || await App.prompt(`Beratungsgespräch mit ${s.betrieb || s.ausbildungsstaette || 'dem Betrieb'} zu ${s.nachname}, ${s.vorname} – bis wann (JJJJ-MM-TT)?`, { titel: 'Beratungsgespräch Betrieb (§ 76 BBiG)', wert: App.wvFrist('beratung_betrieb') });
    if (frist === null) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(frist)) { App.toast('Bitte ein Datum im Format JJJJ-MM-TT', 'warning'); return null; }
    const anlass = p.anlass != null ? p.anlass : await App.prompt('Anlass (erscheint in der Wiedervorlage und in der Einladung):', { titel: 'Beratungsgespräch Betrieb (§ 76 BBiG)', platzhalter: 'z.B. wiederholte Beanstandungen, Mängel trotz zweifacher Erinnerung nicht behoben' });
    if (anlass === null) return null;
    App.run("INSERT INTO wiedervorlagen (schueler_id, art, frist_datum, status) VALUES (?,'beratung_betrieb',?,'offen')", [schuelerId, frist]);
    const wvId = App.scalar('SELECT MAX(id) FROM wiedervorlagen WHERE schueler_id=? AND art=?', [schuelerId, 'beratung_betrieb']);
    if (wvId && anlass.trim()) App.run("INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)", [wvId, `Anlass: ${anlass.trim()}`, (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || App.currentUser || '']);
    App.toast('Beratungsgespräch als Wiedervorlage vorgemerkt', 'success');
    try { if (typeof AzubiSeite !== 'undefined' && AzubiSeite.istOffen && AzubiSeite.istOffen(schuelerId)) AzubiSeite.render(); } catch(e) {}
    try { if (App.currentView === 'wiedervorlagen') Views.wiedervorlagen(); } catch(e) {}
    return wvId;
  },
  // Direkt erledigen ohne Durchsicht – mit NACHWEIS: Art (E-Mail/Post/persönlich),
  // optional Datei in die Akte und „Mängel als behoben markieren", damit
  // Ampel und Zulassungsliste den Azubi als nachgewiesen erkennen
  erledigenDirekt(id) {
    const w = App.query('SELECT w.*, s.nachname, s.vorname FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id WHERE w.id=?', [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    const offeneMaengel = App.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != '' AND maengel_codes != 'H'", [w.schueler_id]) || 0;
    App.openModal('Wiedervorlage erledigen (Nachweis) – ' + esc(w.nachname) + ', ' + esc(w.vorname), `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">Der Betrieb/Azubi hat das Berichtsheft nachgereicht oder den Mangel anders nachgewiesen. Wurde das Heft tatsächlich erneut durchgesehen, besser „→ Durchsicht" nutzen.</div>
      <div class="form-row">
        <div class="form-group"><label>Erledigungsdatum</label><input type="date" class="form-control" id="mWvDatum" value="${todayStr()}"></div>
        <div class="form-group"><label>Nachweis</label>
          <select class="form-control" id="mWvNachweis">${Object.entries(this.NACHWEIS_ARTEN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group"><label>Bemerkung</label><textarea class="form-control" id="mWvBem" rows="2" placeholder="z.B. Berichte für KW 40–44 per E-Mail nachgereicht"></textarea></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-bottom:8px">
        <input type="checkbox" id="mWvBehoben" ${offeneMaengel ? 'checked' : ''} style="accent-color:var(--clr-forest)"> Nachweis erbracht – ${offeneMaengel ? `die <strong>${offeneMaengel}</strong> offenen Mängel im KW-Raster als behoben markieren` : 'keine offenen Mängel im Raster'}
      </label>
    `, '<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button> <button class="btn btn-success" onclick="WiedervorlagenHandler.doErledigen(' + id + ')">Als erledigt markieren</button>');
    setTimeout(() => document.getElementById('mWvBem')?.focus(), 50);
  },
  // params (optional, für Tests/andere Dialoge): {datum, bem, nachweis, behoben}
  async doErledigen(id, params) {
    const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');
    const p = params || {
      datum: document.getElementById('mWvDatum')?.value,
      bem: (document.getElementById('mWvBem')?.value || '').trim(),
      nachweis: document.getElementById('mWvNachweis')?.value || '',
      behoben: !!document.getElementById('mWvBehoben')?.checked,
    };
    const datum = p.datum || todayStr();
    const artLabel = this.NACHWEIS_ARTEN[p.nachweis] || '';
    const bem = (artLabel ? `Nachweis (${artLabel})` : '') + (p.bem ? (artLabel ? ': ' : '') + p.bem : '');
    let behoben = 0;
    const gemerkt = [];
    if (p.behoben) behoben = this._maengelBehoben(w.schueler_id, gemerkt);
    const dateien = 0; // Datei-Anhänge an Wiedervorlagen gibt es nicht mehr (Akte ohne Datei-Upload)
    App.run(`UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung=?, geaendert_am=datetime('now','localtime') WHERE id=?`, [datum, bem, id]);
    this._behobenMerken(id, gemerkt);
    App.closeModal();
    this._soeben.add(Number(id));
    try { Views.wiedervorlagen(); } catch(e) {}
    try { const zeile = document.querySelector(`#wvTableBody tr[data-id="${Number(id)}"]`); if (zeile && zeile.scrollIntoView) zeile.scrollIntoView({ block: 'nearest' }); } catch(e) {}
    App.toast(`Wiedervorlage erledigt${behoben ? ` · ${behoben} Woche(n) als behoben markiert` : ''}${dateien ? ` · ${dateien} Datei(en) in der Akte` : ''} – versehentlich? In der Spalte „Status“ auf „Wieder öffnen“ stellen`, 'success', 7000);
    return { behoben, dateien, bem };
  },
  // Alle offenen Mängel eines Azubis als behoben protokollieren (Nachweis ohne
  // erneute Durchsicht) – Historie bleibt in behobene_codes erhalten
  _maengelBehoben(schuelerId, gemerkt) {
    const rows = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != ""', [schuelerId]);
    rows.forEach(row => {
      const codes = row.maengel_codes.split(',').filter(Boolean);
      const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
      if (gemerkt) gemerkt.push([row.ausbildungsjahr, row.kalenderwoche, codes.join(',')]);
      App.run('UPDATE kw_status SET maengel_codes="", behobene_codes=? WHERE id=?', [[...new Set([...behoben, ...codes])].join(','), row.id]);
    });
    return rows.length;
  },

  details(id) {
    const w = App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette, s.klasse_id,
      ke.kontrolltermin_id, ke.ergebnis as ke_ergebnis, ke.bemerkung as ke_bemerkung,
      ke.fehltage_gesamt, ke.geaendert_am as ke_geaendert, ke.geaendert_von as ke_pruefer
      FROM wiedervorlagen w 
      JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id
      WHERE w.id=?`, [id])[0];
    if (!w) return App.toast('Wiedervorlage nicht gefunden', 'error');

    const notizen = App.query('SELECT * FROM wiedervorlage_notizen WHERE wiedervorlage_id=? ORDER BY erstellt_am DESC', [id]);
    const offeneMaengel = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != "" ORDER BY ausbildungsjahr, kalenderwoche', [w.schueler_id]);

    // Get all kontrollergebnisse for this student (for history)
    const alleKE = App.query(`SELECT ke.*, kt.geplant_datum, kt.pruefer as termin_pruefer
      FROM kontrollergebnisse ke
      JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? ORDER BY ke.erstellt_am DESC`, [w.schueler_id]);

    // Get all snapshots for this student
    const snapshots = App.query(`SELECT ds.*, ke2.kontrolltermin_id
      FROM durchsicht_snapshots ds 
      JOIN kontrollergebnisse ke2 ON ds.kontrollergebnis_id=ke2.id 
      WHERE ds.schueler_id=? ORDER BY ds.snapshot_datum DESC`, [w.schueler_id]);

    // Find the termin info for the "jump to kontrolle" link
    const terminInfo = w.kontrolltermin_id ? App.query(`SELECT kt.*, k.klassenbezeichnung
      FROM kontrolltermine kt
      LEFT JOIN klassen k ON kt.klasse_id=k.id
      WHERE kt.id=?`, [w.kontrolltermin_id])[0] : null;
    const klassen = w.kontrolltermin_id ? App.getTerminKlassen(w.kontrolltermin_id) : [];
    const terminLabel = terminInfo ? `${formatDate(terminInfo.geplant_datum)} – ${klassen.map(k=>k.klassenbezeichnung).join(' + ')}` : '';

    App.openModal(`Wiedervorlage: ${esc(w.nachname)}, ${esc(w.vorname)}`, `
      <!-- ── Info-Grid ── -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;margin-bottom:12px">
        <div><strong>Betrieb:</strong> ${esc(w.ausbildungsstaette)}</div>
        <div><strong>Art:</strong> ${wvArtLabel(w.art)}</div>
        <div><strong>Frist:</strong> ${w.frist_datum ? formatDate(w.frist_datum) : 'bei der nächsten Durchsicht'}</div>
        ${w.versand_datum ? `<div><strong>Versand:</strong> ${w.mahnstufe || 1}× angeschrieben, zuletzt ${formatDate(w.versand_datum)} per ${esc(w.versand_art === 'email' ? 'E-Mail' : (w.versand_art || 'Brief'))}</div>` : '<div style="color:var(--clr-text-light)"><strong>Versand:</strong> noch kein Anschreiben vermerkt</div>'}
        <div><strong>Status:</strong> ${wvStatusBadge(w.status)}</div>
        ${w.erledigt_datum ? `<div><strong>Erledigt am:</strong> ${formatDate(w.erledigt_datum)}</div>` : ''}
        ${w.erledigt_bemerkung ? `<div><strong>Bemerkung:</strong> ${esc(w.erledigt_bemerkung)}</div>` : ''}
      </div>

      <!-- ── Quick Actions: Zur Kontrolle + PDF ── -->
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px;background:var(--clr-leaf-light);border-radius:var(--radius);border:1px solid #c8deb8">
        ${w.kontrolltermin_id ? `<button class="btn btn-sm btn-primary" onclick="KontrolleHandler.goToKontrolle(${w.kontrolltermin_id},${w.schueler_id})" title="${esc(terminLabel)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
          Zur Kontrolle springen
        </button>` : ''}
        ${w.kontrolltermin_id ? `<button class="btn btn-sm btn-secondary" onclick="PDFExport.generateSingle(${w.kontrolltermin_id},${w.schueler_id})" title="Aktuellen Durchsichtsbogen als PDF">▤ PDF aktuell</button>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="Workflows.emailBetriebWV(${id})" title="E-Mail an Betrieb senden">✉︎ Betrieb kontaktieren</button>
      </div>

      <!-- ── Offene Mängel ── -->
      ${offeneMaengel.length ? `
      <h4 style="font-family:var(--font-display);margin-bottom:8px">Offene Mängel (${offeneMaengel.length} KWs)</h4>
      <div style="max-height:160px;overflow-y:auto;margin-bottom:12px">
        <table class="data-table"><thead><tr><th>AJ</th><th>KW</th><th>Mängel</th><th>Fehltage</th><th>Aktion</th></tr></thead><tbody>
          ${offeneMaengel.map(m => {
            const codes = m.maengel_codes.split(',').filter(Boolean);
            return `<tr>
              <td>${App.jahrNr(w.schueler_id, m.ausbildungsjahr, m.kalenderwoche)}</td><td>KW ${m.kalenderwoche}</td>
              <td style="color:var(--clr-red)">${codes.map(c => `<span style="cursor:pointer;text-decoration:underline" title="${KWNav.CODE_LABELS[c]||c} – klicken zum Beheben" onclick="WiedervorlagenHandler.markCodeBehoben(${m.id},'${c}',${id})">${c}</span>`).join(' ')}</td>
              <td>${m.fehltage||0}</td>
              <td><button class="btn btn-sm btn-success" onclick="WiedervorlagenHandler.markKWBehoben(${m.id},${id})" title="Alle Mängel dieser KW als behoben">✓ Behoben</button></td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>
      <button class="btn btn-sm btn-success" style="margin-bottom:14px" onclick="WiedervorlagenHandler.markAllBehoben(${w.schueler_id},${id})">✓ Alle Mängel als behoben markieren</button>
      ` : w.status !== 'erledigt' ? '<p style="color:var(--clr-green);font-size:13px;margin-bottom:14px">✓ Keine offenen Mängel mehr vorhanden.</p>' : ''}

      <!-- ── Durchsichten-History ── -->
      <h4 style="font-family:var(--font-display);margin-bottom:8px">Durchsichten-Verlauf</h4>
      <div style="max-height:180px;overflow-y:auto;margin-bottom:14px">
        ${alleKE.length ? `<table class="data-table"><thead><tr><th>#</th><th>Datum</th><th>Prüfer</th><th>Ergebnis</th><th>Fehltage</th><th>Aktionen</th></tr></thead><tbody>
          ${alleKE.map((ke, i) => {
            // Find matching snapshots for this KE
            const keSnaps = snapshots.filter(s => s.kontrollergebnis_id === ke.id);
            return `<tr style="${ke.id === w.kontrollergebnis_id ? 'background:var(--clr-amber-light);font-weight:600' : ''}">
              <td>${alleKE.length - i}${ke.id === w.kontrollergebnis_id ? ' ←' : ''}</td>
              <td>${formatDate(ke.geplant_datum)}</td>
              <td>${esc(ke.termin_pruefer || ke.geaendert_von || '–')}</td>
              <td>${ke.ergebnis ? `<span class="badge-status ${ke.ergebnis === 'in_ordnung' ? 'badge-ok' : 'badge-open'}">${ergebnisLabel(ke.ergebnis)}</span>` : '<span style="color:var(--clr-text-light)">–</span>'}</td>
              <td>${ke.fehltage_gesamt || 0}</td>
              <td class="btn-group">
                <button class="btn btn-sm btn-secondary" onclick="PDFExport.generateSingle(${ke.kontrolltermin_id},${w.schueler_id})" title="PDF dieses Kontrolltermins">▤</button>
                ${keSnaps.length ? keSnaps.map(snap => 
                  `<button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.viewSnapshot(${snap.id})" title="Snapshot vom ${formatDate(snap.snapshot_datum)} anzeigen">◉</button>
                   <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.exportSnapshotPDF(${snap.id})" title="Archiv-PDF vom ${formatDate(snap.snapshot_datum)}">▤</button>`
                ).join('') : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody></table>` : '<p style="font-size:12px;color:var(--clr-text-light)">Noch keine Kontrollergebnisse vorhanden.</p>'}
      </div>

      <!-- ── Notizen ── -->
      <h4 style="font-family:var(--font-display);margin-bottom:8px">Notizen</h4>
      ${notizen.map(n => `<div style="padding:8px;background:var(--clr-warm);border-radius:var(--radius);margin-bottom:6px;font-size:12px">
        <div style="color:var(--clr-text-light)">${formatDateTime(n.erstellt_am)} – ${esc(n.erstellt_von)}</div>
        <div>${esc(n.notiz)}</div>
      </div>`).join('') || '<p style="font-size:12px;color:var(--clr-text-light)">Noch keine Notizen</p>'}

      <div class="form-group" style="margin-top:12px">
        <label>Neue Notiz hinzufügen</label>
        <textarea class="form-control" id="mWvNotiz" rows="2"></textarea>
      </div>
      <div class="form-group">
        <label>Erstellt von</label>
        <select class="form-control" id="mWvVon" style="width:auto">
          ${App.query('SELECT name FROM pruefer WHERE aktiv=1').map(p => `<option>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        ${w.status === 'erledigt' ? `<button class="btn btn-secondary" onclick="WiedervorlagenHandler.wiederOeffnen(${id})" title="Versehentlich erledigt? Wiedervorlage wieder auf offen stellen">↺ Wieder öffnen</button>` : ''}
        <button class="btn btn-primary" onclick="WiedervorlagenHandler.addNotiz(${id})">Notiz speichern</button>`);
  },

  markCodeBehoben(kwStatusId, code, wvId) {
    const row = App.query('SELECT * FROM kw_status WHERE id=?', [kwStatusId])[0];
    if (!row) return;
    const codes = row.maengel_codes.split(',').filter(Boolean);
    const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
    const newCodes = codes.filter(c => c !== code);
    behoben.push(code);
    App.run('UPDATE kw_status SET maengel_codes=?, behobene_codes=? WHERE id=?',
      [newCodes.join(','), [...new Set(behoben)].join(','), kwStatusId]);
    this._behobenMerken(wvId, [[row.ausbildungsjahr, row.kalenderwoche, code]]);
    App.toast(`Code ${code} als behoben markiert`, 'success');
    this.details(wvId); // Refresh
    this.checkAutoErledigt(wvId);
  },

  markKWBehoben(kwStatusId, wvId) {
    const row = App.query('SELECT * FROM kw_status WHERE id=?', [kwStatusId])[0];
    if (!row) return;
    const codes = row.maengel_codes.split(',').filter(Boolean);
    const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
    const merged = [...new Set([...behoben, ...codes])].join(',');
    App.run('UPDATE kw_status SET maengel_codes="", behobene_codes=? WHERE id=?', [merged, kwStatusId]);
    this._behobenMerken(wvId, [[row.ausbildungsjahr, row.kalenderwoche, codes.join(',')]]);
    App.toast(`KW ${row.kalenderwoche} komplett behoben`, 'success');
    this.details(wvId);
    this.checkAutoErledigt(wvId);
  },

  markAllBehoben(schuelerId, wvId) {
    const rows = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND maengel_codes != ""', [schuelerId]);
    rows.forEach(row => {
      const codes = row.maengel_codes.split(',').filter(Boolean);
      const behoben = row.behobene_codes ? row.behobene_codes.split(',').filter(Boolean) : [];
      const merged = [...new Set([...behoben, ...codes])].join(',');
      App.run('UPDATE kw_status SET maengel_codes="", behobene_codes=? WHERE id=?', [merged, row.id]);
    });
    this._behobenMerken(wvId, rows.map(row => [row.ausbildungsjahr, row.kalenderwoche, row.maengel_codes]));
    App.toast(`Alle ${rows.length} Mängel als behoben markiert`, 'success');
    this.details(wvId);
    this.checkAutoErledigt(wvId);
  },

  checkAutoErledigt(wvId) {
    const w = App.query('SELECT * FROM wiedervorlagen WHERE id=?', [wvId])[0];
    if (!w || w.status === 'erledigt') return;
    const remaining = App.scalar('SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != ""', [w.schueler_id]);
    if (remaining === 0) {
      App.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung='Alle Mängel behoben' WHERE id=?", [todayStr(), wvId]);
      App.toast('Alle Mängel behoben → Wiedervorlage automatisch erledigt!', 'success');
    }
  },

  addNotiz(wvId) {
    const notiz = document.getElementById('mWvNotiz').value.trim();
    if (!notiz) return App.toast('Bitte Notiz eingeben', 'error');
    const von = document.getElementById('mWvVon').value;
    App.run('INSERT INTO wiedervorlage_notizen (wiedervorlage_id, notiz, erstellt_von) VALUES (?,?,?)', [wvId, notiz, von]);
    this.details(wvId); // Refresh modal
    App.toast('Notiz gespeichert', 'success');
  },

  exportICS() {
    // Ohne Datum („bei nächster Durchsicht“) gibt es keinen Kalendereintrag
    const wvs = App.query(`SELECT w.*, s.nachname, s.vorname FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      WHERE w.status IN ('offen','ueberfaellig') AND w.frist_datum != ''`);
    if (!wvs.length) return App.toast('Keine offenen Wiedervorlagen mit Datum', 'warning');
    // Wiedervorlagen als AUFGABEN (VTODO) mit Fälligkeit, stabile UID je WV
    App.exportICS(wvs.map(w => ({
      uid: 'bhk-wv-' + w.id, todo: true,
      date: w.frist_datum,
      title: `Wiedervorlage: ${w.nachname}, ${w.vorname} – BH-Kontrolle`,
      description: wvArtLabel(w.art) + (w.versand_datum ? `\nAngeschrieben: ${formatDate(w.versand_datum)}` : '\nNoch kein Anschreiben vermerkt')
    })), App.safeFilename(['BH-Wiedervorlagen', todayStr()], 'ics'));
    App.toast('ICS-Datei exportiert', 'success');
  }
};
