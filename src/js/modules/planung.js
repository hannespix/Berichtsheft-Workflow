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

  // ── Kontroll-Vorlagen: die drei wiederkehrenden Kampagnen aus der Praxis ──
  // Ein Klick stellt die Kohorten-Filter (AP ∪ ZP, siehe gf()) für die
  // jeweilige Kontrolle ein; die Jahre werden aus dem heutigen Datum
  // abgeleitet und gegen die Stammdaten geprüft. Die organisatorischen
  // Merkhinweise (Hersendung-Schulen, Fachrichtungs-Ausnahmen) erscheinen
  // als Checkliste unter der Werkzeugleiste.
  _aktiveVorlage: null,
  _kontrollVorlagen() {
    const heute = new Date();
    const jahr = heute.getFullYear();
    const monat = heute.getMonth(); // 0 = Januar
    // Kampagnen-Jahre relativ zum typischen Planungszeitpunkt:
    const folgeJahr = monat >= 6 ? jahr + 1 : jahr;   // Nov./Dez.-Kontrolle zielt auf AP S + ZP F des Folgejahres
    const zpFJahr = monat <= 2 ? jahr : jahr + 1;     // ZP Frühjahr (~Februar)
    const zpHJahr = monat <= 10 ? jahr : jahr + 1;    // ZP Herbst (Sept.–Nov.)
    const apSJahr = monat <= 6 ? jahr : jahr + 1;     // Zulassungskontrolle AP S (April)
    const jgRow = (typ, j) => App.query('SELECT id, bezeichnung FROM abschlussjahrgaenge WHERE typ=? AND jahr=?', [typ, j])[0];
    const apW = App.query('SELECT id, bezeichnung FROM abschlussjahrgaenge WHERE typ=? AND jahr>=? ORDER BY jahr LIMIT 1', ['Winter', jahr])[0];
    const zpVorhanden = new Set(App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != ''").map(r => r.zwischenpruefung));

    const bau = (key, titel, termin, jgWuensche, zpWuensche, hinweise) => {
      const jgIds = [], jgLabels = [], zps = [], fehlt = [];
      jgWuensche.forEach(([typ, j, label]) => {
        const row = typ === 'Winter' && j == null ? apW : jgRow(typ, j);
        if (row) { jgIds.push(row.id); jgLabels.push(row.bezeichnung); }
        else fehlt.push(label);
      });
      zpWuensche.forEach(code => {
        if (zpVorhanden.has(code)) zps.push(code);
        else fehlt.push('ZP ' + code);
      });
      return { key, titel, termin, jgIds, jgLabels, zps, fehlt, hinweise };
    };

    return [
      bau('kontrolle23', 'Kontrolle 2.+3. Ausbildungsjahr', 'Ende Nov. – Mitte Dez.',
        [['Sommer', folgeJahr, 'AP S' + folgeJahr]],
        ['F' + folgeJahr, 'H' + (folgeJahr - 1)],
        ['Alle Fachrichtungen 2.+3. AJ – Kontrolle an den Schulen',
         'NICHT die Azubis, die im Herbst bereits an der ZP Produktion kontrolliert wurden (i.d.R. Gemüsebau, Obstbau, Friedhof am RPK)',
         'Hersendung ans RP: Christiane-Herzog-Schule Heilbronn*, Johannes-Gutenberg-Schule Heidelberg*, Freie Landbauschule Bodensee Überlingen* (Standort erfragen!), Justus-von-Liebig-Schule Göppingen, Paulinenpflege Winnenden, Landw. Schule Stuttgart-Hohenheim, alle OHNE Beschulung',
         '* nur die, die noch nicht an der ZP H kontrolliert wurden']),
      bau('zpF', 'Kontrolle zur Zwischenprüfung Frühjahr', '~Februar',
        [], ['F' + zpFJahr],
        ['Kontrolle an den Zwischenprüfungen (an Frau Pfirsig zum Einsortieren in die Mappen)',
         'GaLaBau: immer · Zierpflanzenbau: ab ZP F27',
         'Ggf. Kontrolle bei der ZP eines anderen RP (meist Friedhof)']),
      bau('zpH', 'Kontrolle zur Zwischenprüfung Herbst', 'Sept. – Nov.',
        [], ['H' + zpHJahr],
        ['Kontrolle an den Zwischenprüfungen (an Frau Pfirsig zum Einsortieren in die Mappen)',
         'GaLaBau: immer · Produktion vorgezogen: Gemüsebau, Obstbau (Baumschule nur bis H25 – danach Schuländerung Offenburg)',
         'Übrige Fachrichtungen erst bei der Nov./Dez.-Kontrolle (2.+3. AJ)']),
      bau('apS', 'Zulassungskontrolle AP Sommer', 'zum April',
        [['Sommer', apSJahr, 'AP S' + apSJahr]], [],
        ['Alle Fachrichtungen – Kontrolle an den Schulen',
         'Hersendung ans RP: Heilbronn, Heidelberg, Überlingen, Göppingen, Winnenden, Stuttgart-Hohenheim, alle OHNE Beschulung']),
      bau('apW', 'Zulassungskontrolle AP Winter', 'zum November',
        [['Winter', null, 'AP Winter (nächster Jahrgang)']], [],
        ['Reguläre und Verkürzer senden ihre Berichtshefte per Post ans RP – mit der Anmeldung zum 1.11.']),
    ];
  },
  _vorlagenButtonHtml() {
    return `<span style="position:relative;display:inline-block">
      <button class="btn btn-secondary" id="planVorlagenBtn" onclick="PlanungHandler._toggleVorlagen();event.stopPropagation()">★ Kontroll-Vorlagen ▾</button>
      <div id="planVorlagenDd" style="display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:70;background:white;border:1px solid var(--clr-sand);border-radius:var(--radius);box-shadow:0 6px 18px rgba(0,0,0,0.18);min-width:330px;max-width:420px;padding:4px 0">
        <div style="padding:4px 14px;font-size:10px;color:var(--clr-text-light);border-bottom:1px solid var(--clr-sand)">Stellt die Kohorten-Filter für die jeweilige Kontrolle ein (aktive BAV, Jahre automatisch)</div>
        ${this._kontrollVorlagen().map(v => {
          const teile = [...v.jgLabels, ...v.zps];
          return `<div style="padding:7px 14px;cursor:pointer;border-bottom:1px solid var(--clr-sand-light)" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''" onclick="PlanungHandler._applyVorlage('${v.key}')">
            <div style="font-size:13px;font-weight:600;color:var(--clr-forest-dark)">${esc(v.titel)} <span style="font-weight:400;font-size:11px;color:var(--clr-text-light)">· ${esc(v.termin)}</span></div>
            <div style="font-size:11px;margin-top:1px">${teile.length ? '→ ' + esc(teile.join(' + ')) : ''}${v.fehlt.length ? ` <span style="color:var(--clr-red)">fehlt: ${esc(v.fehlt.join(', '))}</span>` : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </span>`;
  },
  _toggleVorlagen() {
    const dd = document.getElementById('planVorlagenDd');
    if (!dd) return;
    const oeffnen = dd.style.display === 'none';
    dd.style.display = oeffnen ? '' : 'none';
    if (oeffnen) {
      setTimeout(() => {
        const closer = (e) => {
          if (!dd.contains(e.target) && e.target.id !== 'planVorlagenBtn') {
            dd.style.display = 'none';
            document.removeEventListener('click', closer);
          }
        };
        document.addEventListener('click', closer);
      }, 10);
    }
  },
  _applyVorlage(key) {
    const v = this._kontrollVorlagen().find(x => x.key === key);
    if (!v) return;
    App.filterJahrgang = v.jgIds.slice();
    App.filterZp = v.zps.slice();
    App.filterBavStatus = 'aktiv'; // „(nicht) ENDE" = aktive BAV
    // Amt-Filter AUS: Am Schultermin werden auch Azubis fremder
    // Zuständigkeitsbereiche mitkontrolliert (Weitergabe über „§ Ämter").
    App.filterAmt = [];
    App._updateAmtButton();
    this._aktiveVorlage = key;
    App.refreshJgDropdown();
    App._updateJgButton();
    App._updateFilterCount();
    App.renderCurrentView();
    const teile = [...v.jgLabels, ...v.zps];
    App.toast('Kohorten-Filter gesetzt: ' + (teile.join(' + ') || '–')
      + (v.fehlt.length ? ' · fehlt in den Stammdaten: ' + v.fehlt.join(', ') : ''),
      v.fehlt.length ? 'warning' : 'success');
  },
  _vorlagenHinweisHtml() {
    if (!this._aktiveVorlage) return '';
    const v = this._kontrollVorlagen().find(x => x.key === this._aktiveVorlage);
    if (!v) return '';
    const teile = [...v.jgLabels, ...v.zps];
    return `<div class="card" style="margin-bottom:12px;border-left:4px solid var(--clr-forest)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="font-size:14px">★ ${esc(v.titel)}</strong>
        <span style="font-size:12px;color:var(--clr-text-light)">${esc(v.termin)}</span>
        ${teile.length ? `<span style="font-size:11px;padding:2px 8px;background:var(--clr-green-light);border-radius:8px">Filter: ${esc(teile.join(' + '))}</span>` : ''}
        <span style="margin-left:auto;cursor:pointer;color:var(--clr-red);font-weight:bold" title="Vorlagen-Hinweis ausblenden (Filter bleiben)" onclick="PlanungHandler._aktiveVorlage=null;App.renderCurrentView()">✕</span>
      </div>
      <div style="font-size:12px;line-height:1.8;margin-top:6px">
        ${v.hinweise.map(h => `<div>• ${esc(h)}</div>`).join('')}
      </div>
    </div>`;
  },

  addTermin() {
    this._editTerminId = null;
    // BEWUSST UNGEFILTERT: Am Schultermin werden ALLE dort anwesenden Azubis
    // kontrolliert – auch die mit fremdem zuständigen Amt und Klassen ohne
    // Fachrichtungszuordnung. Die globalen Filter (insb. Amt '93') würden
    // genau diese ausblenden; eingegrenzt wird ausschließlich über die
    // Dialog-eigenen Mehrfachauswahl-Filter (Kohorten werden vorbelegt).
    const klassen = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jg_bez,
      fr.bezeichnung as fr_bez, fr.typ as fr_typ, fr.id as fr_id,
      (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as schueler_count
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id
      ORDER BY bs.name, k.klassenbezeichnung`);
    const pruefer = App.query('SELECT * FROM pruefer WHERE aktiv=1 ORDER BY name');
    const allSchueler = App.query(`SELECT s.*, COALESCE(b.name, s.ausbildungsstaette) as betrieb_display FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id WHERE s.aktiv=1 ORDER BY s.nachname, s.vorname`);

    // Filter options – reguläre Schulen + aktuelle LFK-Schulen
    const lfkSchulen = App.query("SELECT DISTINCT landesfachklasse FROM schueler WHERE aktiv=1 AND landesfachklasse != ''").map(r => r.landesfachklasse);
    const schulen = [...new Set([...klassen.map(k => k.schule), ...lfkSchulen])].sort();
    const jahrgaenge = [...new Set(klassen.map(k => k.jg_bez).filter(Boolean))].sort();
    const fachrichtungen = [...new Set(klassen.map(k => (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '')).filter(Boolean))].sort();
    const zpValues = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != '' ORDER BY zwischenpruefung");
    const amtValues = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE aktiv=1 AND zustaendiges_amt != '' ORDER BY zustaendiges_amt");
    // Pre-compute per-class: which ZP values + which Amt values
    const classZP = {}, classAmt = {}, classSchulen = {};
    klassen.forEach(k => {
      const zps = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE klasse_id=? AND aktiv=1 AND zwischenpruefung != ''", [k.id]);
      classZP[k.id] = zps.map(r => r.zwischenpruefung);
      const amts = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE klasse_id=? AND aktiv=1 AND zustaendiges_amt != ''", [k.id]);
      classAmt[k.id] = amts.map(r => r.zustaendiges_amt);
      // Alle Schulen, an denen Azubis dieser Klasse TATSÄCHLICH sind
      // (Stammschule + Landesfachklassen-Standorte) – für den Schul-Filter
      const schulenSet = new Set([k.schule]);
      App.query('SELECT s.*, ? as schule FROM schueler s WHERE s.klasse_id=? AND s.aktiv=1', [k.schule, k.id]).forEach(s => {
        try { const ak = App.getAktuelleSchule(s); if (ak && ak.schule) schulenSet.add(ak.schule); } catch(e) {}
      });
      classSchulen[k.id] = [...schulenSet];
    });
    this._terminClassZP = classZP;
    this._terminClassAmt = classAmt;
    this._terminClassSchulen = classSchulen;

    // Group classes by school for display
    const bySchool = {};
    klassen.forEach(k => {
      if (!bySchool[k.schule]) bySchool[k.schule] = [];
      bySchool[k.schule].push(k);
    });

    App.openModal('Neuer Kontrolltermin / Einsendung', `
      <!-- Typ-Toggle -->
      <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--clr-sand);border-radius:var(--radius);overflow:hidden">
        <button id="btnTypSchule" class="btn" style="flex:1;border-radius:0;border:none;background:var(--clr-forest);color:white;font-size:13px;padding:8px" onclick="this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypEinsend').style.background='var(--clr-warm)';document.getElementById('btnTypEinsend').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='schulkontrolle'">
          Schulkontrolle
        </button>
        <button id="btnTypEinsend" class="btn" style="flex:1;border-radius:0;border:none;background:var(--clr-warm);color:var(--clr-text);font-size:13px;padding:8px" onclick="this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypSchule').style.background='var(--clr-warm)';document.getElementById('btnTypSchule').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='einsendung'">
          ✉︎ Einsendung / Einzelprüfung
        </button>
      </div>
      <input type="hidden" id="mKtTyp" value="schulkontrolle">

      <!-- GEMEINSAM: Filter + Klassenauswahl + Smart-Standort (für beide Modi) -->
      <div class="form-group">
        <label>Klassen / Gruppen auswählen</label>
        ${this._terminFilterHtml(jahrgaenge, zpValues.map(z => z.zwischenpruefung), schulen, amtValues.map(a => a.zustaendiges_amt), fachrichtungen)}
        <div id="terminKlassenList" style="max-height:200px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);padding:8px">
          ${Object.entries(bySchool).map(([schule, kls]) => `
            <div class="termin-school-group" data-school="${esc(schule)}" style="margin-bottom:8px">
              <div style="font-weight:600;font-size:12px;color:var(--clr-forest);margin-bottom:4px;border-bottom:1px solid var(--clr-sand);padding-bottom:2px">${esc(schule)}</div>
              ${kls.map(k => {
                const frLabel = (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '');
                return `<div class="check-row termin-kl-row" data-jg="${esc(k.jg_bez||'')}" data-bs="${esc(k.schule)}" data-fr="${esc(frLabel)}" data-lj="${k.lehrjahr || ''}" data-kid="${k.id}">
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
          <strong style="font-size:13px;color:#7b2fa0">Aktuelle Schulstandorte</strong>
          <span style="font-size:11px;color:var(--clr-text-light)">(Berücksichtigt Landesfachklassen)</span>
        </div>
        <div id="smartStandortContent"></div>
        <div id="standortAuswahlInfo" style="font-size:11px;color:var(--clr-forest);font-weight:600;margin-top:4px"></div>
      </div>

      <!-- NUR BEI EINSENDUNG: Zusätzlich einzelne Schüler manuell hinzufügen -->
      <div id="sectionEinsendungExtra" style="margin-top:12px;padding:12px 16px;background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius)">
        <div class="form-group" style="margin-bottom:8px">
          <label style="font-weight:600;color:var(--clr-forest)">Einzelne Azubis hinzufügen (z.B. LFK-Gäste, fremde Ämter)</label>
          <input class="form-control" id="mKtEinsendSuche" placeholder="Name eingeben…" style="margin-bottom:6px" oninput="PlanungHandler._searchEinsendSchueler(this.value)">
          <div id="mKtEinsendResults" style="max-height:150px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);display:none"></div>
        </div>
        <div id="mKtEinsendSelected" style="display:flex;flex-wrap:wrap;gap:4px"></div>
        <div id="einsendCountInfo" style="font-size:11px;color:var(--clr-text-light);margin-top:4px"></div>
      </div>

      <div class="form-group"><label>Ort des Termins (Berufsschule)</label>
        <select class="form-control" id="mKtOrt">
          <option value="">automatisch (Schule der ersten Klasse)</option>
          ${App.query('SELECT id,name FROM berufsschulen ORDER BY name').map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}
        </select>
        <div style="font-size:10px;color:var(--clr-text-light);margin-top:2px">Bei Landesfachklassen-Terminen die LFK-Schule wählen – E-Mail und Anzeige nutzen diesen Ort.</div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Datum</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="date" class="form-control" id="mKtDatum" value="${todayStr()}" onchange="PlanungHandler._updateKwHighlight()" style="flex:1">
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
          <strong style="color:var(--clr-forest)">KW-Kalender – Klick = Datum setzen</strong>
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
    setTimeout(() => { PlanungHandler._updateKwHighlight(); PlanungHandler.updateBpHint(); PlanungHandler._tfPrefillGlobal(); }, 50);
  },

  _terminClassZP: {},
  _terminClassAmt: {},

  // ── Mehrfachauswahl-Filter im Termin-Dialog ──
  // Jede Dimension erlaubt MEHRERE Werte gleichzeitig ([] = alle, ['∅'] = keine).
  // AP und ZP wirken zusammen als VEREINIGUNG: die Klassenliste zeigt Klassen,
  // die zu einem gewählten AP-Jahrgang ODER einer gewählten ZP-Kohorte gehören
  // (z.B. ZP 2026 + ZP 2027 + AP Sommer 2027 + AP Winter 2028 in einem Termin).
  _terminFilter: { jg: [], zp: [], bs: [], amt: [], fr: [], lj: [] },
  _terminFilterOpts: {},
  _tfNamen: { jg: 'Abschlussprüfung', zp: '✎ Zwischenprüfung', lj: 'Lehrjahr', bs: 'Schule', amt: '§ Amt', fr: 'Fachrichtung' },

  _terminFilterHtml(jahrgaenge, zpCodes, schulen, aemter, fachrichtungen) {
    this._terminFilter = { jg: [], zp: [], bs: [], amt: [], fr: [], lj: [] };
    this._terminFilterOpts = {
      jg: jahrgaenge.map(j => ({ v: j, l: App.jgLabel(j) })),
      zp: zpCodes.map(z => ({ v: z, l: App.zpLabel(z) })),
      lj: [1, 2, 3, 4].map(l => ({ v: String(l), l: l + '. Lehrjahr' })),
      bs: schulen.map(s => ({ v: s, l: s })),
      amt: aemter.map(a => ({ v: a, l: a + ' ' + (App.AEMTER[a] || '') })),
      fr: fachrichtungen.map(f => ({ v: f, l: f })),
    };
    return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:8px;background:var(--clr-warm);border-radius:var(--radius)">
      ${Object.keys(this._tfNamen).map(k => `<div style="position:relative">
        <button type="button" class="form-control" id="tfBtn_${k}" style="width:auto;font-size:11px;padding:2px 8px;cursor:pointer;text-align:left" onclick="PlanungHandler._tfToggle('${k}');event.stopPropagation()">${this._tfNamen[k]}: Alle ▾</button>
        <div id="tfDd_${k}" style="display:none;position:absolute;top:calc(100% + 2px);left:0;z-index:60;background:white;border:1px solid var(--clr-sand);border-radius:var(--radius);box-shadow:0 4px 14px rgba(0,0,0,0.18);min-width:190px;max-width:280px;max-height:190px;overflow-y:auto;padding:2px 0">
          <div style="display:flex;gap:10px;padding:3px 10px;border-bottom:1px solid var(--clr-sand);font-size:10px">
            <a href="#" style="color:var(--clr-forest)" onclick="PlanungHandler._tfAll('${k}',true);return false">alle</a>
            <a href="#" style="color:var(--clr-forest)" onclick="PlanungHandler._tfAll('${k}',false);return false">keine</a>
          </div>
          ${(this._terminFilterOpts[k] || []).map(o => `<label style="display:flex;align-items:center;gap:6px;padding:2px 10px;cursor:pointer;font-size:11px;white-space:nowrap" onmouseenter="this.style.background='var(--clr-warm)'" onmouseleave="this.style.background=''">
            <input type="checkbox" class="chk-tf-${k}" value="${esc(o.v)}" checked onchange="PlanungHandler._tfChange('${k}')" style="accent-color:var(--clr-forest)"> ${esc(o.l)}
          </label>`).join('')}
        </div>
      </div>`).join('')}
      <span style="font-size:10px;color:var(--clr-text-light);align-self:center">Mehrfachauswahl möglich · AP + ZP kombiniert = alle gewählten Kohorten</span>
    </div>`;
  },
  _tfToggle(k) {
    Object.keys(this._tfNamen).forEach(x => {
      const d = document.getElementById('tfDd_' + x);
      if (d && x !== k) d.style.display = 'none';
    });
    const dd = document.getElementById('tfDd_' + k);
    if (!dd) return;
    const oeffnen = dd.style.display === 'none';
    dd.style.display = oeffnen ? '' : 'none';
    if (oeffnen) {
      setTimeout(() => {
        const closer = (e) => {
          if (!dd.contains(e.target) && e.target.id !== 'tfBtn_' + k) {
            dd.style.display = 'none';
            document.removeEventListener('click', closer);
          }
        };
        document.addEventListener('click', closer);
      }, 10);
    }
  },
  _tfAll(k, checked) {
    document.querySelectorAll('.chk-tf-' + k).forEach(c => { c.checked = checked; });
    this._tfChange(k);
  },
  _tfChange(k) {
    const alle = [...document.querySelectorAll('.chk-tf-' + k)];
    const checked = alle.filter(c => c.checked).map(c => c.value);
    this._terminFilter[k] = checked.length === alle.length ? [] : (checked.length === 0 ? ['∅'] : checked);
    this._tfUpdateButton(k);
    this._filterTerminKlassen();
  },
  _tfUpdateButton(k) {
    const btn = document.getElementById('tfBtn_' + k);
    if (!btn) return;
    const sel = this._terminFilter[k];
    if (!sel.length) {
      btn.textContent = this._tfNamen[k] + ': Alle ▾';
      btn.style.background = ''; btn.style.fontWeight = '';
    } else if (sel[0] === '∅') {
      btn.textContent = this._tfNamen[k] + ': Keine ▾';
      btn.style.background = 'var(--clr-red-light)'; btn.style.fontWeight = '600';
    } else {
      const einzel = String(sel[0]);
      btn.textContent = this._tfNamen[k] + ': ' + (sel.length === 1 ? (einzel.length > 18 ? einzel.slice(0, 17) + '…' : einzel) : sel.length + ' gewählt') + ' ▾';
      btn.style.background = 'var(--clr-green-light)'; btn.style.fontWeight = '600';
    }
  },

  _filterTerminKlassen() {
    const container = document.getElementById('terminKlassenList');
    if (!container) return;
    const f = this._terminFilter;
    container.querySelectorAll('.termin-kl-row').forEach(row => {
      const kid = parseInt(row.dataset.kid);
      let show = true;
      // AP/ZP als Vereinigung: sobald eine der beiden Dimensionen eingeschränkt
      // ist, muss die Klasse zu einer der gewählten Kohorten gehören
      if (f.jg.length || f.zp.length) {
        const jgHit = f.jg.length ? f.jg.includes(row.dataset.jg) : false;
        const zpHit = f.zp.length ? (this._terminClassZP[kid] || []).some(z => f.zp.includes(z)) : false;
        show = jgHit || zpHit;
      }
      // Schul-Filter: matcht Stammschule ODER die tatsächlichen Standorte der
      // Klassen-Azubis (Landesfachklassen) – sonst fand ein LFK-Standort-Filter
      // keine einzige Klasse
      if (show && f.bs.length && !f.bs.some(b => (this._terminClassSchulen[kid] || [row.dataset.bs]).includes(b))) show = false;
      if (show && f.fr.length && !f.fr.includes(row.dataset.fr)) show = false;
      if (show && f.lj.length && !f.lj.includes(String(row.dataset.lj))) show = false;
      if (show && f.amt.length && !(this._terminClassAmt[kid] || []).some(a => f.amt.includes(a))) show = false;
      row.style.display = show ? '' : 'none';
    });
    // Hide empty school groups
    container.querySelectorAll('.termin-school-group').forEach(g => {
      const rows = g.querySelectorAll('.termin-kl-row');
      const hasVisible = [...rows].some(r => r.style.display !== 'none');
      g.style.display = hasVisible ? '' : 'none';
    });

    // Smart-Standort aktualisieren bei jedem aktiven Filter
    this._updateSmartStandort();
  },

  _updateSmartStandort() {
    const box = document.getElementById('smartStandortBox');
    const content = document.getElementById('smartStandortContent');
    if (!box || !content) return;

    const f = this._terminFilter;
    const { jg, zp, bs, amt, fr } = f;
    const lj = f.lj || [];

    // Nur anzeigen wenn mindestens ein Filter aktiv
    if (!jg.length && !fr.length && !amt.length && !zp.length && !bs.length && !lj.length) { box.style.display = 'none'; return; }

    // "Keine"-Auswahl in einer Dimension → leere Menge, gar nicht erst suchen
    if ([jg, zp, bs, amt, fr, lj].some(sel => sel[0] === '∅')) {
      box.style.display = '';
      content.innerHTML = '<div style="font-size:12px;color:var(--clr-text-light);padding:4px">Keine Schüler für diese Filterauswahl gefunden.</div>';
      return;
    }

    // Jahrgangs-Bezeichnungen → IDs
    const jgIds = jg.length
      ? App.query(`SELECT id FROM abschlussjahrgaenge WHERE bezeichnung IN (${jg.map(() => '?').join(',')})`, jg).map(r => r.id)
      : [];
    // Fachrichtungs-Labels → IDs
    const frIds = [];
    fr.forEach(frLabel => {
      const cleanLabel = frLabel.replace(/^FW:\s*/, '');
      const isFW = frLabel.startsWith('FW:');
      const frRow = App.query('SELECT id FROM fachrichtungen WHERE bezeichnung=? AND typ=?', [cleanLabel, isFW ? 'Fachwerker' : 'Gärtner'])[0];
      if (frRow) frIds.push(frRow.id);
    });

    const opts = {};
    if (jgIds.length) opts.jahrgangId = jgIds;
    if (frIds.length) opts.fachrichtungId = frIds;
    if (amt.length) opts.amt = amt;
    if (zp.length) opts.zwischenpruefung = zp;
    if (lj.length) opts.lehrjahre = lj.map(Number);

    const gruppen = App.getStandortgruppen(opts);
    if (!gruppen.length) {
      box.style.display = '';
      content.innerHTML = '<div style="font-size:12px;color:var(--clr-text-light);padding:4px">Keine Schüler für diese Filterauswahl gefunden.</div>';
      return;
    }

    // Wenn Schule gefiltert: nur Gruppen an diesen Schulen ODER LFK-Gruppen dort zeigen
    const filtered = bs.length ? gruppen.filter(g => bs.some(b => g.schule.toLowerCase().includes(b.toLowerCase()))) : gruppen;

    // Check ob es LFK-Schüler gibt
    const hasAnyLFK = filtered.some(g => g.hasLFK);

    // Filter-Label für Anzeige
    const activeFilters = [];
    if (jg.length) activeFilters.push(jg.join(', '));
    if (lj.length) activeFilters.push(lj.join('.+') + '. LJ');
    if (fr.length) activeFilters.push(fr.join(', '));
    if (amt.length) activeFilters.push(`Amt ${amt.join('/')}`);
    if (zp.length) activeFilters.push(`ZP ${zp.join(', ')}`);
    if (bs.length) activeFilters.push(bs.join(', '));

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
      <strong>LFK</strong> = Schüler an Landesfachklasse (besuchen diese Schule statt ihrer regulären Berufsschule)
    </div>` : '');
  },

  _selectStandort(klasseIds, schuelerIds) {
    // NUR die Azubis dieser Standortgruppe übernehmen – als EINZEL-Zuordnung.
    // Früher wurden stattdessen die STAMMklassen angehakt (das holte ganze
    // Klassen anderer Schulen mit herein) und eine bereits getroffene Auswahl
    // wurde stillschweigend gelöscht. Jetzt: mergen, Klassen unangetastet.
    const menge = new Set(this._standortSchuelerIds || []);
    schuelerIds.forEach(sid => menge.add(sid));
    this._standortSchuelerIds = [...menge];
    App.toast(`${schuelerIds.length} Azubis dieser Standortgruppe übernommen (${this._standortSchuelerIds.length} Einzel-Zuordnungen insgesamt)`, 'success');
    this._renderEinsendSelected && this._renderStandortInfo();
    this.updateBpHint && this.updateBpHint();
  },
  _renderStandortInfo() {
    const info = document.getElementById('standortAuswahlInfo');
    if (info) info.textContent = this._standortSchuelerIds.length
      ? `${this._standortSchuelerIds.length} Azubis über Standortgruppen als Einzel-Zuordnung übernommen`
      : '';
  },

  // Globale Kohorten-Filter (Jahrgänge/ZP) als VORBELEGUNG in die
  // Dialog-Filter übernehmen – bewusst NICHT Amt/Fachrichtung: am Schultermin
  // werden auch Azubis fremder Ämter und aller Fachrichtungen mitkontrolliert.
  _tfPrefillGlobal() {
    const jgBez = (App.filterJahrgang || []).filter(x => x !== -1)
      .map(jid => App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [jid])).filter(Boolean);
    const zps = (App.filterZp || []).filter(z => z !== '---');
    const setze = (k, werte) => {
      if (!werte.length) return;
      const boxes = [...document.querySelectorAll('.chk-tf-' + k)];
      if (!boxes.length) return;
      let getroffen = false;
      boxes.forEach(c => { const hit = werte.includes(c.value); c.checked = hit; if (hit) getroffen = true; });
      if (getroffen) this._tfChange(k);
      else boxes.forEach(c => { c.checked = true; });
    };
    setze('jg', jgBez);
    setze('zp', zps);
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
    const d = new Date(dt + 'T00:00:00');
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
    // Ort des Termins: explizite Auswahl, sonst Stammschule der ersten Klasse
    // (data-bs am Checkbox-Input trägt die berufsschule_id)
    const ortId = parseInt(document.getElementById('mKtOrt')?.value) || parseInt(firstChecked?.dataset?.bs) || null;

    if (id) {
      App.run('UPDATE kontrolltermine SET geplant_datum=?,pruefer=?,bemerkung=?,jahrgang_id=?,typ=?,berufsschule_id=? WHERE id=?', [dt,pr,bem,jgId,typ,ortId,id]);
      // Update junction table
      App.run('DELETE FROM kontrolltermin_klassen WHERE kontrolltermin_id=?', [id]);
      selectedKlassen.forEach(klId => {
        App.run('INSERT OR IGNORE INTO kontrolltermin_klassen (kontrolltermin_id, klasse_id) VALUES (?,?)', [id, klId]);
      });
      // Legacy klasse_id IMMER setzen – auch auf NULL: sonst holte der
      // Fallback in getTerminKlassenIds eine abgewählte Klasse zurück
      App.run('UPDATE kontrolltermine SET klasse_id=? WHERE id=?', [selectedKlassen[0] || null, id]);
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
      // Verwaiste KEs: NUR leere Bögen löschen. Bögen MIT Inhalt (am
      // Kontrolltag ad hoc hinzugefügte Gäste, inzwischen inaktive Azubis)
      // werden stattdessen als Einzel-Zuordnung an den Termin gebunden –
      // eine bloße Terminkorrektur darf keine dokumentierte Durchsicht
      // vernichten.
      const orphanKE = App.query(`SELECT schueler_id, COALESCE(ergebnis,'') e, COALESCE(bemerkung,'') b,
          COALESCE(geprueft_kws,'') gk, COALESCE(fehltage_gesamt,0) ft
        FROM kontrollergebnisse WHERE kontrolltermin_id=?`, [id])
        .filter(ke => !validSchuelerIds.has(ke.schueler_id));
      const mitInhalt = orphanKE.filter(ke => ke.e !== '' || ke.b !== '' || (ke.gk !== '' && ke.gk !== '{}') || ke.ft > 0);
      const leere = orphanKE.filter(ke => !mitInhalt.includes(ke));
      mitInhalt.forEach(ke => {
        App.run('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)', [id, ke.schueler_id]);
      });
      if (mitInhalt.length) App.toast(`${mitInhalt.length} Azubi(s) mit erfassten Ergebnissen bleiben dem Termin zugeordnet`, 'info');
      if (leere.length) {
        const orphanIds = leere.map(ke => ke.schueler_id);
        const oPh = orphanIds.map(() => '?').join(',');
        App.run(`DELETE FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id IN (${oPh})`, [id, ...orphanIds]);
      }
    } else {
      App.run('INSERT INTO kontrolltermine (klasse_id,jahrgang_id,geplant_datum,pruefer,bemerkung,typ,berufsschule_id) VALUES (?,?,?,?,?,?,?)',
        [selectedKlassen[0] || null, jgId, dt, pr, bem, typ, ortId]);
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
        if (!bem) {
          const autoTitel = App.generateTerminTitel(newId);
          if (autoTitel) App.run('UPDATE kontrolltermine SET bemerkung=? WHERE id=?', [autoTitel, newId]);
        }
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
    // Ungefiltert – siehe addTermin (fremde Ämter werden mitkontrolliert)
    const klassen = App.query(`SELECT k.*, bs.name as schule, j.bezeichnung as jg_bez,
      fr.bezeichnung as fr_bez, fr.typ as fr_typ, fr.id as fr_id,
      (SELECT COUNT(*) FROM schueler WHERE klasse_id=k.id AND aktiv=1) as schueler_count
      FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      LEFT JOIN fachrichtungen fr ON k.fachrichtung_id=fr.id
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
    const allSchueler = App.query(`SELECT s.*, COALESCE(b.name, s.ausbildungsstaette) as betrieb_display FROM schueler s LEFT JOIN betriebe b ON s.betrieb_id=b.id WHERE s.aktiv=1 ORDER BY s.nachname, s.vorname`);
    const isEinsendung = t.typ === 'einsendung';

    // Filter options – reguläre Schulen + aktuelle LFK-Schulen
    const lfkSchulen = App.query("SELECT DISTINCT landesfachklasse FROM schueler WHERE aktiv=1 AND landesfachklasse != ''").map(r => r.landesfachklasse);
    const schulen = [...new Set([...klassen.map(k => k.schule), ...lfkSchulen])].sort();
    const jahrgaenge = [...new Set(klassen.map(k => k.jg_bez).filter(Boolean))].sort();
    const fachrichtungen = [...new Set(klassen.map(k => (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '')).filter(Boolean))].sort();
    const zpValues = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE aktiv=1 AND zwischenpruefung != '' ORDER BY zwischenpruefung");
    const amtValues = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE aktiv=1 AND zustaendiges_amt != '' ORDER BY zustaendiges_amt");
    // Pre-compute per-class: which ZP values + which Amt values
    const classZP = {}, classAmt = {}, classSchulen = {};
    klassen.forEach(k => {
      const zps = App.query("SELECT DISTINCT zwischenpruefung FROM schueler WHERE klasse_id=? AND aktiv=1 AND zwischenpruefung != ''", [k.id]);
      classZP[k.id] = zps.map(r => r.zwischenpruefung);
      const amts = App.query("SELECT DISTINCT zustaendiges_amt FROM schueler WHERE klasse_id=? AND aktiv=1 AND zustaendiges_amt != ''", [k.id]);
      classAmt[k.id] = amts.map(r => r.zustaendiges_amt);
      // Alle Schulen, an denen Azubis dieser Klasse TATSÄCHLICH sind
      // (Stammschule + Landesfachklassen-Standorte) – für den Schul-Filter
      const schulenSet = new Set([k.schule]);
      App.query('SELECT s.*, ? as schule FROM schueler s WHERE s.klasse_id=? AND s.aktiv=1', [k.schule, k.id]).forEach(s => {
        try { const ak = App.getAktuelleSchule(s); if (ak && ak.schule) schulenSet.add(ak.schule); } catch(e) {}
      });
      classSchulen[k.id] = [...schulenSet];
    });
    this._terminClassZP = classZP;
    this._terminClassAmt = classAmt;
    this._terminClassSchulen = classSchulen;

    // Group classes by school for display
    const bySchool = {};
    klassen.forEach(k => {
      if (!bySchool[k.schule]) bySchool[k.schule] = [];
      bySchool[k.schule].push(k);
    });

    App.openModal('Termin bearbeiten', `
      <!-- Typ-Toggle -->
      <div style="display:flex;gap:0;margin-bottom:12px;border:1px solid var(--clr-sand);border-radius:var(--radius);overflow:hidden">
        <button id="btnTypSchule" class="btn" style="flex:1;border-radius:0;border:none;background:${isEinsendung ? 'var(--clr-warm)' : 'var(--clr-forest)'};color:${isEinsendung ? 'var(--clr-text)' : 'white'};font-size:13px;padding:8px" onclick="this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypEinsend').style.background='var(--clr-warm)';document.getElementById('btnTypEinsend').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='schulkontrolle'">
          Schulkontrolle
        </button>
        <button id="btnTypEinsend" class="btn" style="flex:1;border-radius:0;border:none;background:${isEinsendung ? 'var(--clr-forest)' : 'var(--clr-warm)'};color:${isEinsendung ? 'white' : 'var(--clr-text)'};font-size:13px;padding:8px" onclick="this.style.background='var(--clr-forest)';this.style.color='white';document.getElementById('btnTypSchule').style.background='var(--clr-warm)';document.getElementById('btnTypSchule').style.color='var(--clr-text)';document.getElementById('mKtTyp').value='einsendung'">
          ✉︎ Einsendung / Einzelprüfung
        </button>
      </div>
      <input type="hidden" id="mKtTyp" value="${esc(t.typ || 'schulkontrolle')}">

      <div class="form-group">
        <label>Klassen / Gruppen auswählen</label>
        ${this._terminFilterHtml(jahrgaenge, zpValues.map(z => z.zwischenpruefung), schulen, amtValues.map(a => a.zustaendiges_amt), fachrichtungen)}
        <div id="terminKlassenList" style="max-height:200px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);padding:8px">
          ${Object.entries(bySchool).map(([schule, kls]) => `
            <div class="termin-school-group" data-school="${esc(schule)}" style="margin-bottom:8px">
              <div style="font-weight:600;font-size:12px;color:var(--clr-forest);margin-bottom:4px;border-bottom:1px solid var(--clr-sand);padding-bottom:2px">${esc(schule)}</div>
              ${kls.map(k => {
                const frLabel = (k.fr_typ === 'Fachwerker' ? 'FW: ' : '') + (k.fr_bez || '');
                return `<div class="check-row termin-kl-row" data-jg="${esc(k.jg_bez||'')}" data-bs="${esc(k.schule)}" data-fr="${esc(frLabel)}" data-lj="${k.lehrjahr || ''}" data-kid="${k.id}">
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
          <strong style="font-size:13px;color:#7b2fa0">Aktuelle Schulstandorte</strong>
          <span style="font-size:11px;color:var(--clr-text-light)">(Berücksichtigt Landesfachklassen)</span>
        </div>
        <div id="smartStandortContent"></div>
        <div id="standortAuswahlInfo" style="font-size:11px;color:var(--clr-forest);font-weight:600;margin-top:4px"></div>
      </div>

      <!-- NUR BEI EINSENDUNG: Zusätzlich einzelne Schüler manuell hinzufügen -->
      <div id="sectionEinsendungExtra" style="margin-top:12px;padding:12px 16px;background:var(--clr-warm);border:1px solid var(--clr-sand);border-radius:var(--radius)">
        <div class="form-group" style="margin-bottom:8px">
          <label style="font-weight:600;color:var(--clr-forest)">Einzelne Azubis hinzufügen (z.B. LFK-Gäste, fremde Ämter)</label>
          <input class="form-control" id="mKtEinsendSuche" placeholder="Name eingeben…" style="margin-bottom:6px" oninput="PlanungHandler._searchEinsendSchueler(this.value)">
          <div id="mKtEinsendResults" style="max-height:150px;overflow-y:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);display:none"></div>
        </div>
        <div id="mKtEinsendSelected" style="display:flex;flex-wrap:wrap;gap:4px"></div>
        <div id="einsendCountInfo" style="font-size:11px;color:var(--clr-text-light);margin-top:4px"></div>
      </div>

      <div class="form-group"><label>Ort des Termins (Berufsschule)</label>
        <select class="form-control" id="mKtOrt">
          <option value="">automatisch (Schule der ersten Klasse)</option>
          ${App.query('SELECT id,name FROM berufsschulen ORDER BY name').map(b => `<option value="${b.id}" ${t.berufsschule_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select>
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
          <strong style="color:var(--clr-forest)">KW-Kalender – Klick = Datum setzen</strong>
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
    const t = App.query('SELECT * FROM kontrolltermine WHERE id=?', [id])[0];
    if (!t) return;
    const nKe = App.scalar('SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=?', [id]) || 0;
    const nErg = App.scalar("SELECT COUNT(*) FROM kontrollergebnisse WHERE kontrolltermin_id=? AND ergebnis IS NOT NULL AND ergebnis!=''", [id]) || 0;
    const nWv = App.scalar('SELECT COUNT(*) FROM wiedervorlagen WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)', [id]) || 0;
    const nSnap = App.scalar('SELECT COUNT(*) FROM durchsicht_snapshots WHERE kontrollergebnis_id IN (SELECT id FROM kontrollergebnisse WHERE kontrolltermin_id=?)', [id]) || 0;
    const bs = App.getTerminSchule(id);
    const label = `${formatDate(t.geplant_datum)}${bs ? ' · ' + bs.name : ''}${t.bemerkung ? ' · ' + t.bemerkung : ''}`;
    let text = `Termin „${label}" wirklich löschen?`;
    if (nErg || nWv || nSnap) {
      text += `\n\nDabei gehen unwiderruflich verloren:\n• ${nErg} erfasste Kontrollergebnis(se)` +
        (nWv ? `\n• ${nWv} Wiedervorlage(n)` : '') + (nSnap ? `\n• ${nSnap} Durchsichtsbogen-Snapshot(s)` : '') +
        `\n\nTipp: Ein durchgeführter Termin kann stattdessen im Zustand „abgeschlossen" bleiben.`;
    } else if (nKe) {
      text += `\n\n${nKe} Azubi-Zeile(n) ohne erfasstes Ergebnis werden mit entfernt.`;
    }
    if (!confirm(text)) return;
    App.deleteTerminKaskade(id);
    App.invalidateTerminCache();
    Views.planung();
    App.toast(`Termin gelöscht${nErg ? ` (inkl. ${nErg} Ergebnis(se))` : ''}`, 'success');
  },
  exportICS() {
    const termine = App.query(`SELECT kt.*
      FROM kontrolltermine kt
      WHERE kt.status='geplant' ORDER BY kt.geplant_datum`);
    if (!termine.length) return App.toast('Keine Termine zum Exportieren', 'warning');
    App.exportICS(termine.map(t => {
      const klassen = App.getTerminKlassen(t.id);
      const bs = App.getTerminSchule(t.id);
      const schule = bs ? bs.name : (klassen.length ? klassen[0].schule : 'Einsendung');
      const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ');
      const n = App.getTerminSchueler(t.id).length;
      return {
        date: t.geplant_datum,
        title: `BH-Kontrolle: ${schule}${klassenStr ? ' – ' + klassenStr : ''}${t.bemerkung && !klassenStr ? ' – ' + t.bemerkung : ''}`,
        description: `Prüfer: ${t.pruefer || '–'}\n${n} Azubi(s)${bs && bs.ort ? '\nOrt: ' + bs.ort : ''}${t.bemerkung ? '\n' + t.bemerkung : ''}`
      };
    }), App.safeFilename(['BH-Kontrolltermine', todayStr()], 'ics'));
    App.toast(`${termine.length} Termin(e) als ICS exportiert – in Outlook per Datei → Öffnen importieren`, 'success');
  },

  // ── Batch PDF: Alle Durchsichtsbögen eines Kontrolltermins ──
  exportTerminPDF(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return App.toast('Termin nicht gefunden', 'error');
    const klassen = App.getTerminKlassen(terminId);
    const klassenStr = klassen.map(k => k.klassenbezeichnung).join(' + ') || '–';
    const ortBs = App.getTerminSchule(terminId);
    const schule = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : 'Einsendung');
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
  // ── Kampagnen-Assistent: je Schule EIN Termin mit genau den dort
  // anwesenden Azubis (inkl. Landesfachklassen-Gästen und fremder Ämter) ──
  jahresplanAssistent() {
    const vorlagen = this._kontrollVorlagen();
    const pruefer = App.query('SELECT name FROM pruefer WHERE aktiv=1 ORDER BY name');
    App.openModal('Kampagnen-Assistent: Schultermine anlegen', `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:10px;line-height:1.6">
        Gruppiert alle passenden Azubis nach ihrem <strong>tatsächlichen Schulstandort</strong>
        (inkl. Landesfachklassen, <strong>alle Ämter</strong>) und legt je Schule <strong>einen</strong> Termin
        mit genau diesen Azubis an. Nur Zeilen mit Datum werden angelegt.
      </div>
      <div class="form-row">
        <div class="form-group"><label>Kampagne</label>
          <select class="form-control" id="kampVorlage" onchange="PlanungHandler._kampVorlageGewechselt()">
            ${vorlagen.map(v => `<option value="${v.key}">${esc(v.titel)} (${esc(v.termin)})${v.fehlt.length ? ' – fehlt: ' + esc(v.fehlt.join(', ')) : ''}</option>`).join('')}
            <option value="lehrjahre">Frei: nur nach Lehrjahren (ohne Kohorten)</option>
          </select>
        </div>
        <div class="form-group"><label>Lehrjahre (über die Stammklasse)</label>
          <div style="display:flex;gap:12px;font-size:12px;padding:6px 0;flex-wrap:wrap">
            ${[1, 2, 3, 4].map(l => `<label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" class="chk-kamp-lj" value="${l}" onchange="PlanungHandler._kampLaden()" style="accent-color:var(--clr-forest)"> ${l}. LJ</label>`).join('')}
            <span style="color:var(--clr-text-light)">nichts angehakt = alle</span>
          </div>
        </div>
      </div>
      <div class="form-group"><label>Prüfer</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">
          ${pruefer.map(pr => `<label style="display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--clr-warm);border-radius:6px;cursor:pointer;font-size:13px;border:1px solid var(--clr-sand)"><input type="checkbox" class="chk-kamp-pr" value="${esc(pr.name)}" checked style="accent-color:var(--clr-forest)"> ${esc(pr.name)}</label>`).join('')}
        </div>
      </div>
      <div id="kampListe" style="max-height:320px;overflow-y:auto"></div>
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="PlanungHandler._kampAnlegen()">Termine anlegen</button>`);
    setTimeout(() => PlanungHandler._kampVorlageGewechselt(), 30);
  },
  _kampVorlageGewechselt() {
    // Lehrjahr-Vorbelegung je Kampagne: Nov./Dez.-Kontrolle = 2.+3. LJ
    const key = document.getElementById('kampVorlage')?.value;
    const vorbelegung = (key === 'kontrolle23' || key === 'lehrjahre') ? ['2', '3'] : [];
    document.querySelectorAll('.chk-kamp-lj').forEach(c => { c.checked = vorbelegung.includes(c.value); });
    this._kampLaden();
  },
  _kampLaden() {
    const box = document.getElementById('kampListe');
    if (!box) return;
    const key = document.getElementById('kampVorlage')?.value;
    const ljs = [...document.querySelectorAll('.chk-kamp-lj:checked')].map(c => parseInt(c.value));
    const opts = {};
    if (key !== 'lehrjahre') {
      const v = this._kontrollVorlagen().find(x => x.key === key);
      if (v) {
        if (v.jgIds.length) opts.jahrgangId = v.jgIds;
        if (v.zps.length) opts.zwischenpruefung = v.zps;
      }
    }
    if (ljs.length) opts.lehrjahre = ljs;
    const gruppen = App.getStandortgruppen(opts);
    this._kampGruppen = gruppen;
    if (!gruppen.length) {
      box.innerHTML = '<div style="padding:16px;text-align:center;color:var(--clr-text-light);font-size:13px">Keine Azubis für diese Auswahl gefunden.</div>';
      return;
    }
    box.innerHTML = `<table class="data-table" style="font-size:12px"><thead><tr>
        <th>Schule (Standort)</th><th style="text-align:right">Azubis</th><th style="text-align:right">§ fremde Ämter</th><th style="text-align:right">LFK</th><th>Datum</th><th>KW / Blockplan</th>
      </tr></thead><tbody>
      ${gruppen.map((g, i) => {
        const fremd = g.schueler.filter(s => (s.zustaendiges_amt || '') !== '' && s.zustaendiges_amt !== App.EIGENES_AMT).length;
        let lfk = 0;
        g.schueler.forEach(s => { try { if (App.getAktuelleSchule(s).isLandesfachklasse) lfk++; } catch(e) {} });
        return `<tr>
          <td><strong>${esc(g.schule)}</strong></td>
          <td style="text-align:right">${g.schueler.length}</td>
          <td style="text-align:right">${fremd ? `<span class="badge-status badge-open">${fremd}</span>` : '0'}</td>
          <td style="text-align:right">${lfk || '–'}</td>
          <td><input type="date" class="form-control kamp-datum" data-idx="${i}" style="font-size:11px;padding:2px 4px;width:135px" onchange="PlanungHandler._kampKw(this)"></td>
          <td class="kamp-kw" id="kampKw_${i}" style="font-size:11px;color:var(--clr-text-light);white-space:nowrap">–</td>
        </tr>`;
      }).join('')}
    </tbody></table>
    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
      <button class="btn btn-sm btn-secondary" onclick="PlanungHandler._kampVorschlaege()">📅 Datumsvorschläge für alle</button>
      <span style="font-size:11px;color:var(--clr-text-light)">${esc(this._kampFenster(key).label)} – je Schule die erste Blockplan-Woche im Zeitfenster (Dienstag); ohne Blockplan der erste Dienstag</span>
    </div>
    <div style="font-size:11px;color:var(--clr-text-light);margin-top:6px">
      „§ n" = Azubis fremder Zuständigkeitsbereiche – sie werden mitkontrolliert;
      die Weitergabe der Ergebnisse läuft danach über „§ Ämter" am Termin.
    </div>`;
  },
  // Zeitfenster der Kampagne (von/bis als Date) – Grundlage für die Datumsvorschläge
  _kampFenster(key) {
    const heute = new Date(); const j = heute.getFullYear(); const m = heute.getMonth();
    const D = (y, mo, d) => new Date(y, mo, d, 12);
    const v = this._kontrollVorlagen().find(x => x.key === key);
    let von, bis;
    if (key === 'kontrolle23') { const y = m >= 6 ? j : j - 1; von = D(y, 10, 20); bis = D(y, 11, 18); }
    else if (key === 'zpF') { const y = m <= 2 ? j : j + 1; von = D(y, 0, 20); bis = D(y, 2, 10); }
    else if (key === 'zpH') { const y = m <= 10 ? j : j + 1; von = D(y, 8, 1); bis = D(y, 10, 20); }
    else if (key === 'apS') { const y = m <= 6 ? j : j + 1; von = D(y, 2, 1); bis = D(y, 3, 30); }
    else if (key === 'apW') { const y = m <= 10 ? j : j + 1; von = D(y, 9, 1); bis = D(y, 10, 15); }
    else { von = D(j, m, 1); bis = new Date(j, m + 3, 0, 12); }
    if (bis < heute) { von.setFullYear(von.getFullYear() + 1); bis.setFullYear(bis.getFullYear() + 1); }
    const fmt = d => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return { von, bis, label: (v ? v.termin + ': ' : '') + fmt(von) + ' – ' + fmt(bis) };
  },
  _kampVorschlaege() {
    const key = document.getElementById('kampVorlage')?.value;
    const { von, bis } = this._kampFenster(key);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let gesetzt = 0, ohneBp = 0;
    document.querySelectorAll('.kamp-datum').forEach(inp => {
      if (inp.value) return; // vorhandene Eingaben nicht überschreiben
      const g = this._kampGruppen[parseInt(inp.dataset.idx)];
      if (!g) return;
      const bsId = App.scalar('SELECT id FROM berufsschulen WHERE name=?', [g.schule]);
      const bpKws = bsId ? new Set(App.query('SELECT DISTINCT kalenderwoche FROM blockplan WHERE berufsschule_id=?', [bsId]).map(r => r.kalenderwoche)) : new Set();
      let treffer = null, ersterDienstag = null;
      for (let d = new Date(von); d <= bis; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 2) continue; // Dienstag
        if (!ersterDienstag) ersterDienstag = new Date(d);
        if (bpKws.has(App._isoKW(d))) { treffer = new Date(d); break; }
      }
      const wahl = treffer || ersterDienstag;
      if (!wahl) return;
      if (!treffer) ohneBp++;
      inp.value = iso(wahl);
      this._kampKw(inp);
      gesetzt++;
    });
    App.toast(gesetzt ? `${gesetzt} Datum(s) vorgeschlagen${ohneBp ? ` – ${ohneBp} ohne Blockplan-Treffer, bitte prüfen` : ''}` : 'Alle Zeilen haben bereits ein Datum', gesetzt ? 'success' : 'info');
  },
  _kampKw(inp) {
    const i = parseInt(inp.dataset.idx);
    const cell = document.getElementById('kampKw_' + i);
    if (!cell) return;
    if (!inp.value) { cell.textContent = '–'; return; }
    const kw = App._isoKW(new Date(inp.value + 'T12:00:00'));
    const g = this._kampGruppen[i];
    const bsId = App.scalar('SELECT id FROM berufsschulen WHERE name=?', [g.schule]);
    let bp = '';
    if (bsId) {
      const n = App.scalar('SELECT COUNT(*) FROM blockplan WHERE berufsschule_id=? AND kalenderwoche=?', [bsId, kw]) || 0;
      bp = n ? ' · Blockplan ✓' : ' · ⚠ kein Blockplan-Eintrag';
    }
    cell.textContent = 'KW ' + kw + bp;
  },
  _kampAnlegen() {
    const key = document.getElementById('kampVorlage')?.value;
    const v = key !== 'lehrjahre' ? this._kontrollVorlagen().find(x => x.key === key) : null;
    const pr = [...document.querySelectorAll('.chk-kamp-pr:checked')].map(c => c.value).join(', ');
    if (!pr) return App.toast('Mindestens einen Prüfer wählen', 'error');
    const daten = [...document.querySelectorAll('.kamp-datum')]
      .map(inp => ({ idx: parseInt(inp.dataset.idx), datum: inp.value })).filter(x => x.datum);
    if (!daten.length) return App.toast('Bei mindestens einer Schule ein Datum eintragen', 'error');
    let angelegt = 0;
    daten.forEach(({ idx, datum }) => {
      const g = this._kampGruppen[idx];
      if (!g || !g.schueler.length) return;
      const bsId = App.scalar('SELECT id FROM berufsschulen WHERE name=?', [g.schule]) || null;
      const titel = (v ? v.titel : 'Berichtsheftkontrolle') + ' – ' + g.schule;
      App.run('INSERT INTO kontrolltermine (klasse_id, jahrgang_id, berufsschule_id, geplant_datum, pruefer, bemerkung, typ, status) VALUES (?,?,?,?,?,?,?,?)',
        [null, (v && v.jgIds.length === 1) ? v.jgIds[0] : null, bsId, datum, pr, titel, 'schulkontrolle', 'geplant']);
      const newId = App.scalar('SELECT id FROM kontrolltermine WHERE rowid=last_insert_rowid()');
      if (!newId) return;
      // EXAKT die Azubis dieses Standorts – als Einzel-Zuordnung, keine
      // Klassen-Verknüpfung (die zöge LFK-Abwesende und andere Standorte mit)
      g.schueler.forEach(s => App.run('INSERT OR IGNORE INTO kontrolltermin_schueler (kontrolltermin_id, schueler_id) VALUES (?,?)', [newId, s.id]));
      angelegt++;
    });
    App.invalidateTerminCache();
    App.closeModal();
    Views.planung();
    App.toast(`${angelegt} Schultermin(e) angelegt – je Schule mit genau den dort anwesenden Azubis`, 'success');
  },

  // ── Weitergabe an fremde Ämter: Ergebnisse je zuständigem Amt bündeln ──
  fremdeAemter(terminId) {
    const alle = App.getTerminSchueler(terminId);
    const fremde = alle.filter(s => (s.zustaendiges_amt || '') !== '' && s.zustaendiges_amt !== App.EIGENES_AMT);
    if (!fremde.length) return App.toast('Keine Azubis fremder Ämter in diesem Termin', 'info');
    const nachAmt = {};
    fremde.forEach(s => { (nachAmt[s.zustaendiges_amt] = nachAmt[s.zustaendiges_amt] || []).push(s); });
    App.openModal('Ergebnisse an zuständige Ämter weitergeben', `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:10px;line-height:1.6">
        Diese Azubis wurden bei uns mitkontrolliert, gehören aber in die Zuständigkeit anderer
        Ausbildungsberater. Je Amt lassen sich die <strong>Durchsichtsbögen (PDF)</strong> und eine
        <strong>Übergabeliste (Excel)</strong> erzeugen; „✉︎ Übergabeschreiben" öffnet die fertige
        E-Mail (Textbaustein „Übergabe an anderes Amt", E-Mail-Adresse des Amts wird gemerkt) –
        PDF/Excel dann als Anhang hinzufügen.
      </div>
      ${Object.keys(nachAmt).sort().map(amt => {
        const liste = nachAmt[amt];
        return `<div class="card" style="margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>§ ${esc(App.amtLabel(amt))}</strong>
            <span style="font-size:11px;color:var(--clr-text-light)">${liste.length} Azubi(s)</span>
            <span style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-sm btn-secondary" onclick="PlanungHandler.exportAmtPDF(${terminId},'${esc(amt)}')">Bögen (PDF)</button>
              <button class="btn btn-sm btn-secondary" onclick="PlanungHandler.exportAmtExcel(${terminId},'${esc(amt)}')">Liste (Excel)</button>
              <button class="btn btn-sm btn-primary" onclick="Workflows.emailAmtUebergabe(${terminId},'${esc(amt)}')">✉︎ Übergabeschreiben</button>
            </span>
          </div>
          <div style="font-size:11px;margin-top:4px;color:var(--clr-text)">${liste.map(s => esc(s.nachname + ', ' + s.vorname)).join(' · ')}</div>
        </div>`;
      }).join('')}
    `, `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>`);
  },
  _amtTerminInfo(terminId) {
    const termin = App.query('SELECT * FROM kontrolltermine WHERE id=?', [terminId])[0];
    if (!termin) return null;
    const klassen = App.getTerminKlassen(terminId);
    const ortBs = App.getTerminSchule(terminId);
    termin.schule = ortBs ? ortBs.name : (klassen.length ? klassen[0].schule : '');
    termin.klassenbezeichnung = klassen.map(k => k.klassenbezeichnung).join(' + ');
    termin.fachrichtung = '';
    termin.lehrjahr = '';
    return termin;
  },
  exportAmtPDF(terminId, amt) {
    const termin = this._amtTerminInfo(terminId);
    if (!termin) return;
    const liste = App.getTerminSchueler(terminId).filter(s => s.zustaendiges_amt === amt);
    if (!liste.length) return App.toast('Keine Azubis für dieses Amt', 'warning');
    PDFExport.generateBatch(d => d, termin, terminId, liste);
  },
  exportAmtExcel(terminId, amt) {
    if (typeof XLSX === 'undefined') return App.toast('Excel-Bibliothek nicht geladen', 'error');
    const termin = this._amtTerminInfo(terminId);
    if (!termin) return;
    const liste = App.getTerminSchueler(terminId).filter(s => s.zustaendiges_amt === amt);
    if (!liste.length) return App.toast('Keine Azubis für dieses Amt', 'warning');
    const rows = liste.map(s => {
      const ke = App.query('SELECT * FROM kontrollergebnisse WHERE kontrolltermin_id=? AND schueler_id=?', [terminId, s.id])[0] || {};
      const kl = App.query('SELECT k.klassenbezeichnung, bs.name as schule FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [s.klasse_id])[0] || {};
      const betrieb = s.betrieb_id ? (App.scalar('SELECT name FROM betriebe WHERE id=?', [s.betrieb_id]) || '') : (s.ausbildungsstaette || '');
      return {
        'Nachname': s.nachname, 'Vorname': s.vorname,
        'Zuständiges Amt': App.amtLabel(s.zustaendiges_amt),
        'Betrieb': betrieb, 'Stammschule': kl.schule || '', 'Klasse': kl.klassenbezeichnung || '',
        'Kontrolliert am': formatDate(termin.durchgefuehrt_datum || termin.geplant_datum),
        'Kontrollort': termin.schule || '',
        'Ergebnis': ke.ergebnis || '(noch nicht erfasst)',
        'Fehltage': ke.fehltage_gesamt ?? '', 'Bemerkung': ke.bemerkung || '',
        'Prüfer': termin.pruefer || '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:16},{wch:14},{wch:30},{wch:26},{wch:22},{wch:14},{wch:12},{wch:20},{wch:16},{wch:8},{wch:30},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Übergabe Amt ' + amt);
    XLSX.writeFile(wb, App.safeFilename(['Uebergabe', 'Amt ' + amt, termin.schule, (termin.durchgefuehrt_datum || termin.geplant_datum || '').substring(0, 10)], 'xlsx'));
  }
};
