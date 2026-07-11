// ══════════════════════════════════════════════════════════════
//  AZUBI-RECHNER: Phasen-Mathematik, Tarif-Daten, Kennzahlen
//  Extrahiert aus Ausbildungsrechner + Dashboard V6
// ══════════════════════════════════════════════════════════════

const AzubiRechner = {

  // ── Tarif-Daten ──
  BERUFE: [
    {
      id: "galabau", label: "Gärtner/in – Garten- und Landschaftsbau",
      group: "Gartenbau (GaLaBau)", urlaub: 26,
      tarife: [
        { ab: "2024-07-01", lj: [1060, 1180, 1290] },
        { ab: "2025-07-01", lj: [1100, 1220, 1340] },
        { ab: "2026-07-01", lj: [1140, 1270, 1390] },
      ],
    },
    {
      id: "baumschule", label: "Gärtner/in – Baumschule",
      group: "Erwerbsgartenbau BaWü", urlaub: 26,
      tarife: [
        { ab: "2024-03-01", lj: [900, 1000, 1100] },
        { ab: "2025-05-01", lj: [980, 1080, 1240] },
      ],
    },
    {
      id: "friedhof", label: "Gärtner/in – Friedhofsgärtnerei",
      group: "Erwerbsgartenbau BaWü", urlaub: 26,
      tarife: [
        { ab: "2024-03-01", lj: [900, 1000, 1100] },
        { ab: "2025-05-01", lj: [980, 1080, 1240] },
      ],
    },
    {
      id: "gemuese", label: "Gärtner/in – Gemüsebau",
      group: "Erwerbsgartenbau BaWü", urlaub: 26,
      tarife: [
        { ab: "2024-03-01", lj: [900, 1000, 1100] },
        { ab: "2025-05-01", lj: [980, 1080, 1240] },
      ],
    },
    {
      id: "obstbau", label: "Gärtner/in – Obstbau",
      group: "Erwerbsgartenbau BaWü", urlaub: 26,
      tarife: [
        { ab: "2024-03-01", lj: [900, 1000, 1100] },
        { ab: "2025-05-01", lj: [980, 1080, 1240] },
      ],
    },
    {
      id: "stauden", label: "Gärtner/in – Staudengärtnerei",
      group: "Erwerbsgartenbau BaWü", urlaub: 26,
      tarife: [
        { ab: "2024-03-01", lj: [900, 1000, 1100] },
        { ab: "2025-05-01", lj: [980, 1080, 1240] },
      ],
    },
    {
      id: "zierpflanzen", label: "Gärtner/in – Zierpflanzenbau",
      group: "Erwerbsgartenbau BaWü", urlaub: 26,
      tarife: [
        { ab: "2024-03-01", lj: [900, 1000, 1100] },
        { ab: "2025-05-01", lj: [980, 1080, 1240] },
      ],
    },
  ],

  MINDESTVERGUETUNG: [
    { ab: "2024-01-01", lj: [649, 766, 876] },
    { ab: "2025-01-01", lj: [682, 805, 921] },
    { ab: "2026-01-01", lj: [724, 854, 977] },
  ],

  // Fachwerker/Fachpraktiker: Ausbildungsgeld der Arbeitsagentur (§122 SGB III)
  FACHWERKER_AUSBILDUNGSGELD: { elternhaushalt: 501, eigeneWohnung: 822 },

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

  // ── Tarif & Vergütung ──
  // Maßgeblich ist der Tarifstand zum AUSBILDUNGSBEGINN (im BAV vereinbart):
  // spätere Tariferhöhungen gelten nicht automatisch, nur bei freiwilliger
  // Anpassung durch den Betrieb (dann individuellen Bruttolohn eintragen).
  getTarifVerguetung(berufId, datum, lehrjahr, ausbildungsBeginn) {
    const beruf = this.BERUFE.find(b => b.id === berufId);
    if (!beruf) return 0;
    const lj = Math.max(1, Math.min(3, lehrjahr)) - 1;
    const tarifStichtag = ausbildungsBeginn || datum;
    let betrag = beruf.tarife[0].lj[lj];
    for (let i = beruf.tarife.length - 1; i >= 0; i--) {
      if (tarifStichtag >= this.parseISO(beruf.tarife[i].ab)) { betrag = beruf.tarife[i].lj[lj]; break; }
    }
    const miavStichtag = ausbildungsBeginn || datum;
    for (let i = this.MINDESTVERGUETUNG.length - 1; i >= 0; i--) {
      if (miavStichtag >= this.parseISO(this.MINDESTVERGUETUNG[i].ab)) {
        betrag = Math.max(betrag, this.MINDESTVERGUETUNG[i].lj[lj]); break;
      }
    }
    return betrag;
  },

  getJahresurlaub(berufId, geburtsdatum, jahr) {
    const beruf = this.BERUFE.find(b => b.id === berufId);
    const tarifTage = beruf ? beruf.urlaub : 26;
    if (!geburtsdatum) return { tage: tarifTage, grund: "tarif" };
    const alter = this.alterZuStichtag(geburtsdatum, new Date(jahr, 0, 1));
    if (alter >= 18) return { tage: tarifTage, grund: "tarif" };
    if (alter >= 17) return { tage: Math.max(tarifTage, 21), grund: "u18" };
    if (alter >= 16) return { tage: Math.max(tarifTage, 23), grund: "u17" };
    return { tage: Math.max(tarifTage, 25), grund: "u16" };
  },

  fruehesterPruefungstermin(endDate, vorzeitig) {
    if (!endDate) return null;
    const fiktivesEnde = vorzeitig ? this.addMonths(endDate, -6) : endDate;
    return this.addMonths(fiktivesEnde, -2);
  },

  pruefungstermine(umDatum, jahreRange) {
    jahreRange = jahreRange || 2;
    if (!umDatum) return [];
    const jahr = umDatum.getFullYear();
    const AP_MONATE = [1, 6];
    const arr = [];
    for (let y = jahr - jahreRange; y <= jahr + jahreRange; y++) {
      AP_MONATE.forEach(m => arr.push(new Date(y, m, 15)));
    }
    return arr.sort((a, b) => a - b);
  },

  apTerminAuto(vertragsende, vorzeitig) {
    if (!vertragsende) return null;
    const termine = this.pruefungstermine(vertragsende, 2);
    const cutoff = new Date(vertragsende);
    cutoff.setDate(cutoff.getDate() + 14);
    let idx = -1;
    for (let i = termine.length - 1; i >= 0; i--) {
      if (termine[i] <= cutoff) { idx = i; break; }
    }
    if (idx < 0) return null;
    if (!vorzeitig) return termine[idx];
    return idx > 0 ? termine[idx - 1] : null;
  },

  zpTerminAuto(start, effektiveDauerMonate) {
    if (!start) return null;
    const zielMonate = Math.round(effektiveDauerMonate * 14 / 36);
    const ziel = this.addMonths(start, zielMonate);
    const termine = this.pruefungstermine(ziel, 1);
    termine.sort((a, b) => Math.abs(ziel - a) - Math.abs(ziel - b));
    return termine[0];
  },

  // ── Vergütungsübersicht (phasen-bewusst) ──
  berechneVerguetungsUebersicht(cfg, phasenMit) {
    const { beruf_id, geburtsdatum, start_datum, verkuerzung_monate } = cfg;
    const startDate = this.parseISO(start_datum);
    if (isNaN(startDate)) return [];
    const verk = verkuerzung_monate || 0;
    const beruf = this.BERUFE.find(b => b.id === beruf_id);
    const ausbPhasen = phasenMit.filter(p => p.typ === "ausbildung");
    if (!ausbPhasen.length) return [];

    const perioden = [];
    let erbrachtVZ = 0;

    for (const phase of phasenMit) {
      // Offene Unterbrechung (bis UND _berechnetesEnde null) → Invalid Date wäre truthy
      // und NaN-Vergleiche greifen nicht → NaN-Periode in der Tabelle. Explizit überspringen.
      if (!phase.bis && !phase._berechnetesEnde) continue;
      const phVon = this.parseISO(phase.von);
      const phBis = this.parseISO(phase.bis || phase._berechnetesEnde);
      if (!phBis || isNaN(phBis) || phBis <= phVon) continue;

      if (phase.typ === "unterbrechung") {
        perioden.push({
          von: phVon, bis: phBis, unterbrechung: true, grund: phase.grund || "Unterbrechung",
          lehrjahr: 0, quote: 0, vergVZ: 0, vergEff: 0,
          monateDauer: Math.round(this.diffMonths(phVon, phBis) * 10) / 10,
          urlaubTageJahr: 0, urlaubGrund: "Unterbrechung", urlaubAnteilig: 0,
        });
        continue;
      }

      const quote = phase.teilzeit_prozent || 100;
      const tz = quote / 100;
      const breakpoints = new Set();

      for (let m = 1; m < this.diffMonths(phVon, phBis) + 1; m++) {
        const dat = this.addMonths(phVon, m);
        if (dat > phBis) break;
        const erbrPunkt = erbrachtVZ + m * tz + verk;
        const erbrPrev = erbrachtVZ + (m - 1) * tz + verk;
        if (Math.floor(erbrPunkt / 12) !== Math.floor(erbrPrev / 12)) breakpoints.add(this.fmtISO(dat));
      }
      // Tarif-/MiAV-Änderungsdaten sind KEINE Breakpoints mehr: es gilt
      // durchgehend der Tarifstand zum Ausbildungsbeginn (siehe getTarifVerguetung)
      for (let yr = phVon.getFullYear(); yr <= phBis.getFullYear() + 1; yr++) {
        const jan1 = new Date(yr, 0, 1);
        if (jan1 > phVon && jan1 < phBis) breakpoints.add(this.fmtISO(jan1));
      }

      const sorted = [...breakpoints].sort().map(s => this.parseISO(s));
      sorted.push(new Date(phBis));
      let periodStart = new Date(phVon);

      for (const bp of sorted) {
        if (bp <= periodStart) continue;
        const periodEnd = new Date(bp);
        const monateInPhase = this.diffMonths(phVon, periodStart);
        const erbrachtBisHier = erbrachtVZ + monateInPhase * tz + verk;
        const lehrjahr = Math.min(3, Math.floor(erbrachtBisHier / 12) + 1);
        const vergVZ = this.getTarifVerguetung(beruf_id, periodStart, lehrjahr, startDate);
        const vergEff = Math.round(vergVZ * tz);
        const monateDauer = Math.max(0, this.diffMonths(periodStart, periodEnd));
        const urlaubInfo = this.getJahresurlaub(beruf_id, geburtsdatum || null, periodStart.getFullYear());
        const urlaubAnteilig = Math.round((monateDauer / 12) * urlaubInfo.tage * tz * 2) / 2;
        perioden.push({
          von: new Date(periodStart), bis: new Date(periodEnd),
          unterbrechung: false, grund: null,
          lehrjahr, quote, vergVZ, vergEff,
          monateDauer: Math.round(monateDauer * 10) / 10,
          urlaubTageJahr: urlaubInfo.tage, urlaubGrund: urlaubInfo.grund, urlaubAnteilig,
          betrieb: phase.betrieb || null, phaseId: phase.id,
        });
        periodStart = new Date(bp);
      }
      erbrachtVZ += this.diffMonths(phVon, phBis) * tz;
    }

    const merged = [];
    for (const p of perioden) {
      const last = merged[merged.length - 1];
      if (last && !last.unterbrechung && !p.unterbrechung
          && last.vergEff === p.vergEff && last.lehrjahr === p.lehrjahr
          && last.urlaubTageJahr === p.urlaubTageJahr && last.quote === p.quote
          && last.betrieb === p.betrieb) {
        last.bis = p.bis;
        last.monateDauer = Math.round(this.diffMonths(last.von, last.bis) * 10) / 10;
        last.urlaubAnteilig = Math.round((last.monateDauer / 12) * last.urlaubTageJahr * (last.quote / 100) * 2) / 2;
      } else merged.push({ ...p });
    }
    return merged;
  },

  // ── Kennzahlen (alle KPIs auf einen Schlag) ──
  computeKennzahlen(schuelerId) {
    const s = App.query('SELECT * FROM schueler WHERE id=?', [schuelerId])[0];
    if (!s || !s.ausbildungsbeginn) return null;

    const phasenRaw = App.query('SELECT * FROM ausbildungsphasen WHERE schueler_id=? ORDER BY von', [schuelerId]);
    const cfg = {
      beruf_id: s.beruf_id || 'galabau',
      geburtsdatum: s.geburtsdatum || '',
      start_datum: s.ausbildungsbeginn,
      regulaer_dauer_monate: s.regulaer_dauer_monate || 36,
      verkuerzung_monate: s.verkuerzung_monate || 0,
      vorzeitige_zulassung: s.vorzeitige_zulassung || 0,
      teilzeit_prozent: 100,
      vollzeit_wochenstunden: s.vollzeit_wochenstunden || 39,
    };

    const phasen = phasenRaw.length ? phasenRaw : [
      { id: -1, von: cfg.start_datum, bis: s.ausbildungsende || null, typ: "ausbildung", teilzeit_prozent: 100, betrieb: s.ausbildungsstaette || '' }
    ];

    const phasenMit = this.phasenMitEnden(phasen, cfg.regulaer_dauer_monate, cfg.verkuerzung_monate);
    const start = this.parseISO(cfg.start_datum);
    const ende = this.vertragsendeAusPhasen(phasenMit) || this.addMonths(start, cfg.regulaer_dauer_monate);
    const heute = new Date();

    const aktPhase = this.aktivePhaseAm(phasenMit, heute);
    const tz = (aktPhase?.teilzeit_prozent ?? 100) / 100;
    const effektiveDauer = Math.max(6, cfg.regulaer_dauer_monate - (cfg.verkuerzung_monate || 0));
    const dauer = Math.round(this.diffMonths(start, ende));

    const kTageGes = Math.max(1, this.daysBetween(start, ende));
    const kTageVorbei = Math.max(0, Math.min(kTageGes, this.daysBetween(start, heute)));
    const progress = Math.round((kTageVorbei / kTageGes) * 100);

    const ausbildungsTageGes = this.tatsaechlicheAusbildungsTage(phasenMit, false);
    const atVollzeit = Math.round((ausbildungsTageGes / 7) * 5);
    const phasenAusb = phasenMit.filter(p => p.typ === "ausbildung");
    const tzMittel = phasenAusb.length
      ? phasenAusb.reduce((sum, p) => sum + ((p.teilzeit_prozent || 100) / 100) * (p._dauerMonate || 0), 0)
        / Math.max(0.001, phasenAusb.reduce((sum, p) => sum + (p._dauerMonate || 0), 0))
      : tz;
    const atGes = Math.round(atVollzeit * tzMittel);
    const fehltageSoft = Math.round(atGes * 0.10);
    const fehltageHart = Math.round(atGes * 0.15);

    const pf = this.pauschaleFehltage(phasen);

    // Aktuelles Lehrjahr
    // WICHTIG: Filter auf von <= heute — eine LAUFENDE Phase mit gesetztem Zukunfts-Ende
    // (der Normalfall: bis = ausbildungsende) darf NICHT ausgeschlossen werden,
    // sonst ist erbrachtVZ=0 und jeder Azubi steht im "1. Lehrjahr".
    const erbrachtVZ = phasenMit
      .filter(p => p.typ === "ausbildung" && this.parseISO(p.von) <= heute)
      .reduce((sum, p) => {
        const von = this.parseISO(p.von);
        const bis = p.bis ? this.parseISO(p.bis) : heute;
        const eff = bis < heute ? bis : heute;
        if (eff < von) return sum;
        return sum + this.diffMonths(von, eff) * ((p.teilzeit_prozent || 100) / 100);
      }, 0);
    const aktLehrjahr = Math.min(3, Math.max(1, Math.floor((erbrachtVZ + (cfg.verkuerzung_monate || 0)) / 12) + 1));

    const wochenstunden = +(cfg.vollzeit_wochenstunden * tz).toFixed(1);

    const isFachwerker = typeof App !== 'undefined' && App.isFachwerker && App.isFachwerker(s.fachrichtung_id);
    const hatIndividuellenLohn = s.brutto_lohn > 0;
    // Perioden IMMER berechnen (für Lehrjahr, Urlaub, TZ-Wechsel); Brutto wird ggf. überschrieben
    let perioden = isFachwerker ? [] : this.berechneVerguetungsUebersicht(cfg, phasenMit);
    if (hatIndividuellenLohn) {
      perioden = perioden.map(p => p.unterbrechung ? p : {
        ...p,
        vergVZ: s.brutto_lohn,
        vergEff: Math.round(s.brutto_lohn * (p.quote || 100) / 100),
      });
    }
    let aktVerg, aktPeriode = null;
    if (isFachwerker) {
      // Individueller Lohn (z.B. 822€ eigene Wohnung) überschreibt Pauschale
      aktVerg = s.brutto_lohn > 0 ? s.brutto_lohn : this.FACHWERKER_AUSBILDUNGSGELD.elternhaushalt;
    } else {
      aktPeriode = perioden.find(p => heute >= p.von && heute < p.bis && !p.unterbrechung) || perioden.filter(p => !p.unterbrechung).pop();
      aktVerg = aktPeriode ? aktPeriode.vergEff : (hatIndividuellenLohn ? s.brutto_lohn : 0);
    }

    const fruehPruef = this.fruehesterPruefungstermin(ende, false);
    const fruehPruefVorzeitig = this.fruehesterPruefungstermin(ende, true);
    const zpAuto = this.zpTerminAuto(start, dauer);
    const apAuto = this.apTerminAuto(ende, cfg.vorzeitige_zulassung);
    const zpManuell = s.zp_termin ? true : false;
    const apManuell = s.ap_termin ? true : false;
    const zpDate = zpManuell ? this.parseISO(s.zp_termin) : zpAuto;
    const apDate = apManuell ? this.parseISO(s.ap_termin) : apAuto;

    let naechsterMeilenstein = null;
    if (zpDate && zpDate > heute) naechsterMeilenstein = { titel: "Zwischenprüfung", datum: zpDate, tage: this.daysBetween(heute, zpDate) };
    else if (apDate && apDate > heute) naechsterMeilenstein = { titel: "Abschlussprüfung", datum: apDate, tage: this.daysBetween(heute, apDate) };
    else if (ende > heute) naechsterMeilenstein = { titel: "Ende der Ausbildung", datum: ende, tage: this.daysBetween(heute, ende) };

    const probleme = this.phasenValidieren(phasen);

    return {
      schueler: s, cfg, phasen, phasenMit, isFachwerker, hatIndividuellenLohn,
      tz, tzMittel, dauer, effektiveDauer, wochenstunden,
      start, ende, heute, kTageGes, kTageVorbei, progress,
      atVollzeit, atGes, fehltageSoft, fehltageHart, ausbildungsTageGes,
      pauschalFehltage: pf, aktLehrjahr, naechsterMeilenstein,
      perioden, aktVerg, aktPeriode, aktPhase,
      fruehPruef, fruehPruefVorzeitig, zpDate, apDate, zpAuto, apAuto, zpManuell, apManuell,
      probleme, erbrachtVZ,
    };
  },

  // ── Phasen aus DB laden ──
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

  _loadCustomTarife() {
    try {
      // Pristine-Kopien der ausgelieferten Standards einmalig sichern —
      // sonst ist "Auf Standard zurücksetzen" wirkungslos (Originale wurden in-place mutiert)
      if (!this._defaultTarife) {
        this._defaultTarife = JSON.parse(JSON.stringify(this.BERUFE.map(b => ({ id: b.id, tarife: b.tarife }))));
        this._defaultMiav = JSON.parse(JSON.stringify(this.MINDESTVERGUETUNG));
      }
      // Erst auf Standard zurücksetzen, dann Custom anwenden (falls vorhanden)
      this._defaultTarife.forEach(def => {
        const beruf = this.BERUFE.find(b => b.id === def.id);
        if (beruf) beruf.tarife = JSON.parse(JSON.stringify(def.tarife));
      });
      this.MINDESTVERGUETUNG = JSON.parse(JSON.stringify(this._defaultMiav));

      const ct = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='custom_tarife'");
      if (ct) {
        const custom = JSON.parse(ct);
        // Match per Beruf-ID (nicht per Index — Reihenfolge kann sich zwischen Versionen ändern)
        custom.forEach(cb => {
          const beruf = cb.id ? this.BERUFE.find(b => b.id === cb.id) : null;
          if (beruf && cb.tarife && cb.tarife.length) beruf.tarife = cb.tarife;
        });
        // Fallback für alte index-basierte Speicherungen (ohne id-Feld)
        if (custom.length && !custom[0].id) {
          custom.forEach((cb, i) => { if (this.BERUFE[i] && cb.tarife && cb.tarife.length) this.BERUFE[i].tarife = cb.tarife; });
        }
      }
      const cm = App.scalar("SELECT wert FROM einstellungen WHERE schluessel='custom_mindestverguetung'");
      if (cm) {
        const miav = JSON.parse(cm);
        if (Array.isArray(miav) && miav.length) this.MINDESTVERGUETUNG = miav;
      }
    } catch(e) { console.warn('Custom Tarife laden:', e); }
  },
};
