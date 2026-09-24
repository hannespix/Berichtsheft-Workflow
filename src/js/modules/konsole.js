// ══════════════════════════════════════════════════════════════
//  KONSOLE: Diagnosebefehle für die Browser-Konsole (F12 → Konsole)
//
//  Ziel: Netz- und Mehrbenutzerprobleme am Arbeitsplatz nachvollziehen,
//  ohne Programmcode zu lesen. Alles hängt am globalen Objekt `bhk`:
//    bhk.hilfe()      Übersicht der Befehle
//    bhk.status()     Zustand von Verbindung, Synchronisation, Präsenz
//    bhk.spur()       Ereignisspur (BhkSpur) als Tabelle
//    bhk.test()       Verbindungstest mit Schreibprobe und Uhrversatz
//    bhk.kopieren()   Zustandsbild in die Zwischenablage (Weitergabe an die Entwicklung)
//    bhk.dateien()    Inhalt von _bhk/ mit Größe und Alter
//  Die Befehle lesen nur; einzig der Verbindungstest schreibt eine kleine
//  Probedatei und löscht sie wieder. Nichts davon landet in der Datenbank.
// ══════════════════════════════════════════════════════════════

const Konsole = {
  BEFEHLE: [
    ['bhk.hilfe()', 'diese Übersicht'],
    ['bhk.status()', 'Verbindung, Synchronisation, Präsenz und Zähler je Bereich'],
    ['bhk.spur(bereich, n)', 'Ereignisspur, letzte n Einträge (Standard 40); Bereich z.B. "anhaengen", "abgleich", "kompakt", "netz", "takt", "fenster"'],
    ['bhk.dateien()', 'Inhalt von _bhk/ mit Größe und Alter (liest das Netzlaufwerk)'],
    ['bhk.test()', 'Verbindungstest: Auflisten, Lesen, Schreibprobe, Uhrversatz, Lebenszeichen'],
    ['bhk.jetzt()', 'Abgleich sofort ausführen'],
    ['bhk.kopieren()', 'Zustandsbild samt Spur und Protokoll in die Zwischenablage (zur Weitergabe an die Entwicklung)'],
    ['bhk.debug(true)', 'jeden Netzvorgang sofort in der Konsole zeigen (bleibt bis bhk.debug(false))'],
  ],
  PROBE_PREFIX: 'probe_',
  _tabelle(zeilen) { try { if (console.table) console.table(zeilen); else console.log(zeilen); } catch(e) { console.log(zeilen); } },
  _zeit(t) { return t ? new Date(t).toLocaleTimeString('de-DE') : ''; },
  _alter(t) {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
  },

  hilfe() {
    console.log('%cBerichtsheftkontrolle – Diagnosebefehle', 'font-weight:bold');
    this._tabelle(this.BEFEHLE.map(([b, w]) => ({ Befehl: b, Wirkung: w })));
    console.log('Tipp: In den Konsolen-Einstellungen „Protokoll beibehalten" einschalten, damit die Meldungen ein Neuladen überleben. Mit Rechtsklick → „Speichern unter…" lässt sich die ganze Konsole als Datei sichern.');
    return this.BEFEHLE.map(b => b[0]);
  },

  // ── Zustand ──
  status() {
    const d = App.diagnose();
    const zeilen = [];
    Object.entries(d).forEach(([gruppe, werte]) => {
      if (gruppe === 'datenbank' || gruppe === 'programm') return;
      Object.entries(werte).forEach(([k, v]) => zeilen.push({ Bereich: gruppe, Angabe: k, Wert: v === '' ? '–' : v }));
    });
    zeilen.push({ Bereich: 'sync', Angabe: 'anhaengenLaeuft', Wert: !!App._appendInProgress });
    zeilen.push({ Bereich: 'sync', Angabe: 'kompaktierungLaeuft', Wert: !!App._compactInProgress });
    zeilen.push({ Bereich: 'sync', Angabe: 'speichernLaeuft', Wert: !!App._mergeInProgress });
    zeilen.push({ Bereich: 'sync', Angabe: 'eigenesProtokoll', Wert: App._myOplogName ? `${App._myOplogName()} (${Math.round((App._myLogSize || 0) / 1024)} KB)` : '–' });
    console.log('%cZustand', 'font-weight:bold');
    this._tabelle(zeilen);
    const z = typeof BhkSpur !== 'undefined' ? BhkSpur.zusammenfassung() : [];
    if (z.length) { console.log('%cNetz- und Dateivorgänge je Bereich', 'font-weight:bold'); this._tabelle(z); }
    return { zustand: d, bereiche: z };
  },

  spur(bereich, n) {
    if (typeof bereich === 'number') { n = bereich; bereich = ''; }
    const l = BhkSpur.liste(bereich || null, n || 40);
    if (!l.length) { console.log('Keine Einträge' + (bereich ? ' für „' + bereich + '“' : '') + '.'); return []; }
    this._tabelle(l.map(e => ({ Zeit: this._zeit(e.t), Bereich: e.kat, Vorgang: e.was, ms: e.ms == null ? '' : e.ms, OK: e.ok ? '✓' : '✗', Art: e.art || '', Info: e.ok ? (e.info || '') : `${e.fehler || ''}${e.info ? ' (' + e.info + ')' : ''}` })));
    return l;
  },

  // ── Netzlaufwerk ──
  async dateien() {
    const dir = App._syncDirV3 ? App._syncDirV3() : null;
    if (!dir) { console.log('Kein Ordner verbunden.'); return []; }
    const t0 = Date.now();
    const zeilen = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file') { zeilen.push({ Name: name + '/', Art: 'Ordner', KB: '', Geändert: '', Alter: '' }); continue; }
      try {
        const f = await h.getFile();
        zeilen.push({ Name: name, Art: this._dateiArt(name), KB: Math.round(f.size / 1024 * 10) / 10, Geändert: new Date(f.lastModified).toLocaleString('de-DE'), Alter: this._alter(f.lastModified) });
      } catch(e) { zeilen.push({ Name: name, Art: this._dateiArt(name), KB: '?', Geändert: 'nicht lesbar: ' + (BhkSpur.fehlerArt(e) || e.name), Alter: '' }); }
    }
    zeilen.sort((a, b) => a.Art.localeCompare(b.Art) || a.Name.localeCompare(b.Name));
    const ms = Date.now() - t0;
    const arten = {};
    zeilen.forEach(z => { arten[z.Art] = (arten[z.Art] || 0) + 1; });
    console.log(`_bhk/: ${zeilen.length} Einträge in ${ms} ms – ` + Object.entries(arten).map(([a, n]) => `${n}× ${a}`).join(', '));
    this._tabelle(zeilen);
    BhkSpur.notiere('probe', 'Ordner auflisten (bhk.dateien)', { ok: true, ms, info: `${zeilen.length} Einträge` });
    return zeilen;
  },
  _dateiArt(name) {
    if (name.endsWith('.crswap')) return 'Tauschdatei (Browser)';
    if (name.startsWith('oplog_')) return 'Protokoll';
    if (name.startsWith('praesenz_')) return 'Lebenszeichen';
    if (name.startsWith('chat_')) return 'Chat';
    if (name.startsWith('pos-')) return 'Position';
    if (name.startsWith('lock')) return 'Sperre';
    if (name.startsWith('snapmeta_')) return 'Snapshot-Meta';
    if (name.startsWith('sync')) return 'Marker';
    if (name.startsWith(this.PROBE_PREFIX)) return 'Probe';
    return 'Sonstiges';
  },

  // Verbindungstest: jeder Schritt gemessen, am Ende Befunde in Klartext.
  // Die Schreibprobe ist der einzige schreibende Schritt und räumt sich auf.
  async test() {
    const dir = App._syncDirV3 ? App._syncDirV3() : null;
    const schritte = [];
    const befunde = [];
    const schritt = async (name, fn) => {
      const t0 = Date.now();
      try {
        const info = await fn();
        const ms = Date.now() - t0;
        schritte.push({ Schritt: name, ms, Ergebnis: 'OK', Info: info == null ? '' : String(info) });
        BhkSpur.notiere('probe', name, { ok: true, ms, info: info == null ? '' : String(info) });
        return { ok: true, ms, info };
      } catch(e) {
        const ms = Date.now() - t0;
        const art = BhkSpur.fehlerArt(e);
        schritte.push({ Schritt: name, ms, Ergebnis: 'FEHLER', Info: `${art}: ${e && e.message || e}` });
        BhkSpur.notiere('probe', name, { ok: false, ms, fehler: e });
        return { ok: false, ms, art, fehler: e };
      }
    };
    if (!dir) {
      befunde.push('Kein Ordner verbunden – Test nicht möglich.');
      console.log(befunde[0]);
      return { schritte, befunde };
    }
    console.log('%cVerbindungstest läuft…', 'font-weight:bold');
    // 1) Ordner auflisten
    const liste = await schritt('Ordner _bhk auflisten', async () => { let n = 0; for await (const _ of dir.entries()) n++; return `${n} Einträge`; });
    // 2) Datenbankdatei: Metadaten
    const meta = await schritt('Datenbankdatei lesen (Metadaten)', async () => {
      if (!App.dbFileHandle) throw new Error('keine Datenbankdatei verbunden');
      const f = await App.dbFileHandle.getFile();
      return `${Math.round(f.size / 1024 / 1024 * 10) / 10} MB, geändert ${new Date(f.lastModified).toLocaleString('de-DE')}`;
    });
    // 3) Schreibprobe: schreiben, zurücklesen, Uhrversatz schätzen, löschen
    let versatz = null;
    const probeName = this.PROBE_PREFIX + (App._dbSlug ? App._dbSlug() : 'db') + '_' + App._getClientId() + '.txt';
    const schreib = await schritt('Schreibprobe (kleine Datei anlegen, zurücklesen, löschen)', async () => {
      const geschrieben = Date.now();
      const inhalt = 'bhk-probe ' + geschrieben;
      const h = await dir.getFileHandle(probeName, { create: true });
      const w = await h.createWritable();
      await w.write(inhalt);
      await w.close();
      const f = await (await dir.getFileHandle(probeName, { create: false })).getFile();
      const zurueck = await f.text();
      if (zurueck !== inhalt) throw new Error('Zurückgelesener Inhalt weicht ab (Offlinedateien oder Zwischenspeicher?)');
      versatz = f.lastModified - geschrieben;
      try { await dir.removeEntry(probeName); } catch(e) {}
      return `Uhrversatz zum Dateiserver etwa ${Math.round(versatz / 1000)} s (geschätzt)`;
    });
    if (!schreib.ok) { try { await dir.removeEntry(probeName); } catch(e) {} }
    // 4) Abgleich
    const abgleich = await schritt('Fremde Protokolle lesen (Abgleich)', async () => {
      if (!App._v3Ready) return 'Abgleich noch nicht bereit (Start läuft)';
      await App._pollOplogs();
      return `Abgleich ${Math.round(App._lastPollMs || 0)} ms`;
    });

    // Befunde
    if (!schreib.ok) {
      if (schreib.art === 'safebrowsing') befunde.push('Schreiben blockiert: Der Browser lehnt Schreibvorgänge ab (Safe Browsing / Enterprise-Richtlinie ohne Internet-Ausleitung). Lesen geht, eigene Änderungen kommen bei den Kollegen NICHT an. Hilfe → Mehrbenutzer-Betrieb nennt die IT-Einstellung.');
      else if (schreib.art === 'zustand') befunde.push('Zugriff veraltet (Windows-Dateicache): Bitte die Seite neu laden (F5).');
      else if (schreib.art === 'verweigert') befunde.push('Schreiben verweigert: Ordnerberechtigung nur lesend oder Zugriff abgelaufen – Ordner erneut verbinden.');
      else befunde.push(`Schreiben fehlgeschlagen (${BhkSpur.artText(schreib.art)}): ${schreib.fehler && schreib.fehler.message || ''}`);
    }
    if (liste.ok && liste.ms > 2000) befunde.push(`Langsame Leitung: Das Auflisten des Ordners dauert ${liste.ms} ms (Büro-LAN: unter 100 ms). Einstellungen → Verbindung → „Langsame Leitung“ empfohlen.`);
    else if (liste.ok && liste.ms > 500) befunde.push(`Leitung mittel: Auflisten ${liste.ms} ms – der Abgleich braucht länger, das ist über VPN normal.`);
    if (versatz != null && Math.abs(versatz) > 60000) befunde.push(`Uhrversatz von etwa ${Math.round(Math.abs(versatz) / 60000)} min zwischen diesem Rechner und dem Dateiserver: Die Online-Anzeige der Kollegen und die Reihenfolge gleichzeitiger Änderungen können falsch sein. Uhr per Domäne synchronisieren.`);
    if (App._tabIsPrimary === false) befunde.push('Zweit-Registerkarte: Diese Registerkarte kann keinen Snapshot schreiben, Import und Datenbank-Tools sind gesperrt.');
    if (App._neuladenNoetig) befunde.push('Der Zugriff auf das Netzlaufwerk ist veraltet – nur Neuladen (F5) hilft.');
    if (App._netzWeg) befunde.push('Netzabriss-Zustand aktiv: Abgleich und Speichern sind pausiert, Probe alle 30 s.');
    if (App._safeBrowsingBis && Date.now() < App._safeBrowsingBis) befunde.push(`Backups bis ${this._zeit(App._safeBrowsingBis)} ausgesetzt (Safe-Browsing-Abbruch zuvor).`);
    if ((App._dirtyOps || []).length) befunde.push(`${App._dirtyOps.length} Änderung(en) warten noch auf das Anhängen.`);
    if (typeof document !== 'undefined' && document.hidden) befunde.push('Das Fenster gilt als verdeckt – in diesem Zustand setzt der Abgleich-Takt aus.');
    const s = BhkSpur.stat;
    ['anhaengen', 'abgleich', 'backup'].forEach(k => { if (s[k] && s[k].fehler && s[k].letzteArt) befunde.push(`Bereich ${k}: ${s[k].fehler} Fehler in dieser Sitzung, zuletzt ${BhkSpur.artText(s[k].letzteArt)}.`); });
    if (!befunde.length) befunde.push('Keine Auffälligkeiten: Lesen, Schreiben und Abgleich funktionieren.');

    this._tabelle(schritte);
    console.log('%cBefunde', 'font-weight:bold');
    befunde.forEach(b => console.log('• ' + b));
    return { schritte, befunde, versatzMs: versatz, abgleich: abgleich.ok, meta: meta.ok };
  },

  // Verbindungstest mit Ergebnisfenster (Einstellungen → Verbindung)
  async testDialog() {
    App.showLoading && App.showLoading('Verbindungstest läuft…');
    let r;
    try { r = await this.test(); } finally { App.hideLoading && App.hideLoading(); }
    const text = ['Verbindungstest ' + new Date().toLocaleString('de-DE'), ...r.schritte.map(s => `${s.Ergebnis === 'OK' ? '✓' : '✗'} ${s.Schritt}: ${s.ms} ms${s.Info ? ' – ' + s.Info : ''}`), '', 'Befunde:', ...r.befunde.map(b => '• ' + b)].join('\n');
    this._letzterTest = text;
    App.openModal('Verbindungstest', `
      <table class="data-table"><thead><tr><th>Schritt</th><th style="text-align:right">Dauer</th><th>Ergebnis</th></tr></thead><tbody>
        ${r.schritte.map(s => `<tr><td>${esc(s.Schritt)}</td><td style="text-align:right;white-space:nowrap">${s.ms} ms</td><td style="color:${s.Ergebnis === 'OK' ? 'var(--clr-green)' : 'var(--clr-red)'}">${esc(s.Ergebnis)}${s.Info ? ' <span style="color:var(--clr-text-light)">– ' + esc(s.Info) + '</span>' : ''}</td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:10px;font-size:13px"><strong>Befunde</strong><ul style="margin:4px 0 0 18px">${r.befunde.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>
      <div style="font-size:12px;color:var(--clr-text-light);margin-top:8px">Mehr in der Browser-Konsole (F12): <code>bhk.hilfe()</code> zeigt alle Diagnosebefehle, <code>bhk.spur()</code> die Ereignisspur.</div>`,
      `<button class="btn btn-secondary" onclick="App.closeModal()">Schließen</button>
       <button class="btn btn-secondary" onclick="App.kopieren(Konsole._letzterTest,'Testergebnis kopiert')">▤ Ergebnis kopieren</button>
       <button class="btn btn-primary" onclick="Konsole.kopieren()">▤ Zustandsbild kopieren</button>`);
    return r;
  },

  async jetzt() {
    const t0 = Date.now();
    if (App._v3Ready && !App._pollBusy) await App._pollOplogs();
    console.log(`Abgleich ${Math.round(App._lastPollMs || 0)} ms – gesamt ${Date.now() - t0} ms`);
    return { abgleichMs: App._lastPollMs || 0 };
  },
  kopieren() { return App.kopieren(App.diagnoseText({ zeilen: 150 }), 'Zustandsbild kopiert – bei der Entwicklung einfügen'); },
  debug(an) {
    const neu = BhkSpur.setDebug(an !== false);
    console.log(neu ? 'Debug an: Jeder Netzvorgang erscheint ab jetzt als [Spur:…] in der Konsole.' : 'Debug aus.');
    return neu;
  },

  installieren() {
    if (typeof window === 'undefined') return;
    window.bhk = this;
    try {
      if (BhkSpur.debug) console.log('[Spur] Debug-Ausgabe ist eingeschaltet (bhk.debug(false) schaltet sie aus)');
      console.log('%cBerichtsheftkontrolle%c – Diagnose: bhk.hilfe() · Verbindungstest: bhk.test() · Zustandsbild kopieren: bhk.kopieren()', 'font-weight:bold', '');
    } catch(e) {}
  },
};
Konsole.installieren();
