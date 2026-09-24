// ══════════════════════════════════════════════════════════════
//  PHASEN: Ausbildungsverlauf je Azubi (Vollzeit, Teilzeit, Betriebswechsel,
//  Unterbrechungen) – Phasen-Mathematik und Editor.
//  Der Kern nutzt daraus Ausbildungsjahr, Vertragsende und die inaktiven
//  Wochen im KW-Raster (App.getSchuelerAJs, getCurrentAJ, Rasterberechnung),
//  die Nacherfassung die pauschalen Fehltage. Vergütung und Azubi-Dashboard
//  wurden entfernt – sie gehörten nicht zur Berichtsheftkontrolle; die
//  Phasen-Funktionen wurden hierher gerettet.
// ══════════════════════════════════════════════════════════════

const Phasen = {
  // ── Helfer ──
  parseISO(s) { return new Date(s + "T00:00:00"); },
  fmtISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  addMonths(d, n) {
    const r = new Date(d);
    const targetMonth = r.getMonth() + n;
    r.setDate(1);
    r.setMonth(targetMonth);
    const maxDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), maxDay));
    return r;
  },
  diffMonths(from, to) {
    const wholeMonths = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    const daysInMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
    return wholeMonths + (to.getDate() - from.getDate()) / daysInMonth;
  },
  daysBetween(a, b) {
    return Math.round((this.parseISO(this.fmtISO(b)) - this.parseISO(this.fmtISO(a))) / 86400000);
  },
  fmtDE(d) { return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" }); },
  alterZuStichtag(geburtsdatum, stichtag) {
    const geb = new Date(geburtsdatum), st = new Date(stichtag);
    let alter = st.getFullYear() - geb.getFullYear();
    const hatteGeb = st.getMonth() > geb.getMonth() || (st.getMonth() === geb.getMonth() && st.getDate() >= geb.getDate());
    if (!hatteGeb) alter--;
    return alter;
  },

  // ── Phasen-Mathematik ──
  phasenSortiert(phasen) {
    return [...phasen].sort((a, b) => a.von.localeCompare(b.von) || a.id - b.id);
  },

  phasenMitEnden(phasen, regulaerDauer, verkuerzung) {
    verkuerzung = verkuerzung || 0;
    const sorted = this.phasenSortiert(phasen);
    const sollMonate = Math.max(6, regulaerDauer - verkuerzung);
    let erbrachtVZ = 0;
    let hatOffenePhase = false;
    const ergebnis = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = { ...sorted[i] };
      if (p.bis) {
        const von = this.parseISO(p.von), bis = this.parseISO(p.bis);
        const monate = this.diffMonths(von, bis);
        p._dauerMonate = monate;
        if (p.typ === "ausbildung") {
          const tz = (p.teilzeit_prozent || 100) / 100;
          p._vzAequivalent = monate * tz;
          erbrachtVZ += p._vzAequivalent;
        } else {
          p._vzAequivalent = 0;
        }
      } else {
        if (hatOffenePhase) {
          p._berechnetesEnde = null;
          p._dauerMonate = null;
          p._vzAequivalent = 0;
          ergebnis.push(p);
          continue;
        }
        hatOffenePhase = true;
        if (p.typ === "ausbildung") {
          const tz = (p.teilzeit_prozent || 100) / 100;
          const restVZ = Math.max(0, sollMonate - erbrachtVZ);
          const restRealMonate = restVZ / tz;
          const von = this.parseISO(p.von);
          const bis = this.addMonths(von, Math.round(restRealMonate));
          p._berechnetesEnde = this.fmtISO(bis);
          p._dauerMonate = restRealMonate;
          p._vzAequivalent = restVZ;
          erbrachtVZ += restVZ;
        } else {
          p._berechnetesEnde = null;
          p._dauerMonate = null;
          p._vzAequivalent = 0;
        }
      }
      ergebnis.push(p);
    }
    return ergebnis;
  },

  vertragsendeAusPhasen(phasenMit) {
    for (let i = phasenMit.length - 1; i >= 0; i--) {
      const p = phasenMit[i];
      if (p.typ !== "ausbildung") continue;
      const ende = p.bis || p._berechnetesEnde;
      if (ende) return this.parseISO(ende);
    }
    return null;
  },

  aktivePhaseAm(phasenMit, datum) {
    const dStr = this.fmtISO(datum);
    for (const p of phasenMit) {
      const ende = p.bis || p._berechnetesEnde;
      if (p.von <= dStr && (!ende || ende >= dStr)) return p;
    }
    return null;
  },

  tatsaechlicheAusbildungsTage(phasenMit, bisHeute) {
    let tage = 0;
    const heute = new Date();
    for (const p of phasenMit) {
      if (p.typ !== "ausbildung") continue;
      const von = this.parseISO(p.von);
      let bis = p.bis ? this.parseISO(p.bis) : (p._berechnetesEnde ? this.parseISO(p._berechnetesEnde) : null);
      if (!bis) continue;
      if (bisHeute && bis > heute) bis = heute;
      if (bis < von) continue;
      tage += this.daysBetween(von, bis);
    }
    return tage;
  },

  pauschaleFehltage(phasen) {
    let entsch = 0, unentsch = 0;
    for (const p of phasen) {
      entsch += p.pauschal_fehltage_e || 0;
      unentsch += p.pauschal_fehltage_u || 0;
    }
    return { entschuldigt: entsch, unentschuldigt: unentsch, summe: entsch + unentsch };
  },

  phasenValidieren(phasen) {
    const sorted = this.phasenSortiert(phasen);
    const probleme = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      if (!a.bis) {
        probleme.push({ typ: "offen_mitte", phasen: [a.id], text: "Eine offene Phase liegt vor weiteren Phasen — bitte 'bis' eintragen." });
        continue;
      }
      if (a.bis > b.von) {
        probleme.push({ typ: "ueberlappung", phasen: [a.id, b.id], text: `Phasen überlappen: ${a.bis} > ${b.von}` });
      } else if (a.bis < b.von) {
        const tage = this.daysBetween(this.parseISO(a.bis), this.parseISO(b.von));
        if (tage > 1) probleme.push({ typ: "luecke", phasen: [a.id, b.id], text: `Lücke von ${tage} Tagen zwischen ${a.bis} und ${b.von}` });
      }
    }
    return probleme;
  },

  beschreibPhase(p) {
    if (p.typ === "unterbrechung") return `Unterbrechung${p.grund ? `: ${p.grund}` : ""}`;
    const tz = p.teilzeit_prozent || 100;
    return tz < 100 ? `Teilzeit ${tz}%` : "Vollzeit";
  },

  phasenKonflikt(alle, neu) {
    if (!neu.von) return null;
    const eigeneId = neu.id ?? null;
    const neuVon = neu.von;
    const betroffen = alle.filter(p => {
      if (p.id === eigeneId) return false;
      return p.von <= neuVon && (!p.bis || p.bis >= neuVon);
    });
    if (!betroffen.length) return null;
    const konflikt = betroffen.sort((a, b) => b.von.localeCompare(a.von))[0];
    const konfliktEndeNachNeuBis = konflikt.bis && neu.bis && konflikt.bis > neu.bis;
    const optionen = [];
    if (konflikt.von < neuVon) {
      optionen.push({ id: "kuerzen", label: `„${this.beschreibPhase(konflikt)}" am ${this.fmtDE(this.parseISO(neuVon))} beenden (empfohlen)`, empfohlen: true });
    }
    if (konfliktEndeNachNeuBis) {
      optionen.push({ id: "splitten", label: `„${this.beschreibPhase(konflikt)}" in zwei Teile teilen (vor & nach neuer Phase)` });
    }
    optionen.push({ id: "ueberlappen", label: "Nichts ändern — Überlappung akzeptieren (wird als Warnung markiert)" });
    return { konflikt, optionen };
  },

  getPhasen(schuelerId) {
    return App.query('SELECT * FROM ausbildungsphasen WHERE schueler_id=? ORDER BY von', [schuelerId]);
  },

  addPhase(schuelerId, phase) {
    App.run(`INSERT INTO ausbildungsphasen (schueler_id, von, bis, typ, betrieb, teilzeit_prozent, grund, pauschal_fehltage_e, pauschal_fehltage_u, anmerkung)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [schuelerId, phase.von, phase.bis || null, phase.typ, phase.betrieb || null,
       phase.teilzeit_prozent || 100, phase.grund || null,
       phase.pauschal_fehltage_e || 0, phase.pauschal_fehltage_u || 0, phase.anmerkung || null]);
  },

  updatePhase(phaseId, phase) {
    App.run(`UPDATE ausbildungsphasen SET von=?, bis=?, typ=?, betrieb=?, teilzeit_prozent=?, grund=?, pauschal_fehltage_e=?, pauschal_fehltage_u=?, anmerkung=? WHERE id=?`,
      [phase.von, phase.bis || null, phase.typ, phase.betrieb || null,
       phase.teilzeit_prozent || 100, phase.grund || null,
       phase.pauschal_fehltage_e || 0, phase.pauschal_fehltage_u || 0, phase.anmerkung || null, phaseId]);
  },

  deletePhase(phaseId) {
    App.run('DELETE FROM ausbildungsphasen WHERE id=?', [phaseId]);
  },

  // ── Phasen-Editor ──
  editor(schuelerId) { return this.openPhasenEditor(schuelerId); },
  openPhasenEditor(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s) return;
    const phasen = Phasen.getPhasen(schuelerId);

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
            <button class="btn-icon btn-sm" onclick="Phasen.editPhase(${schuelerId},${p.id})" title="Bearbeiten">&#9998;</button>
            <button class="btn-icon btn-sm" onclick="Phasen.confirmDeletePhase(${schuelerId},${p.id})" title="Löschen" style="color:var(--clr-red)">&#10005;</button>
          </td>
        </tr>`).join('');
    } else {
      rows = `<tr><td colspan="7" style="text-align:center;color:var(--clr-text-light);padding:20px">
        Keine Phasen angelegt. Es wird der Standard-Verlauf aus Ausbildungsbeginn/-ende verwendet.
        <br><button class="btn btn-sm btn-primary" style="margin-top:8px" onclick="Phasen.autoCreateInitialPhase(${schuelerId})">Standard-Phase aus Stammdaten erzeugen</button>
      </td></tr>`;
    }

    const probleme = Phasen.phasenValidieren(phasen);

    App.openModal(`Ausbildungsverlauf: ${s.nachname}, ${s.vorname}`, `
      <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">Phasen der Ausbildung: Vollzeit, Teilzeit, Betriebswechsel und Unterbrechungen (Elternzeit, lange Krankheit). Aus ihnen folgen Ausbildungsjahr, Vertragsende und die grau markierten Wochen im KW-Raster; pauschale Fehltage je Phase zählen bei der Zulassung mit. Ohne Phasen gilt Ausbildungsbeginn/-ende aus den Stammdaten.</p>
      ${probleme.length ? `<div style="background:var(--clr-red-light);border:1px solid var(--clr-red);border-radius:var(--radius);padding:8px 12px;margin-bottom:12px;font-size:12px">
        <strong>Validierung:</strong> ${probleme.map(p => esc(p.text)).join('; ')}
      </div>` : ''}
      <div style="overflow-x:auto">
        <table class="data-table" style="font-size:12px;width:100%">
          <thead><tr><th>Typ</th><th>Von</th><th>Bis</th><th>Betrieb/Grund</th><th>TZ-%</th><th>Fehlt.</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <button class="btn btn-primary" onclick="Phasen.addPhaseForm(${schuelerId})">+ Phase hinzufügen</button>`);
    _makeModalWide();
  },

  autoCreateInitialPhase(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s || !s.ausbildungsbeginn) {
      App.toast('Kein Ausbildungsbeginn hinterlegt', 'warning');
      return;
    }
    Phasen.addPhase(schuelerId, {
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
        <div class="form-group"><label>Bis</label><input type="date" class="form-control" id="mPhBis" value="${p.bis || ''}"><div style="font-size:12px;color:var(--clr-text-light)">Leer = läuft noch</div></div>
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
    `, `<button class="btn btn-secondary" onclick="Phasen.openPhasenEditor(${schuelerId})">Abbrechen</button>
        <button class="btn btn-primary" onclick="Phasen.savePhase(${schuelerId},${phaseId || 'null'})">${phaseId ? 'Speichern' : 'Hinzufügen'}</button>`);
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
    const allePhasen = Phasen.getPhasen(schuelerId);
    const konflikt = Phasen.phasenKonflikt(allePhasen, { ...phase, id: phaseId });
    if (konflikt) {
      const empf = konflikt.optionen.find(o => o.empfohlen);
      if (empf && empf.id === 'kuerzen') {
        const vorTag = Phasen.parseISO(von);
        vorTag.setDate(vorTag.getDate() - 1);
        Phasen.updatePhase(konflikt.konflikt.id, { ...konflikt.konflikt, bis: Phasen.fmtISO(vorTag) });
        // User informieren — die bestehende Phase wurde automatisch angepasst!
        App.toast(`Bestehende Phase (${Phasen.beschreibPhase(konflikt.konflikt)}) automatisch am ${Phasen.fmtDE(vorTag)} beendet`, 'warning');
      } else {
        App.toast('Achtung: Phasen überlappen sich — bitte im Editor prüfen', 'warning');
      }
    }

    if (phaseId) {
      Phasen.updatePhase(phaseId, phase);
      App.toast('Phase aktualisiert', 'success');
    } else {
      Phasen.addPhase(schuelerId, phase);
      App.toast('Phase hinzugefügt', 'success');
    }
    this.openPhasenEditor(schuelerId);
  },

  async confirmDeletePhase(schuelerId, phaseId) {
    if (!(await App.confirm('Phase wirklich löschen?', { titel: 'Phase löschen', ok: 'Löschen', gefaehrlich: true }))) return;
    Phasen.deletePhase(phaseId);
    App.toast('Phase gelöscht', 'success');
    this.openPhasenEditor(schuelerId);
  },
};
