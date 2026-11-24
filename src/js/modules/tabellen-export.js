// ═══════════════════════════════════════════════════════════════════
//  Export an jeder Tabelle
//  Unter jeder Liste steht eine schmale Leiste „n Zeilen · Excel · Kopieren“.
//  Exportiert wird immer die AKTUELLE AUSWAHL: angehakte Zeilen, sonst alle
//  sichtbaren (gefilterten, gesuchten) Zeilen in der Reihenfolge am Bildschirm.
//
//  Zwei Wege:
//  • Tabellen mit data-export="<art>" (Stammdaten, Termine, Wiedervorlagen)
//    liefern eine vollständige Liste aus der Datenbank – z. B. Betriebe als
//    Adressliste mit Straße, PLZ, Ort in eigenen Spalten.
//  • Jede andere Tabelle wird so exportiert, wie sie am Bildschirm steht.
//
//  Abschalten: data-kein-export an der Tabelle oder einem Vorfahren.
// ═══════════════════════════════════════════════════════════════════
const TabellenExport = {
  // Tabellen ohne eigene Datenquelle bekommen die Leiste erst ab so vielen Zeilen
  MIN_ZEILEN: 3,
  // Die Startseite zeigt nur Auszüge – dort bleibt es ruhig
  AUS_ANSICHTEN: ['dashboard'],

  EXPORTE: {
    betriebe:       { titel: 'Betriebe', datei: 'Betriebe_Adressliste', einheit: ['Betrieb', 'Betriebe'], knopf: 'Excel-Adressliste', mail: true },
    schulen:        { titel: 'Berufsschulen', datei: 'Berufsschulen', einheit: ['Berufsschule', 'Berufsschulen'], mail: true },
    klassen:        { titel: 'Klassen', datei: 'Klassen', einheit: ['Klasse', 'Klassen'] },
    jahrgaenge:     { titel: 'Jahrgänge', datei: 'Jahrgaenge', einheit: ['Jahrgang', 'Jahrgänge'] },
    pruefer:        { titel: 'Prüfer', datei: 'Pruefer', einheit: ['Prüfer', 'Prüfer'] },
    azubis:         { titel: 'Azubis', datei: 'Azubi-Liste', einheit: ['Azubi', 'Azubis'] },
    termine:        { titel: 'Termine', datei: 'Termine', einheit: ['Termin', 'Termine'] },
    wiedervorlagen: { titel: 'Wiedervorlagen', datei: 'Wiedervorlagen', einheit: ['Wiedervorlage', 'Wiedervorlagen'] },
  },

  // ───────────────────────── Datenquellen ─────────────────────────
  _in(ids) { return (ids || []).map(Number).filter(n => Number.isFinite(n)).join(',') || 'NULL'; },
  // Zeilen in der Reihenfolge der Kennungen (= Reihenfolge am Bildschirm)
  _geordnet(rows, ids) {
    const m = new Map(rows.map(r => [Number(r.id), r]));
    return (ids || []).map(id => m.get(Number(id))).filter(Boolean);
  },
  _d(iso) { return iso ? formatDate(String(iso).slice(0, 10)) : ''; },
  // Globale Filter (Beruf, Jahrgang) für die Azubi-Zahlen – wie in den Listen
  _gf(alias) {
    const fr = (App.filterFachrichtungen || []), jg = (App.filterJahrgang || []);
    return (fr.length ? ` AND ${alias}.fachrichtung_id IN (${this._in(fr)})` : '') + (jg.length ? ` AND ${alias}.jahrgang_id IN (${this._in(jg)})` : '');
  },
  _betriebName(b) { return ((b.vorname ? b.vorname + ' ' : '') + (b.name || '')).trim(); },

  // Blätter [{ name, kopf, zeilen }] für eine Art; ids = Kennungen in
  // Bildschirm-Reihenfolge, null = alles, was der aktuelle Filter zeigt
  blaetter(art, ids) {
    const fn = this['_' + art];
    if (typeof fn !== 'function') throw new Error('Unbekannte Export-Art: ' + art);
    return fn.call(this, ids);
  },

  _betriebe(ids) {
    const inn = this._in(ids);
    const rows = this._geordnet(App.query(`SELECT b.*,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.betrieb_id=b.id AND sq.aktiv=1${this._gf('sq')}) AS azubis
      FROM betriebe b WHERE b.id IN (${inn})`), ids);
    const ausb = App.query(`SELECT * FROM ausbilder WHERE betrieb_id IN (${inn}) ORDER BY nachname, vorname`);
    const jeBetrieb = new Map();
    ausb.forEach(a => { const l = jeBetrieb.get(Number(a.betrieb_id)) || []; l.push(a); jeBetrieb.set(Number(a.betrieb_id), l); });
    const aName = (a) => [a.vorname, a.nachname].filter(Boolean).join(' ');
    const blatt1 = {
      name: 'Betriebe',
      kopf: ['Betriebsnummer', 'Betrieb', 'Zusatzbezeichnung', 'Firma', 'Ansprechpartner', 'Straße', 'PLZ', 'Ort', 'Telefon', 'Fax', 'E-Mail', 'Aktive Azubis', 'Ausbilder', 'E-Mail (Ausbilder)'],
      zeilen: rows.map(b => {
        const al = jeBetrieb.get(Number(b.id)) || [];
        return [b.betriebsnummer || '', this._betriebName(b), b.zusatzbezeichnung || '', b.firma || '', b.ansprechpartner || '', b.strasse || '', String(b.plz || ''), b.ort || '',
          b.telefon || '', b.fax || '', b.email || '', b.azubis || 0, al.map(aName).filter(Boolean).join('; '), [...new Set(al.map(a => (a.email || '').trim()).filter(Boolean))].join('; ')];
      }),
    };
    const blatt2 = {
      name: 'Ausbilder',
      kopf: ['Betrieb', 'Ort', 'Nachname', 'Vorname', 'Funktion', 'Telefon', 'Mobil', 'E-Mail'],
      zeilen: rows.flatMap(b => (jeBetrieb.get(Number(b.id)) || []).map(a => [this._betriebName(b), b.ort || '', a.nachname || '', a.vorname || '', a.funktion || '', a.telefon || '', a.mobil || '', a.email || ''])),
    };
    const azubis = App.query(`SELECT s.*, k.klassenbezeichnung, bs.name AS schule, j.bezeichnung AS jahrgang,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') AS fachrichtung
      FROM schueler s LEFT JOIN klassen k ON s.klasse_id=k.id LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id LEFT JOIN fachrichtungen f ON s.fachrichtung_id=f.id
      WHERE s.aktiv=1 AND s.betrieb_id IN (${inn})${this._gf('s')} ORDER BY s.nachname, s.vorname`);
    const azJe = new Map();
    azubis.forEach(s => { const l = azJe.get(Number(s.betrieb_id)) || []; l.push(s); azJe.set(Number(s.betrieb_id), l); });
    const blatt3 = {
      name: 'Azubis',
      kopf: ['Betrieb', 'Ort', 'Nachname', 'Vorname', 'Fachrichtung', 'Jahrgang', 'Berufsschule', 'Klasse', 'Ausbildungsbeginn', 'Ausbildungsende', 'Telefon', 'E-Mail'],
      zeilen: rows.flatMap(b => (azJe.get(Number(b.id)) || []).map(s => [this._betriebName(b), b.ort || '', s.nachname || '', s.vorname || '', s.fachrichtung || '', s.jahrgang || '',
        s.schule || '', s.klassenbezeichnung || '', this._d(s.ausbildungsbeginn), this._d(s.ausbildungsende), s.telefon || '', s.email || ''])),
    };
    return [blatt1, blatt2, blatt3].filter((b, i) => i === 0 || b.zeilen.length);
  },

  _schulen(ids) {
    const inn = this._in(ids);
    const rows = this._geordnet(App.query(`SELECT bs.*,
      (SELECT COUNT(*) FROM klassen kq WHERE kq.berufsschule_id=bs.id${this._gf('kq')}) AS klassen_cnt,
      (SELECT COUNT(*) FROM schueler sq JOIN klassen kq ON sq.klasse_id=kq.id WHERE kq.berufsschule_id=bs.id AND sq.aktiv=1${this._gf('sq')}) AS azubis
      FROM berufsschulen bs WHERE bs.id IN (${inn})`), ids);
    const blatt1 = {
      name: 'Berufsschulen',
      kopf: ['Berufsschule', 'Ort', 'Ansprechpartner', 'Telefon', 'E-Mail', 'E-Mail (CC)', 'Klassen', 'Aktive Azubis'],
      zeilen: rows.map(r => [r.name || '', r.ort || '', r.ansprechpartner || '', r.telefon || '', r.email || '', r.email_cc || '', r.klassen_cnt || 0, r.azubis || 0]),
    };
    const blatt2 = {
      name: 'Ansprechpartner',
      kopf: ['Berufsschule', 'Ort', 'Name', 'Rolle', 'Telefon', 'Mobil', 'E-Mail'],
      zeilen: rows.flatMap(r => {
        let l = []; try { l = JSON.parse(r.ansprechpartner_json || '[]') || []; } catch(e) { l = []; }
        return (Array.isArray(l) ? l : []).filter(a => a && a.name).map(a => [r.name || '', r.ort || '', a.name || '', a.rolle || '', a.telefon || '', a.mobil || '', a.email || '']);
      }),
    };
    const kl = App.query(`SELECT k.id FROM klassen k JOIN berufsschulen bs ON k.berufsschule_id=bs.id LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      WHERE k.berufsschule_id IN (${inn})${this._gf('k')} ORDER BY bs.name, j.jahr DESC, k.klassenbezeichnung`).map(k => k.id);
    const blatt3 = Object.assign(this._klassen(kl)[0], { name: 'Klassen' });
    return [blatt1, blatt2, blatt3].filter((b, i) => i === 0 || b.zeilen.length);
  },

  _klassen(ids) {
    const rows = this._geordnet(App.query(`SELECT k.*, bs.name AS schule, bs.ort AS schule_ort, j.bezeichnung AS jahrgang,
      CASE WHEN f.typ='Fachwerker' THEN 'FW: ' ELSE '' END || COALESCE(f.bezeichnung,'') AS fachrichtung,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.klasse_id=k.id AND sq.aktiv=1) AS aktiv_cnt,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.klasse_id=k.id) AS gesamt_cnt
      FROM klassen k LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN fachrichtungen f ON k.fachrichtung_id=f.id LEFT JOIN abschlussjahrgaenge j ON k.jahrgang_id=j.id
      WHERE k.id IN (${this._in(ids)})`), ids);
    return [{
      name: 'Klassen',
      kopf: ['Berufsschule', 'Ort', 'Jahrgang', 'Lehrjahr', 'Fachrichtung', 'Bezeichnung', 'Azubis aktiv', 'Azubis gesamt'],
      zeilen: rows.map(r => [r.schule || '', r.schule_ort || '', r.jahrgang || '', r.lehrjahr || '', r.fachrichtung || '', r.klassenbezeichnung || '', r.aktiv_cnt || 0, r.gesamt_cnt || 0]),
    }];
  },

  _jahrgaenge(ids) {
    const fr = (App.filterFachrichtungen || []);
    const bg = fr.length ? ` AND sq.fachrichtung_id IN (${this._in(fr)})` : '';
    const rows = this._geordnet(App.query(`SELECT j.*,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.jahrgang_id=j.id AND sq.aktiv=1${bg}) AS aktiv_cnt,
      (SELECT COUNT(*) FROM schueler sq WHERE sq.jahrgang_id=j.id${bg}) AS gesamt_cnt
      FROM abschlussjahrgaenge j WHERE j.id IN (${this._in(ids)})`), ids);
    return [{
      name: 'Jahrgänge',
      kopf: ['Bezeichnung', 'Typ', 'Jahr', 'Prüfungstermin', 'Azubis aktiv', 'Azubis gesamt'],
      zeilen: rows.map(r => [r.bezeichnung || '', r.typ || '', r.jahr || '', this._d(r.pruefungstermin), r.aktiv_cnt || 0, r.gesamt_cnt || 0]),
    }];
  },

  _pruefer(ids) {
    const rows = this._geordnet(App.query(`SELECT * FROM pruefer WHERE id IN (${this._in(ids)})`), ids);
    return [{
      name: 'Prüfer',
      kopf: ['Name', 'E-Mail', 'Telefon', 'Status'],
      zeilen: rows.map(r => [r.name || '', r.email || '', r.telefon || '', r.aktiv ? 'Aktiv' : 'Inaktiv']),
    }];
  },

  // Azubi-Liste: die ganze gefilterte Liste (nicht nur die Seite), mit Auswahl nur die angehakten
  _azubis(ids) {
    const d = StammdatenTab._azubiExportDaten(ids);
    const blaetter = [{ name: 'Azubis', kopf: d.kopf, zeilen: d.zeilen }];
    if (d.filter && d.filter.length) blaetter.push({ name: 'Filter-Info', kopf: ['Aktive Filter'], zeilen: [...d.filter.map(l => [l]), [''], ['Anzahl: ' + d.zeilen.length], ['Exportiert am ' + new Date().toLocaleString('de-DE')]], ohneFilter: true });
    return blaetter;
  },

  _termine(ids) {
    const rows = this._geordnet(App.query(`SELECT kt.*,
      (SELECT COUNT(*) FROM kontrollergebnisse ke WHERE ke.kontrolltermin_id=kt.id AND ke.ergebnis != '') AS bewertet
      FROM kontrolltermine kt WHERE kt.id IN (${this._in(ids)})`), ids);
    const status = { geplant: 'Geplant', durchgefuehrt: 'Durchgeführt', abgesagt: 'Abgesagt' };
    const tag = (iso) => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''); } catch(e) { return ''; } };
    return [{
      name: 'Termine',
      kopf: ['Datum', 'KW', 'Wochentag', 'Art', 'Ort', 'Stadt', 'Klassen', 'Fachrichtung', 'Jahrgang', 'Azubis', 'Bewertet', 'Prüfer', 'Status', 'Stand', 'Durchgeführt am', 'Nachbereitet am', 'Archiviert am', 'Bemerkung'],
      zeilen: rows.map(t => {
        const kl = App.getTerminKlassen(t.id) || [];
        const bs = App.getTerminSchule(t.id);
        let stand = ''; try { stand = (App.terminKette(t) || {}).label || ''; } catch(e) {}
        return [this._d(t.geplant_datum), getKW(t.geplant_datum), tag(t.geplant_datum), t.typ === 'einsendung' ? 'Einsendung / Einzeltermin' : 'Schultermin',
          bs ? (bs.name || '') : (kl.length ? kl[0].schule : ''), bs ? (bs.ort || '') : (kl.length ? (kl[0].schule_ort || '') : ''),
          kl.map(k => k.klassenbezeichnung).filter(Boolean).join(' + '), [...new Set(kl.map(k => k.fachrichtung).filter(Boolean))].join(', '), [...new Set(kl.map(k => k.jg_bez).filter(Boolean))].join(', '),
          App.getTerminSchuelerCount(t.id) || 0, t.bewertet || 0, t.pruefer || '', status[t.status] || t.status || '', stand,
          this._d(t.durchgefuehrt_datum), this._d(t.nachbereitet_am), this._d(t.archiviert_am), t.bemerkung || ''];
      }),
    }];
  },

  _wiedervorlagen(ids) {
    const rows = this._geordnet(App.query(`SELECT w.*, s.nachname, s.vorname, s.ausbildungsstaette, b.name AS b_name, b.vorname AS b_vorname, b.email AS b_email, b.telefon AS b_tel,
      k.klassenbezeichnung, bs.name AS schule, j.bezeichnung AS jahrgang, kt.geplant_datum, kt.durchgefuehrt_datum
      FROM wiedervorlagen w JOIN schueler s ON w.schueler_id=s.id
      LEFT JOIN betriebe b ON s.betrieb_id=b.id LEFT JOIN klassen k ON s.klasse_id=k.id LEFT JOIN berufsschulen bs ON k.berufsschule_id=bs.id
      LEFT JOIN abschlussjahrgaenge j ON s.jahrgang_id=j.id
      LEFT JOIN kontrollergebnisse ke ON w.kontrollergebnis_id=ke.id LEFT JOIN kontrolltermine kt ON ke.kontrolltermin_id=kt.id
      WHERE w.id IN (${this._in(ids)})`), ids);
    const status = { offen: 'Offen', ueberfaellig: 'Überfällig', erledigt: 'Erledigt' };
    return [{
      name: 'Wiedervorlagen',
      kopf: ['Nachname', 'Vorname', 'Betrieb', 'E-Mail (Betrieb)', 'Telefon (Betrieb)', 'Berufsschule', 'Klasse', 'Jahrgang', 'Art', 'Frist', 'Status', 'Mahnstufe', 'Anschreiben am', 'Versandart', 'Erledigt am', 'Erledigt-Bemerkung', 'Durchsicht am', 'Angelegt am'],
      zeilen: rows.map(w => [w.nachname || '', w.vorname || '', w.b_name ? this._betriebName({ name: w.b_name, vorname: w.b_vorname }) : (w.ausbildungsstaette || ''), w.b_email || '', w.b_tel || '',
        w.schule || '', w.klassenbezeichnung || '', w.jahrgang || '', wvArtLabel(w.art), w.frist_datum ? this._d(w.frist_datum) : App.wvFristText(w), status[w.status] || w.status || '',
        w.mahnstufe || 0, this._d(w.versand_datum), w.versand_art || '', this._d(w.erledigt_datum), w.erledigt_bemerkung || '', this._d(w.durchgefuehrt_datum || w.geplant_datum), this._d(w.erstellt_am)]),
    }];
  },

  // E-Mail-Adressen einer Art (Betriebe, Berufsschulen) – für das Bcc-Feld
  emailAdressen(art, ids) {
    const tab = { betriebe: 'betriebe', schulen: 'berufsschulen' }[art];
    if (!tab) return { adressen: [], ohne: 0 };
    const rows = this._geordnet(App.query(`SELECT id, email FROM ${tab} WHERE id IN (${this._in(ids)})`), ids);
    const adressen = [], gesehen = new Set(); let ohne = 0;
    rows.forEach(r => {
      const teile = String(r.email || '').split(/[;,\s]+/).map(x => x.trim()).filter(x => x.includes('@'));
      if (!teile.length) { ohne++; return; }
      teile.forEach(a => { const k = a.toLowerCase(); if (!gesehen.has(k)) { gesehen.add(k); adressen.push(a); } });
    });
    return { adressen, ohne };
  },

  // ───────────────────────── Tabelle am Bildschirm ─────────────────────────
  _sichtbar(el) { try { return !el.hidden && el.offsetParent !== null; } catch(e) { return true; } },
  // Datenzeilen [{ tr, gruppe }]: sichtbare Zeilen; eine Zeile aus einer
  // einzigen überspannenden Zelle ist eine Gruppenüberschrift (oder ein Leertext)
  _zeilenDom(t) {
    const out = []; let gruppe = '';
    [...t.tBodies].forEach(tb => [...tb.rows].forEach(tr => {
      if (!this._sichtbar(tr)) return;
      const c = tr.cells;
      if (!c.length) return;
      if (c.length === 1 && c[0].colSpan > 1) { gruppe = this._zellText(c[0]); return; }
      out.push({ tr, gruppe });
    }));
    return out;
  },
  _haken(tr) {
    const c = tr.cells[0] && tr.cells[0].querySelector('input[type="checkbox"]');
    return !!(c && c.checked);
  },
  _id(tr) {
    let v = tr.dataset.id;
    if (v == null || v === '') { const c = tr.cells[0] && tr.cells[0].querySelector('input[type="checkbox"]'); v = c ? c.value : null; }
    const n = Number(v);
    return v != null && v !== '' && Number.isFinite(n) ? n : null;
  },
  _text(node) {
    let out = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (tag === 'BUTTON' || tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'DATALIST') return;
      if (n.classList.contains('aktionen-menue') || n.classList.contains('tab-export')) return;
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'INPUT') {
        const typ = (n.type || '').toLowerCase();
        if (typ === 'checkbox') out += n.checked ? 'ja' : 'nein';
        else if (typ === 'radio') out += n.checked ? (n.value || 'ja') : '';
        else if (typ !== 'hidden' && typ !== 'button' && typ !== 'submit') out += n.value || '';
        return;
      }
      if (tag === 'SELECT') { const o = n.selectedOptions && n.selectedOptions[0]; out += o ? o.textContent : ''; return; }
      if (tag === 'TEXTAREA') { out += n.value || ''; return; }
      // Kurzlinks „Mail“ / „Tel“: die Adresse bzw. Nummer steht nur im Verweis
      if (tag === 'A') {
        const m = /^(mailto|tel):([^?]+)/i.exec(n.getAttribute('href') || '');
        if (m) {
          let ziel = m[2]; try { ziel = decodeURIComponent(ziel); } catch(e) {}
          const sicht = this._text(n);
          out += sicht.includes(ziel) ? sicht : ' ' + ziel + ' ';
          return;
        }
      }
      const block = /^(DIV|P|LI|UL|OL|TABLE|TR|H[1-6]|DETAILS|SUMMARY)$/.test(tag);
      const t = this._text(n);
      out += block ? '\n' + t + '\n' : t;
    });
    return out;
  },
  _zellText(td) {
    return this._text(td).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
  },
  _wert(text) {
    return /^-?(0|[1-9]\d{0,10})$/.test(text) ? Number(text) : text;
  },
  // Tabelle, wie sie am Bildschirm steht: Kopf + Zeilen ohne Auswahl- und Aktionsspalten
  _ansicht(t, zeilen) {
    const kopfZeile = t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : null;
    const spalten = [];
    if (kopfZeile) [...kopfZeile.cells].forEach(th => {
      const nurHaken = !!th.querySelector('input[type="checkbox"]');
      const label = nurHaken ? '' : this._zellText(th).replace(/[▲▼]/g, '').trim();
      for (let i = 0; i < (th.colSpan || 1); i++) spalten.push({ label, weg: nurHaken || /^(Aktion|Aktionen|Export)$/i.test(label) });
    });
    const breite = Math.max(spalten.length, ...zeilen.map(z => z.tr.cells.length));
    while (spalten.length < breite) spalten.push({ label: '', weg: false });
    const roh = zeilen.map(z => [...z.tr.cells].map(td => this._zellText(td)));
    // Spalten ohne Überschrift nur behalten, wenn Text drinsteht (nicht bloß Symbole wie die Ampel)
    spalten.forEach((s, i) => { if (!s.weg && !s.label && !roh.some(r => /[0-9A-Za-zÄÖÜäöüß]/.test(r[i] || ''))) s.weg = true; });
    const idx = spalten.map((s, i) => s.weg ? -1 : i).filter(i => i >= 0);
    const mitGruppe = zeilen.some(z => z.gruppe);
    return {
      kopf: [...(mitGruppe ? ['Gruppe'] : []), ...idx.map(i => spalten[i].label || `Spalte ${i + 1}`)],
      zeilen: roh.map((r, n) => [...(mitGruppe ? [zeilen[n].gruppe] : []), ...idx.map(i => this._wert(r[i] || ''))]),
    };
  },
  // Überschrift der Tabelle für Dateiname und Blatt
  _titel(t) {
    if (t.dataset.exportTitel) return t.dataset.exportTitel;
    const txt = (el) => el ? this._zellText(el).replace(/[?✕×]/g, '').trim() : '';
    const teile = [];
    const modal = t.closest('#modalContent');
    if (modal) teile.push(txt(modal.querySelector('.modal-header h3, .modal-header h2, h3')));
    else {
      const mc = document.getElementById('mainContent');
      teile.push(txt(mc && mc.querySelector('.page-header h2')));
      const tab = mc && mc.querySelector('.tab-btn.active');
      if (tab) teile.push(txt(tab));
      const karte = t.closest('.card');
      const kopf = karte && karte.querySelector('.card-header');
      if (kopf) teile.push(txt(kopf));
    }
    const sauber = [...new Set(teile.map(x => x.split(' · ')[0].trim()).filter(Boolean))].map(x => x.length > 40 ? x.slice(0, 40) : x);
    return sauber.join(' ') || 'Tabelle';
  },

  // Zählt, was ein Export jetzt enthielte (ohne Datenbankzugriff)
  zaehlen(t) {
    const zeilen = this._zeilenDom(t);
    const gew = zeilen.filter(z => this._haken(z.tr));
    const ex = this.EXPORTE[t.dataset.export];
    let anzahl = gew.length || zeilen.length;
    if (ex && !gew.length && t.dataset.exportAnzahl != null) anzahl = parseInt(t.dataset.exportAnzahl, 10) || 0;
    return { anzahl, auswahl: gew.length > 0, ex, zeilen: zeilen.length };
  },
  _kennungen(t) {
    const zeilen = this._zeilenDom(t);
    const gew = zeilen.filter(z => this._haken(z.tr));
    return { ids: (gew.length ? gew : zeilen).map(z => this._id(z.tr)).filter(x => x != null), auswahl: gew.length > 0, zeilen, gew };
  },
  // Alles, was ein Export braucht: { titel, datei, blaetter, anzahl, auswahl, einheit }
  daten(t) {
    const art = t.dataset.export, ex = this.EXPORTE[art];
    const k = this._kennungen(t);
    if (ex) {
      // Seitenweise Listen (Azubis): ohne Auswahl die ganze gefilterte Liste
      const alles = !k.auswahl && t.dataset.exportAlle != null;
      const blaetter = this.blaetter(art, alles ? null : k.ids);
      return { art, titel: ex.titel, datei: ex.datei, blaetter, anzahl: blaetter[0].zeilen.length, auswahl: k.auswahl, einheit: ex.einheit };
    }
    const titel = this._titel(t);
    const a = this._ansicht(t, k.auswahl ? k.gew : k.zeilen);
    return { art: '', titel, datei: titel, blaetter: [{ name: titel, kopf: a.kopf, zeilen: a.zeilen }], anzahl: a.zeilen.length, auswahl: k.auswahl, einheit: ['Zeile', 'Zeilen'] };
  },

  // ───────────────────────── Ausgaben ─────────────────────────
  _blattName(name, vergeben) {
    let n = String(name || 'Tabelle').replace(/[\\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Tabelle';
    let i = 2; const basis = n;
    while (vergeben.has(n.toLowerCase())) { const z = ' ' + i++; n = basis.slice(0, 31 - z.length) + z; }
    vergeben.add(n.toLowerCase());
    return n;
  },
  // Arbeitsmappe aus Blättern: Spaltenbreiten nach Inhalt, Autofilter auf der Kopfzeile
  mappe(blaetter) {
    const wb = XLSX.utils.book_new();
    const vergeben = new Set();
    blaetter.forEach(b => {
      const ws = XLSX.utils.aoa_to_sheet([b.kopf, ...b.zeilen]);
      ws['!cols'] = b.kopf.map((h, i) => ({ wch: Math.min(60, Math.max(String(h).length, ...b.zeilen.slice(0, 300).map(r => String(r[i] == null ? '' : r[i]).length), 6) + 2) }));
      if (b.zeilen.length && !b.ohneFilter) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: b.zeilen.length, c: b.kopf.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws, this._blattName(b.name, vergeben));
    });
    return wb;
  },
  _text_tsv(b) {
    const z = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
    return [b.kopf, ...b.zeilen].map(r => r.map(z).join('\t')).join('\n');
  },
  _anzahlText(d) {
    return `${d.anzahl} ${d.anzahl === 1 ? d.einheit[0] : d.einheit[1]}${d.auswahl ? ' (Auswahl)' : ''}`;
  },

  // format: 'xlsx' | 'kopie' | 'mail'
  ausfuehren(t, format) {
    try {
      if (format === 'mail') return this._mailKopieren(t);
      const d = this.daten(t);
      if (!d.anzahl) return App.toast('Keine Zeilen zum Exportieren', 'warning');
      if (format === 'kopie') return App.kopieren(this._text_tsv(d.blaetter[0]), `${this._anzahlText(d)} kopiert – in Excel oder Word mit Strg+V einfügen`);
      const datei = App.safeFilename([d.datei, d.auswahl ? 'Auswahl' : '', todayStr()], 'xlsx');
      XLSX.writeFile(this.mappe(d.blaetter), datei);
      App.toast(`${this._anzahlText(d)} als Excel exportiert`, 'success');
    } catch(e) {
      try { console.error('[Export]', e); } catch(_) {}
      App.toast('Export fehlgeschlagen: ' + (e && e.message ? e.message : e), 'error');
    }
  },
  _mailKopieren(t) {
    const art = t.dataset.export, ex = this.EXPORTE[art];
    if (!ex || !ex.mail) return;
    const k = this._kennungen(t);
    const r = this.emailAdressen(art, k.ids);
    if (!r.adressen.length) return App.toast('Keine E-Mail-Adressen in dieser Auswahl', 'warning');
    return App.kopieren(r.adressen.join('; '), `${r.adressen.length} E-Mail-Adresse${r.adressen.length === 1 ? '' : 'n'} kopiert${r.ohne ? ` (${r.ohne} ohne Adresse)` : ''} – im E-Mail-Programm ins Feld „Bcc“ einfügen`);
  },
  // Aufruf aus Auswahl-Leisten: TabellenExport.fuer('betriebe', 'xlsx')
  fuer(art, format) {
    const t = document.querySelector(`#mainContent table[data-export="${art}"]`);
    if (!t) return App.toast('Diese Liste ist gerade nicht geöffnet', 'warning');
    return this.ausfuehren(t, format || 'xlsx');
  },

  // ───────────────────────── Leiste unter der Tabelle ─────────────────────────
  _leisteHtml(ex) {
    const knopf = ex && ex.knopf ? ex.knopf : 'Excel';
    return `<span class="te-zahl" aria-live="polite"></span>
      <button type="button" class="btn btn-sm btn-secondary te-btn" data-te="xlsx" title="Als Excel-Datei speichern: angehakte Zeilen, sonst alle angezeigten">⬇ ${knopf}</button>
      <button type="button" class="btn btn-sm btn-secondary te-btn" data-te="kopie" title="In die Zwischenablage kopieren – in Excel, Word oder eine E-Mail einfügen">▤ Kopieren</button>
      ${ex && ex.mail ? '<button type="button" class="btn btn-sm btn-secondary te-btn" data-te="mail" title="E-Mail-Adressen der Auswahl kopieren – für das Bcc-Feld einer Rundmail">✉︎ E-Mail-Adressen</button>' : ''}`;
  },
  _ausgeschlossen(t) {
    if (t.dataset.keinExport != null || t.closest('[data-kein-export]')) return true;
    if (t.closest('#mainContent') && this.AUS_ANSICHTEN.includes(App.currentView)) return true;
    return false;
  },
  _leiste(t) {
    let bar = t._teLeiste;
    if (bar && !bar.isConnected) bar = t._teLeiste = null;
    const z = this._ausgeschlossen(t) ? null : this.zaehlen(t);
    const zeigen = !!z && z.anzahl > 0 && (z.ex ? true : z.zeilen >= this.MIN_ZEILEN);
    if (!zeigen) { if (bar) { bar.remove(); t._teLeiste = null; } return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'tab-export';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Diese Tabelle exportieren');
      bar.innerHTML = this._leisteHtml(z.ex);
      bar._teTabelle = t;
      t.insertAdjacentElement('afterend', bar);
      t._teLeiste = bar;
    }
    const einheit = z.ex ? z.ex.einheit : ['Zeile', 'Zeilen'];
    const text = `${z.anzahl} ${z.anzahl === 1 ? einheit[0] : einheit[1]}${z.auswahl ? ' ausgewählt' : ''}`;
    const zahl = bar.querySelector('.te-zahl');
    if (zahl && zahl.textContent !== text) zahl.textContent = text;
    bar.classList.toggle('auswahl', z.auswahl);
  },
  anbringen() {
    try {
      const wurzeln = [document.getElementById('mainContent'), document.getElementById('modalContent')].filter(Boolean);
      wurzeln.forEach(w => {
        w.querySelectorAll('.tab-export').forEach(bar => { if (!bar._teTabelle || bar.previousElementSibling !== bar._teTabelle) bar.remove(); });
        w.querySelectorAll('table.data-table').forEach(t => this._leiste(t));
      });
    } catch(e) { try { console.warn('[Export] Leiste:', e); } catch(_) {} }
  },
  init() {
    if (this._init) return;
    this._init = true;
    try {
      if (typeof MutationObserver !== 'function' || !document.body || typeof document.body.addEventListener !== 'function') return;
      const plan = () => { if (this._t) return; this._t = setTimeout(() => { this._t = null; this.anbringen(); }, 80); };
      new MutationObserver(plan).observe(document.body, { childList: true, subtree: true });
      // Filter und Suche blenden Zeilen nur aus, Häkchen ändern die Auswahl – beides zählt neu
      ['change', 'input', 'click'].forEach(ev => document.addEventListener(ev, plan, true));
      document.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('.tab-export [data-te]') : null;
        if (!b) return;
        const bar = b.closest('.tab-export');
        const t = bar && (bar._teTabelle || bar.previousElementSibling);
        if (t) this.ausfuehren(t, b.dataset.te);
      });
      plan();
    } catch(e) {}
  },
};
