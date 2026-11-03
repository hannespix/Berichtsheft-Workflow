// ═══════════════════════════════════════════════════════════════════
//  Brief-Editor: Briefe an die Betriebe als Vorschau im Briefbogen, jedes
//  automatisch erzeugte Element direkt im Brief änderbar (Anschrift,
//  Infoblock, Betreff, Text, Übersicht je Azubi, Grußformel, Unterschrift,
//  Anlagen, Fußzeile). Aus demselben Modell entstehen PDF, Word (.docx) und
//  ein E-Mail-Entwurf (.eml) mit dem Brief als Anhang – was im Editor steht,
//  steht in jeder Ausgabe.
//
//  Modell: Workflows._briefModell(g, t, isDone) → { anschrift, info[], betreff,
//  text, tabelle, gruss, unterschrift, anlagen, datenschutz, fusszeile, … }.
//  Entwürfe bleiben je Termin und Betrieb bis zum Neuladen der Seite erhalten
//  (BriefEditor._entwuerfe); „Zurücksetzen“ holt den automatischen Stand.
// ═══════════════════════════════════════════════════════════════════
const BriefEditor = {
  _entwuerfe: {},          // { terminId: { key: modell } }
  _stand: null,            // { terminId, keys[], aktiv, opts }
  ANHANG_WAHL: [['pdf', 'Brief als PDF'], ['docx', 'Brief als Word'], ['beide', 'PDF und Word'], ['keiner', 'ohne Brief-Anhang']],

  // ── Öffnen: alle Briefe des Termins (oder nur ohne E-Mail / ein Betrieb) ──
  oeffnen(terminId, opts) {
    const o = opts || {};
    const frisch = Workflows.briefModelle(terminId, o);
    if (!frisch.length) return App.toast('Keine passenden Betriebe für einen Brief', 'warning');
    const ablage = this._entwuerfe[terminId] || (this._entwuerfe[terminId] = {});
    frisch.forEach(m => { if (!ablage[m.key]) ablage[m.key] = m; });
    this._stand = {
      terminId, keys: frisch.map(m => m.key), aktiv: 0,
      opts: { anhang: App.uGet('brief_anhang', 'pdf'), boegen: App.uGet('brief_boegen', '1') !== '0' },
    };
    if (o.nurKey) this._stand.aktiv = 0;
    App.openModal('✎ Briefe an Betriebe', '<div id="bzInhalt"></div>', '<span id="bzFuss"></span>');
    const mc = document.getElementById('modalContent'); if (mc) mc.classList.add('modal-brief');
    this.zeichnen();
  },
  modelle() {
    const s = this._stand; if (!s) return [];
    const ablage = this._entwuerfe[s.terminId] || {};
    return s.keys.map(k => ablage[k]).filter(Boolean);
  },
  aktuell() { return this.modelle()[this._stand ? this._stand.aktiv : 0] || null; },
  geaendert(m) { return !!(m && m._geaendert); },

  // ── Oberfläche ──
  zeichnen() {
    const s = this._stand; if (!s) return;
    const ms = this.modelle(), m = this.aktuell();
    const box = document.getElementById('bzInhalt'); if (!box || !m) return;
    const o = s.opts;
    box.innerHTML = `<div class="bz">
      <div class="bz-leiste" role="toolbar" aria-label="Brief wählen und Ausgabe einstellen">
        <button class="btn btn-sm btn-secondary" onclick="BriefEditor.blaettern(-1)" ${s.aktiv <= 0 ? 'disabled' : ''} aria-label="Vorheriger Brief">‹</button>
        <select class="form-control bz-wahl" id="bzWahl" aria-label="Brief für Betrieb" onchange="BriefEditor.waehlen(+this.value)">
          ${ms.map((x, i) => `<option value="${i}" ${i === s.aktiv ? 'selected' : ''}>${i + 1}. ${esc(x.betriebName)} – ${x.email ? 'E-Mail' : 'Post'}${x._geaendert ? ' ✎' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-secondary" onclick="BriefEditor.blaettern(1)" ${s.aktiv >= ms.length - 1 ? 'disabled' : ''} aria-label="Nächster Brief">›</button>
        <span class="bz-an">${m.email ? `✉︎ ${esc(m.email)}${m.cc ? ` · CC ${esc(m.cc)}` : ''}` : '<span class="bz-warn">keine E-Mail – Versand per Post</span>'}</span>
        <span class="bz-abstand"></span>
        <label class="bz-opt">E-Mail-Anhang
          <select class="form-control" onchange="BriefEditor.option('anhang', this.value)">${this.ANHANG_WAHL.map(([k, l]) => `<option value="${k}" ${o.anhang === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        ${m.isDone ? `<label class="bz-opt"><input type="checkbox" ${o.boegen ? 'checked' : ''} onchange="BriefEditor.option('boegen', this.checked)"> Durchsichtsbögen anhängen</label>` : ''}
        <button class="btn btn-sm btn-secondary" onclick="BriefEditor.zuruecksetzen()" ${m._geaendert ? '' : 'disabled'} title="Alle Änderungen an diesem Brief verwerfen und den automatischen Text wiederherstellen">↺ Zurücksetzen</button>
      </div>
      <p class="bz-tipp">In den Brief klicken und tippen – jedes Feld ist änderbar. Änderungen gelten für diesen Brief und bleiben erhalten, bis die Seite neu geladen wird. Antworten der Betriebe gehen an <strong>${esc(App.antwortEmail() || 'die E-Mail der Sachbearbeitung')}</strong>.</p>
      <div class="bz-buehne">${this._blattHtml(m)}</div>
    </div>`;
    const fuss = document.getElementById('bzFuss');
    if (fuss) {
      const mitMail = ms.filter(x => x.email).length;
      fuss.innerHTML = `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
        <span class="bz-fussgruppe" role="group" aria-label="Dieser Brief">
          <span class="bz-fusslabel">Dieser Brief:</span>
          <button class="btn btn-sm btn-secondary" onclick="BriefEditor.pdf(false)">▤ PDF</button>
          <button class="btn btn-sm btn-secondary" onclick="BriefEditor.word(false)">✎ Word</button>
          <button class="btn btn-sm btn-secondary" onclick="BriefEditor.eml(false)" ${m.email ? '' : 'disabled title="Keine E-Mail-Adresse hinterlegt"'}>✉︎ E-Mail-Entwurf</button>
        </span>
        ${ms.length > 1 ? `<span class="bz-fussgruppe" role="group" aria-label="Alle Briefe">
          <span class="bz-fusslabel">Alle ${ms.length}:</span>
          <button class="btn btn-sm btn-primary" onclick="BriefEditor.pdf(true)">▤ PDF</button>
          <button class="btn btn-sm btn-primary" onclick="BriefEditor.word(true)">✎ Word</button>
          <button class="btn btn-sm btn-primary" onclick="BriefEditor.eml(true)" ${mitMail ? '' : 'disabled'} title="Je Betrieb mit E-Mail ein Outlook-Entwurf (.eml) mit dem Brief als Anhang, zusammen als ZIP">✉︎ ${mitMail} E-Mail-Entwürfe (ZIP)</button>
        </span>` : ''}`;
    }
  },
  // Ein änderbares Feld im Brief (nur Text, Zeilenumbrüche bleiben)
  _feld(pfad, wert, klasse, label, opts) {
    const o = opts || {};
    return `<${o.tag || 'div'} class="bz-feld ${klasse || ''}" contenteditable="plaintext-only" spellcheck="true" role="textbox" ${o.einzeilig ? '' : 'aria-multiline="true"'} aria-label="${esc(label)}" data-pfad="${esc(pfad)}" data-leer="${esc(o.leer || label)}" oninput="BriefEditor._eingabe(this)" onblur="BriefEditor._verlassen()">${esc(wert == null ? '' : String(wert))}</${o.tag || 'div'}>`;
  },
  _blattHtml(m) {
    const logo = document.querySelector && document.querySelector('img.topbar-logo--pos');
    const info = (m.info || []).map((z, i) => `<div class="bz-info-zeile ${i > 0 && m.info[i - 1].gruppe !== z.gruppe ? 'bz-info-gruppe' : ''}">
        ${this._feld(`info.${i}.label`, z.label, 'bz-info-label', 'Bezeichnung im Infoblock', { einzeilig: true, leer: 'Bezeichnung' })}
        <div class="bz-info-wert">${this._feld(`info.${i}.wert`, z.wert, '', z.label || 'Angabe im Infoblock', { leer: 'Angabe' })}${z.zusatz != null && z.zusatz !== '' ? this._feld(`info.${i}.zusatz`, z.zusatz, 'bz-info-zusatz', 'Zusatz', {}) : ''}</div>
        <button class="bz-mini" onclick="BriefEditor.infoWeg(${i})" aria-label="Zeile ${esc(z.label)} entfernen" title="Zeile entfernen">×</button>
      </div>`).join('');
    const tab = m.tabelle;
    const tabelle = tab ? `<div class="bz-tabelle-box">
        <table class="bz-tabelle"><thead><tr>${tab.kopf.map((k, c) => `<th>${this._feld(`tabelle.kopf.${c}`, k, '', 'Spaltenkopf', { einzeilig: true })}</th>`).join('')}<th class="bz-tab-aktion"><span class="sr-only">Zeile</span></th></tr></thead>
        <tbody>${tab.zeilen.map((z, r) => `<tr>${z.map((w, c) => `<td>${this._feld(`tabelle.zeilen.${r}.${c}`, w, '', `${tab.kopf[c] || 'Spalte'} ${r + 1}`)}</td>`).join('')}<td class="bz-tab-aktion"><button class="bz-mini" onclick="BriefEditor.zeileWeg(${r})" aria-label="Zeile ${r + 1} entfernen" title="Zeile entfernen">×</button></td></tr>`).join('')}</tbody></table>
        <div class="bz-tab-knoepfe"><button class="bz-mini bz-mini-text" onclick="BriefEditor.zeileHinzu()">+ Zeile</button><button class="bz-mini bz-mini-text" onclick="BriefEditor.tabelleWeg()">Übersicht entfernen</button></div>
      </div>` : (m.isDone ? `<div class="bz-tab-knoepfe"><button class="bz-mini bz-mini-text" onclick="BriefEditor.tabelleNeu()">+ Übersicht je Azubi</button></div>` : '');
    return `<div class="bz-blatt" lang="de">
      <div class="bz-logo">${logo && logo.src ? `<img src="${esc(logo.src)}" alt="Regierungspräsidium Freiburg">` : '<strong>Regierungspräsidium Freiburg</strong>'}</div>
      <div class="bz-oben">
        <div class="bz-links">
          ${this._feld('ruecksende', m.ruecksende, 'bz-ruecksende', 'Rücksendeangabe', { einzeilig: true })}
          ${this._feld('anschrift', m.anschrift, 'bz-anschrift', 'Anschrift', { leer: 'Anschrift (je Zeile eine Angabe)' })}
        </div>
        <div class="bz-rechts">
          ${this._feld('abteilung', m.abteilung, 'bz-abteilung', 'Abteilung')}
          <div class="bz-info">${info}</div>
          <button class="bz-mini bz-mini-text" onclick="BriefEditor.infoHinzu()">+ Zeile</button>
        </div>
      </div>
      ${this._feld('betreff', m.betreff, 'bz-betreff', 'Betreff')}
      ${this._feld('text', m.text, 'bz-text', 'Brieftext')}
      ${tabelle}
      ${this._feld('gruss', m.gruss, 'bz-gruss', 'Grußformel', { einzeilig: true, leer: 'Grußformel (leer = ohne)' })}
      <div class="bz-unterschrift" aria-hidden="true">Raum für die Unterschrift</div>
      ${this._feld('unterschrift', m.unterschrift, 'bz-name', 'Name unter der Unterschrift', { leer: 'Name' })}
      <div class="bz-anlagen"><div class="bz-anlagen-titel">Anlagen</div>${this._feld('anlagen', m.anlagen, '', 'Anlagen', { leer: 'keine Anlagen (je Zeile eine)' })}</div>
      <div class="bz-fusszeile">
        ${this._feld('datenschutz', m.datenschutz, 'bz-datenschutz', 'Datenschutzhinweis')}
        <div class="bz-seite">Seite 1 von 1</div>
        ${this._feld('fusszeile', m.fusszeile, 'bz-dienst', 'Fußzeile (Einträge mit | trennen)')}
      </div>
    </div>`;
  },
  _eingabe(el) {
    const m = this.aktuell(); if (!m || !el) return;
    // innerText hängt am Ende gern einen Umbruch an
    const wert = String(el.innerText || '').replace(/ /g, ' ').replace(/\n$/, '');
    this._setzen(m, el.getAttribute('data-pfad'), wert);
  },
  _verlassen() {
    // Auswahlliste und „Zurücksetzen“ zeigen den Änderungsstand
    const m = this.aktuell(); if (!m) return;
    const w = document.getElementById('bzWahl');
    if (w && w.options[this._stand.aktiv]) w.options[this._stand.aktiv].text = `${this._stand.aktiv + 1}. ${m.betriebName} – ${m.email ? 'E-Mail' : 'Post'}${m._geaendert ? ' ✎' : ''}`;
    const z = document.querySelector && document.querySelector('.bz-leiste button[onclick="BriefEditor.zuruecksetzen()"]');
    if (z) z.disabled = !m._geaendert;
  },
  // Pfad wie "info.2.wert" oder "tabelle.zeilen.0.1"
  _setzen(m, pfad, wert) {
    if (!m || !pfad) return false;
    const teile = String(pfad).split('.');
    let o = m;
    for (let i = 0; i < teile.length - 1; i++) { o = o[/^\d+$/.test(teile[i]) ? +teile[i] : teile[i]]; if (o == null) return false; }
    const k = teile[teile.length - 1];
    o[/^\d+$/.test(k) ? +k : k] = wert;
    m._geaendert = true;
    return true;
  },
  _neu() { this.zeichnen(); },
  waehlen(i) { if (!this._stand) return; this._stand.aktiv = Math.max(0, Math.min(this.modelle().length - 1, i)); this.zeichnen(); },
  blaettern(d) { if (this._stand) this.waehlen(this._stand.aktiv + d); },
  option(k, v) {
    const s = this._stand; if (!s) return;
    if (k === 'anhang') { s.opts.anhang = v; App.uSet('brief_anhang', v); }
    if (k === 'boegen') { s.opts.boegen = !!v; App.uSet('brief_boegen', v ? '1' : '0'); }
  },
  infoHinzu() { const m = this.aktuell(); if (!m) return; m.info.push({ label: 'Neu:', wert: '', gruppe: 9 }); m._geaendert = true; this._neu(); },
  infoWeg(i) { const m = this.aktuell(); if (!m) return; m.info.splice(i, 1); m._geaendert = true; this._neu(); },
  zeileHinzu() { const m = this.aktuell(); if (!m || !m.tabelle) return; m.tabelle.zeilen.push(m.tabelle.kopf.map(() => '')); m._geaendert = true; this._neu(); },
  zeileWeg(r) { const m = this.aktuell(); if (!m || !m.tabelle) return; m.tabelle.zeilen.splice(r, 1); m._geaendert = true; this._neu(); },
  tabelleWeg() { const m = this.aktuell(); if (!m) return; m.tabelle = null; m._geaendert = true; this._neu(); },
  tabelleNeu() { const m = this.aktuell(); if (!m) return; m.tabelle = { kopf: Workflows.BRIEF_TABELLE_KOPF.slice(), zeilen: [Workflows.BRIEF_TABELLE_KOPF.map(() => '')] }; m._geaendert = true; this._neu(); },
  async zuruecksetzen() {
    const s = this._stand, m = this.aktuell(); if (!s || !m) return;
    if (m._geaendert && !(await App.confirm('Alle Änderungen an diesem Brief verwerfen und den automatischen Text wiederherstellen?', { titel: 'Brief zurücksetzen', ok: 'Zurücksetzen', gefaehrlich: true }))) return;
    const neu = Workflows.briefModelle(s.terminId, { nurKey: m.key })[0];
    if (neu) this._entwuerfe[s.terminId][m.key] = neu;
    this.zeichnen();
  },

  // ── Ausgaben ──
  _auswahl(alle) { return alle ? this.modelle() : [this.aktuell()].filter(Boolean); },
  _dateiname(ms, ext) {
    const t = Workflows._ctxTermin(this._stand.terminId);
    const datum = t ? t.termin.geplant_datum : '';
    return ms.length === 1
      ? App.safeFilename(['Brief', ms[0].betriebName, datum], ext)
      : App.safeFilename(['Briefe_Betriebe', t ? t.ctx.schule : '', datum], ext);
  },
  pdf(alle) {
    const ms = this._auswahl(alle); if (!ms.length) return;
    try {
      App.downloadBlob(Workflows.briefPdfBytes(ms), this._dateiname(ms, 'pdf'), 'application/pdf');
      App.toast(ms.length === 1 ? 'Brief als PDF erstellt' : `PDF mit ${ms.length} Briefen erstellt`, 'success');
    } catch(e) { console.error('Brief-PDF:', e); App.toast('PDF konnte nicht erstellt werden: ' + (e.message || e), 'error'); }
  },
  word(alle) {
    const ms = this._auswahl(alle); if (!ms.length) return;
    try {
      App.downloadBlob(this.docxBytes(ms), this._dateiname(ms, 'docx'), App.EML_TYPEN.docx);
      App.toast(ms.length === 1 ? 'Brief als Word-Datei erstellt' : `Word-Datei mit ${ms.length} Briefen erstellt (je Brief ein Abschnitt)`, 'success');
    } catch(e) { console.error('Brief-Word:', e); App.toast('Word-Datei konnte nicht erstellt werden: ' + (e.message || e), 'error'); }
  },
  eml(alle) {
    const s = this._stand; if (!s) return;
    const ms = this._auswahl(alle).filter(m => m.email);
    if (!ms.length) return App.toast('Kein Betrieb mit E-Mail-Adresse – Brief als PDF oder Word ausgeben', 'warning');
    try {
      if (ms.length === 1) {
        App.downloadBlob(this.emlFuer(ms[0], s.opts), this._dateiname(ms, 'eml'), 'message/rfc822');
      } else {
        if (typeof PizZip === 'undefined') return App.toast('ZIP-Bibliothek nicht geladen', 'error');
        const zip = new PizZip();
        ms.forEach((m, i) => zip.file(App.safeFilename([String(i + 1).padStart(2, '0'), m.betriebName], 'eml'), this.emlFuer(m, s.opts)));
        const ohne = this.modelle().filter(m => !m.email);
        zip.file('LIESMICH.txt', [
          'E-Mail-Entwürfe der Berichtsheftkontrolle (Briefe an Betriebe)', '',
          `${ms.length} Entwürfe mit dem Brief als Anhang. Antworten gehen an ${App.antwortEmail() || 'die Sachbearbeitung'}.`,
          ohne.length ? `Ohne E-Mail (per Post): ${ohne.map(m => m.betriebName).join(', ')}` : '', '',
          '1. ZIP entpacken (Rechtsklick → „Alle extrahieren“).',
          '2. .eml-Datei doppelklicken: Outlook öffnet einen Entwurf mit Empfänger, Betreff, Text und Anhängen.',
          '3. Prüfen, „Senden“.',
        ].join('\r\n'));
        App.downloadBlob(zip.generate({ type: 'uint8array', compression: 'DEFLATE' }), this._dateiname(ms, 'zip'), 'application/zip');
      }
      ms.forEach(m => this._versandVermerken(m));
      App.toast(ms.length === 1 ? 'E-Mail-Entwurf erstellt – doppelklicken, in Outlook senden' : `${ms.length} E-Mail-Entwürfe als ZIP erstellt`, 'success', 8000);
    } catch(e) { console.error('Brief-E-Mail:', e); App.toast('E-Mail-Entwurf konnte nicht erstellt werden: ' + (e.message || e), 'error'); }
  },
  // Versandnachweis an den offenen Wiedervorlagen (Mängel/Nachholung)
  _versandVermerken(m) {
    if (!m || !m.isDone || (m.typ !== 'betrieb_maengel' && m.typ !== 'nachholung')) return;
    (m.keIds || []).forEach(keId => {
      App.query("SELECT id FROM wiedervorlagen WHERE kontrollergebnis_id=? AND status IN ('offen','ueberfaellig')", [keId])
        .forEach(w => Workflows.versandVermerken(w.id, 'email', m.typ === 'nachholung' ? 'nachholung' : 'wv_mahnung', 'Brief-Editor: Entwurf (.eml) erzeugt'));
    });
  },

  // ── E-Mail-Entwurf: Text des Briefs im Mailtext, Brief als Anhang,
  //    Antwort an das Funktionspostfach (Reply-To) ──
  mailText(m) {
    const zeilen = [String(m.text || '').replace(/\s+$/, '')];
    const tab = m.tabelle && m.tabelle.zeilen && m.tabelle.zeilen.length ? m.tabelle : null;
    if (tab) {
      zeilen.push('');
      tab.zeilen.forEach(z => {
        const teile = z.slice(1).map((w, i) => w && String(w).trim() ? `${tab.kopf[i + 1]}: ${w}` : '').filter(Boolean);
        zeilen.push(`  - ${z[0]}${teile.length ? ' – ' + teile.join(' · ') : ''}`);
      });
    }
    if (m.gruss) zeilen.push('', m.gruss);
    if (m.unterschrift) zeilen.push(m.unterschrift);
    const kontakt = ['Regierungspräsidium Freiburg', String(m.abteilung || '').split('\n')[0]].filter(Boolean);
    const antwort = App.antwortEmail();
    zeilen.push('', ...kontakt);
    if (antwort) zeilen.push(`E-Mail: ${antwort}`);
    const tel = (m.info || []).find(z => /^Telefon/i.test(z.label || ''));
    if (tel && tel.wert) zeilen.push(`Telefon: ${tel.wert}`);
    return zeilen.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
  },
  emlFuer(m, opts) {
    const o = opts || {};
    const anhaenge = [];
    const basis = App.safeFilename(['Schreiben', m.betriebName]);
    const art = o.anhang || 'pdf';
    if (art === 'pdf' || art === 'beide') anhaenge.push({ name: basis + '.pdf', bytes: Workflows.briefPdfBytes([m]) });
    if (art === 'docx' || art === 'beide') anhaenge.push({ name: basis + '.docx', bytes: this.docxBytes([m]) });
    if (m.isDone && o.boegen !== false && typeof PDFExport !== 'undefined' && PDFExport.bogenBytes) {
      (m.azubiIds || []).forEach(sid => {
        try { const b = PDFExport.bogenBytes(m.terminId, sid); if (b) anhaenge.push(b); } catch(e) { console.warn('Bogen für Anhang:', e); }
      });
    }
    return App.emlErzeugen({ to: m.email, cc: m.cc, subject: m.betreff, body: this.mailText(m), anhaenge });
  },

  // ── Word (.docx): eigener OOXML-Schreiber, je Brief ein Abschnitt mit
  //    eigener Seitenzählung („Seite x von y“ über SECTIONPAGES) ──
  _x(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
  _run(text, r) {
    const o = r || {};
    const pr = (o.b ? '<w:b/><w:bCs/>' : '') + (o.farbe ? `<w:color w:val="${o.farbe}"/>` : '') + (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '');
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${this._x(text)}</w:t></w:r>`;
  },
  _p(inhalt, p) {
    const o = p || {};
    const pr = (o.stil ? `<w:pStyle w:val="${o.stil}"/>` : '') + (o.keep ? '<w:keepNext/>' : '') + (o.tabs ? `<w:tabs>${o.tabs.map(t => `<w:tab w:val="left" w:pos="${t}"/>`).join('')}</w:tabs>` : '')
      + (o.rand ? '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="C8C4C0"/></w:pBdr>' : '')
      + `<w:spacing w:before="${o.vor || 0}" w:after="${o.nach || 0}"/>` + (o.einzug ? `<w:ind w:left="${o.einzug}"/>` : '') + (o.jc ? `<w:jc w:val="${o.jc}"/>` : '')
      + (o.sz ? `<w:rPr><w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/></w:rPr>` : '');
    return `<w:p><w:pPr>${pr}</w:pPr>${inhalt || ''}</w:p>`;
  },
  _feldCode(code) {
    return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  },
  _zelle(breite, inhalt, o) {
    const z = o || {};
    return `<w:tc><w:tcPr><w:tcW w:w="${breite}" w:type="dxa"/>${z.fuell ? `<w:shd w:val="clear" w:color="auto" w:fill="${z.fuell}"/>` : ''}</w:tcPr>${inhalt || this._p('')}</w:tc>`;
  },
  _tabelle(spalten, zeilen, rahmen) {
    const b = rahmen ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="C8C4C0"/><w:left w:val="single" w:sz="4" w:color="C8C4C0"/><w:bottom w:val="single" w:sz="4" w:color="C8C4C0"/><w:right w:val="single" w:sz="4" w:color="C8C4C0"/><w:insideH w:val="single" w:sz="4" w:color="C8C4C0"/><w:insideV w:val="single" w:sz="4" w:color="C8C4C0"/></w:tblBorders>'
      : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
    const mar = rahmen ? '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>' : '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
    return `<w:tbl><w:tblPr><w:tblW w:w="${spalten.reduce((a, c) => a + c, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${b}${mar}</w:tblPr><w:tblGrid>${spalten.map(c => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>${zeilen.join('')}</w:tbl>`;
  },
  _mm(mm) { return Math.round(mm * 56.693); },     // Millimeter → Twips
  _logoBytes() {
    const logo = Workflows._briefLogo();
    if (!logo || !logo.data || typeof atob !== 'function') return null;
    try {
      const m = String(logo.data).match(/^data:image\/(png|jpe?g);base64,(.*)$/);
      if (!m) return null;
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, ext: m[1] === 'png' ? 'png' : 'jpeg', ratio: logo.ratio || 4.14 };
    } catch(e) { return null; }
  },
  _docxBrief(m, i, letzter, logo) {
    const G = '6C6560';
    const L = (s) => String(s || '').split('\n');
    const teile = [];
    if (logo) {
      const cx = 52 * 36000, cy = Math.round(cx / logo.ratio);
      teile.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="200"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="Logo ${i + 1}" descr="Regierungspräsidium Freiburg"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="logo.${logo.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
    } else {
      teile.push(this._p(this._run('Regierungspräsidium Freiburg', { b: true, sz: 24 }), { nach: 200 }));
    }
    // Kopf: links Rücksendeangabe + Anschrift, rechts Abteilung + Infoblock
    const links = this._p(this._run(L(m.ruecksende)[0] || '', { sz: 13, farbe: G }), { nach: 160 })
      + L(m.anschrift).filter(z => z.trim()).map(z => this._p(this._run(z, { sz: 22 }))).join('');
    let rechts = L(m.abteilung).map(z => this._p(this._run(z, { b: true, sz: 17 }))).join('');
    let gruppe = null;
    (m.info || []).forEach((z, k) => {
      if (!String(z.wert || '').trim() && !String(z.label || '').trim()) return;
      const vor = k === 0 ? 160 : (gruppe !== null && z.gruppe !== gruppe ? 100 : 0);
      gruppe = z.gruppe;
      const werte = L(z.wert);
      // Lange Werte (E-Mail, Schulname) kleiner statt umbrochen – wie im PDF
      const sz = (w) => String(w || '').length > 30 ? 14 : String(w || '').length > 24 ? 16 : 18;
      rechts += this._p(this._run(z.label, { sz: 14, farbe: G }) + '<w:r><w:tab/></w:r>' + this._run(werte[0], { sz: sz(werte[0]) }), { tabs: [this._mm(24)], vor, einzug: 0 });
      werte.slice(1).forEach(w => { rechts += this._p('<w:r><w:tab/></w:r>' + this._run(w, { sz: sz(w) }), { tabs: [this._mm(24)] }); });
      if (z.zusatz) rechts += this._p('<w:r><w:tab/></w:r>' + this._run(z.zusatz, { sz: 15 }), { tabs: [this._mm(24)] });
    });
    teile.push(this._tabelle([this._mm(96), this._mm(64)], [`<w:tr>${this._zelle(this._mm(96), links)}${this._zelle(this._mm(64), rechts)}</w:tr>`], false));
    // Betreff, Text (Einrückung der Vorlage bleibt), Übersicht
    teile.push(this._p(this._run(m.betreff, { b: true, sz: 22 }), { vor: 480, nach: 240 }));
    L(m.text).forEach(z => {
      if (!z.trim()) { teile.push(this._p('', { sz: 12 })); return; }
      const einzug = (z.match(/^\s*/) || [''])[0].length;
      teile.push(this._p(this._run(z.trim()), { einzug: einzug ? this._mm(Math.min(einzug, 8) * 1.1) : 0, nach: 20 }));
    });
    const tab = m.tabelle && m.tabelle.zeilen && m.tabelle.zeilen.length ? m.tabelle : null;
    if (tab) {
      const sp = [46, 62, 34, 18].map(x => this._mm(x));
      const breite = (c) => sp[c] || sp[sp.length - 1];
      const zelle = (w, c, kopf) => this._zelle(breite(c), this._p(this._run(w, { b: kopf, sz: 17 }), { jc: c === 3 ? 'right' : '' }), kopf ? { fuell: 'F2F0EF' } : {});
      teile.push(this._p('', { vor: 80 }));
      teile.push(this._tabelle(sp, [
        `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tab.kopf.map((k, c) => zelle(k, c, true)).join('')}</w:tr>`,
        ...tab.zeilen.map(z => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${z.map((w, c) => zelle(w, c, false)).join('')}</w:tr>`),
      ], true));
    }
    // Grußformel, Raum für die Unterschrift, Name, Anlagen
    if (String(m.gruss || '').trim()) {
      teile.push(this._p(this._run(m.gruss), { vor: 280, keep: true }));
      teile.push(this._p('', { keep: true }), this._p('', { keep: true }), this._p('', { keep: true }));
    } else teile.push(this._p('', { vor: 200 }));
    L(m.unterschrift).filter(z => z.trim()).forEach(z => teile.push(this._p(this._run(z.trim()))));
    const anlagen = L(m.anlagen).map(z => z.trim()).filter(Boolean);
    if (anlagen.length) {
      teile.push(this._p(this._run('Anlagen', { b: true, sz: 17 }), { vor: 240, keep: true }));
      anlagen.forEach(z => teile.push(this._p(this._run(z))));
    }
    const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdF${i + 1}"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${this._mm(12)}" w:right="${this._mm(25)}" w:bottom="${this._mm(36)}" w:left="${this._mm(25)}" w:header="${this._mm(10)}" w:footer="${this._mm(8)}" w:gutter="0"/><w:pgNumType w:start="1"/></w:sectPr>`;
    if (letzter) return { body: teile.join(''), sect };
    return { body: teile.join('') + `<w:p><w:pPr>${sect}</w:pPr></w:p>`, sect: '' };
  },
  _docxFuss(m) {
    const G = '6C6560';
    const eintraege = String(m.fusszeile || '').split('|').map(z => z.trim()).filter(Boolean);
    const spalten = [0, 1, 2].map(sp => eintraege.slice(sp * 2, sp * 2 + 2).map(z => this._p(this._run(z, { sz: 13, farbe: G }))).join('') || this._p(''));
    const sw = [this._mm(62), this._mm(56), this._mm(42)];
    return `<w:ftr ${this.NS}>`
      + this._p(this._run(m.datenschutz || '', { sz: 14, farbe: G }), { nach: 60 })
      + this._p(this._run('Seite ', { sz: 15, farbe: G }) + this._feldCode('PAGE').replace(/<w:r>/g, `<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="${G}"/></w:rPr>`) + this._run(' von ', { sz: 15, farbe: G }) + this._feldCode('SECTIONPAGES').replace(/<w:r>/g, `<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="${G}"/></w:rPr>`), { jc: 'right', rand: true, nach: 60 })
      + this._tabelle(sw, [`<w:tr>${spalten.map((c, k) => this._zelle(sw[k], c)).join('')}</w:tr>`], false)
      + this._p('')
      + '</w:ftr>';
  },
  NS: 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
  // Alle Briefe als eine .docx-Datei (Uint8Array)
  docxBytes(modelle) {
    if (typeof PizZip === 'undefined') throw new Error('ZIP-Bibliothek nicht geladen');
    const ms = (modelle || []).filter(Boolean);
    if (!ms.length) throw new Error('Kein Brief');
    const logo = this._logoBytes();
    const zip = new PizZip();
    const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      ...ms.map((m, i) => `<Override PartName="/word/footer${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`),
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '</Types>'].join('');
    zip.file('[Content_Types].xml', ct);
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
    const jetzt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${this._x(ms.length === 1 ? ms[0].betreff : 'Briefe an Betriebe')}</dc:title><dc:creator>Regierungspräsidium Freiburg</dc:creator><dc:language>de-DE</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${jetzt}</dcterms:created></cp:coreProperties>`);
    zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:color w:val="1E1E1E"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`);
    const rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      ...(logo ? [`<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${logo.ext}"/>`] : []),
      ...ms.map((m, i) => `<Relationship Id="rIdF${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer${i + 1}.xml"/>`),
      '</Relationships>'];
    zip.file('word/_rels/document.xml.rels', rels.join(''));
    if (logo) zip.file(`word/media/logo.${logo.ext}`, logo.bytes);
    let body = '', sect = '';
    ms.forEach((m, i) => {
      const r = this._docxBrief(m, i, i === ms.length - 1, logo);
      body += r.body; if (r.sect) sect = r.sect;
      zip.file(`word/footer${i + 1}.xml`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + this._docxFuss(m));
    });
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${this.NS}><w:body>${body}${sect}</w:body></w:document>`);
    return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
  },
};
