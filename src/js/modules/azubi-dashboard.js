// ══════════════════════════════════════════════════════════════
//  AZUBI-DASHBOARD: Per-Schüler Ausbildungsverlauf-Dashboard
//  Hero-Card, Phasen-Timeline, Vergütung, Prüfungstermine
// ══════════════════════════════════════════════════════════════

const AzubiDashboard = {

  open(schuelerId) {
    const kz = AzubiRechner.computeKennzahlen(schuelerId);
    if (!kz) {
      App.toast('Kein Ausbildungsbeginn hinterlegt — bitte erst in Stammdaten eintragen.', 'warning');
      return;
    }
    const s = kz.schueler;
    const R = AzubiRechner;

    const fmtD = (d) => d ? R.fmtDE(d instanceof Date ? d : R.parseISO(d)) : '–';
    const fmtM = (v) => v ? v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €' : '–';

    // Risiko-Indikatoren
    const risiken = this._berechneRisiken(kz);

    const html = `
      <div class="azubi-dash" style="max-width:900px">

        <!-- Hero Status Card -->
        <div style="display:grid;grid-template-columns:1fr auto;gap:16px;padding:16px;background:var(--clr-warm);border-radius:var(--radius);border:1px solid var(--clr-sand);margin-bottom:16px">
          <div>
            <div style="font-size:20px;font-weight:700;color:var(--clr-forest)">${esc(s.nachname)}, ${esc(s.vorname)}</div>
            <div style="font-size:13px;color:var(--clr-text-light);margin-top:2px">
              ${kz.aktPhase ? (kz.aktPhase.typ === 'ausbildung' ? (kz.aktPhase.betrieb ? esc(kz.aktPhase.betrieb) : esc(s.ausbildungsstaette || '')) + (kz.tz < 1 ? ' · Teilzeit ' + Math.round(kz.tz * 100) + '%' : '') : '<span style="color:var(--clr-amber)">Unterbrechung' + (kz.aktPhase.grund ? ': ' + esc(kz.aktPhase.grund) : '') + '</span>') : esc(s.ausbildungsstaette || '')}
            </div>
            <div style="margin-top:10px;display:flex;gap:20px;flex-wrap:wrap;font-size:13px">
              <span><strong>${kz.aktLehrjahr}. Lehrjahr</strong></span>
              <span>${fmtD(kz.start)} – ${fmtD(kz.ende)}</span>
              <span>${kz.dauer} Monate${kz.cfg.verkuerzung_monate ? ' (verkürzt um ' + kz.cfg.verkuerzung_monate + ' Mon.)' : ''}</span>
            </div>
            <!-- Fortschrittsbalken -->
            <div style="margin-top:10px;background:var(--clr-sand);border-radius:8px;height:10px;overflow:hidden">
              <div style="width:${Math.min(100, kz.progress)}%;height:100%;background:linear-gradient(90deg,var(--clr-forest),var(--clr-green));border-radius:8px;transition:width 0.5s"></div>
            </div>
            <div style="font-size:11px;color:var(--clr-text-light);margin-top:3px">${kz.progress}% der Ausbildung absolviert</div>
          </div>
          <div style="text-align:right;font-size:13px">
            ${kz.naechsterMeilenstein ? `
              <div style="background:var(--clr-forest);color:#fff;padding:8px 14px;border-radius:var(--radius);font-size:12px">
                <div style="font-weight:600">${kz.naechsterMeilenstein.titel}</div>
                <div>${fmtD(kz.naechsterMeilenstein.datum)}</div>
                <div style="opacity:0.8;font-size:11px">in ${kz.naechsterMeilenstein.tage} Tagen</div>
              </div>
            ` : ''}
            <div style="margin-top:8px">
              <button class="btn btn-sm btn-secondary" onclick="AzubiDashboard.openPhasenEditor(${s.id})">Phasen bearbeiten</button>
            </div>
          </div>
        </div>

        ${risiken.length ? `
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;font-size:13px">
          <strong>Risiko-Hinweise:</strong>
          <ul style="margin:4px 0 0 16px;padding:0">${risiken.map(r => `<li>${r}</li>`).join('')}</ul>
        </div>` : ''}

        <!-- Phasen-Timeline -->
        <div style="margin-bottom:16px">
          <div style="font-weight:600;font-size:14px;margin-bottom:6px">Ausbildungsverlauf</div>
          ${this._renderPhasenStreifen(kz)}
        </div>

        <!-- Kennzahlen-Cards -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
          ${this._renderKennzahlCard('Fehltagsbudget', kz.pauschalFehltage.summe + ' / ' + kz.fehltageSoft + ' (10%) / ' + kz.fehltageHart + ' (15%)', kz.pauschalFehltage.summe > kz.fehltageHart ? 'red' : kz.pauschalFehltage.summe > kz.fehltageSoft ? 'amber' : 'green')}
          ${this._renderKennzahlCard('Aktuelle Vergütung', fmtM(kz.aktVerg) + (kz.tz < 1 ? ' (TZ)' : ''), 'forest')}
          ${this._renderKennzahlCard('Wochenstunden', kz.wochenstunden + ' h', 'forest')}
          ${this._renderKennzahlCard('Fortschritt', kz.progress + '%', kz.progress > 90 ? 'green' : 'forest')}
        </div>

        <!-- Prüfungstermine -->
        <div style="margin-bottom:16px">
          <div style="font-weight:600;font-size:14px;margin-bottom:6px">Prüfungstermine</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
            <div style="padding:10px 14px;background:var(--clr-warm);border-radius:var(--radius);border:1px solid var(--clr-sand)">
              <div style="font-size:11px;color:var(--clr-text-light)">Zwischenprüfung</div>
              <div style="font-weight:600;font-size:14px">${fmtD(kz.zpDate)}</div>
            </div>
            <div style="padding:10px 14px;background:var(--clr-warm);border-radius:var(--radius);border:1px solid var(--clr-sand)">
              <div style="font-size:11px;color:var(--clr-text-light)">Abschlussprüfung${kz.cfg.vorzeitige_zulassung ? ' (§45 vorzeitig)' : ''}</div>
              <div style="font-weight:600;font-size:14px">${fmtD(kz.apDate)}</div>
            </div>
            <div style="padding:10px 14px;background:var(--clr-warm);border-radius:var(--radius);border:1px solid var(--clr-sand)">
              <div style="font-size:11px;color:var(--clr-text-light)">Vertragsende (berechnet)</div>
              <div style="font-weight:600;font-size:14px">${fmtD(kz.ende)}</div>
            </div>
          </div>
        </div>

        <!-- Vergütungsperioden -->
        ${kz.perioden.length ? `
        <div style="margin-bottom:16px">
          <div style="font-weight:600;font-size:14px;margin-bottom:6px">Vergütungsperioden</div>
          <div style="overflow-x:auto">
            <table class="data-table" style="font-size:12px;width:100%">
              <thead><tr>
                <th>Zeitraum</th><th>Betrieb</th><th>LJ</th><th>TZ-%</th><th>Brutto (VZ)</th><th>Brutto (eff.)</th><th>Urlaub</th>
              </tr></thead>
              <tbody>
                ${kz.perioden.map(p => p.unterbrechung
                  ? `<tr style="background:#f5f5f5;color:#999"><td>${fmtD(p.von)} – ${fmtD(p.bis)}</td><td colspan="6" style="font-style:italic">${esc(p.grund)}</td></tr>`
                  : `<tr>
                      <td>${fmtD(p.von)} – ${fmtD(p.bis)}</td>
                      <td>${esc(p.betrieb || '–')}</td>
                      <td style="text-align:center">${p.lehrjahr}.</td>
                      <td style="text-align:center">${p.quote}%</td>
                      <td style="text-align:right">${fmtM(p.vergVZ)}</td>
                      <td style="text-align:right;font-weight:600">${fmtM(p.vergEff)}</td>
                      <td style="text-align:right">${p.urlaubAnteilig} T</td>
                    </tr>`
                ).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

        <!-- Phasen-Probleme -->
        ${kz.probleme.length ? `
        <div style="background:#ffeef0;border:1px solid var(--clr-red);border-radius:var(--radius);padding:10px 14px;font-size:13px">
          <strong>Phasen-Probleme:</strong>
          <ul style="margin:4px 0 0 16px;padding:0">${kz.probleme.map(p => `<li>${esc(p.text)}</li>`).join('')}</ul>
        </div>` : ''}

      </div>
    `;

    App.openModal(`Azubi-Dashboard: ${s.nachname}, ${s.vorname}`, html,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-primary" onclick="App.closeModal();AzubiDashboard.openPhasenEditor(${s.id})">Phasen bearbeiten</button>`);
    _makeModalWide();
  },

  _berechneRisiken(kz) {
    const risiken = [];
    if (kz.pauschalFehltage.summe > kz.fehltageHart) risiken.push('Fehltage über 15%-Schwelle — Zulassung gefährdet');
    else if (kz.pauschalFehltage.summe > kz.fehltageSoft) risiken.push('Fehltage über 10%-Schwelle — Beobachtung empfohlen');
    if (kz.probleme.some(p => p.typ === 'luecke')) risiken.push('Lücken im Ausbildungsverlauf');
    if (kz.probleme.some(p => p.typ === 'ueberlappung')) risiken.push('Phasen-Überlappungen vorhanden');
    if (kz.aktPhase && kz.aktPhase.typ === 'unterbrechung') risiken.push('Ausbildung aktuell unterbrochen');
    if (kz.aktVerg > 0) {
      const miav = AzubiRechner.MINDESTVERGUETUNG;
      const letztes = miav[miav.length - 1];
      const ljIdx = Math.max(0, Math.min(2, kz.aktLehrjahr - 1));
      if (kz.aktVerg < letztes.lj[ljIdx]) risiken.push('Vergütung unter Mindestvergütung (§17 BBiG)');
    }
    return risiken;
  },

  _renderKennzahlCard(titel, wert, farbe) {
    const colorMap = { red: 'var(--clr-red)', amber: '#d4a017', green: 'var(--clr-green)', forest: 'var(--clr-forest)' };
    const c = colorMap[farbe] || 'var(--clr-forest)';
    return `<div style="padding:12px 14px;background:var(--clr-warm);border-radius:var(--radius);border:1px solid var(--clr-sand);border-left:4px solid ${c}">
      <div style="font-size:11px;color:var(--clr-text-light)">${titel}</div>
      <div style="font-weight:700;font-size:15px;color:${c}">${wert}</div>
    </div>`;
  },

  _renderPhasenStreifen(kz) {
    const R = AzubiRechner;
    const phasenMit = kz.phasenMit;
    if (!phasenMit.length) return '<div style="color:var(--clr-text-light);font-size:13px">Keine Phasen definiert</div>';

    const startDate = kz.start;
    const endDate = kz.ende;
    const totalDays = Math.max(1, R.daysBetween(startDate, endDate));
    const heute = new Date();
    const heutePos = Math.max(0, Math.min(100, (R.daysBetween(startDate, heute) / totalDays) * 100));

    let bars = '';
    let lastBetrieb = null;
    for (const p of phasenMit) {
      const von = R.parseISO(p.von);
      const bis = p.bis ? R.parseISO(p.bis) : (p._berechnetesEnde ? R.parseISO(p._berechnetesEnde) : endDate);
      const left = Math.max(0, (R.daysBetween(startDate, von) / totalDays) * 100);
      const width = Math.max(0.5, (R.daysBetween(von, bis) / totalDays) * 100);

      let bg, title;
      if (p.typ === 'unterbrechung') {
        bg = 'repeating-linear-gradient(45deg,#ccc,#ccc 4px,#eee 4px,#eee 8px)';
        title = 'Unterbrechung' + (p.grund ? ': ' + p.grund : '');
      } else if ((p.teilzeit_prozent || 100) < 100) {
        bg = 'var(--clr-green)';
        title = 'Teilzeit ' + p.teilzeit_prozent + '%' + (p.betrieb ? ' – ' + p.betrieb : '');
      } else {
        bg = 'var(--clr-forest)';
        title = 'Vollzeit' + (p.betrieb ? ' – ' + p.betrieb : '');
      }

      const betriebWechsel = p.typ === 'ausbildung' && lastBetrieb !== null && p.betrieb && p.betrieb !== lastBetrieb;
      if (betriebWechsel) {
        bars += `<div style="position:absolute;left:${left}%;top:0;bottom:0;width:2px;background:#d4a017;z-index:2" title="Betriebswechsel"></div>`;
      }
      if (p.typ === 'ausbildung') lastBetrieb = p.betrieb;

      bars += `<div style="position:absolute;left:${left}%;width:${width}%;height:100%;background:${bg};border-radius:3px;cursor:pointer" title="${esc(title)}" onclick="AzubiDashboard.openPhasenEditor(${kz.schueler.id})"></div>`;
    }

    // Heute-Linie
    bars += `<div style="position:absolute;left:${heutePos}%;top:-3px;bottom:-3px;width:2px;background:var(--clr-red);z-index:3" title="Heute: ${R.fmtDE(heute)}"></div>`;

    return `<div style="position:relative;height:22px;background:var(--clr-sand);border-radius:6px;overflow:visible;margin:8px 0">
      ${bars}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--clr-text-light)">
      <span>${R.fmtDE(startDate)}</span><span>${R.fmtDE(endDate)}</span>
    </div>
    <div style="display:flex;gap:12px;margin-top:4px;font-size:10px;color:var(--clr-text-light)">
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--clr-forest);border-radius:2px;vertical-align:middle"></span> Vollzeit</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--clr-green);border-radius:2px;vertical-align:middle"></span> Teilzeit</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:repeating-linear-gradient(45deg,#ccc,#ccc 2px,#eee 2px,#eee 4px);border-radius:2px;vertical-align:middle"></span> Unterbrechung</span>
      <span><span style="display:inline-block;width:10px;height:2px;background:#d4a017;vertical-align:middle"></span> Betriebswechsel</span>
      <span><span style="display:inline-block;width:10px;height:2px;background:var(--clr-red);vertical-align:middle"></span> Heute</span>
    </div>`;
  },

  // ── Phasen-Editor ──
  openPhasenEditor(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return;
    const phasen = AzubiRechner.getPhasen(schuelerId);

    let rows = '';
    if (phasen.length) {
      rows = phasen.map(p => `
        <tr>
          <td>${p.typ === 'ausbildung' ? '<span style="color:var(--clr-forest)">Ausbildung</span>' : '<span style="color:var(--clr-amber)">Unterbrechung</span>'}</td>
          <td>${p.von}</td>
          <td>${p.bis || '<em style="color:var(--clr-text-light)">offen</em>'}</td>
          <td>${p.typ === 'ausbildung' ? esc(p.betrieb || '–') : esc(p.grund || '–')}</td>
          <td style="text-align:center">${p.teilzeit_prozent || 100}%</td>
          <td style="text-align:center">${(p.pauschal_fehltage_e || 0) + (p.pauschal_fehltage_u || 0)}</td>
          <td>
            <button class="btn-icon btn-sm" onclick="AzubiDashboard.editPhase(${schuelerId},${p.id})" title="Bearbeiten">&#9998;</button>
            <button class="btn-icon btn-sm" onclick="AzubiDashboard.confirmDeletePhase(${schuelerId},${p.id})" title="Löschen" style="color:var(--clr-red)">&#10005;</button>
          </td>
        </tr>`).join('');
    } else {
      rows = `<tr><td colspan="7" style="text-align:center;color:var(--clr-text-light);padding:20px">
        Keine Phasen angelegt. Es wird der Standard-Verlauf aus Ausbildungsbeginn/-ende verwendet.
        <br><button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="AzubiDashboard.autoCreateInitialPhase(${schuelerId})">Standard-Phase aus Stammdaten erzeugen</button>
      </td></tr>`;
    }

    const probleme = AzubiRechner.phasenValidieren(phasen);

    App.openModal(`Phasen-Editor: ${s.nachname}, ${s.vorname}`, `
      ${probleme.length ? `<div style="background:#ffeef0;border:1px solid var(--clr-red);border-radius:var(--radius);padding:8px 12px;margin-bottom:12px;font-size:12px">
        <strong>Validierung:</strong> ${probleme.map(p => esc(p.text)).join('; ')}
      </div>` : ''}
      <div style="overflow-x:auto">
        <table class="data-table" style="font-size:12px;width:100%">
          <thead><tr><th>Typ</th><th>Von</th><th>Bis</th><th>Betrieb/Grund</th><th>TZ-%</th><th>Fehlt.</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal();AzubiDashboard.open(${schuelerId})">Zurück zum Dashboard</button>
        <button class="btn btn-primary" onclick="AzubiDashboard.addPhaseForm(${schuelerId})">+ Phase hinzufügen</button>`);
    _makeModalWide();
  },

  autoCreateInitialPhase(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s || !s.ausbildungsbeginn) {
      App.toast('Kein Ausbildungsbeginn hinterlegt', 'warning');
      return;
    }
    AzubiRechner.addPhase(schuelerId, {
      von: s.ausbildungsbeginn,
      bis: s.ausbildungsende || null,
      typ: 'ausbildung',
      betrieb: s.ausbildungsstaette || '',
      teilzeit_prozent: 100,
    });
    App.toast('Standard-Phase angelegt', 'success');
    this.openPhasenEditor(schuelerId);
  },

  addPhaseForm(schuelerId) {
    this._phaseFormModal(schuelerId, null);
  },

  editPhase(schuelerId, phaseId) {
    this._phaseFormModal(schuelerId, phaseId);
  },

  _phaseFormModal(schuelerId, phaseId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    const existing = phaseId ? App.query('SELECT * FROM ausbildungsphasen WHERE id=?', [phaseId])[0] : null;
    const p = existing || { typ: 'ausbildung', von: '', bis: '', betrieb: s?.ausbildungsstaette || '', teilzeit_prozent: 100, grund: '', pauschal_fehltage_e: 0, pauschal_fehltage_u: 0, anmerkung: '' };

    const isAusb = p.typ === 'ausbildung';
    App.openModal(phaseId ? 'Phase bearbeiten' : 'Neue Phase', `
      <div class="form-row">
        <div class="form-group"><label>Typ</label>
          <select class="form-control" id="mPhTyp" onchange="document.getElementById('mPhAusb').style.display=this.value==='ausbildung'?'':'none';document.getElementById('mPhUnterb').style.display=this.value==='unterbrechung'?'':'none'">
            <option value="ausbildung" ${isAusb ? 'selected' : ''}>Ausbildung</option>
            <option value="unterbrechung" ${!isAusb ? 'selected' : ''}>Unterbrechung</option>
          </select>
        </div>
        <div class="form-group"><label>Von</label><input type="date" class="form-control" id="mPhVon" value="${p.von || ''}"></div>
        <div class="form-group"><label>Bis</label><input type="date" class="form-control" id="mPhBis" value="${p.bis || ''}"><div style="font-size:10px;color:var(--clr-text-light)">Leer = läuft noch</div></div>
      </div>
      <div id="mPhAusb" style="${isAusb ? '' : 'display:none'}">
        <div class="form-row">
          <div class="form-group"><label>Betrieb</label><input class="form-control" id="mPhBetrieb" value="${esc(p.betrieb || '')}"></div>
          <div class="form-group"><label>Teilzeit %</label><input type="number" class="form-control" id="mPhTZ" value="${p.teilzeit_prozent || 100}" min="25" max="100" step="5"></div>
        </div>
      </div>
      <div id="mPhUnterb" style="${!isAusb ? '' : 'display:none'}">
        <div class="form-group"><label>Grund</label>
          <select class="form-control" id="mPhGrund">
            <option value="">–</option>
            ${['Mutterschutz', 'Elternzeit', 'Krankheit (lang)', 'Wehrdienst/Freiwilligendienst', 'Sonstiges'].map(g => `<option value="${g}" ${p.grund === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Pauschal-Fehltage (entsch.)</label><input type="number" class="form-control" id="mPhFE" value="${p.pauschal_fehltage_e || 0}" min="0"></div>
        <div class="form-group"><label>Pauschal-Fehltage (unentsch.)</label><input type="number" class="form-control" id="mPhFU" value="${p.pauschal_fehltage_u || 0}" min="0"></div>
      </div>
      <div class="form-group"><label>Anmerkung</label><input class="form-control" id="mPhAnm" value="${esc(p.anmerkung || '')}"></div>
      <div id="mPhKonflikt" style="margin-top:8px"></div>
    `, `<button class="btn btn-secondary" onclick="AzubiDashboard.openPhasenEditor(${schuelerId})">Abbrechen</button>
        <button class="btn btn-primary" onclick="AzubiDashboard.savePhase(${schuelerId},${phaseId || 'null'})">${phaseId ? 'Speichern' : 'Hinzufügen'}</button>`);
  },

  savePhase(schuelerId, phaseId) {
    const typ = document.getElementById('mPhTyp').value;
    const von = document.getElementById('mPhVon').value;
    const bis = document.getElementById('mPhBis').value;
    if (!von) { App.toast('Beginn ist Pflichtfeld', 'error'); return; }
    if (bis && bis < von) { App.toast('Ende liegt vor dem Beginn', 'error'); return; }

    const phase = {
      typ,
      von, bis: bis || null,
      betrieb: typ === 'ausbildung' ? document.getElementById('mPhBetrieb').value.trim() : null,
      teilzeit_prozent: typ === 'ausbildung' ? parseInt(document.getElementById('mPhTZ').value) || 100 : 100,
      grund: typ === 'unterbrechung' ? document.getElementById('mPhGrund').value : null,
      pauschal_fehltage_e: parseInt(document.getElementById('mPhFE').value) || 0,
      pauschal_fehltage_u: parseInt(document.getElementById('mPhFU').value) || 0,
      anmerkung: document.getElementById('mPhAnm').value.trim(),
    };

    // Konflikt-Check
    const allePhasen = AzubiRechner.getPhasen(schuelerId);
    const konflikt = AzubiRechner.phasenKonflikt(allePhasen, { ...phase, id: phaseId });
    if (konflikt) {
      const empf = konflikt.optionen.find(o => o.empfohlen);
      if (empf && empf.id === 'kuerzen') {
        const vorTag = AzubiRechner.parseISO(von);
        vorTag.setDate(vorTag.getDate() - 1);
        AzubiRechner.updatePhase(konflikt.konflikt.id, { ...konflikt.konflikt, bis: AzubiRechner.fmtISO(vorTag) });
      }
    }

    if (phaseId) {
      AzubiRechner.updatePhase(phaseId, phase);
      App.toast('Phase aktualisiert', 'success');
    } else {
      AzubiRechner.addPhase(schuelerId, phase);
      App.toast('Phase hinzugefügt', 'success');
    }
    this.openPhasenEditor(schuelerId);
  },

  confirmDeletePhase(schuelerId, phaseId) {
    if (!confirm('Phase wirklich löschen?')) return;
    AzubiRechner.deletePhase(phaseId);
    App.toast('Phase gelöscht', 'success');
    this.openPhasenEditor(schuelerId);
  },
};
