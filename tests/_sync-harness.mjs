// ═══════════════════════════════════════════════════════════════════
//  Gemeinsamer Harness für die Sync-Tests: Fake-Netzlaufwerk (Nachbau der
//  File System Access API) mit einschaltbaren Störungen, wie sie ein
//  Windows-Netzlaufwerk (SMB) im Alltag zeigt:
//   - readFail(name): Lesen eines Blobs schlägt fehl (NotReadableError –
//     Chrome wirft das, wenn sich die Datei zwischen getFile() und dem
//     Lesen geändert hat; bei Append-Logs, die per Swap-Datei ersetzt
//     werden, passiert das regelmäßig)
//   - Negativ-Cache pro Client (FileNotFoundCacheLifetime, 5 s): ein
//     Client, der einen Namen als "nicht vorhanden" gesehen hat, bekommt
//     ihn für 5 s weiterhin als fehlend gemeldet, obwohl ein anderer
//     Client ihn inzwischen angelegt hat (nur create:false-Lookups)
//   - Schreibfehler (InvalidStateError) für bestimmte Dateien
//  Dazu die App-Instanz (app-core.js) in einem eigenen vm-Kontext.
// ═══════════════════════════════════════════════════════════════════
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const initSqlJs = require(path.join(ROOT, 'libs/sql-wasm.js'));
export const APP_SRC = fs.readFileSync(path.join(ROOT, 'src/js/app-core.js'), 'utf8');

export function makeStore() {
  return {
    files: new Map(),
    readFail: () => false,        // (name) => boolean – Lesefehler auslösen
    writeFail: () => false,       // (name) => boolean – createWritable scheitert
    negativeCacheMs: 0,           // > 0: Negativ-Cache pro Client-Dir aktiv
    writes: 0, reads: 0,
  };
}

function fakeFile(store, name, entry) {
  const data = entry.data;
  const mkText = (start, end) => async () => {
    store.reads++;
    if (store.readFail(name)) { const err = new Error('The requested file could not be read'); err.name = 'NotReadableError'; throw err; }
    return new TextDecoder().decode(data.subarray(start ?? 0, end ?? data.length));
  };
  return {
    arrayBuffer: async () => {
      store.reads++;
      if (store.readFail(name)) { const err = new Error('The requested file could not be read'); err.name = 'NotReadableError'; throw err; }
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    },
    text: mkText(),
    slice: (start, end) => ({ text: mkText(start, end) }),
    lastModified: entry.mtime,
    size: data.length,
    name,
  };
}

export class FakeFileHandle {
  constructor(store, name) { this.store = store; this.name = name; this.kind = 'file'; }
  async getFile() {
    const e = this.store.files.get(this.name);
    if (!e) { const err = new Error('NotFound: ' + this.name); err.name = 'NotFoundError'; throw err; }
    return fakeFile(this.store, this.name, e);
  }
  async createWritable(opts = {}) {
    const store = this.store, name = this.name;
    if (store.writeFail(name)) { const err = new Error('state had changed since it was read from disk'); err.name = 'InvalidStateError'; throw err; }
    const base = opts.keepExistingData && store.files.get(name) ? store.files.get(name).data : new Uint8Array(0);
    let buf = Array.from(base);
    let pos = 0;
    let aborted = false;
    const put = (position, bytes) => {
      for (let i = 0; i < bytes.length; i++) buf[position + i] = bytes[i];
      pos = position + bytes.length;
    };
    return {
      async write(d) {
        if (aborted) throw new Error('stream aborted');
        let data = d, position = pos;
        if (d && typeof d === 'object' && d.type === 'write') { position = d.position ?? pos; data = d.data; }
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data)
          : data instanceof Uint8Array ? data : new Uint8Array(data);
        put(position, bytes);
      },
      async close() {
        if (aborted) throw new Error('stream aborted');
        store.writes++;
        store.files.set(name, { data: Uint8Array.from(buf, x => x || 0), mtime: Date.now() });
      },
      async abort() { aborted = true; },
    };
  }
}

export class FakeDir {
  constructor(store) { this.store = store; this.kind = 'directory'; this._negCache = new Map(); }
  async getFileHandle(name, opts = {}) {
    const neg = this.store.negativeCacheMs;
    if (!opts.create) {
      // Windows-Redirector: "nicht gefunden" wird für einige Sekunden gecacht
      if (neg > 0) {
        const until = this._negCache.get(name);
        if (until && until > Date.now()) { const err = new Error('NotFound(cached): ' + name); err.name = 'NotFoundError'; throw err; }
      }
      if (!this.store.files.has(name)) {
        if (neg > 0) this._negCache.set(name, Date.now() + neg);
        const err = new Error('NotFound: ' + name); err.name = 'NotFoundError'; throw err;
      }
      return new FakeFileHandle(this.store, name);
    }
    // create:true geht immer zum Server (OPEN_ALWAYS) – kein Negativ-Cache
    this._negCache.delete(name);
    if (!this.store.files.has(name)) this.store.files.set(name, { data: new Uint8Array(0), mtime: Date.now() });
    return new FakeFileHandle(this.store, name);
  }
  async getDirectoryHandle() { return this; }
  async removeEntry(name) { this.store.files.delete(name); }
  async *entries() {
    for (const name of [...this.store.files.keys()]) yield [name, new FakeFileHandle(this.store, name)];
  }
  async *values() { for (const name of [...this.store.files.keys()]) yield new FakeFileHandle(this.store, name); }
  [Symbol.asyncIterator]() { return this.entries(); }
}

export async function getSQL() { return initSqlJs({ locateFile: f => path.join(ROOT, 'libs', f) }); }

export function makeSeed(SQL, extraSql) {
  const seed = new SQL.Database();
  seed.run(APP_SRC.match(/SCHEMA: `([\s\S]*?)`,/)[1]);
  seed.run("INSERT INTO schueler (id,nachname,vorname,aktiv) VALUES (1,'Mustermann','Max',1),(2,'Beispiel','Berta',1),(3,'Dritte','Dora',1)");
  seed.run("INSERT INTO kontrolltermine (id,geplant_datum,status) VALUES (77,'2026-07-01','geplant')");
  if (extraSql) seed.run(extraSql);
  const bytes = seed.export();
  seed.close();
  return bytes;
}

// App-Instanz in eigenem vm-Kontext. opts.clientId erzwingt eine feste Client-Identität
// (z.B. "derselbe Rechner nach Neustart").
export async function makeClient(SQL, store, pruefer, dbBytes, opts = {}) {
  const el = () => ({ textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {} } });
  const ls = new Map();
  if (opts.clientId) ls.set('bhk_client_id', opts.clientId);
  const sandbox = {
    console: opts.quiet ? { log() {}, warn() {}, error() {} } : console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, TextEncoder, TextDecoder, Uint8Array, Set, Map,
    document: { getElementById: el, createElement: el, hidden: false, addEventListener() {}, body: { classList: { add() {}, remove() {}, contains: () => false } } },
    navigator: {},
    localStorage: { getItem: (k) => ls.has(k) ? ls.get(k) : null, setItem(k, v) { ls.set(k, String(v)); }, removeItem(k) { ls.delete(k); } },
    initSqlJs: async () => SQL,
    KontrolleHandler: { activePruefer: pruefer },
    TableSort: { init() {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(APP_SRC + '\n;globalThis.__App = App;', sandbox, { filename: 'app-core.js' });
  const app = sandbox.__App;
  app.toast = () => {};
  app.scheduleAutoSave = () => {};
  app._broadcastChange = () => {};
  app._updateNetworkQuality = () => {};
  app._updateNetworkUI = () => {};
  app._persistDirtyOps = async () => {};
  app._showConflicts = () => {};
  app.tryReconnect = async () => {};
  app._smartRefresh = () => {};
  app.markDirty = function () { this.unsavedChanges = true; };
  app.db = new SQL.Database(dbBytes);
  app.migrateDB();
  // Die Datenbankdatei liegt im (Fake-)Laufwerk – die Netzabriss-Probe fasst sie an
  if (!store.files.has('test.sqlite')) store.files.set('test.sqlite', { data: new Uint8Array(dbBytes), mtime: Date.now() });
  app.dbFileHandle = new FakeFileHandle(store, 'test.sqlite');
  app.dirHandle = opts.dir || new FakeDir(store);
  app.bhkDirHandle = null;
  app.autoLoadedDbName = 'test.sqlite';
  app.demoMode = false;
  app._networkQuality = 'good';
  app._syncReady = true;
  app._importChangeCount = 0;
  if (!opts.skipBootstrap) await app._bootstrapV3();
  return app;
}

export function makeChecker() {
  const state = { passed: 0, failed: 0 };
  const check = (cond, msg) => {
    if (cond) { state.passed++; console.log('  ✓ ' + msg); }
    else { state.failed++; console.error('  ✗ FEHLER: ' + msg); }
  };
  return { check, state };
}
