// ══════════════════════════════════════════════════════════════
//  CHAT: kurze Zurufe an gleichzeitig arbeitende Kolleginnen und Kollegen
//
//  Transport wie bei den Op-Protokollen: JEDER Rechner hängt nur an seine
//  EIGENE Datei _bhk/chat_<db>_<client>.jsonl an, die anderen lesen ab ihrer
//  Leseposition. Eine gemeinsame Datei schiede aus – Chrome kopiert beim
//  Anhängen die ganze Datei, gleichzeitige Schreibzugriffe zerstören sie.
//
//  Bewusste Grenzen:
//  - Nichts landet in der Datenbank (sie soll nicht wieder wachsen).
//  - Zustellung im Abgleich-Takt (3/10/30 s, Feldmodus 60 s), also kein
//    Sofortnachrichtendienst. Offline und bei Netzabriss ruht der Chat.
//  - Der Ordner ist gemeinsam: „direkt" ist eine Zustellregel, KEIN
//    Vertraulichkeitsversprechen. Steht so auch in der Oberfläche.
// ══════════════════════════════════════════════════════════════

const Chat = {
  MAX_LAENGE: 500,
  AUFBEWAHRUNG_TAGE: 7,
  DATEI_MAX_BYTES: 64 * 1024,
  TOAST_MS: 9000,
  VERLAUF_MAX: 200,
  _nachrichten: [],     // zusammengeführter Verlauf (eigene + fremde)
  _offsets: {},         // Datei → gelesene Bytes
  _gesehenBis: 0,       // Zeitstempel der zuletzt gelesenen Nachricht
  _offen: false,
  _laeuft: false,
  _eigeneDatei: null,
  _eigeneGroesse: 0,

  // ── Identität und Dateinamen ──
  _prefix() { return 'chat_' + App._dbSlug() + '_'; },
  _dateiName() { return this._prefix() + App._getClientId() + '.jsonl'; },
  absender() {
    return (typeof KontrolleHandler !== 'undefined' && KontrolleHandler.activePruefer) || App.currentUser || ('Rechner ' + App._getClientId().slice(-4));
  },
  _uKey() { return 'chat_gesehen_' + App._dbSlug(); },

  an() { return !!(App.kollegenAn && App.kollegenAn()); },
  aktiv() { return !!(this.an() && App.dirHandle && !App.offlineModus && !App._netzWeg); },
  _grund() {
    if (!this.an()) return 'Nachrichten sind ausgeschaltet (Einstellungen → Verbindung → Kollegen-Anzeige und Nachrichten)';
    if (!App.dirHandle) return 'Kein Datenbank-Ordner verbunden';
    if (App.offlineModus) return 'Im Offline-Modus werden keine Nachrichten übertragen';
    if (App._netzWeg) return 'Netzlaufwerk nicht erreichbar';
    return '';
  },

  // ── Senden ──
  async senden(text, anClient) {
    text = String(text || '').trim().slice(0, this.MAX_LAENGE);
    if (!text) return false;
    const grund = this._grund();
    if (grund) { App.toast(grund, 'warning'); return false; }
    const n = {
      id: App._newUid ? App._newUid() : (Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      c: App._getClientId(), von: this.absender(), an: anClient || '', anName: anClient ? (this._nameZuClient(anClient) || '') : '',
      text, ts: Date.now(),
    };
    let ok = false;
    try { ok = await this._anhaengen(n); } catch(e) { console.warn('[Chat] Senden:', e.message); }
    if (!ok) { App.toast('Nachricht konnte nicht zugestellt werden', 'error'); return false; }
    this._aufnehmen(n);
    this._gesehenBis = Math.max(this._gesehenBis, n.ts);
    this._gesehenSpeichern();
    this._render();
    return true;
  },
  async _anhaengen(n, versuch = 0) {
    const dir = App._syncDirV3();
    if (!dir) return false;
    const zeile = JSON.stringify(n) + '\n';
    const bytes = new TextEncoder().encode(zeile);
    let writable = null;
    const t0 = Date.now();
    try {
      let handle = await dir.getFileHandle(this._dateiName(), { create: true });
      let size = (await handle.getFile()).size;
      // Datei zu groß oder zu alt: neu beginnen (der Verlauf lebt im Speicher
      // der Clients weiter, ein Chat braucht kein Langzeitgedächtnis).
      if (size > this.DATEI_MAX_BYTES) {
        try { await dir.removeEntry(this._dateiName()); } catch(e) {}
        handle = await dir.getFileHandle(this._dateiName(), { create: true });
        size = 0;
        this._offsets[this._dateiName()] = 0;
      }
      writable = await handle.createWritable({ keepExistingData: true });
      await writable.write({ type: 'write', position: size, data: bytes });
      await writable.close();
      writable = null;
      this._eigeneGroesse = size + bytes.length;
      this._offsets[this._dateiName()] = this._eigeneGroesse; // eigene Zeilen nicht zurücklesen
      if (typeof BhkSpur !== 'undefined') BhkSpur.notiere('chat', 'Nachricht anhängen', { ok: true, ms: Date.now() - t0, info: `${bytes.length} B an ${Math.round(size / 1024)} KB${versuch ? ', 2. Versuch' : ''}` });
      return true;
    } catch(e) {
      if (writable) { try { await writable.abort(); } catch(_) {} }
      if (typeof BhkSpur !== 'undefined') BhkSpur.notiere('chat', 'Nachricht anhängen', { ok: false, ms: Date.now() - t0, fehler: e, info: versuch ? 'auch im 2. Versuch' : '' });
      // HÖCHSTENS ein zweiter Versuch: ohne Grenze wiederholte sich das
      // Anhängen bei dauerhaften Cache-Fehlern endlos.
      if (versuch === 0 && App._istZustandsFehler && App._istZustandsFehler(e) && await App._handlesNeuHolen()) {
        console.warn('[Chat] Zugriffspunkt erneuert, ein zweiter Sendeversuch');
        return await this._anhaengen(n, 1);
      }
      App._verbindungsProblem && App._verbindungsProblem(e, 'chat');
      throw e;
    }
  },

  // ── Empfangen (hängt am Abgleich-Takt) ──
  async abholen() {
    if (!this.aktiv() || this._laeuft) return 0;
    this._laeuft = true;
    const t0 = Date.now();
    try {
      const dir = App._syncDirV3();
      if (!dir) return 0;
      const prefix = this._prefix(), eigen = this._dateiName();
      const grenze = Date.now() - this.AUFBEWAHRUNG_TAGE * 86400000;
      const neue = [];
      let dateien = 0;
      for await (const [name, h] of dir.entries()) {
        if (!name.startsWith(prefix) || !name.endsWith('.jsonl') || h.kind !== 'file') continue;
        dateien++;
        try {
          const f = await h.getFile();
          if (f.lastModified < grenze) {
            if (name !== eigen) { try { await dir.removeEntry(name); } catch(_) {} }
            continue;
          }
          if (name === eigen) { this._offsets[name] = f.size; this._eigeneGroesse = f.size; continue; }
          const gelesen = this._offsets[name] || 0;
          if (f.size <= gelesen) { if (f.size < gelesen) this._offsets[name] = 0; continue; }
          const text = await f.slice(gelesen).text();
          this._offsets[name] = f.size;
          text.split('\n').forEach(z => {
            if (!z.trim()) return;
            let n; try { n = JSON.parse(z); } catch(e) { return; }
            if (!n || !n.text || !n.ts || n.ts < grenze) return;
            if (n.an && n.an !== App._getClientId()) return; // nicht für mich
            if (this._aufnehmen(n)) neue.push(n);
          });
        } catch(e) { /* einzelne Datei unlesbar – überspringen */ }
      }
      if (neue.length) this._melden(neue);
      if (typeof BhkSpur !== 'undefined') BhkSpur.notiere('chat', 'Nachrichten abholen', { ok: true, ms: Date.now() - t0, info: `${dateien} Datei(en)${neue.length ? ', ' + neue.length + ' neu' : ''}`, nurStat: !neue.length });
      return neue.length;
    } catch(e) {
      if (typeof BhkSpur !== 'undefined') BhkSpur.notiere('chat', 'Nachrichten abholen', { ok: false, ms: Date.now() - t0, fehler: e });
      App._verbindungsProblem && App._verbindungsProblem(e, 'chat');
      return 0;
    } finally { this._laeuft = false; }
  },
  _aufnehmen(n) {
    if (this._nachrichten.some(x => x.id === n.id)) return false;
    this._nachrichten.push(n);
    this._nachrichten.sort((a, b) => a.ts - b.ts);
    if (this._nachrichten.length > this.VERLAUF_MAX) this._nachrichten = this._nachrichten.slice(-this.VERLAUF_MAX);
    return true;
  },
  _melden(neue) {
    if (this._offen) {
      this._gesehenBis = Math.max(this._gesehenBis, ...neue.map(n => n.ts));
      this._gesehenSpeichern();
      this._verlaufRendern();
    } else {
      neue.forEach(n => this._toast(n));
    }
    this._render();
  },
  _toast(n) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast toast-chat';
    t.style.cursor = 'pointer';
    t.title = 'Öffnen und antworten';
    t.innerHTML = `<div style="min-width:0"><div style="font-weight:600;font-size:12px">${esc(n.von)}${n.an ? ' <span style="font-weight:400;color:var(--clr-text-light)">(nur an mich)</span>' : ''}</div>
      <div style="white-space:pre-wrap;word-break:break-word">${esc(n.text)}</div></div>`;
    t.onclick = () => { t.remove(); Chat.oeffnen(n.c); };
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, this.TOAST_MS);
  },

  // ── Ungelesen-Stand (nur lokal, kein Schreibzugriff aufs Netzlaufwerk) ──
  _gesehenLaden() {
    if (this._gesehenBis) return;
    const v = parseInt(App.uGet(this._uKey(), '0')) || 0;
    this._gesehenBis = v;
  },
  _gesehenSpeichern() { App.uSet(this._uKey(), String(this._gesehenBis || 0)); },
  ungelesen() {
    this._gesehenLaden();
    return this._nachrichten.filter(n => n.c !== App._getClientId() && n.ts > this._gesehenBis).length;
  },

  // ── Kopfzeile ──
  _render() {
    const el = document.getElementById('chatBadge');
    if (!el) return;
    // Immer sichtbar: Nicht jeder kennt die Tastenkürzel, und das Symbol ist
    // der einzige Weg zu Nachrichten und zum Melden eines Problems.
    el.style.display = '';
    if (!this.an()) {
      // Nachrichten ausgeschaltet: Das Symbol führt nur noch zum Melden
      el.innerHTML = '⚑ Problem melden';
      el.title = 'Problem melden (F2): Zustandsbild, Protokoll und Bildschirmfoto an die Entwicklung. Nachrichten an Kollegen sind ausgeschaltet (Einstellungen → Verbindung).';
      el.style.color = ''; el.style.opacity = '0.7';
      return;
    }
    const n = this.ungelesen();
    el.innerHTML = n ? `✉ <strong>${n}</strong> Nachrichten` : '✉ Nachrichten';
    el.title = (n ? `${n} ungelesene Nachricht(en). ` : '') + 'Nachrichten an Kolleginnen und Kollegen (Strg+M) und Problem melden (F2). Gemeinsamer Ordner, nicht vertraulich.'
      + (this.aktiv() ? '' : ' – ' + this._grund());
    el.style.color = n ? 'var(--clr-amber)' : '';
    el.style.opacity = this.aktiv() ? '' : '0.55';
  },
  _nameZuClient(cid) {
    const a = (App._praesenzAndere || []).find(x => x.client === cid);
    if (a) return App._praesenzLabel(a);
    const n = [...this._nachrichten].reverse().find(x => x.c === cid);
    return n ? n.von : '';
  },

  // ── Fenster ──
  oeffnen(anClient) {
    if (!this.an()) { if (typeof Melden !== 'undefined') Melden.oeffnen(); else App.toast(this._grund(), 'info'); return; }
    this._gesehenLaden();
    const online = (App.onlineNutzer ? App.onlineNutzer() : []);
    const ziel = anClient || this._letztesZiel || '';
    App.openModal('✉ Nachrichten', `
      <div style="font-size:11px;color:var(--clr-text-light);margin-bottom:8px">
        Kurze Zurufe an alle, die gerade dieselbe Datenbank geöffnet haben. Zustellung im Abgleich-Takt (wenige Sekunden, bei langsamem Netz bis zu einer halben Minute, im Feldmodus länger); im Offline-Modus ruht der Chat.
        <strong>Nicht vertraulich:</strong> Die Nachrichten liegen als Dateien im gemeinsamen Ordner und sind für alle mit Zugriff lesbar. Keine Namen von Azubis oder andere personenbezogene Angaben hineinschreiben. Automatische Löschung nach ${this.AUFBEWAHRUNG_TAGE} Tagen.
      </div>
      <div style="font-size:12px;margin-bottom:6px">Etwas funktioniert nicht?
        <a href="#" onclick="Chat.schliessen();Melden.oeffnen();return false" style="color:var(--clr-forest);font-weight:600">⚑ Problem melden</a>
        <span style="color:var(--clr-text-light)">– schickt Zustandsbild, Protokoll und auf Wunsch ein Bildschirmfoto an die Entwicklung (Taste F2)</span></div>
      <div id="chatVerlauf" style="height:40vh;overflow:auto;border:1px solid var(--clr-sand);border-radius:var(--radius);padding:8px;background:var(--clr-warm)"></div>
      <div style="display:flex;gap:6px;align-items:flex-end;margin-top:8px">
        <div style="flex:0 0 auto">
          <label style="font-size:11px;color:var(--clr-text-light)">An</label>
          <select class="form-control" id="chatZiel" style="font-size:12px;max-width:190px">
            <option value="">alle (${online.length} online)</option>
            ${online.map(a => `<option value="${esc(a.client)}" ${a.client === ziel ? 'selected' : ''}>${esc(App._praesenzLabel(a))}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1">
          <label style="font-size:11px;color:var(--clr-text-light)">Nachricht (Enter sendet)</label>
          <textarea class="form-control" id="chatText" rows="2" maxlength="${this.MAX_LAENGE}" style="font-size:13px;resize:vertical"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();Chat.sendenAusFormular()}"></textarea>
        </div>
        <button class="btn btn-primary" onclick="Chat.sendenAusFormular()" style="flex:0 0 auto">Senden</button>
      </div>
      ${this._grund() ? `<div style="font-size:12px;color:var(--clr-red);margin-top:6px">${esc(this._grund())}</div>` : ''}`,
      `<button class="btn btn-secondary" onclick="Chat.schliessen()">Schließen</button>
       <button class="btn btn-secondary" onclick="Chat.abholen().then(()=>Chat._verlaufRendern())">Jetzt abrufen</button>
       <button class="btn btn-secondary" onclick="Chat.schliessen();Melden.oeffnen()" title="Fehler mit Zustandsbild, Protokoll und Bildschirmfoto melden (F2)">⚑ Problem melden</button>`);
    if (typeof _makeModalWide === 'function') _makeModalWide();
    this._offen = true;
    this._verlaufRendern();
    setTimeout(() => { const t = document.getElementById('chatText'); if (t) t.focus(); }, 60);
  },
  schliessen() { this._offen = false; App.closeModal(); this._render(); },
  _verlaufRendern() {
    const box = document.getElementById('chatVerlauf');
    if (!box) { this._offen = false; return; }
    const mein = App._getClientId();
    const zeit = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    box.innerHTML = this._nachrichten.length ? this._nachrichten.map(n => {
      const eigen = n.c === mein;
      return `<div style="display:flex;justify-content:${eigen ? 'flex-end' : 'flex-start'};margin-bottom:6px">
        <div style="max-width:78%;padding:6px 10px;border-radius:10px;font-size:13px;background:${eigen ? 'var(--clr-forest)' : 'var(--clr-white)'};color:${eigen ? 'var(--clr-white)' : 'var(--clr-text)'};border:1px solid var(--clr-sand)">
          <div style="font-size:10px;opacity:0.75">${esc(eigen ? 'Ich' : n.von)}${n.an ? (eigen ? ' → ' + esc(n.anName || 'direkt') : ' (nur an mich)') : ''} · ${esc(zeit(n.ts))}</div>
          <div style="white-space:pre-wrap;word-break:break-word">${esc(n.text)}</div>
        </div></div>`;
    }).join('') : '<div style="font-size:12px;color:var(--clr-text-light)">Noch keine Nachrichten.</div>';
    box.scrollTop = box.scrollHeight;
    if (this._nachrichten.length) {
      this._gesehenBis = Math.max(this._gesehenBis, ...this._nachrichten.map(n => n.ts));
      this._gesehenSpeichern();
    }
    this._render();
  },
  async sendenAusFormular() {
    const t = document.getElementById('chatText');
    const z = document.getElementById('chatZiel');
    if (!t || !t.value.trim()) return;
    const text = t.value;
    this._letztesZiel = z ? z.value : '';
    t.value = '';
    const ok = await this.senden(text, this._letztesZiel);
    if (!ok) t.value = text; // Text nicht verlieren
    this._verlaufRendern();
    t.focus();
  },
};
