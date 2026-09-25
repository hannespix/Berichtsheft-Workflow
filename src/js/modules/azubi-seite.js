// ══════════════════════════════════════════════════════════════
//  AZUBI-SEITE: eine Seite je Azubi statt drei Dialoge
//  (Stammdaten bearbeiten, Ausbildungsverlauf, Akte). Die bisherigen
//  Editoren bleiben unverändert – sie zeichnen ihren Inhalt über
//  App.oeffneEditor() in einen Abschnitt dieser Seite, wenn sie offen ist,
//  sonst wie bisher in den Dialog. Dazu Kontrollen und Wiedervorlagen des
//  Azubis mit Absprung in die Durchsicht.
// ══════════════════════════════════════════════════════════════

const AzubiSeite = {
  _id: null,
  _springe: '',
  _zurueck: null,        // { terminId, schuelerId } – Rückweg in die Durchsicht
  _bearbeiten: false,    // Formulare (Stammdaten, Verlauf) nur auf Wunsch
  // Reihenfolge der Abschnitte: erst sehen, dann bearbeiten
  ABSCHNITTE: [
    ['uebersicht', 'Übersicht'],
    ['kontrollen', 'Kontrollen'],
    ['wiedervorlagen', 'Wiedervorlagen'],
    ['akte', 'Akte'],
    ['stammdaten', 'Stammdaten bearbeiten'],
    ['phasen', 'Ausbildungsverlauf bearbeiten'],
  ],
  NUR_BEARBEITEN: new Set(['stammdaten', 'phasen']),
  ERGEBNIS: { in_ordnung: 'In Ordnung', nachholung_naechste_durchsicht: 'Nachholung', sachberichte_wetter_email: 'E-Mail (Wetter)', berichte_bis_termin_email: 'E-Mail (Berichte)', persoenliche_vorlage_rp: 'Vorlage RP', post_an_rp: 'Post RP', beratung_betrieb: 'Beratungsgespräch (§ 76)' },

  // opts.zurueck = { terminId, schuelerId }: die Seite kam aus der Durchsicht
  // und führt dorthin zurück. Abschnitte „stammdaten“/„phasen“ als Sprungziel
  // schalten den Bearbeiten-Modus gleich ein.
  oeffnen(id, abschnitt, opts) {
    this._id = parseInt(id);
    this._springe = abschnitt || '';
    this._zurueck = (opts && opts.zurueck) || null;
    this._bearbeiten = this.NUR_BEARBEITEN.has(this._springe);
    try { App.uSet('azubi_id', String(this._id)); } catch(e) {}
    App.navigate('azubi');
  },
  bearbeiten(an) {
    this._bearbeiten = an == null ? !this._bearbeiten : !!an;
    this.render();
    if (this._bearbeiten) setTimeout(() => this.springe('stammdaten'), 60);
  },
  // Ist die Seite (für diesen Azubi) gerade zu sehen? Dann zeichnen die
  // Editoren in ihre Abschnitte statt in den Dialog.
  istOffen(id) {
    if (App.currentView !== 'azubi' || this._id == null) return false;
    if (id != null && Number(id) !== Number(this._id)) return false;
    return !!document.getElementById('azSeite');
  },
  zurueck() {
    const z = this._zurueck; this._zurueck = null;
    if (z && z.terminId) { this.kontrolleOeffnen(z.terminId, z.schuelerId); return; }
    App.navigate('stammdaten');
  },
  springe(abschnitt) {
    const el = document.getElementById('azAbschnitt_' + abschnitt);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  render() {
    const c = document.getElementById('mainContent');
    if (!c) return;
    if (this._id == null) { try { this._id = parseInt(App.uGet('azubi_id', '')) || null; } catch(e) {} }
    const s = this._id != null ? App.query('SELECT * FROM schueler WHERE id=?', [this._id])[0] : null;
    if (!s) { this._id = null; App.navigate('stammdaten'); return; }
    const klasse = s.klasse_id ? (App.query('SELECT k.klassenbezeichnung, bs.name AS schule FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id WHERE k.id=?', [s.klasse_id])[0] || null) : null;
    const jg = s.jahrgang_id ? App.scalar('SELECT bezeichnung FROM abschlussjahrgaenge WHERE id=?', [s.jahrgang_id]) : '';
    const fr = s.fachrichtung_id ? App.scalar('SELECT bezeichnung FROM fachrichtungen WHERE id=?', [s.fachrichtung_id]) : '';
    const ampel = App.getSchuelerAmpel(s.id);
    const nKe = App.scalar("SELECT COUNT(*) FROM kontrollergebnisse WHERE schueler_id=? AND ergebnis != ''", [s.id]) || 0;
    const nWv = App.scalar("SELECT COUNT(*) FROM wiedervorlagen WHERE schueler_id=? AND status IN ('offen','ueberfaellig')", [s.id]) || 0;
    const fehl = App.getFehltageGesamt(s.id).gesamt;
    const status = s.status || (s.aktiv ? 'aktiv' : 'inaktiv');
    const statusKlasse = status === 'aktiv' ? 'badge-ok' : 'badge-open';
    const meta = [s.ausbildungsstaette, klasse ? [klasse.klassenbezeichnung, klasse.schule].filter(Boolean).join(' · ') : '', jg ? 'Jahrgang ' + jg : '', fr].filter(Boolean);
    const zurueckText = this._zurueck && this._zurueck.terminId ? '‹ Zurück zur Durchsicht' : '‹ Azubi-Liste';
    const abschnitte = this.ABSCHNITTE.filter(([k]) => this._bearbeiten || !this.NUR_BEARBEITEN.has(k));
    c.innerHTML = `
      <div class="page-header kompakt">
        <div class="page-header-left"><button class="btn btn-secondary btn-sm" onclick="AzubiSeite.zurueck()" title="${esc(zurueckText.slice(2))}">${zurueckText}</button></div>
      </div>
      <div id="azSeite" class="az-seite${this._bearbeiten ? ' bearbeiten' : ''}" data-id="${s.id}">
        <div class="card az-kopf">
          <div class="az-titel">
            <span class="az-ampel" title="${esc(ampel.label || '')}">${ampel.icon || ''}</span>
            <h1>${esc(s.nachname)}, ${esc(s.vorname)}</h1>
            <span class="badge-status ${statusKlasse}">${esc(status)}</span>
            ${s.ibykus_id ? `<span class="az-ident" title="IBYKUS-Ident">${esc(s.ibykus_id)}</span>` : ''}
            <button class="btn btn-sm ${this._bearbeiten ? 'btn-primary' : 'btn-secondary'} az-bearbeiten" onclick="AzubiSeite.bearbeiten()" aria-pressed="${this._bearbeiten ? 'true' : 'false'}" title="Stammdaten und Ausbildungsverlauf bearbeiten">${this._bearbeiten ? '✓ Bearbeiten beenden' : '✎ Bearbeiten'}</button>
          </div>
          ${meta.length ? `<div class="az-meta">${meta.map(esc).join(' <span class="az-punkt">·</span> ')}</div>` : ''}
          <div class="az-zahlen">
            <button class="az-zahl" onclick="AzubiSeite.springe('kontrollen')"><strong>${nKe}</strong> Kontrollen</button>
            <button class="az-zahl${nWv ? ' offen' : ''}" onclick="AzubiSeite.springe('wiedervorlagen')"><strong>${nWv}</strong> offene Wiedervorlage${nWv === 1 ? '' : 'n'}</button>
            <span class="az-zahl statisch"><strong>${fehl}</strong> Fehltage</span>
          </div>
          <nav class="az-nav" aria-label="Abschnitte">
            ${abschnitte.map(([k, t]) => `<button class="btn btn-sm btn-secondary" onclick="AzubiSeite.springe('${k}')">${t}</button>`).join('')}
          </nav>
        </div>
        ${abschnitte.map(([k, t]) => `<section class="card az-teil" id="azAbschnitt_${k}" aria-labelledby="azTitel_${k}"><h2 id="azTitel_${k}">${t}</h2><div id="azTeil_${k}"></div></section>`).join('')}
      </div>`;
    this._uebersicht(s, { klasse, jg, fr, ampel, nKe, nWv, fehl });
    // Die bestehenden Editoren zeichnen in ihre Abschnitte (App.oeffneEditor)
    if (this._bearbeiten) {
      try { ImportHandler.editSchueler(s.id); } catch(e) { console.warn('Azubi-Seite: Stammdaten', e); }
      if (typeof Phasen !== 'undefined') { try { Phasen.openPhasenEditor(s.id); } catch(e) { console.warn('Azubi-Seite: Verlauf', e); } }
    }
    if (typeof SchuelerAkte !== 'undefined') { try { SchuelerAkte.open(s.id); } catch(e) { console.warn('Azubi-Seite: Akte', e); } }
    this._kontrollen(s);
    this._wiedervorlagen(s);
    if (this._springe) { const ziel = this._springe; this._springe = ''; setTimeout(() => this.springe(ziel), 60); }
  },

  // ── Übersicht: alles Wesentliche auf einen Blick, nichts zum Tippen ──
  _uebersicht(s, k) {
    const el = document.getElementById('azTeil_uebersicht');
    if (!el) return;
    const betrieb = s.betrieb_id ? App.query('SELECT * FROM betriebe WHERE id=?', [s.betrieb_id])[0] : null;
    const ausbilder = s.betrieb_id ? App.query('SELECT * FROM ausbilder WHERE betrieb_id=? ORDER BY nachname, vorname', [s.betrieb_id]) : [];
    const schule = k.klasse ? k.klasse : null;
    const letzte = App.query(`SELECT ke.ergebnis, kt.geplant_datum, kt.durchgefuehrt_datum FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE ke.schueler_id=? AND ke.ergebnis != '' ORDER BY kt.geplant_datum DESC LIMIT 1`, [s.id])[0];
    const zeile = (label, wert, opts = {}) => wert ? `<div class="az-zeile"><span class="az-label">${label}</span><span class="az-wert">${opts.roh ? wert : esc(wert)}</span></div>` : '';
    const link = (art, wert) => wert ? `<a href="${art}:${esc(String(wert).replace(/\s+/g, ''))}">${esc(wert)}</a>` : '';
    const alter = s.geburtsdatum && typeof Phasen !== 'undefined' ? Phasen.alterZuStichtag(s.geburtsdatum, new Date()) : null;
    const dauer = (s.regulaer_dauer_monate || 36) - (s.verkuerzung_monate || 0);
    const statusZeilen = [
      zeile('Status', s.status || (s.aktiv ? 'aktiv' : 'inaktiv')),
      s.inaktiv_datum ? zeile('Seit', formatDate(s.inaktiv_datum) + (s.inaktiv_grund ? ' · ' + s.inaktiv_grund : '')) : '',
      zeile('BAV-Status (IBYKUS)', s.bav_status),
      zeile('Zuständiges Amt', App.amtLabel ? App.amtLabel(s.zustaendiges_amt) : s.zustaendiges_amt),
      zeile('Prüfungserfolg', s.pruefungserfolg),
      s.ap_zugelassen || s.ap_bestanden ? zeile('Abschlussprüfung', [s.ap_zugelassen ? 'zugelassen' : '', s.ap_bestanden ? 'bestanden' : ''].filter(Boolean).join(', ')) : '',
    ].join('');
    el.innerHTML = `
      ${this._zeitstrahl(s)}
      <div class="az-spalten">
        <div class="az-spalte">
          <h3>Azubi</h3>
          ${zeile('Telefon', link('tel', s.telefon), { roh: true })}
          ${zeile('E-Mail', link('mailto', s.email), { roh: true })}
          ${zeile('Geburtsdatum', s.geburtsdatum ? formatDate(s.geburtsdatum) + (alter != null ? ` (${alter} Jahre)` : '') : '')}
          ${zeile('Geschlecht', s.geschlecht)}
          ${zeile('Schulabschluss', s.schulabschluss)}
          ${zeile('Ausbildungsdauer', `${dauer} Monate${s.verkuerzung_monate ? ` (verkürzt um ${s.verkuerzung_monate})` : ''}${s.vorzeitige_zulassung ? ' · vorzeitige Zulassung' : ''}`)}
          ${!s.telefon && !s.email && !s.geburtsdatum ? '<p class="az-leer">Keine Kontaktdaten hinterlegt.</p>' : ''}
        </div>
        <div class="az-spalte">
          <h3>Betrieb</h3>
          ${betrieb ? `
            ${zeile('Betrieb', [betrieb.name, betrieb.zusatzbezeichnung].filter(Boolean).join(' · '))}
            ${zeile('Anschrift', [betrieb.strasse, [betrieb.plz, betrieb.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))}
            ${zeile('Telefon', link('tel', betrieb.telefon), { roh: true })}
            ${zeile('E-Mail', link('mailto', betrieb.email), { roh: true })}
            ${zeile('Ansprechpartner', betrieb.ansprechpartner)}
            ${zeile('Betriebsnummer', betrieb.betriebsnummer)}
            ${ausbilder.map(a => zeile(esc(a.funktion) || 'Ausbilder', [a.vorname, a.nachname].filter(Boolean).join(' ') + [a.telefon, a.mobil, a.email].filter(Boolean).map(x => ' · ' + x).join(''))).join('')}
          ` : zeile('Ausbildungsstätte', s.ausbildungsstaette) || '<p class="az-leer">Kein Betrieb zugeordnet.</p>'}
        </div>
        <div class="az-spalte">
          <h3>Schule</h3>
          ${zeile('Berufsschule', schule ? schule.schule : '')}
          ${zeile('Klasse', schule ? schule.klassenbezeichnung : '')}
          ${zeile('Fachrichtung', k.fr)}
          ${zeile('Jahrgang', k.jg)}
          ${zeile('Landesfachklasse', s.landesfachklasse)}
          ${!schule ? '<p class="az-leer">Keine Klasse zugeordnet.</p>' : ''}
          <h3 class="az-h3-abstand">Kontrollstand</h3>
          ${zeile('Ampel', `${k.ampel.icon || ''} ${esc(k.ampel.label || '')}`, { roh: true })}
          ${letzte ? zeile('Letzte Kontrolle', `${formatDate(letzte.durchgefuehrt_datum || letzte.geplant_datum)} · ${this.ERGEBNIS[letzte.ergebnis] || letzte.ergebnis}`) : zeile('Letzte Kontrolle', 'noch keine')}
          ${zeile('Offene Mängel', String(k.ampel.offeneMaengel || 0) + ' Woche(n)')}
          ${zeile('Offene Wiedervorlagen', String(k.nWv))}
          ${zeile('Fehltage', String(k.fehl))}
          ${statusZeilen}
        </div>
      </div>`;
  },

  // ── Zeitstrahl: Ausbildung von Beginn bis Ende, Lehrjahre, Phasen, heute ──
  _zeitstrahl(s) {
    const beginn = App._parseDate(s.ausbildungsbeginn);
    if (!beginn) return '<p class="az-leer">Kein Ausbildungsbeginn hinterlegt – kein Zeitstrahl.</p>';
    let ende = App._parseDate(s.ausbildungsende);
    let phasenMit = [];
    if (typeof Phasen !== 'undefined') {
      try {
        const phasen = Phasen.getPhasen(s.id);
        if (phasen.length) {
          phasenMit = Phasen.phasenMitEnden(phasen, s.regulaer_dauer_monate || 36, s.verkuerzung_monate || 0);
          const e = Phasen.vertragsendeAusPhasen(phasenMit);
          if (e) ende = e;
        }
      } catch(e) {}
    }
    if (!ende) { ende = new Date(beginn); ende.setMonth(ende.getMonth() + ((s.regulaer_dauer_monate || 36) - (s.verkuerzung_monate || 0))); }
    const heute = new Date();
    const span = Math.max(1, ende - beginn);
    const pos = (d) => Math.min(100, Math.max(0, (d - beginn) / span * 100));
    const fortschritt = Math.round(pos(heute));
    const monate = Math.round((ende - beginn) / (30.44 * 86400000));
    // Lehrjahre: je zwölf Monate ab Beginn (letztes ggf. kürzer); Verkürzer
    // steigen im 2. (oder 3.) Lehrjahr ein – die Blöcke tragen das Lehrjahr,
    // nicht die Zählung ab Vertragsbeginn
    const ljInfo = App._lehrjahrInfo ? App._lehrjahrInfo(s.id) : { erstesAJ: 1 };
    const jahre = [];
    for (let j = 0, d = new Date(beginn); d < ende && j < 4; j++) {
      const bis = new Date(d); bis.setFullYear(bis.getFullYear() + 1);
      const b = bis < ende ? bis : ende;
      jahre.push({ nr: ljInfo.erstesAJ + j, links: pos(d), breite: pos(b) - pos(d) });
      d = bis;
    }
    const ajJetzt = App.getLehrjahr ? App.getLehrjahr(s.id) : App.getCurrentAJ(s.ausbildungsbeginn, s.id);
    const phasenHtml = phasenMit.map(p => {
      const von = Phasen.parseISO(p.von);
      const bisStr = p.bis || p._berechnetesEnde;
      const bis = bisStr ? Phasen.parseISO(bisStr) : ende;
      const l = pos(von), b = Math.max(0.5, pos(bis) - l);
      const art = p.typ !== 'ausbildung' ? 'pause' : ((p.teilzeit_prozent || 100) < 100 ? 'teilzeit' : 'voll');
      const titel = p.typ !== 'ausbildung' ? `Unterbrechung${p.grund ? ': ' + p.grund : ''}` : `${p.betrieb || 'Ausbildung'}${(p.teilzeit_prozent || 100) < 100 ? ` · Teilzeit ${p.teilzeit_prozent} %` : ''}`;
      return `<div class="az-phase ${art}" style="left:${l}%;width:${b}%" title="${esc(titel)} · ${esc(formatDate(p.von))} – ${esc(bisStr ? formatDate(bisStr) : 'offen')}"></div>`;
    }).join('');
    const vorbei = heute > ende, davor = heute < beginn;
    return `
      <div class="az-strahl" role="img" aria-label="Ausbildung vom ${esc(formatDate(s.ausbildungsbeginn))} bis ${esc(formatDate(Phasen && Phasen.fmtISO ? Phasen.fmtISO(ende) : ende))}, ${fortschritt} Prozent vergangen${ajJetzt ? `, Lehrjahr ${ajJetzt}` : ''}">
        <div class="az-strahl-kopf">
          <span><strong>Ausbildung</strong> ${esc(formatDate(s.ausbildungsbeginn))} – ${esc(formatDate(typeof Phasen !== 'undefined' ? Phasen.fmtISO(ende) : ende))} <span class="az-leer">(${monate} Monate${s.verkuerzung_monate ? ', verkürzt' : ''})</span></span>
          <span>${vorbei ? '<strong>beendet</strong>' : davor ? '<strong>beginnt erst</strong>' : `<strong>${fortschritt} %</strong>${ajJetzt ? ` · Lehrjahr ${ajJetzt}` : ''}`}</span>
        </div>
        <div class="az-strahl-balken">
          <div class="az-strahl-fortschritt" style="width:${fortschritt}%"></div>
          ${phasenHtml}
          ${jahre.map(j => `<div class="az-jahr${ajJetzt === j.nr ? ' aktuell' : ''}" style="left:${j.links}%;width:${j.breite}%"><span>${j.nr}. LJ</span></div>`).join('')}
          ${!vorbei && !davor ? `<div class="az-heute" style="left:${fortschritt}%" title="Heute"></div>` : ''}
        </div>
        ${phasenMit.length ? `<div class="az-strahl-legende"><span class="az-leg voll"></span> Vollzeit <span class="az-leg teilzeit"></span> Teilzeit <span class="az-leg pause"></span> Unterbrechung</div>` : ''}
      </div>`;
  },

  _kontrollen(s) {
    const el = document.getElementById('azTeil_kontrollen');
    if (!el) return;
    const rows = App.query(`SELECT ke.id, ke.kontrolltermin_id, ke.ergebnis, ke.anwesend, ke.geaendert_am, ke.zulassung_ap, ke.pruefungsausschuss,
        kt.geplant_datum, kt.durchgefuehrt_datum, kt.status AS kt_status, kt.bemerkung AS kt_bemerkung, bs.name AS schule
      FROM kontrollergebnisse ke JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id LEFT JOIN berufsschulen bs ON kt.berufsschule_id=bs.id
      WHERE ke.schueler_id=? ORDER BY kt.geplant_datum DESC, ke.id DESC`, [s.id]);
    if (!rows.length) { el.innerHTML = '<p class="az-leer">Noch keine Kontrolle zu diesem Azubi.</p>'; return; }
    el.innerHTML = `<table class="data-table az-tabelle"><thead><tr><th>Datum</th><th>Termin</th><th>Ergebnis</th><th>Vermerke</th><th></th></tr></thead><tbody>
      ${rows.map(r => {
        const erg = r.ergebnis ? `<span class="badge-status ${r.ergebnis === 'in_ordnung' ? 'badge-ok' : 'badge-open'}">${esc(this.ERGEBNIS[r.ergebnis] || r.ergebnis)}</span>` : (r.anwesend === 0 ? '<span class="az-leer">abwesend</span>' : '<span class="az-leer">offen</span>');
        const vermerke = [r.zulassung_ap === 1 ? 'Berichtsheft-Voraussetzung erfüllt (§ 43)' : '', r.pruefungsausschuss === 1 ? 'Prüfungsausschuss' : ''].filter(Boolean).join(', ');
        return `<tr><td>${esc(formatDate(r.durchgefuehrt_datum || r.geplant_datum))}</td><td>${esc([r.schule, r.kt_bemerkung].filter(Boolean).join(' · ') || ('Termin #' + r.kontrolltermin_id))}${r.kt_status === 'durchgefuehrt' ? ' <span class="az-leer">(abgeschlossen)</span>' : ''}</td><td>${erg}</td><td>${esc(vermerke) || '<span class="az-leer">–</span>'}</td>
          <td style="white-space:nowrap"><button class="btn btn-sm btn-secondary" onclick="AzubiSeite.kontrolleOeffnen(${r.kontrolltermin_id}, ${s.id})" title="Durchsicht dieses Termins öffnen">Öffnen</button></td></tr>`;
      }).join('')}
    </tbody></table>`;
  },
  _wiedervorlagen(s) {
    const el = document.getElementById('azTeil_wiedervorlagen');
    if (!el) return;
    const rows = App.query(`SELECT w.*, kt.geplant_datum FROM wiedervorlagen w LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id LEFT JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE w.schueler_id=? ORDER BY CASE w.status WHEN 'ueberfaellig' THEN 0 WHEN 'offen' THEN 1 ELSE 2 END, w.frist_datum DESC`, [s.id]);
    const beratungKnopf = typeof WiedervorlagenHandler !== 'undefined' && WiedervorlagenHandler.beratungAnlegen
      ? `<div style="margin:4px 0 8px"><button class="btn btn-sm btn-secondary" onclick="WiedervorlagenHandler.beratungAnlegen(${s.id})" title="Beratungsgespräch mit dem Ausbildungsbetrieb vormerken (§ 76 BBiG: Förderung durch Beratung) – als Wiedervorlage mit Einladungs-Vorlage">+ Beratungsgespräch Betrieb (§ 76)</button></div>` : '';
    if (!rows.length) { el.innerHTML = beratungKnopf + '<p class="az-leer">Keine Wiedervorlagen zu diesem Azubi.</p>'; return; }
    const statusText = { offen: 'offen', ueberfaellig: 'überfällig', erledigt: 'erledigt' };
    el.innerHTML = beratungKnopf + `<table class="data-table az-tabelle"><thead><tr><th>Frist</th><th>Art</th><th>Status</th><th>Aus Kontrolle</th><th>Erledigt</th><th></th></tr></thead><tbody>
      ${rows.map(w => `<tr><td>${esc(formatDate(w.frist_datum))}</td><td>${esc(this.ERGEBNIS[w.art] || w.art || '–')}</td>
        <td><span class="badge-status ${w.status === 'erledigt' ? 'badge-ok' : 'badge-open'}">${esc(statusText[w.status] || w.status)}</span>${w.mahnstufe ? ` <span class="az-leer">Mahnstufe ${w.mahnstufe}</span>` : ''}</td>
        <td>${esc(formatDate(w.geplant_datum) || '–')}</td><td>${esc(formatDate(w.erledigt_datum) || '–')}</td>
        <td style="white-space:nowrap">${typeof WiedervorlagenHandler !== 'undefined' && WiedervorlagenHandler.details ? `<button class="btn btn-sm btn-secondary" onclick="WiedervorlagenHandler.details(${w.id})">Details</button>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
  },
  // Durchsicht eines Termins mit diesem Azubi öffnen (wie der Absprung aus der Azubi-Liste)
  kontrolleOeffnen(terminId, schuelerId) {
    App.navigate('kontrolle');
    setTimeout(() => {
      const sel = document.getElementById('selKontrolltermin');
      if (sel) sel.value = terminId;
      KontrolleHandler.loadTermin(terminId);
      setTimeout(() => {
        const i = (KontrolleHandler.currentSchuelerList || []).findIndex(x => x.id === schuelerId);
        if (i >= 0) { KontrolleHandler.currentIndex = i; KontrolleHandler._viewMode = 'einzeln'; KontrolleHandler.enterSchüler(); }
      }, 200);
    }, 100);
  },
};
