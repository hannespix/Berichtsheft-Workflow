// KW-Reihenfolge im Ausbildungsjahr (September→August): KW 36 bis KW 35
const KW_ALL = [36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35];
const KW_GRID = [[36,37,38,39,40,41,42,43,44,45,46,47,48],[49,50,51,52,1,2,3,4,5,6,7,8,9],[10,11,12,13,14,15,16,17,18,19,20,21,22],[23,24,25,26,27,28,29,30,31,32,33,34,35]];

const KontrolleHandler = {
  currentTerminId: null,
  currentSchuelerList: [],
  currentIndex: 0,

  startKontrolle(terminId) {
    const sel = document.getElementById('selKontrolltermin');
    if (sel) sel.value = terminId;
    this.loadTermin(terminId);
  },

  // Zentrale Navigation: Kontrolle öffnen und direkt zu einem bestimmten Schüler springen
  goToKontrolle(terminId, schuelerId) {
    App.closeModal();
    App.navigate('kontrolle');
    setTimeout(() => {
      this.startKontrolle(terminId);
      if (schuelerId) {
        setTimeout(() => {
          const idx = this.currentSchuelerList.findIndex(s => s.id === schuelerId);
          if (idx >= 0) {
            this.goTo(idx);
          } else {
            App.toast('Auszubildender nicht im Termin gefunden', 'warning');
          }
        }, 200);
      }
    }, 200);
  },

  loadTermin(terminId) {
    if (!terminId) {
      document.getElementById('kontrolleContent').innerHTML = '';
      this.stopLiveSync();
      return;
    }
    this.currentTerminId = parseInt(terminId);
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return;

    // Active prüfer = immer der in der Topbar ausgewählte Benutzer
    this.activePruefer = App.currentUser || '';

    // Load students from ALL linked classes
    this.currentSchuelerList = App.getTerminSchueler(terminId);

    // Also include students from OTHER classes who have a kontrollergebnis for this termin
    // (manually added via "+ Schüler hinzufügen")
    const extraIds = App.query(`SELECT DISTINCT schueler_id FROM kontrollergebnisse WHERE kontrolltermin_id=?`, [terminId]).map(r => r.schueler_id);
    const currentIds = new Set(this.currentSchuelerList.map(s => s.id));
    const missingIds = extraIds.filter(id => !currentIds.has(id));
    if (missingIds.length) {
      const placeholders = missingIds.map(() => '?').join(',');
      const extras = App.query(`SELECT * FROM schueler WHERE id IN (${placeholders}) ORDER BY nachname`, missingIds);
      this.currentSchuelerList.push(...extras);
    }

    if (!this.currentSchuelerList.length) {
      document.getElementById('kontrolleContent').innerHTML = '<div class="card" style="margin-top:16px"><div class="empty-state"><h3>Keine Schüler in dieser Klasse</h3><p>Importieren Sie zuerst Schüler und ordnen Sie diese der Klasse zu.</p></div></div>';
      return;
    }

    this.currentIndex = 0;
    for (let i = 0; i < this.currentSchuelerList.length; i++) {
      const existing = App.scalar(`SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=? AND ergebnis != ''`,
        [terminId, this.currentSchuelerList[i].id]);
      if (!existing) { this.currentIndex = i; break; }
    }
    this._viewMode = this._viewMode || 'uebersicht';
    this.renderKontrolleView();
  },

  _viewMode: 'uebersicht', // 'uebersicht' or 'einzeln'

  setViewMode(mode) {
    this._viewMode = mode;
    this.renderKontrolleView();
  },

  renderKontrolleView() {
    if (this._viewMode === 'uebersicht') {
      this.renderUebersicht();
    } else {
      this.enterSchüler();
    }
  },

  // ══════════════════════════════════════
  //  ÜBERSICHTSTABELLE
  // ══════════════════════════════════════
  renderUebersicht() {
    // Clean up our position when leaving Einzelansicht
    this.stopLiveSync();
    const terminId = this.currentTerminId;
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const schueler = this.currentSchuelerList;

    // Fachrichtung-Lookup
    const frLookup = {};
    App.query('SELECT id, bezeichnung, typ FROM fachrichtungen').forEach(f => {
      frLookup[f.id] = (f.typ === 'Fachwerker' ? 'FW: ' : '') + f.bezeichnung;
    });

    // Preload all KE data for this termin
    const alleKE = {};
    App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=?', [terminId]).forEach(ke => { alleKE[ke.schueler_id] = ke; });

    // Count stats
    const linkedKlassenIds = new Set(App.getTerminKlassenIds(terminId));
    let anwCount = 0, doneCount = 0, okCount = 0, mangelCount = 0, paCount = 0, zulCount = 0, autoZulCount = 0;
    const rows = schueler.map((s, i) => {
      const frName = frLookup[s.fachrichtung_id] || '–';
      const isExtraSchueler = !linkedKlassenIds.has(s.klasse_id);
      let ke = alleKE[s.id];
      if (!ke) {
        // Create KE with carried-forward data from last completed Kontrolle
        const prevKE = App.query(`SELECT ke.*
          FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
          WHERE ke.schueler_id=? AND ke.kontrolltermin_id != ? AND ke.ergebnis != ''
          ORDER BY kt.geplant_datum DESC LIMIT 1`, [s.id, terminId]);
        const prev = prevKE.length ? prevKE[0] : {};
        App.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,fehltage_gesamt,durchsicht_nr,
          p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,
          f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [terminId, s.id,
           prev.geprueft_kws || '{}',
           prev.fehltage_gesamt || 0,
           (prev.durchsicht_nr || 0) + 1,
           prev.p_1_1_ausbildungsplan || '',
           prev.p_1_4_auszubildende || '',
           prev.p_1_5_bescheinigungen || '',
           prev.bescheinigungen_anzahl || 0,
           prev.f_1_2_vertragliche_regelungen || '',
           prev.f_1_6_ausbildungsbetrieb || '']);
        ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0];
      }
      const isAnw = ke.anwesend !== 0;
      const isDone = ke.ergebnis && ke.ergebnis !== '';
      const isOK = ke.ergebnis === 'in_ordnung';
      if (isAnw) anwCount++;
      if (isDone) doneCount++;
      if (isOK) okCount++;
      if (isDone && !isOK) mangelCount++;
      if (ke.pruefungsausschuss === 1) paCount++;
      if (ke.zulassung_ap === 1) zulCount++;

      // AP-Zulassung checks
      const fehlGesamt = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=?', [s.id]) || 0;
      const arbeitstage = App.calcArbeitstage(s.ausbildungsbeginn, s.ausbildungsende, s.id);
      const fehlProzent = arbeitstage > 0 ? (fehlGesamt / arbeitstage * 100) : 0;
      const fehlWarn = fehlProzent >= 10;
      const reqUBA = App.getRequiredUBA(s.fachrichtung_id);
      const pflichtOK = ke.p_1_1_ausbildungsplan === 'ja' && ke.p_1_4_auszubildende === 'ja' && ke.p_1_5_bescheinigungen === 'ja' && (ke.bescheinigungen_anzahl||0) >= reqUBA;
      const offeneMaengel = App.scalar("SELECT COUNT(*) FROM kw_status WHERE schueler_id=? AND maengel_codes != '' AND maengel_codes != 'H'", [s.id]) || 0;
      const wvOffen = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id]) > 0;
      const ampel = App.getSchuelerAmpel(s.id);

      // Auto-Zulassung: wenn < 10% Fehltage UND Pflichtteile OK UND keine Mängel/WV
      const autoZulassung = !fehlWarn && pflichtOK && offeneMaengel === 0 && !wvOffen && isDone && isOK;
      // Auto-set only if field was never manually changed (still default 0 and conditions met)
      if (autoZulassung && ke.zulassung_ap === 0 && ke.pruefungsausschuss === 0) {
        App._runSilent('UPDATE kontrollergebnisse SET zulassung_ap=1 WHERE id=? AND zulassung_ap=0 AND pruefungsausschuss=0', [ke.id]);
        ke.zulassung_ap = 1;
        autoZulCount++;
      }

      const isZulassung = ke.zulassung_ap === 1;
      const isPA = ke.pruefungsausschuss === 1;
      // Conditions NOT met → needs attention (red if not already zugelassen or PA)
      const needsAttention = isDone && !autoZulassung && !isZulassung && !isPA;

      const ergebnisLabels = {in_ordnung:'✓ OK',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail (Wetter)',berichte_bis_termin_email:'E-Mail (Berichte)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};

      return `<tr style="${isPA ? 'background:var(--clr-red-light) !important;border-left:4px solid var(--clr-red)' : !isAnw ? 'opacity:0.5;background:var(--clr-warm)' : isDone && !isOK ? 'background:var(--clr-red-light)' : isDone && isOK ? 'background:var(--clr-green-light)' : ''}">
        <td style="text-align:center">${i+1}</td>
        <td>
          <strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}
          ${isExtraSchueler ? '<span style="font-size:9px;padding:1px 5px;background:var(--clr-blue-light);color:var(--clr-blue);border-radius:8px;margin-left:4px" title="Manuell hinzugefügt (andere Klasse)">Extra</span>' : ''}
          ${App.isVerkuerzer(s.ausbildungsbeginn, s.ausbildungsende, s.id) ? '<span style="font-size:9px;padding:1px 5px;background:#e8d5f5;color:#7b2fa0;border-radius:8px;margin-left:4px" title="Verkürzte Ausbildung">Verk.</span>' : ''}
          ${isPA ? '<span style="font-size:9px;padding:1px 5px;background:var(--clr-red);color:white;border-radius:8px;margin-left:4px;font-weight:700" title="An Prüfungsausschuss übergeben">PA</span>' : ''}
          <div style="font-size:10px;color:var(--clr-text-light)">${esc(s.ausbildungsstaette||'')} <a href="#" onclick="event.preventDefault();AzubiDashboard.open(${s.id})" style="color:var(--clr-forest);text-decoration:none" title="Azubi-Dashboard">&#128202;</a></div>
        </td>
        <td style="font-size:11px" data-sort="${esc(frName)}">${esc(frName)}</td>
        <td style="text-align:center">
          <input type="checkbox" ${isAnw ? 'checked' : ''} onchange="KontrolleHandler.quickToggleAnwesend(${s.id}, this.checked)" style="width:18px;height:18px;accent-color:var(--clr-forest)">
        </td>
        <td style="text-align:center" title="${esc(ampel.label)}">${ampel.icon}</td>
        <td data-sort="${ke.ergebnis || ''}">
          ${isDone ? `<span class="badge-status ${isOK ? 'badge-ok' : 'badge-open'}" style="font-size:11px">${ergebnisLabels[ke.ergebnis]||ke.ergebnis}</span>` : '<span style="color:var(--clr-text-light);font-size:11px">–</span>'}
          ${wvOffen ? '<span style="color:var(--clr-red);font-size:10px;margin-left:4px" title="Offene Wiedervorlage vorhanden">WV!</span>' : ''}
        </td>
        <td data-sort="${fehlGesamt}" style="text-align:center;${fehlWarn ? 'color:var(--clr-red);font-weight:700' : ''}" title="${fehlGesamt} Fehltage / ${arbeitstage} Arbeitstage (${Math.round(arbeitstage/5)} aktive KWs) = ${fehlProzent.toFixed(1)}%">${fehlGesamt}<span style="font-size:9px;color:${fehlWarn?'var(--clr-red)':'var(--clr-text-light)'};margin-left:2px">${fehlProzent.toFixed(0)}%</span></td>
        <td data-sort="${pflichtOK ? 1 : 0}" style="text-align:center" title="Pflichtteile: 1.1=${ke.p_1_1_ausbildungsplan||'-'}, 1.4=${ke.p_1_4_auszubildende||'-'}, 1.5=${ke.p_1_5_bescheinigungen||'-'} (${(ke.bescheinigungen_anzahl||0)}/${reqUBA} ÜBA)">${pflichtOK ? '<span style="color:var(--clr-green)">✓</span>' : '<span style="color:var(--clr-red)">✗</span>'}</td>
        <td style="text-align:center">
          <input type="checkbox" ${isZulassung ? 'checked' : ''} onchange="KontrolleHandler.toggleZulassung(${s.id},this.checked)" style="width:18px;height:18px;accent-color:var(--clr-green)" title="Zulassung zur AP${autoZulassung ? ' (automatisch empfohlen)' : ''}">
        </td>
        <td style="text-align:center">
          <input type="checkbox" ${isPA ? 'checked' : ''} onchange="KontrolleHandler.togglePA(${s.id},this.checked)" style="width:18px;height:18px;accent-color:var(--clr-red)" title="An Prüfungsausschuss übergeben">
        </td>
        <td style="text-align:center">
          ${needsAttention ? '<span title="Zulassungsbedingungen nicht erfüllt – prüfen!" style="color:var(--clr-red);font-size:13px;font-weight:700;cursor:help">⚠</span>' : ''}
          ${isZulassung && !isPA ? '<span style="color:var(--clr-green);font-size:14px" title="AP-Zulassung erteilt ✓">✓</span>' : ''}
          ${isPA ? '<span style="color:var(--clr-red);font-size:12px;font-weight:700" title="Prüfungsausschuss">PA</span>' : ''}
        </td>
        <td>
          <button class="btn btn-sm btn-secondary" style="padding:3px 8px" onclick="KontrolleHandler._viewMode='einzeln';KontrolleHandler.currentIndex=${i};KontrolleHandler.enterSchüler()" title="Einzelansicht">→</button>
          <button class="btn btn-sm" style="padding:3px 6px;color:var(--clr-red);background:none;border:1px solid var(--clr-red-light);font-size:11px" onclick="KontrolleHandler.removeSchueler(${s.id})" title="Schüler aus dieser Kontrolle entfernen">✕</button>
        </td>
      </tr>`;
    });

    // Gruppierung nach Fachrichtung (optional)
    let tableRows;
    if (this._groupByFR) {
      const groups = {};
      schueler.forEach((s, i) => {
        const fr = frLookup[s.fachrichtung_id] || 'Ohne Fachrichtung';
        if (!groups[fr]) groups[fr] = [];
        groups[fr].push(rows[i]);
      });
      tableRows = Object.keys(groups).sort().map(fr =>
        `<tr><td colspan="12" style="background:var(--clr-sand);font-weight:700;font-size:13px;padding:8px 12px;font-family:var(--font-display);color:var(--clr-forest-dark)">${esc(fr)} (${groups[fr].length})</td></tr>` + groups[fr].join('')
      ).join('');
    } else {
      tableRows = rows.join('');
    }

    // Toast bei automatischer AP-Zulassung
    if (autoZulCount > 0) {
      App.toast(`${autoZulCount} Auszubildende${autoZulCount > 1 ? '' : 'r'} automatisch zur AP zugelassen (alle Kriterien erfüllt)`, 'success');
    }

    const container = document.getElementById('kontrolleContent');
    container.innerHTML = `
      <div class="card" style="margin-top:12px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div>
            <strong style="font-size:16px;font-family:var(--font-display);color:var(--clr-forest-dark)">${esc(klassenStr)}</strong>
            <div style="font-size:12px;color:var(--clr-text-light)">${formatDate(termin.geplant_datum)} · ${esc(termin.pruefer||'')} · ${schueler.length} Schüler</div>
          </div>
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" onclick="KontrolleHandler._viewMode='uebersicht';KontrolleHandler.renderUebersicht()" style="${this._viewMode==='uebersicht'?'':'opacity:0.6'}">📋 Übersicht</button>
            <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler._viewMode='einzeln';KontrolleHandler.enterSchüler()" style="${this._viewMode==='einzeln'?'border:2px solid var(--clr-forest)':''}">👤 Einzelansicht</button>
            <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler._groupByFR=!KontrolleHandler._groupByFR;KontrolleHandler.renderUebersicht()" style="${this._groupByFR ? 'border:2px solid var(--clr-forest);background:var(--clr-green-light)' : ''}" title="Nach Fachrichtung gruppieren">Nach FR gruppieren</button>
          </div>
        </div>

        <!-- Statistik-Leiste -->
        <div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div style="padding:6px 12px;background:var(--clr-warm);border-radius:var(--radius);font-size:12px">
            📊 <strong>${anwCount}</strong>/${schueler.length} anwesend
          </div>
          <div style="padding:6px 12px;background:var(--clr-green-light);border-radius:var(--radius);font-size:12px">
            ✓ <strong>${okCount}</strong> in Ordnung
          </div>
          <div style="padding:6px 12px;background:${mangelCount?'var(--clr-red-light)':'var(--clr-warm)'};border-radius:var(--radius);font-size:12px">
            ✗ <strong>${mangelCount}</strong> beanstandet
          </div>
          <div style="padding:6px 12px;background:var(--clr-blue-light);border-radius:var(--radius);font-size:12px">
            ⏳ <strong>${schueler.length - doneCount}</strong> noch offen
          </div>
          ${zulCount ? `<div style="padding:6px 12px;background:var(--clr-green-light);border-radius:var(--radius);font-size:12px">
            🎓 <strong>${zulCount}</strong> zugelassen
          </div>` : ''}
          ${paCount ? `<div style="padding:6px 12px;background:var(--clr-red-light);border-radius:var(--radius);font-size:12px;font-weight:700;color:var(--clr-red)">
            ⚠ <strong>${paCount}</strong> Prüfungsausschuss
          </div>` : ''}
        </div>

        <!-- Fortschrittsbalken -->
        ${(() => {
          const pctDone = schueler.length ? Math.round(doneCount / schueler.length * 100) : 0;
          const pctOK = schueler.length ? Math.round(okCount / schueler.length * 100) : 0;
          const pctMangel = schueler.length ? Math.round(mangelCount / schueler.length * 100) : 0;
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;color:var(--clr-text-light)">
              <span>Fortschritt: ${doneCount}/${schueler.length} bewertet (${pctDone}%)</span>
              <span>${pctDone === 100 ? '✅ Alle bewertet!' : `${schueler.length - doneCount} offen`}</span>
            </div>
            <div style="height:8px;background:var(--clr-sand);border-radius:4px;overflow:hidden;display:flex">
              <div style="width:${pctOK}%;background:var(--clr-green);transition:width 0.3s" title="${okCount} in Ordnung"></div>
              <div style="width:${pctMangel}%;background:var(--clr-red);transition:width 0.3s" title="${mangelCount} beanstandet"></div>
            </div>
          </div>`;
        })()}

        <!-- Tabelle -->
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr>
              <th style="width:35px">#</th>
              <th>Name / Betrieb</th>
              <th title="Fachrichtung">FR</th>
              <th style="width:50px;text-align:center" title="Anwesend bei Durchsicht (Checkbox)">Anw.</th>
              <th style="width:35px;text-align:center" title="Ampel-Status">⚡</th>
              <th>Ergebnis</th>
              <th style="width:55px;text-align:center" title="Fehltage gesamt">Fehl.</th>
              <th style="width:45px;text-align:center" title="Pflichtteile vollständig">Pfl.</th>
              <th style="width:45px;text-align:center" title="Zulassung zur Abschlussprüfung">Zul.</th>
              <th style="width:35px;text-align:center" title="Prüfungsausschuss (Sonderfall)">PA</th>
              <th style="width:55px;text-align:center" title="AP-Status">AP</th>
              <th style="width:40px"></th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>

        <!-- Bulk-Aktionen -->
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;align-items:center">
          <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.quickSetAllAnwesend(true)">✓ Alle anwesend</button>
          <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.quickSetAllAnwesend(false)">✗ Alle abwesend</button>
          <button class="btn btn-sm btn-primary" onclick="KontrolleHandler._viewMode='einzeln';KontrolleHandler.enterSchüler()">👤 Einzelkontrolle starten</button>
          <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.showAddSchueler()" title="Schüler aus anderer Klasse oder neuen Schüler hinzufügen">+ Schüler hinzufügen</button>
          <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.printUebersicht()" title="Übersichtstabelle drucken">🖨️ Drucken</button>
            <button class="btn btn-sm btn-secondary" onclick="Workflows.emailSchule(${terminId})" title="E-Mail an Schule">📧 Schule</button>
            <button class="btn btn-sm btn-secondary" onclick="Workflows.seriendruckBetriebe(${terminId})" title="Betriebe anschreiben">📄 Betriebe</button>
            <button class="btn btn-sm btn-secondary" onclick="PlanungHandler.exportTerminPDF(${terminId})">📄 Alle PDFs</button>
          </div>
        </div>
      </div>
    `;
  },

  // Quick toggle anwesend from overview table
  quickToggleAnwesend(schuelerId, checked) {
    let ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId])[0];
    if (!ke) return;
    App.run(`UPDATE kontrollergebnisse SET anwesend=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`,
      [checked ? 1 : 0, this.activePruefer || '', ke.id]);
    this.renderUebersicht();
  },

  // Quick toggle any checkbox field (zulassung_ap, pruefungsausschuss)
  quickToggleField(schuelerId, field, checked) {
    const allowed = ['zulassung_ap','pruefungsausschuss'];
    if (!allowed.includes(field)) return;
    let ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId])[0];
    if (!ke) return;
    App.run(`UPDATE kontrollergebnisse SET ${field}=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`,
      [checked ? 1 : 0, this.activePruefer || '', ke.id]);
    this.renderUebersicht();
  },

  // Toggle Zulassung AP (mutually exclusive with PA)
  toggleZulassung(schuelerId, checked) {
    let ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId])[0];
    if (!ke) return;
    if (checked && ke.pruefungsausschuss === 1) {
      // Unset PA when setting Zulassung
      App.run('UPDATE kontrollergebnisse SET pruefungsausschuss=0, zulassung_ap=1, geaendert_am=datetime(\'now\',\'localtime\'), geaendert_von=? WHERE id=?',
        [this.activePruefer || '', ke.id]);
    } else {
      App.run('UPDATE kontrollergebnisse SET zulassung_ap=?, geaendert_am=datetime(\'now\',\'localtime\'), geaendert_von=? WHERE id=?',
        [checked ? 1 : 0, this.activePruefer || '', ke.id]);
    }
    this.renderUebersicht();
  },

  // Toggle Prüfungsausschuss (mutually exclusive with Zulassung)
  togglePA(schuelerId, checked) {
    let ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId])[0];
    if (!ke) return;
    if (checked && ke.zulassung_ap === 1) {
      // Unset Zulassung when setting PA
      App.run('UPDATE kontrollergebnisse SET zulassung_ap=0, pruefungsausschuss=1, geaendert_am=datetime(\'now\',\'localtime\'), geaendert_von=? WHERE id=?',
        [this.activePruefer || '', ke.id]);
    } else {
      App.run('UPDATE kontrollergebnisse SET pruefungsausschuss=?, geaendert_am=datetime(\'now\',\'localtime\'), geaendert_von=? WHERE id=?',
        [checked ? 1 : 0, this.activePruefer || '', ke.id]);
    }
    this.renderUebersicht();
  },

  printUebersicht(terminIdOverride) {
    const terminId = terminIdOverride || this.currentTerminId;
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return;
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
    const frAj = App.formatTerminFrAj(terminId);
    const isEinsendung = termin.typ === 'einsendung';
    const schule = klassen.length ? klassen[0].schule : (isEinsendung ? 'Einsendung' : '–');
    const schueler = terminIdOverride ? App.getTerminSchueler(terminId) : this.currentSchuelerList;
    const alleKE = {};
    App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=?', [terminId]).forEach(ke => { alleKE[ke.schueler_id] = ke; });

    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'E-Mail (Wetter)',berichte_bis_termin_email:'E-Mail (Berichte)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};
    let anw = 0, ok = 0, mg = 0, pa = 0, zul = 0;

    const rows = schueler.map((s, i) => {
      const ke = alleKE[s.id] || {};
      const isAnw = ke.anwesend !== 0;
      const isDone = ke.ergebnis && ke.ergebnis !== '';
      const isPA = ke.pruefungsausschuss === 1;
      const isZul = ke.zulassung_ap === 1;
      if (isAnw) anw++;
      if (ke.ergebnis === 'in_ordnung') ok++;
      if (isDone && ke.ergebnis !== 'in_ordnung') mg++;
      if (isPA) pa++;
      if (isZul) zul++;
      const fehl = App.scalar('SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=?', [s.id]) || 0;
      const at = App.calcArbeitstage(s.ausbildungsbeginn, s.ausbildungsende, s.id);
      const fehlPct = at > 0 ? (fehl / at * 100) : 0;
      const fehlWarn = fehlPct >= 10;
      const reqUBA2 = App.getRequiredUBA(s.fachrichtung_id);
      const pflOK = ke.p_1_1_ausbildungsplan === 'ja' && ke.p_1_4_auszubildende === 'ja' && ke.p_1_5_bescheinigungen === 'ja' && (ke.bescheinigungen_anzahl||0) >= reqUBA2;
      const bg = isPA ? '#fde0dc' : !isAnw ? '#f5f0eb' : isDone && ke.ergebnis !== 'in_ordnung' ? '#fde8e6' : isDone && ke.ergebnis === 'in_ordnung' ? '#e8f5e9' : '#fff';
      return `<tr style="background:${bg}${isPA ? ';border-left:3px solid #c0392b' : ''}">
        <td style="text-align:center">${i+1}</td>
        <td><strong>${esc(s.nachname)}</strong>, ${esc(s.vorname)}${isPA ? ' <b style="color:#c0392b">PA</b>' : ''}</td>
        <td style="font-size:10px">${esc(s.ausbildungsstaette || '–')}</td>
        <td style="text-align:center">${isAnw ? '✓' : '–'}</td>
        <td>${isDone ? (eLbl[ke.ergebnis] || ke.ergebnis || '–') : ''}</td>
        <td style="text-align:center;${fehlWarn ? 'color:red;font-weight:bold' : ''}">${fehl} <span style="font-size:8px">(${fehlPct.toFixed(0)}%)</span></td>
        <td style="text-align:center">${pflOK ? '✓' : '–'}</td>
        <td style="text-align:center;color:${isZul ? '#27ae60' : '#999'};font-weight:${isZul ? '700' : '400'}">${isZul ? '✓' : '–'}</td>
        <td style="text-align:center;color:${isPA ? '#c0392b' : '#999'};font-weight:${isPA ? '700' : '400'}">${isPA ? '⚠ PA' : '–'}</td>
        <td style="font-size:10px">${esc(ke.bemerkung || '')}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Übersicht ${isEinsendung ? 'Einsendung' : klassenStr} – ${formatDate(termin.geplant_datum)}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 15mm; color: #333; }
      h1 { font-size: 16px; color: #2d5016; margin: 0 0 4px 0; }
      .sub { font-size: 11px; color: #666; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #2d5016; color: white; padding: 5px 6px; font-size: 10px; text-align: left; }
      td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
      .stats { display: flex; gap: 16px; margin: 8px 0 4px 0; font-size: 11px; }
      .stats span { padding: 3px 8px; border-radius: 4px; }
      @media print { body { margin: 10mm; } }
    </style></head><body>
    <h1>Berichtsheftkontrolle – ${esc(schule)}</h1>
    <div class="sub">${esc(frAj)} · ${formatDate(termin.geplant_datum)} KW${getKW(termin.geplant_datum)} · Prüfer: ${esc(termin.pruefer || '')}</div>
    <div class="stats">
      <span style="background:#e8f5e9">✓ ${ok} i.O.</span>
      <span style="background:${mg ? '#fde8e6' : '#f5f5f5'}">✗ ${mg} beanstandet</span>
      <span style="background:#f5f5f5">${anw}/${schueler.length} anwesend</span>
      ${zul ? `<span style="background:#e8f5e9;font-weight:bold">🎓 ${zul} zugelassen</span>` : ''}
      ${pa ? `<span style="background:#fde8e6;color:#c0392b;font-weight:bold">⚠ ${pa} Prüfungsausschuss</span>` : ''}
    </div>
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Betrieb</th><th title="Anwesend bei Durchsicht">Anw.</th><th>Ergebnis</th><th title="Fehltage gesamt">Fehl.</th><th title="Pflichtteile vollständig">Pfl.</th><th title="Zulassung zur Abschlussprüfung">Zul.</th><th title="Prüfungsausschuss">PA</th><th>Bemerkung</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px;font-size:9px;color:#999;border-top:1px solid #ddd;padding-top:4px">
      Regierungspräsidium Freiburg · Abt. 3 · Ref. 31 · Erstellt: ${new Date().toLocaleDateString('de-DE')}
    </div>
    </body></html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  },

  quickSetAllAnwesend(anwesend) {
    const count = this.currentSchuelerList.length;
    const label = anwesend ? 'anwesend' : 'abwesend';
    if (!confirm(`${count} Auszubildende als „${label}" markieren?`)) return;
    this.currentSchuelerList.forEach(s => {
      App.run(`UPDATE kontrollergebnisse SET anwesend=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE kontrolltermin_id=? AND schueler_id=?`,
        [anwesend ? 1 : 0, this.activePruefer || '', this.currentTerminId, s.id]);
    });
    this.renderUebersicht();
    App.toast(`Alle ${count} als ${label} markiert`, 'success');
  },

  // ══════════════════════════════════════
  //  SCHÜLER ZUR KONTROLLE HINZUFÜGEN
  // ══════════════════════════════════════
  showAddSchueler() {
    // Get ALL active students (unfiltered!) NOT already in this kontrolle
    const existingIds = this.currentSchuelerList.map(s => s.id);
    const allSchueler = App.query(`SELECT s.*, k.klassenbezeichnung, bs.name as schule, j.bezeichnung as jahrgang
      FROM schueler s
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      WHERE s.aktiv=1 ORDER BY s.nachname, s.vorname`);
    const available = allSchueler.filter(s => !existingIds.includes(s.id));

    // Get ALL klassen + fachrichtungen (unfiltered for manual entry)
    const klassen = App.query(`SELECT k.*, bs.name as schule FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id ORDER BY bs.name, k.klassenbezeichnung`);
    const fachrichtungen = App.query(`SELECT * FROM fachrichtungen ORDER BY bezeichnung`);
    const jahrgaenge = App.query('SELECT * FROM abschlussjahrgaenge ORDER BY jahr DESC');

    App.openModal('Schüler zur Kontrolle hinzufügen', `
      <!-- Tab buttons -->
      <div style="display:flex;gap:4px;margin-bottom:12px;border-bottom:2px solid var(--clr-sand);padding-bottom:8px">
        <button class="btn btn-sm" id="tabExisting" style="background:var(--clr-forest);color:white" onclick="document.getElementById('panelExisting').style.display='';document.getElementById('panelNew').style.display='none';this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('tabNew').style.background='var(--clr-warm)';document.getElementById('tabNew').style.color='var(--clr-text)'">
          Vorhandener Schüler
        </button>
        <button class="btn btn-sm" id="tabNew" style="background:var(--clr-warm);color:var(--clr-text)" onclick="document.getElementById('panelNew').style.display='';document.getElementById('panelExisting').style.display='none';this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('tabExisting').style.background='var(--clr-warm)';document.getElementById('tabExisting').style.color='var(--clr-text)'">
          Neuer Schüler (manuell)
        </button>
      </div>

      <!-- Panel 1: Vorhandener Schüler suchen -->
      <div id="panelExisting">
        <div class="form-group">
          <label>Schüler suchen (Name, Betrieb, Klasse, Jahrgang)</label>
          <input class="form-control" id="addSchuelerSearch" type="text" placeholder="Mind. 2 Buchstaben eingeben…" oninput="KontrolleHandler._liveSearchSchueler(this.value)" autofocus>
        </div>
        <div id="addSchuelerResults" style="max-height:250px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius)">
          <p style="padding:16px;color:var(--clr-text-light);text-align:center;font-size:13px">Suchbegriff eingeben um in <strong>allen ${available.length} verfügbaren Azubis</strong> zu suchen</p>
        </div>
        <p id="addSchuelerCount" style="font-size:11px;color:var(--clr-text-light);margin-top:6px">${available.length} Schüler verfügbar (nicht in dieser Kontrolle)</p>
      </div>

      <!-- Panel 2: Neuer Schüler manuell anlegen -->
      <div id="panelNew" style="display:none">
        <p style="font-size:12px;color:var(--clr-amber);margin-bottom:10px">⚠ Der Schüler wird dauerhaft in die Datenbank aufgenommen und kann danach auch bei zukünftigen Kontrollen verwendet werden.</p>
        <div class="form-row">
          <div class="form-group"><label>Nachname *</label><input class="form-control" id="newSchNachname" required></div>
          <div class="form-group"><label>Vorname *</label><input class="form-control" id="newSchVorname" required></div>
        </div>
        <div class="form-group">
          <label>Ausbildungsstätte (Betrieb)</label>
          <input class="form-control" id="newSchBetrieb" placeholder="z.B. Gartenbau Schmidt GmbH">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Fachrichtung</label>
            <select class="form-control" id="newSchFR">
              <option value="">– Optional –</option>
              ${fachrichtungen.map(f => `<option value="${f.id}">${esc(f.bezeichnung)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Jahrgang</label>
            <select class="form-control" id="newSchJG">
              ${jahrgaenge.map(j => `<option value="${j.id}" ${j.aktiv ? 'selected' : ''}>${esc(j.bezeichnung)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Klasse zuordnen</label>
          <select class="form-control" id="newSchKlasse">
            <option value="">– Keine Klasse –</option>
            ${klassen.map(k => `<option value="${k.id}">${esc(k.schule)} – ${esc(k.klassenbezeichnung)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Ausbildungsbeginn</label><input type="date" class="form-control" id="newSchBeginn"></div>
          <div class="form-group"><label>Ausbildungsende</label><input type="date" class="form-control" id="newSchEnde"></div>
        </div>
        <div class="form-group"><label>iBykus-Ident (optional)</label><input class="form-control" id="newSchIbykus" placeholder="BAV-Nummer"></div>
        <div class="form-row">
          <div class="form-group"><label>📞 Telefon</label><input class="form-control" id="newSchTelefon" placeholder="Mobil/Festnetz"></div>
          <div class="form-group"><label>📧 E-Mail</label><input class="form-control" id="newSchEmail" placeholder="azubi@email.de"></div>
        </div>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="KontrolleHandler.doAddNewSchueler()">Neuen Schüler anlegen + hinzufügen</button>`);
  },

  _liveSearchSchueler(query) {
    const q = query.trim();
    const container = document.getElementById('addSchuelerResults');
    const countEl = document.getElementById('addSchuelerCount');
    if (!container) return;

    if (q.length < 2) {
      const total = App.scalar("SELECT COUNT(*) FROM schueler WHERE aktiv=1") || 0;
      container.innerHTML = `<p style="padding:16px;color:var(--clr-text-light);text-align:center;font-size:13px">Mind. 2 Buchstaben eingeben um in <strong>${total} Azubis</strong> zu suchen</p>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    // Live DB search across ALL active students
    const existingIds = this.currentSchuelerList.map(s => s.id);
    const p = `%${q}%`;
    const results = App.query(`SELECT s.*, k.klassenbezeichnung, bs.name as schule, j.bezeichnung as jahrgang
      FROM schueler s
      LEFT JOIN klassen k ON s.klasse_id=k.id
      LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      WHERE s.aktiv=1 AND (s.nachname LIKE ? OR s.vorname LIKE ? OR s.ausbildungsstaette LIKE ?
        OR k.klassenbezeichnung LIKE ? OR bs.name LIKE ? OR j.bezeichnung LIKE ? OR s.ibykus_id LIKE ?)
      ORDER BY s.nachname, s.vorname LIMIT 50`, [p,p,p,p,p,p,p]);

    const available = results.filter(s => !existingIds.includes(s.id));

    if (!available.length) {
      container.innerHTML = `<p style="padding:16px;color:var(--clr-text-light);text-align:center">Keine Treffer für "${esc(q)}"${results.length > available.length ? ` (${results.length - available.length} bereits in Kontrolle)` : ''}</p>`;
    } else {
      container.innerHTML = available.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid var(--clr-sand);cursor:pointer;font-size:13px"
             onclick="KontrolleHandler.addExistingSchueler(${s.id})">
          <div>
            <strong>${esc(s.nachname)}, ${esc(s.vorname)}</strong>
            <span style="color:var(--clr-text-light);font-size:11px;margin-left:6px">${esc(s.ausbildungsstaette||'')} · ${esc(s.klassenbezeichnung||'')} · ${esc(s.schule||'')}${s.jahrgang ? ' · '+esc(s.jahrgang) : ''}</span>
          </div>
          <button class="btn btn-sm btn-success" style="padding:2px 10px;font-size:11px;flex-shrink:0" onclick="event.stopPropagation();KontrolleHandler.addExistingSchueler(${s.id})">+</button>
        </div>
      `).join('');
    }
    if (countEl) countEl.textContent = `${available.length} Treffer${available.length >= 50 ? ' (max. 50 – Suche verfeinern)' : ''}`;
  },

  // Add existing student from another class to this kontrolle
  addExistingSchueler(schuelerId) {
    // Check not already added
    if (this.currentSchuelerList.find(s => s.id === schuelerId)) {
      return App.toast('Schüler ist bereits in dieser Kontrolle', 'warning');
    }
    // Create kontrollergebnis for this student + termin
    const existing = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId]);
    if (!existing.length) {
      // Carry forward from previous completed Kontrolle
      const prevKE = App.query(`SELECT ke.*
        FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
        WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`, [schuelerId]);
      const prev = prevKE.length ? prevKE[0] : {};
      App.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,fehltage_gesamt,durchsicht_nr,
        p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,
        f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [this.currentTerminId, schuelerId,
         prev.geprueft_kws || '{}',
         prev.fehltage_gesamt || 0,
         (prev.durchsicht_nr || 0) + 1,
         prev.p_1_1_ausbildungsplan || '',
         prev.p_1_4_auszubildende || '',
         prev.p_1_5_bescheinigungen || '',
         prev.bescheinigungen_anzahl || 0,
         prev.f_1_2_vertragliche_regelungen || '',
         prev.f_1_6_ausbildungsbetrieb || '']);
    }
    // Reload student list (now includes the extra student via KE)
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    this.currentSchuelerList.push(s);
    App.closeModal();
    this.renderUebersicht();
    App.toast(`${s.nachname}, ${s.vorname} zur Kontrolle hinzugefügt`, 'success');
  },

  // Remove a student from this kontrolle
  removeSchueler(schuelerId) {
    const s = this.currentSchuelerList.find(s => s.id === schuelerId);
    if (!s) return;
    const name = `${s.nachname}, ${s.vorname}`;
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId])[0];
    const hasDaten = ke && ke.ergebnis && ke.ergebnis !== '';
    const msg = hasDaten
      ? `${name} aus dieser Kontrolle entfernen?\n\nAchtung: Für diesen Schüler liegt bereits ein Ergebnis vor (${ke.ergebnis}). Dieses wird gelöscht!`
      : `${name} aus dieser Kontrolle entfernen?`;
    if (!confirm(msg)) return;
    // Delete kontrollergebnis for this termin+student
    App.run('DELETE FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId]);
    // Also remove from kontrolltermin_schueler (if individually linked)
    App.run('DELETE FROM kontrolltermin_schueler WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, schuelerId]);
    // Remove from in-memory list + adjust index
    this.currentSchuelerList = this.currentSchuelerList.filter(s => s.id !== schuelerId);
    if (this.currentIndex >= this.currentSchuelerList.length && this.currentIndex > 0) this.currentIndex--;
    this.renderUebersicht();
    App.toast(`${name} aus Kontrolle entfernt`, 'info');
  },

  // Create new student and add to this kontrolle
  doAddNewSchueler() {
    const nachname = document.getElementById('newSchNachname')?.value?.trim();
    const vorname = document.getElementById('newSchVorname')?.value?.trim();
    if (!nachname || !vorname) return App.toast('Nachname und Vorname sind Pflichtfelder', 'error');

    const betrieb = document.getElementById('newSchBetrieb')?.value?.trim() || '';
    const frId = parseInt(document.getElementById('newSchFR')?.value) || null;
    const jgId = parseInt(document.getElementById('newSchJG')?.value) || null;
    const klasseId = parseInt(document.getElementById('newSchKlasse')?.value) || null;
    const beginn = document.getElementById('newSchBeginn')?.value || '';
    const ende = document.getElementById('newSchEnde')?.value || '';
    const ibykus = document.getElementById('newSchIbykus')?.value?.trim() || '';
    const telefon = document.getElementById('newSchTelefon')?.value?.trim() || '';
    const email = document.getElementById('newSchEmail')?.value?.trim() || '';

    // Check for duplicates
    const dup = App.query('SELECT id FROM schueler WHERE nachname=? AND vorname=? AND jahrgang_id=?', [nachname, vorname, jgId]);
    if (dup.length) {
      if (!confirm(`Ein Schüler "${nachname}, ${vorname}" existiert bereits. Trotzdem neu anlegen?`)) return;
    }

    // Insert into schueler table
    App.run(`INSERT INTO schueler (nachname,vorname,ausbildungsstaette,fachrichtung_id,klasse_id,jahrgang_id,ausbildungsbeginn,ausbildungsende,ibykus_id,telefon,email,aktiv) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
      [nachname, vorname, betrieb, frId, klasseId, jgId, beginn, ende, ibykus, telefon, email]);
    const newId = App.scalar('SELECT last_insert_rowid()');

    // Add to this kontrolle
    this.addExistingSchueler(newId);
    App.toast(`${nachname}, ${vorname} neu angelegt und zur Kontrolle hinzugefügt`, 'success');
  },

  renderSchueler() {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const total = this.currentSchuelerList.length;
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [this.currentTerminId])[0];
    const ergebnisLabels = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'Sachberichte (E-Mail)',berichte_bis_termin_email:'Berichte (E-Mail)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};

    // Load existing result
    let ke = App.query(`SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?`, [this.currentTerminId, s.id])[0];
    if (!ke) {
      // Carry forward all cumulative data from previous completed Kontrolle
      const prevKE = App.query(`SELECT ke.*
        FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
        WHERE ke.schueler_id=? AND ke.kontrolltermin_id != ? AND ke.ergebnis != ''
        ORDER BY kt.geplant_datum DESC LIMIT 1`, [s.id, this.currentTerminId]);
      const prev = prevKE.length ? prevKE[0] : {};
      App.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,fehltage_gesamt,durchsicht_nr,
        p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,
        f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [this.currentTerminId, s.id,
         prev.geprueft_kws || '{}',
         prev.fehltage_gesamt || 0,
         (prev.durchsicht_nr || 0) + 1,
         prev.p_1_1_ausbildungsplan || '',
         prev.p_1_4_auszubildende || '',
         prev.p_1_5_bescheinigungen || '',
         prev.bescheinigungen_anzahl || 0,
         prev.f_1_2_vertragliche_regelungen || '',
         prev.f_1_6_ausbildungsbetrieb || '']);
      ke = App.query(`SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?`, [this.currentTerminId, s.id])[0];
    }

    // Load CUMULATIVE KW data for this student (across all Durchsichten)
    const kwData = {};
    App.query(`SELECT * FROM kw_status WHERE schueler_id=?`, [s.id]).forEach(r => {
      kwData[`${r.ausbildungsjahr}_${r.kalenderwoche}`] = {
        codes: r.maengel_codes, behoben: r.behobene_codes,
        fehltage: r.fehltage, geprueft: r.geprueft, bemerkung: r.bemerkung || ''
      };
    });
    // Load which KWs were checked in THIS session
    let sessionKWs = {};
    try { sessionKWs = JSON.parse(ke.geprueft_kws || '{}'); } catch(e) {}
    // Durchsicht-Nummer
    const durchsichtNr = App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=? AND ergebnis != ""', [s.id]) || 0;
    // Previous snapshots
    const prevSnapshots = App.query('SELECT ds.*, ke2.erstellt_am as ke_datum FROM durchsicht_snapshots ds JOIN kontrollergebnisse ke2 ON ds.kontrollergebnis_id=ke2.id WHERE ds.schueler_id=? ORDER BY ds.snapshot_datum DESC', [s.id]);

    const codes = [
      { code: 'A', label: 'Unterschrift Azubi' },
      { code: 'B', label: 'Unterschrift Ausbilder' },
      { code: 'C', label: 'Berufsschulthemen' },
      { code: 'D', label: 'Wetter' },
      { code: 'E', label: 'Inhaltlich lückenhaft' },
      { code: 'F', label: 'Komplette Berichte fehlen' },
      { code: 'G', label: 'Datum/KW' },
      { code: 'H', label: 'Fehltage' },
      { code: 'I', label: 'Sonstiges' },
    ];

    const kwRows = KW_GRID;

    // Calculate active KW ranges from AV-Beginn/AV-Ende
    const ajBounds = App.getAJKWBounds(s.id);

    const ergebnisOptions = [
      { val: 'in_ordnung', label: 'Berichtsheft war in Ordnung' },
      { val: 'nachholung_naechste_durchsicht', label: 'Fehlende Berichte/Unterschriften bis nächste Durchsicht nachholen' },
      { val: 'sachberichte_wetter_email', label: 'Sachberichte wegen Wetter per E-Mail senden' },
      { val: 'berichte_bis_termin_email', label: 'Berichte bis Termin per E-Mail senden' },
      { val: 'persoenliche_vorlage_rp', label: 'Persönliche Vorlage im RP Freiburg' },
      { val: 'post_an_rp', label: 'Per Post ans RP Freiburg senden' },
    ];

    const pflichtOptHtml = (name, val) => `
      <select class="form-control" style="width:auto;display:inline;padding:4px 8px;font-size:12px" data-field="${name}" onchange="KontrolleHandler.saveField('${name}',this.value)">
        <option value="" ${!val?'selected':''}>–</option>
        <option value="ja" ${val==='ja'?'selected':''}>Ja</option>
        <option value="nein" ${val==='nein'?'selected':''}>Nein</option>
        <option value="nicht_vorhanden" ${val==='nicht_vorhanden'?'selected':''}>Nicht vorhanden</option>
      </select>`;

    const renderKWGrid = (aj) => {
      const ajSessionKWs = sessionKWs[aj] || [];
      const bounds = ajBounds[aj] || { inactiveKWs: [], syStart: null };
      const inactiveSet = new Set(bounds.inactiveKWs);
      return kwRows.map((row, ri) => `
        <div class="kw-grid" data-aj="${aj}" data-row="${ri}">
          ${row.map((kw, ci) => {
            const isInactive = inactiveSet.has(kw);
            const dr = bounds.syStart ? App.kwDateRange(kw, bounds.syStart) : null;
            const drLabel = dr ? ` · ${dr.label}` : '';
            if (isInactive) {
              return `<div class="kw-cell kw-inactive" data-aj="${aj}" data-kw="${kw}" title="KW ${kw}${drLabel} – außerhalb der Ausbildungszeit"><span class="kw-num">${kw}</span></div>`;
            }
            const key = `${aj}_${kw}`;
            const d = kwData[key];
            const hasCodes = d && d.codes;
            const hasBehoben = d && d.behoben;
            const codeStr = hasCodes ? d.codes : '';
            const behobenStr = hasBehoben ? d.behoben : '';
            const fehl = d && d.fehltage ? d.fehltage : 0;
            const hasBem = d && d.bemerkung;
            const isSessionKW = ajSessionKWs.includes(kw);
            const isPastPruef = d && d.geprueft && !isSessionKW;
            // H (Fehltage) allein = kein Mangel → kein rot
            const hasRealMaengel = hasCodes && codeStr.split(',').some(c => c.trim() && c.trim() !== 'H');
            const isHOnly = hasCodes && !hasRealMaengel;
            // States: kw-issue (red) only for real Mängel, kw-behoben (orange), kw-ok (green)
            let cls = '';
            if (hasRealMaengel) cls = 'kw-issue';
            else if (hasBehoben) cls = 'kw-behoben';
            else if (isPastPruef || isHOnly) cls = 'kw-ok';
            if (fehl > 0 && !hasRealMaengel) cls += ' kw-fehltage-only';
            if (isSessionKW) cls += ' kw-session';
            const fehlDisplay = fehl > 0 && !(hasCodes && codeStr.includes('H')) ? `<span class="kw-fehltage">${fehl}</span>` : '';
            // Merge H with Fehltage: "A,H" + 3 → display "A H3"
            const displayCodes = (fehl > 0 && codeStr.includes('H')) ? codeStr.replace(/\bH\b/, `H${fehl}`) : codeStr;
            const bemIndicator = hasBem ? `<span style="position:absolute;top:0;right:1px;font-size:7px;line-height:1">💬</span>` : '';
            const title = `KW ${kw}${drLabel}${hasRealMaengel ? ' · Mängel: '+codeStr : ''}${isHOnly ? ' · Fehltage: '+fehl : ''}${hasBehoben ? ' · Behoben: '+behobenStr : ''}${fehl && !isHOnly ? ' · '+fehl+' Fehltag(e)' : ''}${hasBem ? ' · Bemerkung: '+d.bemerkung : ''}${isPastPruef ? ' · früher geprüft' : ''}${isSessionKW ? ' · diese Sitzung' : ''}`;
            return `<div class="kw-cell ${cls}" tabindex="0" style="position:relative"
              data-ke="${ke.id}" data-sid="${s.id}" data-aj="${aj}" data-kw="${kw}" data-row="${ri}" data-col="${ci}"
              data-codes="${esc(codeStr)}" data-behoben="${esc(behobenStr)}" data-fehltage="${fehl}"
              onclick="KWNav.focusCell(this)"
              title="${title}">
              ${bemIndicator}<span class="kw-num">${kw}</span>${hasCodes ? `<span class="kw-codes">${displayCodes.replace(/,/g,' ')}</span>` : ''}${hasBehoben && !hasCodes ? `<span class="kw-codes" style="text-decoration:line-through;opacity:0.5">${behobenStr.replace(/,/g,' ')}</span>` : ''}${fehlDisplay}
            </div>`;
          }).join('')}
        </div>
      `).join('') + `<div style="text-align:right;font-size:12px;color:var(--clr-text-light);padding:2px 4px;">
        Fehltage AJ${aj}: <strong id="fehlSumAj${aj}" style="color:var(--clr-text)">${this.calcFehlSum(s.id, aj)}</strong>
      </div>`;
    };

    const legendHidden = App.uGet('legend_hidden') === '1';
    const kwLegendHtml = `<div class="kw-legend-show" id="kwLegendShow" style="${legendHidden?'display:block':''}" onclick="document.querySelector('.kw-legend').classList.remove('hidden');this.style.display='none';App.uRemove('legend_hidden')">▼ Legende einblenden</div>
    <div class="kw-legend${legendHidden?' hidden':''}" id="kwLegendBar">
      <span class="leg-item"><kbd>A</kbd>Unterschr. Azubi</span>
      <span class="leg-item"><kbd>B</kbd>Unterschr. Ausbilder</span>
      <span class="leg-item"><kbd>C</kbd>BS-Themen</span>
      <span class="leg-item"><kbd>D</kbd>Wetter</span>
      <span class="leg-item"><kbd>E</kbd>Lückenhaft</span>
      <span class="leg-item"><kbd>F</kbd>Berichte fehlen</span>
      <span class="leg-item"><kbd>G</kbd>Datum/KW</span>
      <span class="leg-item"><kbd>H</kbd>Fehltage (1-5)</span>
      <span class="leg-item"><kbd>I</kbd>Sonstiges</span>
      <span class="leg-sep">│</span>
      <span class="leg-item"><kbd>←→↑↓</kbd>Nav</span>
      <span class="leg-item"><kbd>Entf</kbd>Leeren</span>
      <span class="leg-item"><kbd>Leer</kbd>Modal</span>
      <span class="leg-item"><kbd>O</kbd>OK</span>
      <button class="kw-legend-toggle" onclick="this.parentElement.classList.add('hidden');document.getElementById('kwLegendShow').style.display='block';App.uSet('legend_hidden','1')" title="Legende ausblenden">✕</button>
    </div>`;

    const c = document.getElementById('kontrolleContent');
    // Get other active prüfer (from position files)
    const anderePruefer = (App._otherPositions || []).filter(p => p.terminId === this.currentTerminId);
    const prueferList = App.query('SELECT name FROM pruefer WHERE aktiv=1');
    const isAnwesend = ke.anwesend !== 0;
    const isLocked = this.currentLock;

    c.innerHTML = `${kwLegendHtml}
    <div class="fade-in" style="margin-top:0">
      ${isLocked ? `<!-- Lock Warning -->
      <div class="card" id="lockWarning" style="margin-bottom:8px;border-left:4px solid var(--clr-red);background:var(--clr-red-light)">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px">
          <span style="font-size:24px">🔒</span>
          <div>
            <strong style="color:var(--clr-red);font-size:14px">${esc(isLocked.pruefer)} bearbeitet diesen Schüler!</strong>
            <div style="font-size:12px;color:var(--clr-text)">Dieser Schüler ist gesperrt bis ${esc(isLocked.pruefer)} auf <em>"Speichern & Freigeben"</em> klickt oder zum nächsten Schüler wechselt.</div>
            <div style="font-size:11px;color:var(--clr-text-light);margin-top:4px">
              Seit ${formatDateTime(isLocked.seit)} · Bitte einen anderen Schüler bearbeiten.
              <button class="btn btn-sm" style="margin-left:12px;font-size:11px;padding:2px 8px;background:var(--clr-amber-light);border:1px solid var(--clr-amber);color:var(--clr-amber)" onclick="KontrolleHandler.overrideLock()">⚠️ Sperre aufheben (Datenkonflikt möglich!)</button>
            </div>
          </div>
        </div>
      </div>` : `<div id="lockWarning" style="display:none" class="card" style="margin-bottom:8px;border-left:4px solid var(--clr-red);background:var(--clr-red-light)">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px">
          <span style="font-size:24px">🔒</span>
          <div><strong style="color:var(--clr-red)"><span class="lock-pruefer"></span> bearbeitet diesen Schüler!</strong>
            <div style="font-size:11px;color:var(--clr-text-light)"><button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onclick="KontrolleHandler.overrideLock()">⚠️ Sperre aufheben</button></div>
          </div>
        </div>
      </div>`}
      <!-- Prüfer + Suche + Live-Sync -->
      <div class="card" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
          <label style="font-weight:600;white-space:nowrap">Prüfer:</label>
          <span style="padding:4px 10px;background:var(--clr-leaf-light);border-radius:var(--radius);font-weight:600;font-size:12px">${esc(this.activePruefer || '–')}</span>
          <span style="font-size:10px;color:var(--clr-text-light)" title="Prüfer wird über die Benutzerauswahl in der Topbar (rechts oben) gesteuert">← Topbar</span>
          <!-- Live sync indicator -->
          ${!App.demoMode ? `<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--clr-sage);margin-left:4px" title="Live-Sync alle 6 Sekunden">
            <span id="syncPulse" style="width:6px;height:6px;border-radius:50%;background:var(--clr-green);opacity:0.3;transition:opacity 0.3s"></span>
            LIVE
          </span>` : '<span style="font-size:10px;color:var(--clr-amber)">Demo (kein Sync)</span>'}
          <!-- Live prüfer positions (updated by doLiveSync) -->
          <span id="livePrueferBar" style="display:${anderePruefer.length ? '' : 'none'};font-size:11px;padding:3px 8px;background:var(--clr-red-light);border-radius:10px;color:var(--clr-red)">
            ${anderePruefer.map(a => `🔒 ${esc(a.pruefer)} → #${this.currentSchuelerList.findIndex(sc => sc.id === a.schuelerId)+1} ${esc(a.schuelerName || this.currentSchuelerList.find(sc => sc.id === a.schuelerId)?.nachname || '?')}`).join(' · ')}
          </span>
          <div style="margin-left:auto;display:flex;align-items:center;gap:4px">
            <div style="position:relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="opacity:0.5;position:absolute;left:6px;top:7px;pointer-events:none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input class="form-control" id="kontrolleSearch" placeholder="Schüler suchen…" style="width:200px;padding:4px 8px 4px 24px;font-size:12px" autocomplete="off"
                oninput="KontrolleHandler.searchSchueler(this.value)"
                onfocus="if(this.value)KontrolleHandler.searchSchueler(this.value)"
                onblur="setTimeout(()=>{const dd=document.getElementById('searchDropdown');if(dd)dd.style.display='none'},200)"
                onkeydown="KontrolleHandler._searchKeyDown(event)">
              <div id="searchDropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:240px;overflow-y:auto;background:var(--clr-white);border:1px solid var(--clr-sand);border-radius:0 0 var(--radius) var(--radius);box-shadow:var(--shadow-md);z-index:50;font-size:12px"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mode toggle + Navigation -->
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--clr-sand)">
          <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler._viewMode='uebersicht';KontrolleHandler.renderUebersicht()" title="Zurück zur Übersicht">📋 Übersicht</button>
          <span style="font-size:11px;color:var(--clr-text-light)">|</span>
          <span style="font-size:12px;font-weight:600;color:var(--clr-forest)">👤 Einzelansicht</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <button class="btn btn-secondary" ${this.currentIndex === 0 ? 'disabled' : ''} onclick="KontrolleHandler.prev()">← Vorheriger</button>
          <div style="text-align:center">
            <strong style="font-size:18px;font-family:var(--font-display)">${esc(s.nachname)}, ${esc(s.vorname)}</strong>
            <div style="font-size:12px;color:var(--clr-text-light)">
              ${esc(s.ausbildungsstaette)} · Schüler ${this.currentIndex + 1} von ${total}
              ${App.getCurrentAJ(s.ausbildungsbeginn, s.id) ? ` · <span style="color:var(--clr-forest);font-weight:600">AJ ${App.getCurrentAJ(s.ausbildungsbeginn, s.id)}</span>` : ''}
              ${App.isVerkuerzer(s.ausbildungsbeginn, s.ausbildungsende, s.id) ? ' · <span style="color:#7b2fa0;font-weight:600">Verkürzer</span>' : ''}
              ${!isAnwesend ? ' · <span style="color:var(--clr-red);font-weight:600">NICHT ANWESEND</span>' : ''}
              · <a href="#" onclick="event.preventDefault();AzubiDashboard.open(${s.id})" style="color:var(--clr-forest);text-decoration:none;font-weight:600">&#128202; Dashboard</a>
            </div>
            ${!isLocked && this.activePruefer ? `<div style="font-size:11px;margin-top:2px;padding:2px 10px;display:inline-block;border-radius:10px;background:var(--clr-leaf-light);color:var(--clr-forest)">
              ✏️ <strong>${esc(this.activePruefer)}</strong> bearbeitet · <span style="opacity:0.7">andere können diesen Schüler nicht bearbeiten</span>
            </div>` : ''}
          </div>
          <button class="btn btn-secondary" ${this.currentIndex === total - 1 ? 'disabled' : ''} onclick="KontrolleHandler.next()">Nächster →</button>
        </div>
        <!-- Anwesenheit -->
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px;padding:4px 8px;background:${isAnwesend?'var(--clr-green-light)':'var(--clr-red-light)'};border-radius:var(--radius);font-size:12px">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-weight:600;color:${isAnwesend?'var(--clr-green)':'var(--clr-red)'}">
            <input type="checkbox" ${isAnwesend ? 'checked' : ''} onchange="KontrolleHandler.toggleAnwesend(this.checked)">
            ${isAnwesend ? '✓ Anwesend' : '✕ Nicht anwesend'}
          </label>
          ${!isAnwesend ? '<span style="color:var(--clr-text-light)">– Berichtsheft wird nicht geprüft</span>' : ''}
        </div>
        <!-- Ampel + Wiederholungstäter + Template -->
        ${(() => {
          const ampel = App.getSchuelerAmpel(s.id);
          const wdh = App.getWiederholungstaeter(s.id);
          const prevKE = App.getPreviousKETemplate(s.id, this.currentTerminId);
          let html = '';
          // Ampel bar
          if (ampel.color !== 'gray') {
            const bgCol = ampel.color === 'green' ? 'var(--clr-green-light)' : (ampel.color === 'red' ? 'var(--clr-red-light)' : 'var(--clr-amber-light)');
            const txtCol = ampel.color === 'green' ? '#1a7a42' : (ampel.color === 'red' ? '#a32a1e' : '#9a6100');
            html += `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:5px 10px;background:${bgCol};border-radius:var(--radius);font-size:12px;color:${txtCol}">
              <span style="font-size:16px">${ampel.icon}</span>
              <span><strong>${ampel.label}</strong>${ampel.offeneMaengel ? ` · ${ampel.offeneMaengel} offene KWs` : ''}${ampel.wvOffen ? ' · <span style="color:var(--clr-red)">WV offen!</span>' : ''}</span>
            </div>`;
          }
          // Wiederholungstäter
          if (wdh.isRepeat) {
            html += `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;padding:5px 10px;background:var(--clr-red-light);border-left:3px solid var(--clr-red);border-radius:var(--radius);font-size:12px;color:#8b2020">
              <span style="font-size:14px">⚠️</span>
              <div><strong>Wiederholte Beanstandung (${wdh.count}×)</strong>
              ${wdh.codes.length ? `<br>Häufige Codes: <strong>${wdh.codes.join(', ')}</strong>` : ''}
              ${wdh.suggestion ? `<br><em>${wdh.suggestion}</em>` : ''}</div>
            </div>`;
          }
          // Template button
          if (prevKE) {
            html += `<div style="margin-top:4px">
              <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.applyTemplate()" title="Pflichtteile aus letzter Kontrolle übernehmen">
                📋 Pflichtteile aus Vorkontrolle übernehmen
              </button>
            </div>`;
          }
          return html;
        })()}
        <!-- Quick nav with prüfer indicators -->
        <div style="display:flex;gap:4px;margin-top:8px;flex-wrap:wrap;justify-content:center" id="quickNavGrid">
          ${this.currentSchuelerList.map((sc, i) => {
            const done = App.scalar(`SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?`, [this.currentTerminId, sc.id]);
            const anw = App.scalar(`SELECT anwesend FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?`, [this.currentTerminId, sc.id]);
            const lockedBy = this.isLockedByOther(sc.id);
            const otherPruefer = anderePruefer.find(a => a.schuelerId === sc.id);
            const ampel = App.getSchuelerAmpel(sc.id);
            const cls = i === this.currentIndex ? 'btn-primary' : (anw === 0 ? '' : (done && done !== '' ? 'btn-success' : 'btn-secondary'));
            let style = anw === 0 ? 'background:var(--clr-red-light);color:var(--clr-red);border:1px solid var(--clr-red)' : '';
            if (lockedBy) style += ';box-shadow:0 0 0 2px var(--clr-red);opacity:0.7';
            else if (otherPruefer) style += ';box-shadow:0 0 0 2px var(--clr-red);opacity:0.7';
            const ampelDot = ampel.color === 'green' ? '' : (ampel.color === 'red' ? '🔴' : (ampel.color === 'yellow' ? '🟡' : ''));
            return `<button class="btn btn-sm ${cls}" style="${style}" onclick="KontrolleHandler.goTo(${i})" title="${esc(sc.nachname)}, ${esc(sc.vorname)}${ampelDot ? ' – '+ampel.label : ''}${lockedBy ? ' – 🔒 '+lockedBy : (otherPruefer ? ' – 🔒 '+otherPruefer.pruefer : '')}${anw===0?' – NICHT ANWESEND':''}">${lockedBy ? '🔒' : ampelDot}${i+1}</button>`;
          }).join('')}
        </div>
        </div>
        <!-- Schnell-Aktion: Ausgewählte als OK -->
        ${(() => {
          const unkontrolliert = this.currentSchuelerList.filter(sc => {
            const r = App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, sc.id]);
            return !r || r === '';
          });
          if (unkontrolliert.length === 0) return '';
          return `<details style="margin-top:8px;font-size:12px">
            <summary style="cursor:pointer;color:var(--clr-forest);font-weight:600;padding:6px 0">
              ✓ Ausgewählte als "In Ordnung" markieren (${unkontrolliert.length} unkontrolliert)
            </summary>
            <div style="padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);margin-top:4px">
              <div style="margin-bottom:6px">
                <label style="cursor:pointer;font-weight:600"><input type="checkbox" id="chkAllOK" onchange="document.querySelectorAll('.chk-ok').forEach(c=>c.checked=this.checked)" style="margin-right:4px">Alle unkontrollierten auswählen</label>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
                ${unkontrolliert.map(sc => `<label style="display:flex;align-items:center;gap:3px;padding:3px 8px;background:white;border-radius:4px;border:1px solid var(--clr-sand);cursor:pointer;white-space:nowrap">
                  <input type="checkbox" class="chk-ok" value="${sc.id}">
                  <span>${esc(sc.nachname)}, ${esc(sc.vorname)}</span>
                </label>`).join('')}
              </div>
              <button class="btn btn-sm btn-success" onclick="KontrolleHandler.bulkMarkOK()">✓ Ausgewählte als "In Ordnung"</button>
            </div>
          </details>`;
        })()}
        </div>
      </div>

      <!-- Content area (disabled when locked by another prüfer) -->
      <!-- Content area (disabled when locked by another prüfer) -->
      <div id="lockableContent" style="${isLocked ? 'pointer-events:none;opacity:0.5;user-select:none' : ''}">

      <!-- Frühere Kontrollen + Verlauf -->
      ${(() => {
        // Get ALL past kontrollergebnisse for this student
        const prevKEs = App.query(`SELECT ke.*, kt.geplant_datum, kt.pruefer as termin_pruefer, kt.id as tid
          FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
          WHERE ke.schueler_id=? AND ke.kontrolltermin_id != ? AND ke.ergebnis != ''
          ORDER BY kt.geplant_datum DESC`, [s.id, this.currentTerminId]);
        if (!prevKEs.length && durchsichtNr <= 1) {
          return '<div style="padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);margin-bottom:12px;font-size:12px;color:var(--clr-forest-dark)"><strong>Erste Durchsicht</strong> für diesen Schüler – noch keine Vorgänger-Daten vorhanden.</div>';
        }
        if (!prevKEs.length) return '';
        const lastPrev = prevKEs[0];
        // Count carried-forward KWs
        let carriedKWs = 0;
        try { const g = JSON.parse(ke.geprueft_kws || '{}'); carriedKWs = Object.values(g).reduce((s,arr) => s + (arr?.length||0), 0); } catch(e){}
        // Get matching snapshots
        const snapMap = {};
        prevSnapshots.forEach(snap => {
          if (!snapMap[snap.kontrollergebnis_id]) snapMap[snap.kontrollergebnis_id] = [];
          snapMap[snap.kontrollergebnis_id].push(snap);
        });

        return `<details class="card" style="margin-bottom:12px" ${lastPrev && lastPrev.ergebnis !== 'in_ordnung' ? 'open' : ''}>
        <summary style="cursor:pointer;padding:12px 16px;font-weight:600;font-size:13px;color:var(--clr-forest-dark)">
          📋 ${prevKEs.length} frühere Kontrolle${prevKEs.length > 1 ? 'n' : ''} vorhanden
          <span style="font-weight:400;color:var(--clr-text-light);font-size:12px;margin-left:8px">
            Letzte: ${formatDate(lastPrev.geplant_datum)} – ${ergebnisLabels[lastPrev.ergebnis] || lastPrev.ergebnis}
            ${carriedKWs ? ` · <span style="color:var(--clr-green)">${carriedKWs} KWs übernommen</span>` : ''}
          </span>
        </summary>
        <div style="padding:8px 16px 16px">
          ${lastPrev.ergebnis !== 'in_ordnung' ? `<div style="padding:6px 10px;background:var(--clr-amber-light);border-left:3px solid var(--clr-amber);border-radius:var(--radius);margin-bottom:8px;font-size:12px">
            <strong>⚠ Letzte Kontrolle war nicht OK:</strong> ${ergebnisLabels[lastPrev.ergebnis] || lastPrev.ergebnis}
            ${lastPrev.bemerkung ? `<br><em style="color:var(--clr-text-light)">${esc(lastPrev.bemerkung).substring(0,120)}</em>` : ''}
          </div>` : ''}
          <table class="data-table"><thead><tr><th>#</th><th>Datum</th><th>Prüfer</th><th>Ergebnis</th><th>Fehltage</th><th>Unterlagen</th></tr></thead><tbody>
            ${prevKEs.map((pke, i) => {
              const snaps = snapMap[pke.id] || [];
              return `<tr style="${pke.ergebnis !== 'in_ordnung' ? 'background:var(--clr-red-light)' : ''}">
                <td>${prevKEs.length - i}</td>
                <td>${formatDate(pke.geplant_datum)}</td>
                <td>${esc(pke.termin_pruefer || pke.geaendert_von || '–')}</td>
                <td><span class="badge-status ${pke.ergebnis === 'in_ordnung' ? 'badge-ok' : 'badge-open'}">${ergebnisLabels[pke.ergebnis] || pke.ergebnis}</span></td>
                <td>${pke.fehltage_gesamt || 0}</td>
                <td class="btn-group" style="flex-wrap:wrap">
                  <button class="btn btn-sm btn-secondary" onclick="PDFExport.generateSingle(${pke.tid},${s.id})" title="Durchsichtsbogen als PDF">📄 PDF</button>
                  ${snaps.map(snap => `<button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.viewSnapshot(${snap.id})" title="Archiv vom ${formatDate(snap.snapshot_datum)}">🔍 Archiv</button>`).join('')}
                  <button class="btn btn-sm btn-secondary" onclick="KontrolleHandler.goToKontrolle(${pke.tid},${s.id})" title="Alte Kontrolle öffnen">→ Öffnen</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody></table>
        </div>
      </details>`;
      })()}

      <!-- Pflichtteile (kompakt) -->
      <div class="card" style="margin-bottom:12px;max-width:540px">
        <div class="card-header" style="padding-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          <span>Pflichtteile (Zulassung Abschlussprüfung)</span>
          <button class="btn btn-sm btn-success" style="font-size:11px;padding:2px 8px" onclick="KontrolleHandler.setAllPflichtOK()" title="Alle Pflichtteile auf 'Ja' setzen">✓ Alle OK</button>
        </div>
        <div style="display:grid;grid-template-columns:28px 1fr auto;gap:4px 8px;align-items:center;font-size:13px">
          <span style="font-weight:600;color:var(--clr-sage)">1.1</span>
          <span>Ausbildungsplan <span style="font-size:11px;color:var(--clr-text-light)">(ausgef. + unterschr.)</span></span>
          <div>${pflichtOptHtml('p_1_1_ausbildungsplan', ke.p_1_1_ausbildungsplan)}</div>

          <span style="font-weight:600;color:var(--clr-sage)">1.4</span>
          <span>Der/die Auszubildende <span style="font-size:11px;color:var(--clr-text-light)">(ausgefüllt)</span></span>
          <div>${pflichtOptHtml('p_1_4_auszubildende', ke.p_1_4_auszubildende)}</div>

          <span style="font-weight:600;color:var(--clr-sage)">1.5</span>
          <span>Bescheinigungen ÜBA <span style="font-size:11px;color:var(--clr-text-light)">(ausgefüllt)</span></span>
          <div style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap">
            ${pflichtOptHtml('p_1_5_bescheinigungen', ke.p_1_5_bescheinigungen)}
            ${(() => {
              const reqUBA = App.getRequiredUBA(s.fachrichtung_id);
              const curUBA = ke.bescheinigungen_anzahl || 0;
              const ubaOK = curUBA >= reqUBA;
              const ubaColor = ubaOK ? 'var(--clr-green)' : curUBA > 0 ? 'var(--clr-amber)' : 'var(--clr-text-light)';
              return `<input type="number" class="form-control" value="${curUBA}" min="0" max="20" style="width:40px;padding:2px 4px;font-size:12px" onchange="KontrolleHandler.saveField('bescheinigungen_anzahl',this.value)">
                <span style="font-weight:600;color:${ubaColor};font-size:11px;white-space:nowrap">${curUBA}/${reqUBA} ${reqUBA === 6 ? '(GaLa)' : '(Prod.)'}${ubaOK ? ' ✓' : ''}</span>`;
            })()}
          </div>
        </div>
        <div style="border-top:1px solid var(--clr-sand);margin-top:8px;padding-top:6px">
          <div style="font-size:11px;font-weight:600;color:var(--clr-text-light);margin-bottom:4px">Freiwillig / Vertragsbestandteil</div>
          <div style="display:grid;grid-template-columns:28px 1fr auto;gap:4px 8px;align-items:center;font-size:13px">
            <span style="font-weight:600;color:var(--clr-sage)">1.2</span>
            <span>Vertragliche Regelungen</span>
            <div>${pflichtOptHtml('f_1_2_vertragliche_regelungen', ke.f_1_2_vertragliche_regelungen)}</div>

            <span style="font-weight:600;color:var(--clr-sage)">1.6</span>
            <span>Ausbildungsbetrieb / Skizze</span>
            <div>${pflichtOptHtml('f_1_6_ausbildungsbetrieb', ke.f_1_6_ausbildungsbetrieb)}</div>
          </div>
        </div>
      </div>

      <!-- KW Grids -->
      ${(() => { const ajs = App.getSchuelerAJs(s.id); return ajs.map(aj => {
        const ajSessionKWs = sessionKWs[aj] || [];
        // Progress: count geprüft vs total KWs
        const kwRange = KW_ALL;
        let geprueftCount = 0, maengelCount = 0;
        kwRange.forEach(kw => {
          const key = `${aj}_${kw}`;
          const d = kwData[key];
          if (d?.geprueft || ajSessionKWs.includes(kw)) geprueftCount++;
          if (d?.codes && d.codes !== '' && d.codes.split(',').some(c => c.trim() && c.trim() !== 'H')) maengelCount++;
        });
        const pct = Math.round(geprueftCount / 52 * 100);
        const barCol = pct >= 90 ? 'var(--clr-green)' : pct >= 50 ? 'var(--clr-amber)' : 'var(--clr-sage)';
        const bnd = ajBounds[aj] || { startKW: 36, endKW: 35, inactiveKWs: [], schoolYear: '', syStart: null };
        const activeCount = 52 - bnd.inactiveKWs.length;
        const activePct = activeCount > 0 ? Math.round(geprueftCount / activeCount * 100) : 0;
        const kwRangeLabel = bnd.inactiveKWs.length > 0 ? ` · KW ${bnd.startKW}–${bnd.endKW} (${activeCount} Wo.)` : '';
        return `
        <div class="card" style="margin-bottom:12px">
          <div class="card-header" style="flex-wrap:wrap;gap:6px">
            <span>Ausbildungsjahr ${aj}${bnd.schoolYear ? ' <span style="font-weight:400;color:var(--clr-sage)">('+bnd.schoolYear+')</span>' : ''} – Kalenderwochen</span>
            <span style="font-size:11px;font-weight:400;color:var(--clr-sage)">
              ${geprueftCount}/${activeCount} gepr\u00fcft${kwRangeLabel}${maengelCount ? ` · <span style="color:var(--clr-red)">${maengelCount} M\u00e4ngel</span>` : ''}
            </span>
            <div style="margin-left:auto;display:flex;align-items:center;gap:4px;font-size:11px">
              <span style="color:var(--clr-text-light)">Bereich pr\u00fcfen:</span>
              <select id="kwRangeFrom_${aj}" class="form-control" style="width:60px;padding:2px 4px;font-size:11px">
                ${KW_ALL.map(kw => `<option value="${kw}" ${kw===36?'selected':''}${bnd.inactiveKWs.includes(kw)?' disabled':''}>${bnd.inactiveKWs.includes(kw)?'(':''}KW ${kw}${bnd.inactiveKWs.includes(kw)?')':''}</option>`).join('')}
              </select>
              <span>\u2013</span>
              <select id="kwRangeTo_${aj}" class="form-control" style="width:60px;padding:2px 4px;font-size:11px">
                ${KW_ALL.map(kw => `<option value="${kw}" ${kw===35?'selected':''}${bnd.inactiveKWs.includes(kw)?' disabled':''}>${bnd.inactiveKWs.includes(kw)?'(':''}KW ${kw}${bnd.inactiveKWs.includes(kw)?')':''}</option>`).join('')}
              </select>
              <button class="btn btn-sm btn-success" style="padding:2px 8px;font-size:11px" onclick="KontrolleHandler.markRangeChecked(${aj})">✓ Als geprüft</button>
              <button class="btn btn-sm" style="padding:2px 8px;font-size:11px;background:var(--clr-red-light);color:var(--clr-red);border:1px solid var(--clr-red)" onclick="KontrolleHandler.unmarkRangeChecked(${aj})">✕ Entfernen</button>
            </div>
          </div>
          <div style="height:4px;background:var(--clr-sand);border-radius:2px;margin:0 0 4px">
            <div style="height:100%;width:${activePct}%;background:${barCol};border-radius:2px;transition:width 0.3s"></div>
          </div>
          ${renderKWGrid(aj)}
        </div>`;
      }).join(''); })()}

      <!-- Fehltage & Ergebnis -->
      <div class="card" style="margin-bottom:12px;max-width:700px">
        <div class="card-header">Fehl-/Krankheitstage & Ergebnis</div>
        <div style="display:flex;gap:16px;align-items:center;padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);margin-bottom:12px;font-size:13px">
          ${App.getSchuelerAJs(s.id).map(aj => `<span>AJ${aj}: <strong id="fehlSumAj${aj}_display">${this.calcFehlSum(s.id, aj)}</strong></span>`).join('')}
          <span style="font-size:11px;color:var(--clr-text-light)">│</span>
          <span style="font-size:15px;font-weight:700;color:var(--clr-forest-dark)">Gesamt: <span id="fehlGesamt">${ke.fehltage_gesamt}</span> Tage</span>
          <input type="hidden" id="fehlGesamtInput" value="${ke.fehltage_gesamt}">
          <span style="font-size:10px;color:var(--clr-sage);margin-left:auto">automatisch aus KW-Einträgen berechnet</span>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Sachberichte (bei Wetter-Mängeln)</label>
            <input type="number" class="form-control" value="${ke.sachberichte_anzahl}" onchange="KontrolleHandler.saveField('sachberichte_anzahl',this.value)" style="width:120px">
          </div>
        </div>

        <div class="form-group">
          <label>Ergebnis</label>
          <div class="check-row">
            <input type="radio" name="ergebnis" value="" ${!ke.ergebnis || ke.ergebnis === '' ? 'checked' : ''} onchange="KontrolleHandler.saveField('ergebnis','')">
            <span style="color:var(--clr-text-light)">– noch nicht bewertet –</span>
          </div>
          ${ergebnisOptions.map(o => `
            <div class="check-row">
              <input type="radio" name="ergebnis" value="${o.val}" ${ke.ergebnis === o.val ? 'checked' : ''} onchange="KontrolleHandler.saveField('ergebnis',this.value)">
              <span>${o.label}</span>
            </div>
          `).join('')}
        </div>

        <div class="form-group">
          <label>Bemerkung
            <select style="margin-left:8px;font-size:11px;padding:2px 6px;border:1px solid var(--clr-sand);border-radius:4px;color:var(--clr-text-light)" onchange="if(this.value){const ta=this.closest('.form-group').querySelector('textarea');ta.value=ta.value?(ta.value+'. '+this.value):this.value;KontrolleHandler.saveField('bemerkung',ta.value);this.value=''}">
              <option value="">Textbaustein einfügen…</option>
              ${App.getTextbausteine().map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}
            </select>
          </label>
          <textarea class="form-control" rows="3" onchange="KontrolleHandler.saveField('bemerkung',this.value)">${esc(ke.bemerkung)}</textarea>
        </div>

        <div class="form-row" id="wvSection" style="${ke.ergebnis && ke.ergebnis !== 'in_ordnung' ? '' : 'display:none'}">
          <div class="form-group">
            <label>Termin zur Wiedervorlage</label>
            <input type="date" class="form-control" id="wvDatum" value="${this.getWVDate(ke.id)}" onchange="KontrolleHandler.saveWV(${ke.id},this.value)">
          </div>
        </div>
      </div>

      </div><!-- /lock overlay -->

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:8px">
        <button class="btn btn-secondary" onclick="KontrolleHandler.prev()" ${this.currentIndex === 0 ? 'disabled' : ''}>← Vorheriger</button>
        <div class="btn-group" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn-success" onclick="KontrolleHandler.saveAndReleaseExplicit()" title="Änderungen speichern und Schüler für andere freigeben" style="font-weight:600">💾 Speichern & Freigeben</button>
          <button class="btn btn-secondary" onclick="PDFExport.generateSingle(${this.currentTerminId},${s.id})" title="Durchsichtsbogen dieses Schülers">📄 PDF Einzeln</button>
          <button class="btn btn-secondary" onclick="PlanungHandler.exportTerminPDF(${this.currentTerminId})" title="Alle Durchsichtsbögen dieser Klasse">📄 PDF Alle (${total})</button>
        </div>
        <button class="btn btn-secondary" onclick="KontrolleHandler.next()" ${this.currentIndex === total - 1 ? 'disabled' : ''}>Nächster →</button>
      </div>

      <!-- Kontrolle abschließen -->
      ${(() => {
        const done = this.currentSchuelerList.filter(sc => {
          const r = App.scalar('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, sc.id]);
          return r && r !== '';
        }).length;
        const open = total - done;
        const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [this.currentTerminId])[0];
        const isDone = termin?.status === 'durchgefuehrt';
        return `<div class="card" style="margin-top:16px;border-left:4px solid ${isDone ? 'var(--clr-green)' : open === 0 ? 'var(--clr-leaf)' : 'var(--clr-amber)'}">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <strong style="font-size:14px">${isDone ? '✓ Kontrolle abgeschlossen' : 'Kontrollfortschritt'}</strong>
              <div style="font-size:12px;color:var(--clr-text-light);margin-top:2px" data-sync-progress>
                ${done} von ${total} Schülern kontrolliert${open > 0 ? ` – <strong>${open} offen</strong>` : ' – <strong style="color:var(--clr-green)">alle fertig!</strong>'}
                ${isDone ? ` · Abgeschlossen am ${formatDate(termin.durchgefuehrt_datum)}` : ''}
              </div>
              <!-- Progress bar -->
              <div style="width:200px;height:6px;background:var(--clr-sand);border-radius:3px;margin-top:6px;overflow:hidden">
                <div data-sync-progress-bar style="width:${total?Math.round(done/total*100):0}%;height:100%;background:${done===total?'var(--clr-green)':'var(--clr-leaf)'};border-radius:3px;transition:width 0.3s"></div>
              </div>
            </div>
            <div class="btn-group">
              ${!isDone ? `<button class="btn ${open===0?'btn-success':'btn-primary'}" onclick="KontrolleHandler.abschliessen()" ${open > 0 ? '' : ''}>
                ${open === 0 ? '✓ Kontrolle abschließen' : `Kontrolle abschließen (${open} offen)`}
              </button>` : `<button class="btn btn-secondary" onclick="KontrolleHandler.reopenKontrolle()">Kontrolle wieder öffnen</button>`}
              <button class="btn btn-secondary" onclick="PlanungHandler.exportTerminPDF(${this.currentTerminId})">📄 Alle als PDF</button>
            </div>
          </div>
        </div>`;
      })()}
    </div>`;
  },

  getWVDate(keId) {
    const wv = App.query(`SELECT frist_datum FROM wiedervorlagen WHERE kontrollergebnis_id=? ORDER BY id DESC LIMIT 1`, [keId]);
    return wv.length ? wv[0].frist_datum : '';
  },

  // Whitelist erlaubter Feldnamen für saveField() – schützt gegen SQL-Injection
  _allowedFields: new Set(['ergebnis','bemerkung','p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb','sachberichte_anzahl','anwesend','bescheinigungen_anzahl','zulassung_ap','pruefungsausschuss']),

  saveField(field, value) {
    if (!this._allowedFields.has(field)) {
      console.error('saveField: ungültiger Feldname:', field);
      return;
    }
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const ke = App.query(`SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?`, [this.currentTerminId, s.id])[0];
    if (!ke) return;
    const oldVal = ke[field] || '';
    const keId = ke.id;
    const pruefer = this.activePruefer || '';

    // Push undo entry
    const fieldLabels = {ergebnis:'Ergebnis',bemerkung:'Bemerkung',p_1_1_ausbildungsplan:'Ausbildungsplan',p_1_4_auszubildende:'Auszubildende',p_1_5_bescheinigungen:'Bescheinigungen',f_1_2_vertragliche_regelungen:'Vertragliches',f_1_6_ausbildungsbetrieb:'Betrieb/Skizze',sachberichte_anzahl:'Sachberichte',anwesend:'Anwesend'};
    UndoManager.push(
      `${fieldLabels[field]||field} bei ${s.nachname}`,
      () => { App.run(`UPDATE kontrollergebnisse SET ${field}=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`, [oldVal, pruefer, keId]); this.renderSchueler(); },
      () => { App.run(`UPDATE kontrollergebnisse SET ${field}=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`, [value, pruefer, keId]); this.renderSchueler(); }
    );

    App.run(`UPDATE kontrollergebnisse SET ${field}=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`, [value, pruefer, keId]);

    // When "In Ordnung" → auto-set all Pflichtteile to "ja"
    if (field === 'ergebnis' && value === 'in_ordnung') {
      const pflichtFields = ['p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb'];
      pflichtFields.forEach(pf => {
        App.run(`UPDATE kontrollergebnisse SET ${pf}='ja' WHERE id=? AND (${pf}='' OR ${pf} IS NULL)`, [ke.id]);
        // Update UI dropdown
        const sel = document.querySelector(`[data-field="${pf}"]`);
        if (sel && (!sel.value || sel.value === '')) { sel.value = 'ja'; sel.style.borderColor = 'var(--clr-green)'; }
      });
    }

    // Show/hide WV section
    if (field === 'ergebnis') {
      const wvSec = document.getElementById('wvSection');
      if (wvSec) wvSec.style.display = (value && value !== 'in_ordnung') ? '' : 'none';

      // Auto-erledige offene Wiedervorlagen wenn "in Ordnung"
      if (value === 'in_ordnung') {
        const openWVs = App.query("SELECT id FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id]);
        if (openWVs.length) {
          const today = new Date().toISOString().split('T')[0];
          openWVs.forEach(wv => {
            App.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung='Automatisch erledigt – Berichtsheft bei erneuter Durchsicht in Ordnung' WHERE id=?", [today, wv.id]);
          });
          App.toast(openWVs.length + ' Wiedervorlage' + (openWVs.length > 1 ? 'n' : '') + ' automatisch als erledigt markiert', 'success');
        }
      }
    }
  },

  // Set all Pflichtteile to "Ja" with one click
  setAllPflichtOK() {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, s.id])[0];
    if (!ke) return;
    const fields = ['p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb'];
    let count = 0;
    fields.forEach(f => {
      if (ke[f] !== 'ja') {
        App.run(`UPDATE kontrollergebnisse SET ${f}='ja', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`, [this.activePruefer || '', ke.id]);
        count++;
      }
    });
    this.renderSchueler();
    App.toast(count ? `${count} Pflichtteile auf "Ja" gesetzt` : 'Alle Pflichtteile waren bereits "Ja"', count ? 'success' : 'info');
  },

  saveWV(keId, datum) {
    if (!datum) return;
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE id=?', [keId])[0];
    if (!ke) return;
    // Upsert wiedervorlage
    const existing = App.query('SELECT * FROM wiedervorlagen WHERE kontrollergebnis_id=?', [keId]);
    if (existing.length) {
      App.run('UPDATE wiedervorlagen SET frist_datum=?, art=? WHERE kontrollergebnis_id=?', [datum, ke.ergebnis, keId]);
    } else {
      App.run('INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum) VALUES (?,?,?,?)',
        [keId, ke.schueler_id, ke.ergebnis, datum]);
    }
  },

  editKW(keId, aj, kw, cellEl) {
    // Full modal fallback (opened via Space key or click)
    const codes = ['A','B','C','D','E','F','G','H','I'];
    const labels = ['Unterschrift Azubi','Unterschrift Ausbilder','Berufsschulthemen','Wetter','Inhaltlich lückenhaft','Komplette Berichte fehlen','Datum/KW','Fehltage','Sonstiges'];

    const existing = App.query(`SELECT * FROM kw_maengel WHERE kontrollergebnis_id=? AND ausbildungsjahr=? AND kalenderwoche=?`, [keId, aj, kw]);
    const currentCodes = existing.length ? (existing[0].maengel_codes || '').split(',').filter(Boolean) : [];
    const currentFehltage = existing.length ? existing[0].fehltage : 0;

    const s = this.currentSchuelerList[this.currentIndex];
    const sid = s ? s.id : null;
    const kwBem = sid ? (App.query('SELECT bemerkung FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [sid, aj, kw])[0]?.bemerkung || '') : '';
    const bausteine = JSON.parse(App.scalar("SELECT wert FROM einstellungen WHERE schluessel='textbausteine_bemerkung'") || '[]');

    App.openModal(`KW ${kw} – Ausbildungsjahr ${aj}`, `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-success" style="flex:1;font-weight:600" id="kwBtnOK" onclick="KontrolleHandler.saveKWOk(${keId},${aj},${kw})">✓ Keine Beanstandungen <kbd style="font-size:10px;opacity:0.7;margin-left:4px">O</kbd></button>
      </div>
      <p style="font-size:13px;color:var(--clr-text-light);margin-bottom:8px">Mängel-Codes (<kbd>A</kbd>–<kbd>I</kbd> zum Umschalten):</p>
      ${codes.map((c,i) => `
        <div class="check-row">
          <input type="checkbox" id="kwc_${c}" ${currentCodes.includes(c) ? 'checked' : ''}${c === 'I' ? ' onchange="document.getElementById(\'kwBemSection\').style.display=this.checked?\'\':\'\'"' : ''}>
          <label for="kwc_${c}"><kbd>${c}</kbd> ${labels[i]}</label>
        </div>
      `).join('')}
      <div class="form-group" style="margin-top:12px">
        <label>Fehltage in dieser KW (<kbd>1</kbd>–<kbd>5</kbd>, <kbd>0</kbd> löschen)</label>
        <input type="number" class="form-control" id="kwFehltage" value="${currentFehltage}" min="0" max="7" style="width:80px">
      </div>
      <div id="kwBemSection" style="margin-top:12px;${currentCodes.includes('I') || kwBem ? '' : 'display:none'}">
        <div class="form-group">
          <label>Bemerkung zu KW ${kw} (Sonstiges)</label>
          <textarea class="form-control" id="kwBemText" rows="2" style="font-size:12px" placeholder="Freitext…">${esc(kwBem)}</textarea>
        </div>
        ${bausteine.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px">${bausteine.map(b => `<button class="btn btn-sm btn-secondary" style="font-size:10px;padding:2px 6px" onclick="const t=document.getElementById('kwBemText');t.value=t.value+(t.value?'\\n':'')+${JSON.stringify(b)}">${esc(b.length > 25 ? b.substring(0,23)+'…' : b)}</button>`).join('')}</div>` : ''}
      </div>
      <div style="font-size:10px;color:var(--clr-text-light);margin-top:12px;border-top:1px solid var(--clr-sand);padding-top:8px">
        <kbd>Enter</kbd> Speichern · <kbd>Esc</kbd> Abbrechen · <kbd>O</kbd> Keine Beanstandungen · <kbd>A</kbd>–<kbd>I</kbd> Codes umschalten
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen <kbd style="font-size:9px;opacity:0.6">Esc</kbd></button>
        <button class="btn btn-danger btn-sm" onclick="KontrolleHandler.clearKW(${keId},${aj},${kw})">Leeren</button>
        <button class="btn btn-primary" onclick="KontrolleHandler.saveKW(${keId},${aj},${kw})">Speichern <kbd style="font-size:9px;opacity:0.6">Enter</kbd></button>`);

    // Store context for keyboard handler
    this._kwModalContext = { keId, aj, kw, cellEl };

    // Auto-focus the OK button for immediate keyboard use
    setTimeout(() => { const btn = document.getElementById('kwBtnOK'); if (btn) btn.focus(); }, 100);
  },

  // "Keine Beanstandungen" quick action
  saveKWOk(keId, aj, kw) {
    const s = this.currentSchuelerList[this.currentIndex];
    if (s) {
      // Mark as geprüft with no issues
      const existing = App.query('SELECT id FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, kw]);
      if (existing.length) {
        App.run('UPDATE kw_status SET maengel_codes="", fehltage=0, geprueft=1 WHERE id=?', [existing[0].id]);
      } else {
        App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,maengel_codes,fehltage,geprueft,erstellt_bei) VALUES (?,?,?,"",0,1,?)',
          [s.id, aj, kw, keId]);
      }
      KWNav.trackSessionKW(keId, aj, kw);
    }
    // Also clear kw_maengel
    App.run('DELETE FROM kw_maengel WHERE kontrollergebnis_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [keId, aj, kw]);
    App.closeModal();
    this._kwModalContext = null;
    this.renderSchueler();
    this._focusNextKW(aj, kw);
  },

  saveKW(keId, aj, kw) {
    const codes = ['A','B','C','D','E','F','G','H','I'];
    const selected = codes.filter(c => document.getElementById('kwc_' + c)?.checked);
    const fehltage = parseInt(document.getElementById('kwFehltage').value) || 0;
    const codesStr = selected.join(',');
    const bem = document.getElementById('kwBemText')?.value?.trim() || '';

    KWNav.persistCodes(keId, aj, kw, codesStr, fehltage);

    // Save bemerkung
    const s = this.currentSchuelerList[this.currentIndex];
    if (s) {
      const existing = App.query('SELECT id FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, kw]);
      if (existing.length) {
        App.run('UPDATE kw_status SET bemerkung=? WHERE id=?', [bem, existing[0].id]);
      } else if (bem) {
        App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,bemerkung,geprueft,erstellt_bei) VALUES (?,?,?,?,1,?)',
          [s.id, aj, kw, bem, keId]);
      }
      if (bem) {
        const ke = App.query('SELECT bemerkung FROM kontrollergebnisse WHERE id=?', [keId])[0];
        if (ke) {
          const prefix = `[AJ${aj}/KW${kw}] `;
          const existingGlobal = ke.bemerkung || '';
          if (!existingGlobal.includes(prefix + bem)) {
            const newBem = existingGlobal ? existingGlobal + '\n' + prefix + bem : prefix + bem;
            App.run('UPDATE kontrollergebnisse SET bemerkung=? WHERE id=?', [newBem, keId]);
          }
        }
      }
    }

    App.closeModal();
    this._kwModalContext = null;
    this.renderSchueler();
    this._focusNextKW(aj, kw);
  },

  clearKW(keId, aj, kw) {
    KWNav.persistCodes(keId, aj, kw, '', 0);
    App.closeModal();
    this._kwModalContext = null;
    this.renderSchueler();
    this._focusNextKW(aj, kw);
  },

  // ── Focus next KW cell after modal close ──
  _focusNextKW(aj, kw) {
    setTimeout(() => {
      const allKWs = KW_ALL;
      const idx = allKWs.indexOf(kw);
      const s = this.currentSchuelerList?.[this.currentIndex];
      const schuelerAJs = s ? App.getSchuelerAJs(s.id) : [1,2,3];

      // Try next KW in same AJ
      if (idx >= 0 && idx < allKWs.length - 1) {
        const nextKW = allKWs[idx + 1];
        const cell = document.querySelector(`.kw-cell[data-aj="${aj}"][data-kw="${nextKW}"]:not(.kw-inactive)`);
        if (cell) { cell.focus(); return; }
      }
      // End of AJ → try first active KW in next AJ
      const ajIdx = schuelerAJs.indexOf(aj);
      if (ajIdx >= 0 && ajIdx < schuelerAJs.length - 1) {
        const nextAJ = schuelerAJs[ajIdx + 1];
        const cell = document.querySelector(`.kw-cell[data-aj="${nextAJ}"]:not(.kw-inactive)`);
        if (cell) { cell.focus(); return; }
      }
      // Fallback: refocus current cell
      const current = document.querySelector(`.kw-cell[data-aj="${aj}"][data-kw="${kw}"]`);
      if (current) current.focus();
    }, 50);
  },

  prev() {
    this.saveAndRelease(); // save + release old lock
    if (this.currentIndex > 0) { this.currentIndex--; this.enterSchüler(); }
  },
  next() {
    this.saveAndRelease();
    if (this.currentIndex < this.currentSchuelerList.length - 1) { this.currentIndex++; this.enterSchüler(); }
  },
  goTo(i) {
    if (i === this.currentIndex) return;
    this.saveAndRelease();
    this.currentIndex = i;
    this.enterSchüler();
  },

  // ── Save current student + release lock ──
  saveAndRelease() {
    this.microSave();
    this.releaseLock();
  },

  // ── Explicit "Speichern & Freigeben" (button handler) ──
  saveAndReleaseExplicit() {
    const s = this.currentSchuelerList?.[this.currentIndex];
    this.microSave();
    this.releaseLock();
    App.toast(`${s ? s.nachname + ', ' + s.vorname : 'Schüler'} gespeichert & freigegeben`, 'success');
    this.renderSchueler(); // re-render to show unlocked state
  },

  // ── Release lock for current student ──
  releaseLock() {
    const pruefer = this.activePruefer || '';
    if (pruefer) {
      App._deletePositionFile(pruefer);
    }
  },

  // ── Release ALL locks for this prüfer (on tab close) ──
  releaseAllLocks() {
    const pruefer = this.activePruefer || '';
    if (pruefer) {
      App._deletePositionFile(pruefer);
    }
  },

  // ── Micro-Save: schedule save when switching students (non-blocking) ──
  microSave() {
    if (App.dbFileHandle && !App.demoMode) {
      App.scheduleAutoSave();
    }
  },

  // ── Enter a student: track prüfer + save immediately for sync ──
  enterSchüler() {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const pruefer = this.activePruefer || '';

    // ── Persist position for reload recovery ──
    try {
      App.uSet('last_position', JSON.stringify({
        terminId: this.currentTerminId,
        schuelerId: s.id,
        schuelerIndex: this.currentIndex,
        viewMode: this._viewMode,
        timestamp: Date.now()
      }));
    } catch(e) {}

    // ── Write position file (tiny JSON, no DB lock needed) ──
    if (pruefer && App.dirHandle && !App.demoMode) {
      this._lastWrittenPos = this.currentTerminId + ':' + s.id;
      App._writePositionFile(pruefer, this.currentTerminId, s.id, s.nachname);
    }

    // Check if another prüfer has this student (from cached positions – updated by doLiveSync)
    const others = App._otherPositions || [];
    const lock = others.find(p => p.terminId === this.currentTerminId && p.schuelerId === s.id);
    this.currentLock = lock || null;

    this.renderSchueler();
    this.startLiveSync();
  },

  // Update the "andere Prüfer" bar in Einzelansicht header (from cache, no disk read)
  _updateAnderePrueferBar() {
    const bar = document.getElementById('livePrueferBar');
    if (!bar || !this.currentTerminId) return;
    const others = (App._otherPositions || []).filter(p => p.terminId === this.currentTerminId);
    if (others.length) {
      bar.style.display = '';
      bar.innerHTML = others.map(a => {
        const idx = this.currentSchuelerList.findIndex(sc => sc.id === a.schuelerId);
        const name = a.schuelerName || this.currentSchuelerList.find(sc => sc.id === a.schuelerId)?.nachname || '?';
        return `🔒 ${esc(a.pruefer)} → #${idx+1} ${esc(name)}`;
      }).join(' · ');
    } else {
      bar.style.display = 'none';
    }
  },

  // Current lock state (null = not locked, object = locked by someone)
  currentLock: null,

  // ════════════════════════════════════════
  //  LIVE SYNC – Echtzeit-Prüfer-Positionen
  // ════════════════════════════════════════
  _liveSyncTimer: null,
  _lastOtherPositions: '{}', // JSON string for change detection

  startLiveSync() {
    if (this._liveSyncTimer) return; // already running
    if (App.demoMode) return; // no sync in demo
    this._liveSyncTimer = setInterval(() => this.doLiveSync(), 8000); // every 8 seconds (relaxed)
    this._liveSyncCycle = 0;
  },

  stopLiveSync() {
    if (this._liveSyncTimer) {
      clearInterval(this._liveSyncTimer);
      this._liveSyncTimer = null;
    }
    // Delete our position file (non-blocking, no DB write)
    const pruefer = this.activePruefer;
    if (pruefer && !App.demoMode) App._deletePositionFile(pruefer);
  },

  _clearMyPosition() {
    const pruefer = this.activePruefer;
    if (!pruefer || App.demoMode) return;
    App._deletePositionFile(pruefer);
  },

  async doLiveSync() {
    if (!this.currentTerminId) return;
    const pruefer = this.activePruefer || '';
    this._liveSyncCycle = (this._liveSyncCycle || 0) + 1;

    try {
      // Write position file ONLY if position changed OR heartbeat needed (>2 min since last write)
      if (pruefer && App.dirHandle && !App.demoMode) {
        const s = this.currentSchuelerList[this.currentIndex];
        if (s) {
          const posKey = this.currentTerminId + ':' + s.id;
          const now = Date.now();
          const stale = !this._lastPosWriteTime || (now - this._lastPosWriteTime > 120000); // 2 min heartbeat
          if (posKey !== this._lastWrittenPos || stale) {
            this._lastWrittenPos = posKey;
            this._lastPosWriteTime = now;
            App._writePositionFile(pruefer, this.currentTerminId, s.id, s.nachname);
          }
        }
      }

      // Read other prüfer positions every cycle (lightweight: just reads 2-3 small files)
      if (App.dirHandle && !App.demoMode) {
        await App._readPositionFiles(pruefer);
      }
      const others = (App._otherPositions || []).filter(p => p.terminId === this.currentTerminId);

      const diskResults = {};
      App.query("SELECT schueler_id, ergebnis, anwesend FROM kontrollergebnisse WHERE kontrolltermin_id=?",
        [this.currentTerminId]).forEach(r => { diskResults[r.schueler_id] = r; });

      // Check if positions changed
      const posKey = JSON.stringify(others.map(o => `${o.pruefer}:${o.schuelerId}`).sort());
      const changed = posKey !== this._lastOtherPositions;
      this._lastOtherPositions = posKey;

      // Update quick-nav grid buttons (lightweight, no full re-render)
      this.updateLiveIndicators(others, diskResults);

      // Update the prüfer status bar
      this.updatePrueferBar(others);

      // Check if current student is now locked
      const currentStudent = this.currentSchuelerList[this.currentIndex];
      if (currentStudent) {
        const lockedNow = others.find(o => o.schuelerId === currentStudent.id);
        if (lockedNow && !this.currentLock) {
          this.currentLock = lockedNow;
          const lockEl = document.getElementById('lockWarning');
          if (lockEl) {
            lockEl.style.display = '';
            const lp = lockEl.querySelector('.lock-pruefer');
            if (lp) lp.textContent = lockedNow.pruefer;
          }
          const formArea = document.getElementById('lockableContent');
          if (formArea) { formArea.style.pointerEvents = 'none'; formArea.style.opacity = '0.5'; formArea.style.userSelect = 'none'; }
        } else if (!lockedNow && this.currentLock) {
          this.currentLock = null;
          const lockEl = document.getElementById('lockWarning');
          if (lockEl) lockEl.style.display = 'none';
          const formArea = document.getElementById('lockableContent');
          if (formArea) { formArea.style.pointerEvents = ''; formArea.style.opacity = ''; formArea.style.userSelect = ''; }
        }
      }

      // Pulse the sync indicator
      const syncDot = document.getElementById('syncPulse');
      if (syncDot) {
        syncDot.style.opacity = '1';
        setTimeout(() => { if (syncDot) syncDot.style.opacity = '0.3'; }, 800);
      }

      this._updateProgressFromSync(diskResults);

    } catch(e) {
      console.warn('LiveSync error:', e);
    }
  },

  // Update the progress bar/counter from synced data
  _updateProgressFromSync(diskResults) {
    const total = this.currentSchuelerList.length;
    if (!total) return;
    const done = this.currentSchuelerList.filter(sc => {
      const r = diskResults[sc.id];
      return r && r.ergebnis && r.ergebnis !== '';
    }).length;
    // Update progress text if it exists in DOM
    const progEl = document.querySelector('[data-sync-progress]');
    if (progEl) {
      const open = total - done;
      progEl.innerHTML = `${done} von ${total} Schülern kontrolliert${open > 0 ? ` – <strong>${open} offen</strong>` : ' – <strong style="color:var(--clr-green)">alle fertig!</strong>'}`;
    }
    const progBar = document.querySelector('[data-sync-progress-bar]');
    if (progBar) progBar.style.width = `${total ? Math.round(done/total*100) : 0}%`;
  },

  // Lightweight status update: just re-read kontrollergebnisse and update quick-nav buttons
  _updateQuickNavStatus() {
    const grid = document.getElementById('quickNavGrid');
    if (!grid || !this.currentTerminId) return;
    const buttons = grid.querySelectorAll('button');
    const results = {};
    App.query("SELECT schueler_id, ergebnis, anwesend FROM kontrollergebnisse WHERE kontrolltermin_id=?",
      [this.currentTerminId]).forEach(r => { results[r.schueler_id] = r; });
    this.currentSchuelerList.forEach((sc, i) => {
      const btn = buttons[i];
      if (!btn || i === this.currentIndex) return;
      const r = results[sc.id];
      if (r && r.ergebnis && r.ergebnis !== '') {
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-success');
      }
      if (r && r.anwesend === 0) {
        btn.style.opacity = '0.4';
      }
    });
  },

  // Update quick-nav buttons with other prüfer positions + disk results
  updateLiveIndicators(others, diskResults) {
    const grid = document.getElementById('quickNavGrid');
    if (!grid) return;
    const buttons = grid.querySelectorAll('button');

    this.currentSchuelerList.forEach((sc, i) => {
      const btn = buttons[i];
      if (!btn) return;

      const otherHere = others.find(o => o.schuelerId === sc.id);
      const diskResult = diskResults[sc.id];
      const isCurrent = i === this.currentIndex;

      // Reset styles
      btn.style.boxShadow = '';
      btn.style.opacity = '';
      let titleParts = [`${sc.nachname}, ${sc.vorname}`];

      // Apply "other prüfer here" indicator → LOCKED
      if (otherHere) {
        btn.style.boxShadow = '0 0 0 3px var(--clr-red), inset 0 0 0 1px var(--clr-red)';
        btn.style.opacity = '0.7';
        titleParts.push(`🔒 ${otherHere.pruefer}`);
      }

      // Update done-state from disk (if the other prüfer finished this student)
      if (diskResult && diskResult.ergebnis && diskResult.ergebnis !== '' && !isCurrent) {
        if (!btn.classList.contains('btn-success') && !btn.classList.contains('btn-primary')) {
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-success');
        }
      }

      // Non-anwesend from disk
      if (diskResult && diskResult.anwesend === 0) {
        titleParts.push('NICHT ANWESEND');
      }

      btn.title = titleParts.join(' · ');
      btn.textContent = (otherHere ? '🔒' : '') + (i + 1);
    });
  },

  // Update the prüfer status bar (without re-render)
  updatePrueferBar(others) {
    const bar = document.getElementById('livePrueferBar');
    if (!bar) return;
    if (others.length) {
      const parts = others.map(o => {
        const idx = this.currentSchuelerList.findIndex(sc => sc.id === o.schuelerId);
        const name = o.schuelerName || (idx >= 0 ? this.currentSchuelerList[idx].nachname : '?');
        return `🔒 ${o.pruefer} → #${idx+1} ${name}`;
      });
      bar.innerHTML = parts.join(' <span style="opacity:0.4">·</span> ');
      bar.style.display = '';
    } else {
      bar.style.display = 'none';
    }
  },

  // Check if a specific student is locked by another prüfer (from cached positions)
  isLockedByOther(schuelerId) {
    const others = (App._otherPositions || []).filter(p => p.terminId === this.currentTerminId);
    const lock = others.find(o => o.schuelerId === schuelerId);
    return lock ? lock.pruefer : null;
  },

  // Apply previous kontrollergebnis as template for current student
  applyTemplate() {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const prevKE = App.getPreviousKETemplate(s.id, this.currentTerminId);
    if (!prevKE) return App.toast('Keine Vorkontrolle gefunden', 'warning');
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, s.id])[0];
    if (!ke) return;

    // Only overwrite empty fields
    const fields = ['p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb'];
    let count = 0;
    fields.forEach(f => {
      if ((!ke[f] || ke[f] === '') && prevKE[f] && prevKE[f] !== '') {
        App.run(`UPDATE kontrollergebnisse SET ${f}=? WHERE id=?`, [prevKE[f], ke.id]);
        count++;
      }
    });
    if (prevKE.bescheinigungen_anzahl && !ke.bescheinigungen_anzahl) {
      App.run('UPDATE kontrollergebnisse SET bescheinigungen_anzahl=? WHERE id=?', [prevKE.bescheinigungen_anzahl, ke.id]);
    }
    this.renderSchueler();
    App.toast(`${count} Pflichtteile aus Vorkontrolle übernommen`, 'success');
  },

  // Override lock (force edit despite another prüfer working on this student)
  overrideLock() {
    this.currentLock = null;
    const formArea = document.getElementById('lockableContent');
    if (formArea) { formArea.style.pointerEvents = ''; formArea.style.opacity = ''; formArea.style.userSelect = ''; }
    App.toast('Sperre aufgehoben – Sie können jetzt bearbeiten. Achtung: Datenkonflikt möglich!', 'warning');
    this.renderSchueler();
  },

  // Active Prüfer name (set when starting kontrolle)
  activePruefer: '',

  setActivePruefer(name) {
    const oldPruefer = this.activePruefer;
    this.activePruefer = name;

    // Delete old prüfer's position file
    if (oldPruefer && oldPruefer !== name) {
      App._deletePositionFile(oldPruefer);
    }

    // Write position file with new name
    const s = this.currentSchuelerList[this.currentIndex];
    if (s && this.currentTerminId && name) {
      App._writePositionFile(name, this.currentTerminId, s.id, s.nachname);
    }
  },

  // ── Schülersuche innerhalb Kontrolle ──
  _searchHighlightIdx: -1,

  searchSchueler(query) {
    const dd = document.getElementById('searchDropdown');
    if (!dd) return;

    // Also filter quickNavGrid
    document.querySelectorAll('#quickNavGrid button').forEach(b => b.style.display = '');

    if (!query || query.length < 1) {
      dd.style.display = 'none';
      this._searchHighlightIdx = -1;
      return;
    }
    const q = query.toLowerCase();
    const results = [];
    this.currentSchuelerList.forEach((sc, i) => {
      const matchName = sc.nachname.toLowerCase().includes(q) || sc.vorname.toLowerCase().includes(q);
      const matchBetrieb = (sc.ausbildungsstaette||'').toLowerCase().includes(q);
      const btn = document.querySelectorAll('#quickNavGrid button')[i];
      if (btn) btn.style.display = (matchName || matchBetrieb) ? '' : 'none';
      if (matchName || matchBetrieb) results.push({ idx: i, sc, matchName, matchBetrieb });
    });

    if (!results.length) {
      dd.innerHTML = '<div style="padding:8px 12px;color:var(--clr-text-light)">Kein Treffer</div>';
      dd.style.display = 'block';
      this._searchHighlightIdx = -1;
      return;
    }

    this._searchResults = results;
    this._searchHighlightIdx = 0;

    const highlight = (text, q) => {
      const idx = text.toLowerCase().indexOf(q);
      if (idx < 0) return esc(text);
      return esc(text.substring(0, idx)) + '<strong style="color:var(--clr-forest)">' + esc(text.substring(idx, idx + q.length)) + '</strong>' + esc(text.substring(idx + q.length));
    };

    dd.innerHTML = results.map((r, ri) => {
      const s = r.sc;
      const ke = App.query('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, s.id])[0];
      const ergebnis = ke?.ergebnis;
      const badge = ergebnis === 'in_ordnung' ? '🟢' : ergebnis && ergebnis !== '' ? '🔴' : '⚪';
      const isActive = ri === 0;
      return `<div class="search-result" data-ridx="${ri}" data-idx="${r.idx}"
        style="padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--clr-sand);${isActive ? 'background:var(--clr-green-light)' : ''}"
        onmouseenter="KontrolleHandler._searchHover(${ri})"
        onclick="KontrolleHandler._searchSelect(${r.idx})">
        <span style="font-size:11px;width:22px;text-align:center;color:var(--clr-text-light)">${r.idx + 1}</span>
        <span>${badge}</span>
        <div style="flex:1;min-width:0">
          <div>${highlight(s.nachname, q)}, ${highlight(s.vorname, q)}</div>
          <div style="font-size:10px;color:var(--clr-text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.ausbildungsstaette || '–')}</div>
        </div>
      </div>`;
    }).join('');
    dd.style.display = 'block';
  },

  _searchHover(ri) {
    this._searchHighlightIdx = ri;
    document.querySelectorAll('#searchDropdown .search-result').forEach((el, i) => {
      el.style.background = i === ri ? 'var(--clr-green-light)' : '';
    });
  },

  _searchSelect(idx) {
    const dd = document.getElementById('searchDropdown');
    if (dd) dd.style.display = 'none';
    document.getElementById('kontrolleSearch').value = '';
    document.querySelectorAll('#quickNavGrid button').forEach(b => b.style.display = '');
    this._searchHighlightIdx = -1;
    this.goTo(idx);
  },

  _searchKeyDown(e) {
    const dd = document.getElementById('searchDropdown');
    if (!dd || dd.style.display === 'none' || !this._searchResults?.length) return;
    const results = this._searchResults;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._searchHighlightIdx = Math.min(this._searchHighlightIdx + 1, results.length - 1);
      this._searchHover(this._searchHighlightIdx);
      const active = dd.querySelector(`[data-ridx="${this._searchHighlightIdx}"]`);
      if (active) active.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._searchHighlightIdx = Math.max(this._searchHighlightIdx - 1, 0);
      this._searchHover(this._searchHighlightIdx);
      const active = dd.querySelector(`[data-ridx="${this._searchHighlightIdx}"]`);
      if (active) active.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && this._searchHighlightIdx >= 0) {
      e.preventDefault();
      this._searchSelect(results[this._searchHighlightIdx].idx);
    } else if (e.key === 'Escape') {
      dd.style.display = 'none';
      this._searchHighlightIdx = -1;
    }
  },

  // ── Anwesenheit togglen ──
  toggleAnwesend(checked) {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, s.id])[0];
    if (ke) {
      App.run(`UPDATE kontrollergebnisse SET anwesend=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`, [checked ? 1 : 0, this.activePruefer || '', ke.id]);
    }
    this.renderSchueler();
  },

  // Calculate Fehltage sum for one Ausbildungsjahr (from cumulative kw_status)
  calcFehlSum(schuelerId, aj) {
    return App.scalar(`SELECT COALESCE(SUM(fehltage),0) FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=?`, [schuelerId, aj]) || 0;
  },

  // ── Ausgewählte als "In Ordnung" markieren ──
  bulkMarkOK() {
    const ids = [...document.querySelectorAll('.chk-ok:checked')].map(c => parseInt(c.value));
    if (!ids.length) return App.toast('Bitte Schüler auswählen', 'warning');
    if (!confirm(`${ids.length} Auszubildende als „In Ordnung" markieren?`)) return;
    const tid = this.currentTerminId;
    const pflichtFields = ['p_1_1_ausbildungsplan','p_1_4_auszubildende','p_1_5_bescheinigungen','f_1_2_vertragliche_regelungen','f_1_6_ausbildungsbetrieb'];
    let count = 0;
    ids.forEach(sid => {
      let ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [tid, sid])[0];
      if (!ke) {
        // Carry forward cumulative data
        const prevKE = App.query(`SELECT ke.* FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
          WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`, [sid]);
        const prev = prevKE.length ? prevKE[0] : {};
        App.run(`INSERT INTO kontrollergebnisse (kontrolltermin_id,schueler_id,geprueft_kws,fehltage_gesamt,durchsicht_nr,
          p_1_1_ausbildungsplan,p_1_4_auszubildende,p_1_5_bescheinigungen,bescheinigungen_anzahl,
          f_1_2_vertragliche_regelungen,f_1_6_ausbildungsbetrieb) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [tid, sid, prev.geprueft_kws||'{}', prev.fehltage_gesamt||0, (prev.durchsicht_nr||0)+1,
           prev.p_1_1_ausbildungsplan||'', prev.p_1_4_auszubildende||'', prev.p_1_5_bescheinigungen||'',
           prev.bescheinigungen_anzahl||0, prev.f_1_2_vertragliche_regelungen||'', prev.f_1_6_ausbildungsbetrieb||'']);
        ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [tid, sid])[0];
      }
      if (!ke.ergebnis || ke.ergebnis === '') {
        App.run("UPDATE kontrollergebnisse SET ergebnis='in_ordnung', geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?", [this.activePruefer || '', ke.id]);
        // Also set all Pflichtteile to 'ja'
        pflichtFields.forEach(pf => {
          App.run(`UPDATE kontrollergebnisse SET ${pf}='ja' WHERE id=? AND (${pf}='' OR ${pf} IS NULL)`, [ke.id]);
        });
        // Auto-erledige offene WVs
        const today = new Date().toISOString().split('T')[0];
        App.run("UPDATE wiedervorlagen SET status='erledigt', erledigt_datum=?, erledigt_bemerkung='Automatisch erledigt – Berichtsheft bei erneuter Durchsicht in Ordnung' WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [today, sid]);
        count++;
      }
    });
    App.toast(`${count} Schüler als "In Ordnung" markiert (inkl. Pflichtteile ✓)`, 'success');
    this.renderSchueler();
  },

  // ── Kontrolle abschließen ──
  abschliessen() {
    const tid = this.currentTerminId;
    const total = this.currentSchuelerList.length;
    const klassen = App.getTerminKlassen(tid);
    const schule = klassen.length ? klassen[0].schule : '?';
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [tid])[0];
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'Sachberichte (E-Mail)',berichte_bis_termin_email:'Berichte (E-Mail)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};

    // Collect results + mangelhafte
    const results = {}; let done = 0, open = 0;
    const mangelhafte = [];
    this.currentSchuelerList.forEach(s => {
      const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [tid, s.id])[0];
      const e = ke?.ergebnis || '';
      if (e) { done++; results[e] = (results[e]||0) + 1; }
      else { open++; }
      if (e && e !== 'in_ordnung') mangelhafte.push({...s, ke, ergebnis: e});
    });

    // Auto-WV date suggestions
    const nextTermin = App.query("SELECT geplant_datum FROM kontrolltermine WHERE status='geplant' AND geplant_datum > ? ORDER BY geplant_datum LIMIT 1", [termin?.geplant_datum || '']).map(r => r.geplant_datum)[0] || '';
    const plus4w = new Date(Date.now() + 28*86400000).toISOString().split('T')[0];
    const plus2w = new Date(Date.now() + 14*86400000).toISOString().split('T')[0];
    const plus3w = new Date(Date.now() + 21*86400000).toISOString().split('T')[0];
    const wvDefaults = {
      nachholung_naechste_durchsicht: nextTermin || plus4w,
      sachberichte_wetter_email: plus4w,
      berichte_bis_termin_email: plus4w,
      persoenliche_vorlage_rp: plus2w,
      post_an_rp: plus3w
    };

    App.openModal('Kontrolle abschließen – Nachbereitung', `
      <!-- Step 1: Zusammenfassung -->
      <div style="font-size:14px;margin-bottom:12px">
        <strong>${done} von ${total}</strong> kontrolliert${open > 0 ? ` – <span style="color:var(--clr-red)">${open} offen</span>` : ''} · ${esc(schule)}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        ${Object.entries(results).map(([k,v]) => `<span style="padding:4px 10px;background:${k==='in_ordnung'?'var(--clr-green-light)':'var(--clr-red-light)'};border-radius:10px;font-size:12px">${eLbl[k]||k}: <strong>${v}</strong></span>`).join('')}
      </div>

      <!-- Step 2: Wiedervorlagen-Fristen -->
      ${mangelhafte.length ? `
      <div style="border:1px solid var(--clr-sand);border-radius:var(--radius);padding:12px;margin-bottom:12px">
        <strong style="font-size:13px;color:var(--clr-forest)">⏰ Wiedervorlagen-Fristen (automatisch vorgeschlagen)</strong>
        <div style="max-height:150px;overflow-y:auto;margin-top:8px">
          ${mangelhafte.map(m => {
            const existingWV = App.query('SELECT * FROM wiedervorlagen WHERE kontrollergebnis_id=?', [m.ke.id]);
            const hasWV = existingWV.length > 0;
            const defaultDate = wvDefaults[m.ergebnis] || plus4w;
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--clr-sand);font-size:12px" data-wv-ke="${m.ke.id}" data-wv-sid="${m.id}" data-wv-art="${m.ergebnis}">
              <input type="checkbox" class="wv-auto" ${!hasWV?'checked':''} style="accent-color:var(--clr-forest)">
              <span style="min-width:120px"><strong>${esc(m.nachname)}</strong>, ${esc(m.vorname)}</span>
              <span class="badge-status badge-open" style="font-size:10px">${eLbl[m.ergebnis]||m.ergebnis}</span>
              <input type="date" class="form-control wv-date" value="${hasWV ? existingWV[0].frist_datum : defaultDate}" style="width:130px;padding:3px 6px;font-size:11px">
              ${hasWV ? '<span style="color:var(--clr-green);font-size:10px">✓ existiert</span>' : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Step 3: Nachbereitungs-Optionen -->
      <div style="border:1px solid var(--clr-sand);border-radius:var(--radius);padding:12px;margin-bottom:12px">
        <strong style="font-size:13px;color:var(--clr-forest)">📤 Nachbereitung</strong>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;font-size:13px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="wizPDF" checked style="accent-color:var(--clr-forest)"> 📄 PDFs für mangelhafte Schüler generieren (${mangelhafte.length})
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="wizEmailSchule" style="accent-color:var(--clr-forest)"> 📧 Ergebnis-Zusammenfassung an Schule senden
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="wizBetriebe" ${mangelhafte.length?'checked':''} style="accent-color:var(--clr-forest)"> 📄 Betriebe bei Mängeln anschreiben (Seriendruck)
          </label>
        </div>
      </div>

      <div class="form-group"><label>Durchführungsdatum</label><input type="date" class="form-control" id="mAbschlDatum" value="${new Date().toISOString().split('T')[0]}"></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-success" onclick="KontrolleHandler.doAbschliessen()">✓ Abschließen + Nachbereitung starten</button>`);
  },

  doAbschliessen() {
    App.showLoading('Kontrolle wird abgeschlossen…');
    const tid = this.currentTerminId;
    const datum = document.getElementById('mAbschlDatum').value;
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [tid])[0];
    
    // 1) Create snapshots
    this.currentSchuelerList.forEach(s => {
      const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [tid, s.id])[0];
      if (!ke) return;
      const kwRows = App.query('SELECT * FROM kw_status WHERE schueler_id=?', [s.id]);
      const pflicht = {
        p_1_1: ke.p_1_1_ausbildungsplan, p_1_4: ke.p_1_4_auszubildende,
        p_1_5: ke.p_1_5_bescheinigungen, besch_anz: ke.bescheinigungen_anzahl,
        f_1_2: ke.f_1_2_vertragliche_regelungen, f_1_6: ke.f_1_6_ausbildungsbetrieb
      };
      App.run(`INSERT INTO durchsicht_snapshots (kontrollergebnis_id, schueler_id, snapshot_datum, kw_daten_json, geprueft_kws_json, pflichtteile_json, ergebnis, bemerkung, pruefer) VALUES (?,?,?,?,?,?,?,?,?)`,
        [ke.id, s.id, datum, JSON.stringify(kwRows), ke.geprueft_kws || '{}', JSON.stringify(pflicht), ke.ergebnis || '', ke.bemerkung || '', ke.geaendert_von || termin?.pruefer || '']);
    });

    // 2) Auto-create Wiedervorlagen
    document.querySelectorAll('[data-wv-ke]').forEach(row => {
      const cb = row.querySelector('.wv-auto');
      if (!cb?.checked) return;
      const keId = parseInt(row.dataset.wvKe);
      const sid = parseInt(row.dataset.wvSid);
      const art = row.dataset.wvArt;
      const frist = row.querySelector('.wv-date')?.value;
      if (!frist) return;
      const existing = App.query('SELECT id FROM wiedervorlagen WHERE kontrollergebnis_id=?', [keId]);
      if (existing.length) {
        App.run('UPDATE wiedervorlagen SET frist_datum=?, art=? WHERE kontrollergebnis_id=?', [frist, art, keId]);
      } else {
        App.run('INSERT INTO wiedervorlagen (kontrollergebnis_id, schueler_id, art, frist_datum) VALUES (?,?,?,?)', [keId, sid, art, frist]);
      }
    });

    // 3) Set termin status
    App.run("UPDATE kontrolltermine SET status='durchgefuehrt', durchgefuehrt_datum=? WHERE id=?", [datum, tid]);
    App.closeModal();

    // 4) Post-actions
    const doPDF = document.getElementById('wizPDF')?.checked;
    const doEmail = document.getElementById('wizEmailSchule')?.checked;
    const doBetriebe = document.getElementById('wizBetriebe')?.checked;

    if (doPDF) {
      // Generate PDFs for mangelhafte only
      const mangelIds = [];
      this.currentSchuelerList.forEach(s => {
        const ke = App.query('SELECT ergebnis FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [tid, s.id])[0];
        if (ke?.ergebnis && ke.ergebnis !== 'in_ordnung') mangelIds.push(s.id);
      });
      if (mangelIds.length) {
        setTimeout(() => PlanungHandler.exportTerminPDF(tid), 300);
      }
    }
    if (doEmail) setTimeout(() => Workflows.emailSchule(tid), doPDF ? 1000 : 300);
    if (doBetriebe) setTimeout(() => Workflows.seriendruckBetriebe(tid), (doPDF ? 1000 : 0) + (doEmail ? 700 : 300));

    App.hideLoading();
    App.toast(`Kontrolle abgeschlossen – Snapshots + ${document.querySelectorAll('.wv-auto:checked').length} Wiedervorlagen erstellt`, 'success');
    this.renderKontrolleView();
  },

  reopenKontrolle() {
    if (!confirm('Kontrolle wieder öffnen? Status wird auf "geplant" zurückgesetzt.')) return;
    App.run("UPDATE kontrolltermine SET status='geplant', durchgefuehrt_datum='' WHERE id=?", [this.currentTerminId]);
    App.toast('Kontrolle wieder geöffnet', 'success');
    this.renderSchueler();
  },

  // ── Mark KW range as checked (geprüft) ──
  markRangeChecked(aj) {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, s.id])[0];
    if (!ke) return;
    const fromKW = parseInt(document.getElementById(`kwRangeFrom_${aj}`).value);
    const toKW = parseInt(document.getElementById(`kwRangeTo_${aj}`).value);
    const allKWs = KW_ALL;
    const fromIdx = allKWs.indexOf(fromKW);
    const toIdx = allKWs.indexOf(toKW);
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) return App.toast('Ungültiger Bereich', 'error');
    const rangeKWs = allKWs.slice(fromIdx, toIdx + 1);
    const schuelerAJs = App.getSchuelerAJs(s.id);
    const ajBounds = App.getAJKWBounds(s.id);
    let count = 0;

    // 1) Mark the selected range in this AJ
    rangeKWs.forEach(kw => {
      const existing = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, kw]);
      if (existing.length) {
        App.run('UPDATE kw_status SET geprueft=1 WHERE id=?', [existing[0].id]);
      } else {
        App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,geprueft,erstellt_bei) VALUES (?,?,?,1,?)', [s.id, aj, kw, ke.id]);
      }
      KWNav.trackSessionKW(ke.id, aj, kw);
      count++;
    });

    // 2) Cascade: mark ALL active KWs in earlier AJs as geprüft
    const earlierAJs = schuelerAJs.filter(a => a < aj);
    earlierAJs.forEach(prevAJ => {
      const bounds = ajBounds[prevAJ] || { inactiveKWs: [] };
      const inactiveSet = new Set(bounds.inactiveKWs);
      allKWs.forEach(kw => {
        if (inactiveSet.has(kw)) return; // skip inactive KWs
        const existing = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, prevAJ, kw]);
        if (existing.length) {
          if (!existing[0].geprueft) {
            App.run('UPDATE kw_status SET geprueft=1 WHERE id=?', [existing[0].id]);
            count++;
          }
        } else {
          App.run('INSERT INTO kw_status (schueler_id,ausbildungsjahr,kalenderwoche,geprueft,erstellt_bei) VALUES (?,?,?,1,?)', [s.id, prevAJ, kw, ke.id]);
          count++;
        }
        KWNav.trackSessionKW(ke.id, prevAJ, kw);
      });
    });

    const cascadeInfo = earlierAJs.length ? ` (+ AJ${earlierAJs.join('+AJ')} komplett)` : '';
    App.toast(`${count} KWs als geprüft markiert: AJ${aj} KW ${fromKW}–${toKW}${cascadeInfo}`, 'success');
    this.renderSchueler();
  },

  // ── Remove geprüft marking from KW range ──
  unmarkRangeChecked(aj) {
    const s = this.currentSchuelerList[this.currentIndex];
    if (!s) return;
    const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [this.currentTerminId, s.id])[0];
    if (!ke) return;
    const fromKW = parseInt(document.getElementById(`kwRangeFrom_${aj}`).value);
    const toKW = parseInt(document.getElementById(`kwRangeTo_${aj}`).value);
    const allKWs = KW_ALL;
    const fromIdx = allKWs.indexOf(fromKW);
    const toIdx = allKWs.indexOf(toKW);
    if (fromIdx < 0 || toIdx < 0 || fromIdx > toIdx) return App.toast('Ungültiger Bereich', 'error');
    const rangeKWs = allKWs.slice(fromIdx, toIdx + 1);

    // Parse session tracking ONCE before loop
    let sessionData = {};
    try { sessionData = JSON.parse(ke.geprueft_kws || '{}'); } catch(e) {}

    let count = 0;
    rangeKWs.forEach(kw => {
      const existing = App.query('SELECT * FROM kw_status WHERE schueler_id=? AND ausbildungsjahr=? AND kalenderwoche=?', [s.id, aj, kw]);
      if (existing.length) {
        const row = existing[0];
        if (!row.maengel_codes && !row.behobene_codes && !row.fehltage) {
          App.run('DELETE FROM kw_status WHERE id=?', [row.id]);
        } else {
          App.run('UPDATE kw_status SET geprueft=0 WHERE id=?', [row.id]);
        }
        count++;
      }
      // Remove from session data (in-memory)
      if (sessionData[aj]) {
        sessionData[aj] = sessionData[aj].filter(k => k !== kw);
      }
    });

    // Write session tracking ONCE after loop
    App.run('UPDATE kontrollergebnisse SET geprueft_kws=? WHERE id=?', [JSON.stringify(sessionData), ke.id]);

    App.toast(`${count} KWs (AJ${aj}: KW ${fromKW}–${toKW}) Prüfmarkierung entfernt`, 'success');
    this.renderSchueler();
  },

  // ── View historical snapshot ──
  viewSnapshot(snapId) {
    const snap = App.query('SELECT * FROM durchsicht_snapshots WHERE id=?', [snapId])[0];
    if (!snap) return App.toast('Snapshot nicht gefunden', 'error');
    const s = App.query('SELECT * FROM schueler WHERE id=?', [snap.schueler_id])[0];
    let kwData = []; try { kwData = JSON.parse(snap.kw_daten_json || '[]'); } catch(e) {}
    let pflicht = {}; try { pflicht = JSON.parse(snap.pflichtteile_json || '{}'); } catch(e) {}
    let geprueftKWs = {}; try { geprueftKWs = JSON.parse(snap.geprueft_kws_json || '{}'); } catch(e) {}
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung',sachberichte_wetter_email:'Sachberichte (E-Mail)',berichte_bis_termin_email:'Berichte (E-Mail)',persoenliche_vorlage_rp:'Vorlage RP',post_an_rp:'Post RP'};

    const maengelRows = kwData.filter(r => r.maengel_codes);
    const body = `
      <div style="font-size:13px;margin-bottom:12px">
        <strong>${esc(s?.nachname || '?')}, ${esc(s?.vorname || '?')}</strong> · ${formatDate(snap.snapshot_datum)} · Prüfer: ${esc(snap.pruefer)}
      </div>
      <div style="padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);margin-bottom:12px">
        <strong>Ergebnis:</strong> ${eLbl[snap.ergebnis] || snap.ergebnis || '–'}
        ${snap.bemerkung ? `<br><strong>Bemerkung:</strong> ${esc(snap.bemerkung)}` : ''}
      </div>
      <div style="padding:8px 12px;background:var(--clr-warm);border-radius:var(--radius);margin-bottom:12px">
        <strong>Pflichtteile:</strong>
        1.1: ${pflicht.p_1_1||'–'} · 1.4: ${pflicht.p_1_4||'–'} · 1.5: ${pflicht.p_1_5||'–'} (${pflicht.besch_anz||0} Stk.)
        · 1.2: ${pflicht.f_1_2||'–'} · 1.6/7: ${pflicht.f_1_6||'–'}
      </div>
      ${maengelRows.length ? `<div style="max-height:200px;overflow-y:auto">
        <table class="data-table"><thead><tr><th>AJ</th><th>KW</th><th>Mängel</th><th>Behoben</th><th>Fehltage</th></tr></thead><tbody>
          ${maengelRows.map(r => `<tr>
            <td>${r.ausbildungsjahr}</td><td>KW ${r.kalenderwoche}</td>
            <td style="color:var(--clr-red)">${esc(r.maengel_codes)}</td>
            <td style="color:var(--clr-green)">${esc(r.behobene_codes || '')}</td>
            <td>${r.fehltage||0}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>` : '<p style="color:var(--clr-green)">Keine Mängel zum Zeitpunkt dieser Durchsicht.</p>'}
      <div style="margin-top:8px;font-size:11px;color:var(--clr-text-light)">
        Geprüfte KWs: ${Object.entries(geprueftKWs).map(([aj, kws]) => `AJ${aj}: ${kws.length ? kws.join(', ') : '–'}`).join(' · ') || '–'}
      </div>`;
    App.openModal(`Durchsicht vom ${formatDate(snap.snapshot_datum)}`, body,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-primary" onclick="KontrolleHandler.exportSnapshotPDF(${snapId})">📄 Als PDF drucken</button>`);
  },

  // ── PDF from historical snapshot ──
  exportSnapshotPDF(snapId) {
    const snap = App.query('SELECT * FROM durchsicht_snapshots WHERE id=?', [snapId])[0];
    if (!snap) return App.toast('Snapshot nicht gefunden', 'error');
    const s = App.query('SELECT s.*, bs.name as schule, k.klassenbezeichnung FROM schueler s LEFT JOIN klassen k ON s.klasse_id=k.id LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE s.id=?', [snap.schueler_id])[0];
    if (!s) return;
    let kwRows = []; try { kwRows = JSON.parse(snap.kw_daten_json || '[]'); } catch(e) {}
    let pflicht = {}; try { pflicht = JSON.parse(snap.pflichtteile_json || '{}'); } catch(e) {}
    let geprueftKWs = {}; try { geprueftKWs = JSON.parse(snap.geprueft_kws_json || '{}'); } catch(e) {}
    const eLbl = {in_ordnung:'In Ordnung',nachholung_naechste_durchsicht:'Nachholung bis nächste Durchsicht',sachberichte_wetter_email:'Sachberichte (Wetter) per E-Mail',berichte_bis_termin_email:'Berichte per E-Mail bis Termin',persoenliche_vorlage_rp:'Persönliche Vorlage im RP',post_an_rp:'Per Post ans RP'};

    // Build kwData lookup from snapshot
    const kwDataMap = {};
    kwRows.forEach(r => { kwDataMap[`${r.ausbildungsjahr}_${r.kalenderwoche}`] = r; });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const kwGridOrder = KW_GRID;

    // Header
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('Berichtsheftdurchsicht (Archiv-Snapshot)', 14, 15);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text(`Datum: ${formatDate(snap.snapshot_datum)}`, 14, 22);
    doc.text(`Name: ${s.nachname}, ${s.vorname}`, 90, 22);
    doc.text(`Ausbildungsstätte: ${(s.ausbildungsstaette||'').substring(0,60)}`, 14, 28);
    doc.text(`Schule: ${s.schule||'?'} – ${s.klassenbezeichnung||''}`, 14, 34);
    doc.text(`Prüfer: ${snap.pruefer||''}`, 150, 34);

    // KW Grids
    let y = 42;
    const snapAJs = App.getSchuelerAJs(s.id);
    for (const aj of snapAJs) {
      doc.setFont('helvetica','bold'); doc.setFontSize(8);
      doc.text(`Ausbildungsjahr ${aj}`, 14, y);
      // Show geprüfte KWs
      const geprueft = geprueftKWs[aj] || geprueftKWs[String(aj)] || [];
      if (geprueft.length) {
        doc.setFont('helvetica','normal'); doc.setFontSize(6);
        doc.text(`Geprüft: KW ${geprueft[0]}–${geprueft[geprueft.length-1]}`, 60, y);
      }
      y += 4;
      kwGridOrder.forEach(row => {
        const cw = 13.8;
        row.forEach((kw, ci) => {
          const x = 14 + ci * cw;
          const d = kwDataMap[`${aj}_${kw}`];
          const hasCodes = d && d.maengel_codes;
          const hasBehoben = d && d.behobene_codes && !hasCodes;
          doc.setDrawColor(180);
          if (hasCodes) { doc.setFillColor(253,240,239); doc.rect(x, y, cw, 6, 'FD'); }
          else if (hasBehoben) { doc.setFillColor(255,245,230); doc.rect(x, y, cw, 6, 'FD'); }
          else if (geprueft.includes(kw)) { doc.setFillColor(240,250,240); doc.rect(x, y, cw, 6, 'FD'); }
          else { doc.rect(x, y, cw, 6); }
          doc.setFont('helvetica','normal'); doc.setFontSize(7);
          doc.setTextColor(hasCodes?192:100, hasCodes?57:100, hasCodes?43:100);
          doc.text(`${kw}`, x+1, y+3);
          if (hasCodes) {
            doc.setFontSize(5);
            let dispCodes = d.maengel_codes;
            if (d.fehltage && dispCodes.includes('H')) dispCodes = dispCodes.replace(/\bH\b/, `H${d.fehltage}`);
            doc.text(dispCodes.replace(/,/g,' '), x+1, y+5.5);
          }
          if (hasBehoben) { doc.setFontSize(5); doc.setTextColor(180,140,60); doc.text(d.behobene_codes.replace(/,/g,' '), x+1, y+5.5); }
          if (d?.fehltage && !(hasCodes && d.maengel_codes.includes('H'))) { doc.setFontSize(5); doc.setTextColor(200,120,0); doc.text(`${d.fehltage}T`, x+cw-4, y+3); }
        });
        y += 6.5;
      });
      // Fehltage sum
      const sum = kwRows.filter(r => r.ausbildungsjahr == aj).reduce((s,r) => s + (r.fehltage||0), 0);
      doc.setTextColor(0); doc.setFontSize(7);
      doc.text(`Fehltage AJ${aj}: ${sum}`, 160, y-1); y += 3;
    }

    // Pflichtteile
    doc.setTextColor(0); doc.setFont('helvetica','bold'); doc.setFontSize(8);
    doc.text('Pflichtteile', 14, y); y += 4;
    doc.setFont('helvetica','normal'); doc.setFontSize(7);
    [['1.1','Indiv. Ausbildungsplan',pflicht.p_1_1],['1.4','Der/die Auszubildende',pflicht.p_1_4],
     ['1.5','Zusammenst. Bescheinigungen',pflicht.p_1_5 ? `${pflicht.p_1_5} (${pflicht.besch_anz||0} Stk.)` : '–'],
     ['1.2','Vertragl. Regelungen',pflicht.f_1_2],['1.6/7','Ausbild.betrieb/Skizze',pflicht.f_1_6]
    ].forEach(([nr,lbl,val]) => { doc.text(`${nr} ${lbl}: ${val||'–'}`, 14, y); y += 3.5; });

    // Ergebnis
    y += 2;
    const totalFehl = kwRows.reduce((s,r) => s + (r.fehltage||0), 0);
    doc.setFont('helvetica','bold'); doc.setFontSize(9);
    doc.text(`Fehltage gesamt: ${totalFehl}`, 14, y);
    doc.text(`Ergebnis: ${eLbl[snap.ergebnis]||snap.ergebnis||'–'}`, 80, y); y += 5;
    if (snap.bemerkung) { doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.text(`Bemerkung: ${snap.bemerkung}`, 14, y, {maxWidth:180}); y += 6; }

    // Archive stamp
    y += 4;
    doc.setFontSize(7); doc.setTextColor(150);
    doc.text(`Archiv-Snapshot · erstellt: ${snap.erstellt_am}`, 14, y);

    // Signature
    y = Math.max(y+5, 260);
    const snapPrName = snap.pruefer || 'Ausbildungsberater';
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(snapPrName, 14, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(150);
    doc.text('Referat 31, RP Freiburg', 14, y+4);
    doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(`Gez. ${snapPrName}`, 196, y, { align: 'right' });
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(150);
    doc.text('Digitale Signatur', 196, y+4, { align: 'right' });

    const dateStr2 = snap.snapshot_datum.replace(/-/g,'');
    const fname = `BH-Archiv_${s.nachname}_${s.vorname}_${s.schule||'Schule'}_${dateStr2}_Pruefer-${snap.pruefer||'unbekannt'}.pdf`.replace(/[\/ \\:,;]/g,'_');
    doc.save(fname);
    App.toast(`Archiv-PDF erstellt: ${fname}`, 'success');
  },

  // Calculate total Fehltage across all AJs and auto-update the DB + UI
  autoUpdateFehltage(schuelerId, keId) {
    let total = 0;
    const ajs = App.getSchuelerAJs(schuelerId);
    for (const aj of ajs) {
      const sum = this.calcFehlSum(schuelerId, aj);
      total += sum;
      const gridEl = document.getElementById(`fehlSumAj${aj}`);
      if (gridEl) gridEl.textContent = sum;
      const displayEl = document.getElementById(`fehlSumAj${aj}_display`);
      if (displayEl) displayEl.textContent = sum;
    }
    App.run(`UPDATE kontrollergebnisse SET fehltage_gesamt=?, geaendert_am=datetime('now','localtime'), geaendert_von=? WHERE id=?`, [total, this.activePruefer || '', keId]);
    const totalEl = document.getElementById('fehlGesamt');
    if (totalEl) totalEl.textContent = total;
  },
};
