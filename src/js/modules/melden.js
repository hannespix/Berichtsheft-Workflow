// ══════════════════════════════════════════════════════════════
//  PROBLEM MELDEN
//  Eine Meldung besteht aus: Beschreibung, automatisch gesammeltem
//  Zustandsbild, Konsolenprotokoll und optional einem Bildschirmfoto.
//
//  Ablage: _bhk/meldungen/<zeit>_<rechner>/meldung.json (+ bild.png).
//  NICHT in der Chatdatei – Chrome kopiert beim Anhängen die ganze Datei,
//  ein Bild darin würde jede weitere Nachricht über die Leitung schleppen.
//  NICHT in der Datenbank – sie soll nicht wieder wachsen.
//
//  Datenschutz: Alles Übertragene läuft durch App.schwaerzen() und wird
//  vor dem Absenden in einer bearbeitbaren Vorschau gezeigt. Automatische
//  Löschung nach MELDUNG_TAGE.
// ══════════════════════════════════════════════════════════════

const Melden = {
  ORDNER: 'meldungen',
  MELDUNG_TAGE: 60,
  BILD_MAX_BYTES: 4 * 1024 * 1024,
  PROTOKOLL_ZEILEN: 150,
  PRUEF_TAKT_MS: 300000,   // höchstens alle 5 Minuten im Ordner nachsehen
  _bild: null,        // { bytes: Uint8Array, typ, name, vorschau }
  _meldungen: [],
  _letztePruefung: 0,

  // ── Zustellweg: Zähler in der Kopfzeile ──
  _uKey() { return 'meldungen_gesehen_' + (App._dbSlug ? App._dbSlug() : 'db'); },
  _gesehen() { return App.uGet ? (App.uGet(this._uKey(), '') || '') : ''; },
  _gesehenSetzen(stand) { if (App.uSet) App.uSet(this._uKey(), stand || ''); },
  neue() {
    const stand = this._gesehen();
    return (this._meldungen || []).filter(m => String(m.zeitpunkt || '') > stand);
  },
  _badge() {
    const el = document.getElementById('meldungBadge');
    if (!el) return;
    const n = this.neue().length;
    el.style.display = n ? '' : 'none';
    el.innerHTML = `⚑ <strong>${n}</strong> Meldung${n === 1 ? '' : 'en'}`;
    el.title = `${n} neue Fehlermeldung(en) – klicken zum Ansehen`;
  },
  // Hängt am Abgleich-Takt, sieht aber höchstens alle PRUEF_TAKT_MS nach
  async pruefeNeue(erzwingen) {
    if (!App.bhkDirHandle || App.offlineModus || App._netzWeg) return 0;
    if (!erzwingen && Date.now() - this._letztePruefung < this.PRUEF_TAKT_MS) return 0;
    this._letztePruefung = Date.now();
    try { await this.liste(); } catch(e) { return 0; }
    this._badge();
    return this.neue().length;
  },
  async uebersicht() {
    await this.pruefeNeue(true);
    const liste = this._meldungen || [];
    App.openModal('⚑ Fehlermeldungen', `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
        Meldungen aus <code>_bhk/${esc(this.ORDNER)}/</code>. „Alle als Textdatei" fasst sie für die Weitergabe an die Entwicklung zusammen; Bildschirmfotos liegen als eigene Dateien in den jeweiligen Ordnern.
      </div>
      ${this._tabelle(liste)}`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-secondary" onclick="Melden.oeffnen()">⚑ Selbst melden</button>
       ${liste.length ? `<button class="btn btn-secondary" style="color:var(--clr-red)" onclick="Melden.alleLoeschen()">Alle löschen (${liste.length})</button>` : ''}
       <button class="btn btn-primary" onclick="Melden.kopiereAlle()">▤ Alle kopieren</button>
       <button class="btn btn-secondary" onclick="Melden.exportAlle()">Alle als Textdatei</button>`);
    if (typeof _makeModalWide === 'function') _makeModalWide();
    if (liste.length) this._gesehenSetzen(String(liste[0].zeitpunkt || ''));
    this._badge();
  },
  _tabelle(liste) {
    const stand = this._gesehen();
    return liste.length ? `<table class="data-table"><thead><tr><th>Zeitpunkt</th><th>Von</th><th>Version</th><th>Beschreibung</th><th>Bild</th><th>Aktionen</th></tr></thead><tbody>
      ${liste.map(m => `<tr${String(m.zeitpunkt || '') > stand ? ' style="font-weight:600"' : ''}>
        <td style="white-space:nowrap">${esc(new Date(m.zeitpunkt).toLocaleString('de-DE'))}</td>
        <td>${esc(m.von || '–')}</td><td>${esc(m.version || '')}</td>
        <td>${esc(String(m.beschreibung || '').slice(0, 90))}${String(m.beschreibung || '').length > 90 ? '…' : ''}</td>
        <td>${m.bild ? '✓' : '–'}</td>
        <td class="btn-group" style="white-space:nowrap">
          <button class="btn btn-sm btn-secondary" onclick="Melden.anzeigen('${esc(m._ordner)}')">Ansehen</button>
          <button class="btn btn-sm btn-secondary" onclick="Melden.kopiereEine('${esc(m._ordner)}')" title="Text dieser Meldung in die Zwischenablage">▤</button>
          <button class="btn btn-sm" style="color:var(--clr-red)" onclick="Melden.loeschen('${esc(m._ordner)}')">Löschen</button>
        </td></tr>`).join('')}
    </tbody></table>` : `<div style="font-size:12px;color:var(--clr-text-light)">Keine Meldungen vorhanden.</div>`;
  },
  // Weg 3: per E-Mail an die hinterlegte Adresse (Bild muss von Hand angehängt werden)
  meldungsEmail() { try { return App.scalar("SELECT wert FROM einstellungen WHERE schluessel='meldung_email'") || ''; } catch(e) { return ''; } },
  perEmail(m) {
    const ziel = this.meldungsEmail();
    const text = this.alsText(m || this.bauen(this._formular()));
    const betreff = `Berichtsheftkontrolle: Fehlermeldung (Version ${App.VERSION})`;
    const url = `mailto:${encodeURIComponent(ziel)}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text.slice(0, 1800))}`;
    location.href = url;
    App.toast(text.length > 1800 ? 'E-Mail geöffnet – der Text ist gekürzt, die vollständige Meldung liegt im Ordner' : 'E-Mail geöffnet', 'info');
  },

  // ── Dialog ──
  oeffnen(vorbelegung) {
    this._bild = null;
    const text = App.diagnoseText({ zeilen: this.PROTOKOLL_ZEILEN });
    App.openModal('⚑ Problem melden', `
      <div style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
        Die Meldung landet als Datei im Ordner <code>_bhk/${esc(this.ORDNER)}/</code> und wird den anderen als Nachricht angekündigt.
        <strong>Bitte prüfen:</strong> Namen von Azubis, Betrieben und Ausbildern sind unten automatisch durch <code>…</code> ersetzt. Der Text lässt sich vor dem Absenden ändern oder kürzen.
      </div>
      <div class="form-group"><label>Was ist passiert? *</label>
        <textarea class="form-control" id="mdBeschreibung" rows="3" maxlength="2000" placeholder="z.B. Beim Speichern der Kontrolle kam eine rote Meldung und die Eingabe war weg.">${esc(vorbelegung || '')}</textarea></div>
      <div class="form-group"><label>Was hast du davor gemacht? (Schritte)</label>
        <textarea class="form-control" id="mdSchritte" rows="2" maxlength="1000" placeholder="z.B. Termin geöffnet, Azubi 5 angeklickt, KW 12 auf i.O. gesetzt"></textarea></div>
      <div class="form-group">
        <label>Bildschirmfoto (freiwillig)</label>
        <div id="mdBildFeld" tabindex="0" style="border:2px dashed var(--clr-sand);border-radius:var(--radius);padding:12px;text-align:center;font-size:12px;color:var(--clr-text-light);cursor:pointer">
          Hierher klicken und mit <strong>Strg+V</strong> einfügen (vorher <strong>Druck</strong> drücken), Bild hierher ziehen oder <label style="color:var(--clr-forest);text-decoration:underline;cursor:pointer">Datei wählen<input type="file" accept="image/*" style="display:none" onchange="Melden._bildAusDatei(this.files[0])"></label>
        </div>
        <div id="mdBildVorschau" style="margin-top:6px"></div>
      </div>
      <details style="margin-top:4px" open>
        <summary style="cursor:pointer;font-size:12px">Mitgesendetes Zustandsbild und Protokoll (bearbeitbar)</summary>
        <textarea class="form-control" id="mdDiagnose" rows="10" style="font-size:11px;font-family:monospace;margin-top:4px">${esc(text)}</textarea>
      </details>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Abbrechen</button>
       <button class="btn btn-secondary" onclick="App.kopieren(Melden.alsText(Melden.bauen(Melden._formular())), 'Meldung kopiert')" title="Text der Meldung in die Zwischenablage">▤ Kopieren</button>
       <button class="btn btn-secondary" onclick="Melden.alsDateiSpeichern()" title="Ohne Netzlaufwerk: Meldung als Textdatei herunterladen">Als Datei speichern</button>
       ${this.meldungsEmail() ? `<button class="btn btn-secondary" onclick="Melden.perEmail()" title="Meldung als E-Mail an ${esc(this.meldungsEmail())} (Bild bitte von Hand anhängen)">Per E-Mail</button>` : ''}
       <button class="btn btn-primary" id="mdSenden" onclick="Melden.senden()">Melden</button>`);
    if (typeof _makeModalWide === 'function') _makeModalWide();
    setTimeout(() => this._bildFeldVerdrahten(), 60);
  },
  _bildFeldVerdrahten() {
    const feld = document.getElementById('mdBildFeld');
    if (!feld) return;
    feld.onclick = () => feld.focus();
    feld.onpaste = (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); this._bildAusDatei(f); return; } }
      }
    };
    feld.ondragover = (e) => { e.preventDefault(); feld.style.borderColor = 'var(--clr-forest)'; };
    feld.ondragleave = () => { feld.style.borderColor = 'var(--clr-sand)'; };
    feld.ondrop = (e) => { e.preventDefault(); feld.style.borderColor = 'var(--clr-sand)'; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) this._bildAusDatei(f); };
    // Einfügen ohne vorheriges Klicken ins Feld
    document.getElementById('mdBeschreibung')?.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); this._bildAusDatei(f); return; } }
    });
  },
  async _bildAusDatei(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) return App.toast('Nur Bilddateien', 'warning');
    if (file.size > this.BILD_MAX_BYTES) return App.toast(`Bild zu groß (max. ${Math.round(this.BILD_MAX_BYTES / 1024 / 1024)} MB)`, 'warning');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const endung = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 4);
    this._bild = { bytes, typ: file.type, name: 'bild.' + endung, groesse: file.size };
    const box = document.getElementById('mdBildVorschau');
    if (box) {
      const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
      box.innerHTML = `<div style="display:flex;gap:8px;align-items:center">
        <img src="${url}" style="max-height:120px;max-width:60%;border:1px solid var(--clr-sand);border-radius:6px">
        <div style="font-size:11px;color:var(--clr-text-light)">${esc(this._bild.name)} · ${Math.round(file.size / 1024)} KB<br>
        <a href="#" onclick="Melden._bild=null;document.getElementById('mdBildVorschau').innerHTML='';return false" style="color:var(--clr-red)">entfernen</a></div></div>`;
    }
  },

  // ── Meldung zusammenstellen ──
  _formular() {
    const w = (id) => (document.getElementById(id)?.value || '').trim();
    return { beschreibung: w('mdBeschreibung'), schritte: w('mdSchritte'), diagnose: document.getElementById('mdDiagnose')?.value || '' };
  },
  // Zeit + Rechner + Zufall: zwei Meldungen in derselben Sekunde bekamen sonst
  // dieselbe Kennung und landeten im selben Ordner (die zweite überschrieb die erste)
  _id() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '_' + (App._getClientId ? App._getClientId().slice(-4) : 'xxxx') + '_' + Math.random().toString(36).slice(2, 6); },
  bauen(f) {
    return {
      id: this._id(), version: App.VERSION, zeitpunkt: new Date().toISOString(),
      von: (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || App.currentUser || '',
      rechner: App._getClientId ? App._getClientId() : '',
      beschreibung: App.schwaerzen(f.beschreibung), schritte: App.schwaerzen(f.schritte),
      diagnose: f.diagnose, bild: this._bild ? this._bild.name : '',
    };
  },
  alsText(m) {
    return [
      `# Fehlermeldung ${m.id}`, '',
      `Programmversion: ${m.version}`,
      `Gemeldet: ${new Date(m.zeitpunkt).toLocaleString('de-DE')}${m.von ? ' von ' + m.von : ''}`,
      m.bild ? `Bildschirmfoto: ${m.bild} (liegt neben dieser Datei)` : 'Bildschirmfoto: keines', '',
      '## Was ist passiert?', m.beschreibung || '(nichts angegeben)', '',
      '## Schritte davor', m.schritte || '(nichts angegeben)', '',
      '## Zustand und Protokoll', m.diagnose || '(nichts)', '',
    ].join('\n');
  },

  // ── Senden ──
  async _ordner(create = true) {
    if (!App.bhkDirHandle) throw new Error('Kein Datenbank-Ordner verbunden');
    return await App.bhkDirHandle.getDirectoryHandle(this.ORDNER, { create });
  },
  async _schreiben(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  },
  // Ablegen mit HÖCHSTENS einem Wiederholungsversuch und STABILER Kennung.
  // Beides ist wichtig: Ohne Grenze wiederholte sich der Versuch endlos, und
  // eine bei jedem Versuch neu erzeugte Kennung legte jedes Mal einen neuen
  // Ordner an – aus einer Meldung wurden ein Dutzend.
  async _ablegen(m, versuch = 0) {
    try {
      const dir = await this._ordner(true);
      const eigen = await dir.getDirectoryHandle(m.id, { create: true });
      await this._schreiben(eigen, 'meldung.json', JSON.stringify(m, null, 1));
      await this._schreiben(eigen, 'meldung.txt', this.alsText(m));
      if (this._bild) await this._schreiben(eigen, this._bild.name, this._bild.bytes);
      return true;
    } catch(e) {
      if (versuch === 0 && App._istZustandsFehler && App._istZustandsFehler(e) && await App._handlesNeuHolen()) {
        console.warn('[Melden] Zugriffspunkt erneuert, ein zweiter Versuch mit derselben Kennung');
        return await this._ablegen(m, 1);
      }
      console.warn('[Melden]', e);
      // Angefangenen, leeren Ordner wieder entfernen – sonst bleibt bei jedem
      // Fehlversuch Müll auf dem Netzlaufwerk liegen.
      try { const d = await this._ordner(false); await d.removeEntry(m.id, { recursive: true }); } catch(_) {}
      App.toast('Meldung konnte nicht abgelegt werden: ' + e.message + ' – bitte „Als Datei speichern" nutzen', 'error');
      return false;
    }
  },
  async senden() {
    if (this._sendet) return false;              // Doppelklick erzeugt keine zweite Meldung
    const f = this._formular();
    if (!f.beschreibung) return App.toast('Bitte kurz beschreiben, was passiert ist', 'warning');
    if (!App.bhkDirHandle || App.offlineModus || App._netzWeg) {
      App.toast('Kein Netzlaufwerk – die Meldung wird als Datei gespeichert', 'warning');
      return this.alsDateiSpeichern();
    }
    this._sendet = true;
    const knopf = document.getElementById('mdSenden');
    if (knopf) { knopf.disabled = true; knopf.textContent = 'Wird gespeichert…'; }
    const m = this.bauen(f);
    let ok = false;
    try { ok = await this._ablegen(m); }
    finally {
      this._sendet = false;
      if (knopf) { knopf.disabled = false; knopf.textContent = 'Melden'; }
    }
    if (!ok) return false;
    App.closeModal();
    App.toast('Danke, die Meldung ist abgelegt', 'success');
    this._letztePruefung = 0;
    try { await this.pruefeNeue(true); } catch(e) {}
    try { if (typeof Chat !== 'undefined' && Chat.aktiv()) await Chat.senden(`⚑ Neue Fehlermeldung: ${m.beschreibung.slice(0, 120)}`); } catch(e) {}
    this._bild = null;
    return true;
  },
  alsDateiSpeichern() {
    const m = this.bauen(this._formular());
    const blob = new Blob([this.alsText(m)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = App.safeFilename(['Fehlermeldung', m.id], 'txt');
    a.click();
    if (this._bild) {
      const b = document.createElement('a');
      b.href = URL.createObjectURL(new Blob([this._bild.bytes], { type: this._bild.typ }));
      b.download = App.safeFilename(['Fehlermeldung', m.id], this._bild.name.split('.').pop());
      b.click();
    }
    App.toast('Meldung als Datei gespeichert', 'success');
    return true;
  },

  // ── Übersicht (Einstellungen) ──
  async liste() {
    const out = [];
    let dir;
    try { dir = await this._ordner(false); } catch(e) { return out; }
    const grenze = Date.now() - this.MELDUNG_TAGE * 86400000;
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'directory') continue;
      try {
        const fh = await h.getFileHandle('meldung.json', { create: false });
        const f = await fh.getFile();
        if (f.lastModified < grenze) { try { await dir.removeEntry(name, { recursive: true }); } catch(_) {} continue; }
        const m = JSON.parse(await f.text());
        m._ordner = name;
        out.push(m);
      } catch(e) { /* unvollständiger Ordner */ }
    }
    this._meldungen = out.sort((a, b) => String(b.zeitpunkt).localeCompare(String(a.zeitpunkt)));
    return this._meldungen;
  },
  cardHtml() {
    return `<div class="card" style="margin-top:16px">
      <div class="card-header">⚑ Fehlermeldungen der Kolleginnen und Kollegen</div>
      <p style="font-size:12px;color:var(--clr-text-light);margin-bottom:8px">
        Meldungen aus <code>_bhk/${esc(this.ORDNER)}/</code>, inklusive Zustandsbild und Konsolenprotokoll. Namen sind beim Melden automatisch geschwärzt.
        „Alle als Textdatei" fasst sie für die Weitergabe an die Entwicklung zusammen. Automatische Löschung nach ${this.MELDUNG_TAGE} Tagen.
      </p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-secondary btn-sm" onclick="Melden.oeffnen()">⚑ Problem melden (F2)</button>
        <button class="btn btn-secondary btn-sm" onclick="Melden.kopiereAlle()" title="Alle Meldungen als Text in die Zwischenablage – zum Einfügen bei der Entwicklung">▤ Alle kopieren</button>
        <button class="btn btn-secondary btn-sm" onclick="Melden.exportAlle()">Alle als Textdatei</button>
        <button class="btn btn-secondary btn-sm" onclick="Melden.renderCard()">Aktualisieren</button>
      </div>
      <div id="meldungenBox"><div style="font-size:12px;color:var(--clr-text-light)">Meldungen werden gelesen…</div></div>
    </div>`;
  },
  async renderCard() {
    const box = document.getElementById('meldungenBox');
    if (!box) return;
    if (!App.bhkDirHandle) { box.innerHTML = '<div style="font-size:12px;color:var(--clr-text-light)">Nur bei verbundenem Datenbank-Ordner verfügbar.</div>'; return; }
    const liste = await this.liste();
    if (!document.getElementById('meldungenBox')) return;
    box.innerHTML = this._tabelle(liste);
    if (liste.length) this._gesehenSetzen(String(liste[0].zeitpunkt || ''));
    this._badge();
  },
  async anzeigen(ordner) {
    const m = (this._meldungen || []).find(x => x._ordner === ordner);
    if (!m) return;
    let bildUrl = '';
    if (m.bild) {
      try {
        const dir = await (await this._ordner(false)).getDirectoryHandle(ordner, { create: false });
        const f = await (await dir.getFileHandle(m.bild, { create: false })).getFile();
        bildUrl = URL.createObjectURL(f);
      } catch(e) {}
    }
    App.openModal(`⚑ Meldung ${esc(m.id)}`, `
      <div style="font-size:12px;color:var(--clr-text-light)">${esc(new Date(m.zeitpunkt).toLocaleString('de-DE'))}${m.von ? ' · ' + esc(m.von) : ''} · Version ${esc(m.version || '')}</div>
      <div style="margin-top:8px"><strong>Was ist passiert?</strong><div style="white-space:pre-wrap;font-size:13px">${esc(m.beschreibung || '')}</div></div>
      ${m.schritte ? `<div style="margin-top:8px"><strong>Schritte davor</strong><div style="white-space:pre-wrap;font-size:13px">${esc(m.schritte)}</div></div>` : ''}
      ${bildUrl ? `<div style="margin-top:8px"><a href="${bildUrl}" target="_blank"><img src="${bildUrl}" style="max-width:100%;border:1px solid var(--clr-sand);border-radius:6px"></a></div>` : ''}
      <details style="margin-top:8px"><summary style="cursor:pointer;font-size:12px">Zustand und Protokoll</summary>
        <pre style="font-size:11px;white-space:pre-wrap;max-height:40vh;overflow:auto;background:var(--clr-warm);padding:8px;border-radius:6px">${esc(m.diagnose || '')}</pre></details>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-primary" onclick="Melden.kopiereEine('${esc(ordner)}')">▤ Kopieren</button>
       <button class="btn btn-secondary" onclick="Melden.exportEine('${esc(ordner)}')">Als Textdatei</button>`);
    if (typeof _makeModalWide === 'function') _makeModalWide();
  },
  async loeschen(ordner) {
    if (!(await App.confirm('Diese Meldung endgültig löschen?', { titel: 'Meldung löschen', ok: 'Löschen', gefaehrlich: true }))) return;
    try { await (await this._ordner(false)).removeEntry(ordner, { recursive: true }); } catch(e) { return App.toast('Löschen fehlgeschlagen: ' + e.message, 'error'); }
    App.closeModal();
    App.toast('Meldung gelöscht', 'success');
    this.renderCard();
  },
  async alleLoeschen() {
    const liste = this._meldungen || [];
    if (!liste.length) return;
    if (!(await App.confirm(`Alle ${liste.length} Meldungen endgültig löschen?\n\nVorher lohnt sich „Alle als Textdatei".`, { titel: 'Meldungen löschen', ok: 'Alle löschen', gefaehrlich: true }))) return;
    let dir;
    try { dir = await this._ordner(false); } catch(e) { return; }
    let n = 0;
    for (const m of liste) { try { await dir.removeEntry(m._ordner, { recursive: true }); n++; } catch(e) {} }
    App.closeModal();
    App.toast(`${n} Meldungen gelöscht`, 'success');
    this._letztePruefung = 0;
    await this.pruefeNeue(true);
    this.renderCard();
  },
  _download(text, teile) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = App.safeFilename(teile, 'txt');
    a.click();
  },
  exportEine(ordner) {
    const m = (this._meldungen || []).find(x => x._ordner === ordner);
    if (!m) return;
    this._download(this.alsText(m), ['Fehlermeldung', m.id]);
    App.toast('Meldung als Textdatei gespeichert', 'success');
  },
  // Für die Weitergabe an die Entwicklung: ein Klick, dann einfügen
  kopiereEine(ordner) {
    const m = (this._meldungen || []).find(x => x._ordner === ordner);
    if (!m) return;
    return App.kopieren(this.alsText(m), 'Meldung kopiert – jetzt mit Strg+V einfügen');
  },
  _alleText(liste) {
    return [`# Fehlermeldungen Berichtsheftkontrolle`, `Stand: ${new Date().toLocaleString('de-DE')} · ${liste.length} Meldung(en) · Programmversion ${App.VERSION}`, '',
      ...liste.map(m => this.alsText(m) + '\n' + '─'.repeat(70) + '\n')].join('\n');
  },
  async kopiereAlle() {
    const liste = await this.liste();
    if (!liste.length) return App.toast('Keine Meldungen vorhanden', 'info');
    return App.kopieren(this._alleText(liste), `${liste.length} Meldungen kopiert – jetzt mit Strg+V einfügen`);
  },
  async exportAlle() {
    const liste = await this.liste();
    if (!liste.length) return App.toast('Keine Meldungen vorhanden', 'info');
    this._download(this._alleText(liste), ['Fehlermeldungen', new Date().toISOString().slice(0, 10)]);
    App.toast(`${liste.length} Meldungen als Textdatei gespeichert`, 'success');
  },
};
