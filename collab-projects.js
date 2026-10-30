// =====================================================================
//  Colaboración de Proyectos  ·  extensión para TurboWarp (UNSANDBOXED)
//
//  - Sin bloques: todo se maneja desde un panel flotante (botón 👥).
//  - Salas: crear, unirse (lista pública o código) y salir (reinicia el editor).
//  - Anfitrión = autoridad. Guarda y ordena todos los cambios de todos, y
//    puede recargar el proyecto a quien tenga lag o se reconecte.
//  - Cursores con nombre, avisos de entrada/salida, chat y registro de actividad.
//  - Red: protocolo de Cloud32 (mensajes "gmsg" difundidos). Las salas se
//    resuelven en el cliente porque ese servidor no tiene salas.
//  - Archivos pesados (imágenes, sonidos, project.json) → YeetYourFiles (YYF).
// =====================================================================
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('"Colaboración de Proyectos" necesita ejecutarse sin sandbox (unsandboxed).');
  }
  // Si ya está cargada (p. ej. el proyecto de la sala también la incluye), no duplicar el panel.
  if (window.__projectCollab) {
    Scratch.extensions.register(window.__projectCollab);
    return;
  }

  /* ============================== constantes ============================== */
  const EXT_ID = 'projectcollab';
  const PROTO = 'CP1';
  const LS_KEY = 'projectcollab.settings.v1';
  const DEFAULTS = {
    name: '',
    server: 'wss://cloud32.vercel.app/',
    yyf: 'https://yyf.mubilop.com',
    cursors: true,
    toasts: true,
    syncProps: true
  };
  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const SYNC_EVENTS = new Set(['create', 'delete', 'change', 'move', 'var_create', 'var_rename', 'var_delete']);
  const EVENT_KEYS = ['type', 'blockId', 'varId', 'element', 'name', 'newValue', 'oldParentId', 'oldInputName',
    'newParentId', 'newInputName', 'newCoordinate', 'isLocal', 'isCloud', 'varName', 'varType', 'newName'];
  const MAX_INLINE = 10000; // bytes por mensaje (al ir doblemente codificado crece ~25 %); más grande → se sube a YYF

  /* ============================== utilidades ============================== */
  const enc = (s) => new TextEncoder().encode(s);
  const dec = (u) => new TextDecoder().decode(u);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rid = (n = 8) => {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    const a = new Uint8Array(n);
    try { crypto.getRandomValues(a); } catch (_) { for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); }
    for (let i = 0; i < n; i++) out += abc[a[i] % 36];
    return out;
  };
  const hashStr = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x); };
  const colorFor = (uid) => COLORS[hashStr(String(uid)) % COLORS.length];
  const roomCode = () => Array.from({ length: 6 }, () => ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]).join('');
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const targetKey = (t) => (t.isStage ? '@stage' : t.getName());
  const hasStreams = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  // Mini hiperscript para construir DOM sin innerHTML (todo texto va por textContent).
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  async function pipeBytes(u8, stream) {
    const w = stream.writable.getWriter();
    w.write(u8).catch(() => {});
    w.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  const gzip = (u8) => pipeBytes(u8, new CompressionStream('gzip'));
  const gunzip = (u8) => pipeBytes(u8, new DecompressionStream('gzip'));

  async function pool(limit, items, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
    });
    await Promise.all(workers);
  }

  // ZIP "stored" (sin compresión) para armar un .sb3 con project.json + assets.
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    let csize = 0;
    for (const c of central) csize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    let total = 0;
    for (const p of all) total += p.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // Evento de Blockly → objeto JSON plano (el XML viaja como texto).
  function serializeEvent(e) {
    const out = {};
    for (const k of EVENT_KEYS) {
      const v = e[k];
      if (v === undefined || typeof v === 'function') continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.x === 'number' && typeof v.y === 'number') out[k] = { x: v.x, y: v.y };
        continue;
      }
      out[k] = v;
    }
    if (e.xml) {
      out.xml = typeof e.xml === 'string' ? e.xml
        : (e.xml.outerHTML || (typeof XMLSerializer !== 'undefined' ? new XMLSerializer().serializeToString(e.xml) : ''));
    }
    return out;
  }
  const propsOf = (t) => ({
    x: Math.round(t.x * 100) / 100, y: Math.round(t.y * 100) / 100,
    s: Math.round(t.size * 100) / 100, d: Math.round(t.direction * 100) / 100,
    v: t.visible ? 1 : 0, c: t.currentCostume, r: t.rotationStyle, dr: t.draggable ? 1 : 0
  });

  /* ================================ estilos =============================== */
  const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.hidden{display:none!important}
.fab{position:fixed;right:18px;bottom:18px;width:54px;height:54px;border-radius:50%;border:0;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;font-size:24px;cursor:pointer;pointer-events:auto;box-shadow:0 8px 24px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;transition:transform .15s}
.fab:hover{transform:scale(1.07)}
.fabdot{position:absolute;left:2px;bottom:2px;width:14px;height:14px;border-radius:50%;border:2px solid #111827;background:#6b7280}
.fabdot.ok{background:#22c55e}.fabdot.wait{background:#eab308}.fabdot.bad{background:#ef4444}
.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}
.panel{position:fixed;right:18px;bottom:84px;width:390px;height:580px;min-width:300px;min-height:380px;max-width:96vw;max-height:92vh;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.5);display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;resize:both}
.head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1f2937;cursor:move;user-select:none}
.title{font-weight:700;font-size:14px;flex:1}
.chip{font-size:11px;padding:2px 8px;border-radius:99px;background:#374151;white-space:nowrap}
.chip.ok{background:#14532d;color:#bbf7d0}.chip.wait{background:#713f12;color:#fde68a}.chip.bad{background:#7f1d1d;color:#fecaca}
.x{background:none;border:0;color:#9ca3af;font-size:18px;cursor:pointer}
.tabs{display:flex;background:#1f2937;border-top:1px solid #374151;border-bottom:1px solid #374151}
.tab{flex:1;padding:8px 2px;background:none;border:0;border-bottom:2px solid transparent;color:#9ca3af;font-size:12px;cursor:pointer;position:relative}
.tab.on{color:#fff;border-bottom-color:#0ea5e9}
.tb{position:absolute;top:5px;right:6px;width:8px;height:8px;border-radius:50%;background:#ef4444}
.body{flex:1;min-height:0;position:relative}
.pane{position:absolute;inset:0;overflow:auto;padding:12px}
.pane.chat{padding:0;display:flex;flex-direction:column;overflow:hidden}
.card{background:#1f2937;border:1px solid #374151;border-radius:10px;padding:10px;margin-bottom:10px}
.card h4{margin:0 0 8px;font-size:13px}
input[type=text]{width:100%;background:#0b1220;color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:7px 9px;font-size:13px;outline:none}
input[type=text]:focus{border-color:#0ea5e9}
label.chk{display:flex;gap:6px;align-items:center;font-size:12.5px;margin:6px 0;cursor:pointer}
.btn{background:#374151;color:#e5e7eb;border:0;border-radius:8px;padding:7px 11px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.btn:hover{filter:brightness(1.15)}
.btn.primary{background:#0ea5e9;color:#04121c;font-weight:700}
.btn.danger{background:#dc2626;color:#fff}
.btn.sm{padding:4px 8px;font-size:11.5px}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.row{display:flex;gap:6px;align-items:center}.row.end{justify-content:flex-end}.row.wrap{flex-wrap:wrap}
.grow{flex:1;min-width:0}
.muted{color:#9ca3af;font-size:12px}
.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;letter-spacing:3px;background:#0b1220;padding:2px 8px;border-radius:6px}
.mem{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #2b3545}
.mem:last-child{border-bottom:0}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.warn{background:#713f12;color:#fde68a;border-radius:8px;padding:7px 9px;font-size:12px;margin-bottom:10px}
.chatlist{flex:1;overflow:auto;padding:12px}
.msg{margin-bottom:8px;font-size:13px;line-height:1.35;word-break:break-word}
.msg .who{font-weight:700;font-size:12px}
.msg .ts{color:#6b7280;font-size:10.5px;margin-left:6px}
.msg.sys{color:#9ca3af;font-style:italic;font-size:12px;text-align:center}
.chatbar{display:flex;gap:6px;padding:8px;border-top:1px solid #374151;background:#1f2937}
.act{font-size:12.5px;padding:5px 0;border-bottom:1px solid #2b3545;line-height:1.35}
.act .ts{color:#6b7280;font-size:10.5px;margin-right:6px}
.act.err{color:#fca5a5}
.prog{padding:6px 12px;background:#0b1220;border-top:1px solid #374151;font-size:11.5px}
.bar{height:5px;background:#374151;border-radius:3px;overflow:hidden;margin-top:4px}
.bar>i{display:block;height:100%;background:#0ea5e9;width:0;transition:width .2s}
.toasts{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.toast{background:#111827;color:#f3f4f6;border:1px solid #374151;border-left:4px solid #0ea5e9;border-radius:10px;padding:9px 14px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:420px;animation:cpin .2s}
.toast.join{border-left-color:#22c55e}.toast.leave{border-left-color:#f97316}.toast.err{border-left-color:#ef4444}.toast.chat{border-left-color:#a78bfa}
@keyframes cpin{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.cur{position:fixed;left:0;top:0;pointer-events:none;will-change:transform;transition:transform .09s linear,opacity .4s}
.cur svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
.cur .lab{position:absolute;left:14px;top:14px;color:#fff;font-size:11.5px;font-weight:600;padding:2px 7px;border-radius:6px;white-space:nowrap}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto}
.dlg{background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:14px;padding:18px;width:min(430px,92vw)}
.dlg h3{margin:0 0 8px;font-size:16px}
.dlg p{margin:0 0 14px;font-size:13px;line-height:1.45;color:#cbd5e1}
`;
  const cursorSvg = (color) => `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1.5 L2 14.5 L5.6 11.3 L8.2 17 L10.6 16 L8.1 10.4 L13 10.2 Z" fill="${color}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

  /* ============================ clase principal ============================ */
  class ProjectCollab {
    constructor() {
      window.__projectCollab = this;
      this.cfg = this._loadCfg();
      const uid = rid(10);
      this.me = {
        uid,
        name: (this.cfg.name || '').trim() || 'Usuario' + (100 + Math.floor(Math.random() * 900)),
        color: colorFor(uid)
      };
      // red
      this.ws = null; this.wsState = 'off'; this._wsTry = 0; this._wsTimer = null; this._manualClose = false; this._wantConn = false;
      this._outQ = []; this._curOut = null;
      // sala
      this.mode = 'lobby'; // lobby | joining | host | guest
      this.room = null;
      this.members = new Map();
      this.lobby = new Map();
      this.ready = false;
      this.seq = 0; this.lastSeq = -1;
      this.opLog = []; this.snap = null; this._snapP = null;
      this.assetUrls = {};
      this.chat = []; this.activity = [];
      this.pending = new Map(); this.lastCid = new Map(); this._cid = 0; this._lastResend = 0;
      this._quietUntil = 0; this._blockUntil = 0; this._burstAt = 0; this._burstN = 0;
      this.hostSeen = 0; this.hostOnline = true; this._lagTicks = 0; this._lastSyncAt = 0; this._lastNj = 0;
      this._early = []; this._applyQ = []; this._draining = false; this._needRefresh = false;
      this._bcast = []; this._bcastT = null;
      this._upQ = []; this._upT = null; this._upBusy = false;
      this._loadChain = Promise.resolve();
      this.loading = false; this.applyingRemote = false;
      this.structBusy = false; this.structDirty = false; this.lastStructSig = null; this._psT = null;
      this._lastProps = {}; this._miss = 0; this._missAt = 0;
      this.progress = null; this.unread = 0; this._leftRecently = new Set(); this._joinWait = null;
      this._cursors = new Map(); this._t = 0; this._hooked = false; this._blockly = null; this._refreshT = null; this._uiT = null;
      this.activeTab = 'lobby';

      this._buildUI();
      this._bindGlobal();
      this._tickT = setInterval(() => this._tick(), 1000);
      try { Scratch.vm.runtime.on('PROJECT_CHANGED', () => this._onProjectChanged()); } catch (_) { /* sin VM */ }
      this._tab('lobby');
      this._openPanel();
    }

    getInfo() {
      return {
        id: EXT_ID,
        name: 'Colaboración',
        color1: '#0ea5e9',
        color2: '#0284c7',
        color3: '#0369a1',
        blocks: [
          // No hay bloques: solo un botón de la paleta que abre el panel.
          { blockType: Scratch.BlockType.BUTTON, text: 'Abrir panel de colaboración', func: 'openPanel' }
        ]
      };
    }
    openPanel() { this._openPanel(); }

    /* ------------------------------ ajustes ------------------------------ */
    _loadCfg() {
      try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (_) { return Object.assign({}, DEFAULTS); }
    }
    _saveCfg() { try { localStorage.setItem(LS_KEY, JSON.stringify(this.cfg)); } catch (_) { /* ignore */ } }
    _setName(v) {
      v = String(v).trim().slice(0, 24);
      if (!v) return;
      this.me.name = v; this.cfg.name = v; this._saveCfg();
      const m = this.members.get(this.me.uid);
      if (m) m.name = v;
    }
    _yyfBase() { return String(this.cfg.yyf || DEFAULTS.yyf).trim().replace(/\/+$/, ''); }

    /* ============================== interfaz =============================== */
    _buildUI() {
      const host = document.createElement('div');
      host.id = 'projectcollab-root';
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
      document.body.appendChild(host);
      // Que las teclas escritas en el panel no lleguen al editor (Backspace borraría bloques).
      ['keydown', 'keyup', 'keypress'].forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));
      const root = host.attachShadow({ mode: 'open' });
      root.appendChild(h('style', null, CSS));
      this.$host = host; this.$root = root;
      this.$cursors = h('div');
      this.$toasts = h('div', { class: 'toasts' });
      this.$badge = h('span', { class: 'badge hidden' }, '0');
      this.$fabDot = h('span', { class: 'fabdot' });
      this.$fab = h('button', { class: 'fab', title: 'Colaboración', onclick: () => this._togglePanel() }, '👥', this.$badge, this.$fabDot);
      this.$panel = this._buildPanel();
      root.append(this.$panel, this.$fab, this.$cursors, this.$toasts);
    }

    _buildPanel() {
      const panel = h('div', { class: 'panel hidden' });
      this.$status = h('span', { class: 'chip' }, '…');
      const head = h('div', { class: 'head' },
        h('span', { class: 'title' }, '👥 Colaboración'), this.$status,
        h('button', { class: 'x', title: 'Cerrar', onclick: () => this._closePanel() }, '✕'));
      this._makeDraggable(panel, head);
      const defs = [['lobby', 'Salas'], ['room', 'Sala'], ['chat', 'Chat'], ['log', 'Actividad']];
      this._tabs = {}; this.$tabBtns = {};
      const tabbar = h('div', { class: 'tabs' });
      const body = h('div', { class: 'body' });
      for (const [id, label] of defs) {
        const dot = h('span', { class: 'tb hidden' });
        const btn = h('button', { class: 'tab', onclick: () => this._tab(id) }, label, dot);
        btn._dot = dot;
        this.$tabBtns[id] = btn;
        tabbar.append(btn);
      }
      this._tabs.lobby = this._buildLobby();
      this._tabs.room = this._buildRoom();
      this._tabs.chat = this._buildChat();
      this._tabs.log = this._buildLog();
      for (const [id] of defs) body.append(this._tabs[id].el);
      this.$prog = h('div', { class: 'prog hidden' });
      panel.append(head, tabbar, body, this.$prog);
      return panel;
    }

    _makeDraggable(panel, head) {
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest && e.target.closest('button')) return;
        const r = panel.getBoundingClientRect();
        const dx = e.clientX - r.left; const dy = e.clientY - r.top;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
        panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
        const move = (ev) => {
          panel.style.left = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx)) + 'px';
          panel.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)) + 'px';
        };
        const up = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        e.preventDefault();
      });
    }

    _card(title, ...kids) { return h('div', { class: 'card' }, title ? h('h4', null, title) : null, ...kids); }

    _buildLobby() {
      const nameIn = h('input', { type: 'text', maxlength: '24', placeholder: 'Tu nombre', value: this.me.name });
      nameIn.addEventListener('input', () => this._setName(nameIn.value));
      const roomIn = h('input', { type: 'text', maxlength: '40', placeholder: 'Nombre de la sala (opcional)' });
      const priv = h('input', { type: 'checkbox' });
      const codeIn = h('input', { type: 'text', maxlength: '8', placeholder: 'CÓDIGO', style: 'text-transform:uppercase;letter-spacing:3px' });
      const createBtn = h('button', { class: 'btn primary', onclick: () => this.createRoom(roomIn.value, priv.checked) }, 'Crear sala');
      const joinBtn = h('button', { class: 'btn primary', onclick: () => this.joinRoom(codeIn.value) }, 'Unirme');
      codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinRoom(codeIn.value); });
      const info = h('div', { class: 'warn hidden' });
      const list = h('div');
      const net = h('div', { class: 'row' });
      const el = h('div', { class: 'pane hidden' },
        info,
        this._card('Tu nombre', nameIn),
        this._card('Crear sala', roomIn,
          h('label', { class: 'chk' }, priv, 'Privada (no aparece en la lista; se entra solo con el código)'),
          h('div', { class: 'row end' }, createBtn)),
        this._card('Unirse con código', h('div', { class: 'row' }, h('div', { class: 'grow' }, codeIn), joinBtn)),
        this._card('Salas públicas', list),
        net);
      const update = () => {
        const inRoom = this.mode !== 'lobby';
        createBtn.disabled = inRoom; joinBtn.disabled = inRoom;
        info.classList.toggle('hidden', !inRoom);
        info.textContent = 'Ya estás en una sala. Sal de ella para crear otra o unirte a otra.';
        list.textContent = '';
        const rooms = [...this.lobby.values()].filter((r) => Date.now() - r.ts < 14000);
        if (!rooms.length) list.append(h('div', { class: 'muted' }, this.wsState === 'open' ? 'No hay salas públicas ahora mismo.' : 'Conectando con el servidor…'));
        for (const r of rooms) {
          list.append(h('div', { class: 'mem' },
            h('div', { class: 'grow' }, h('div', null, h('b', null, r.name || r.code)), h('div', { class: 'muted' }, `${r.host} · ${r.count} 👥 · ${r.code}`)),
            h('button', { class: 'btn sm primary', disabled: inRoom, onclick: () => this.joinRoom(r.code) }, 'Unirme')));
        }
        net.textContent = '';
        if (this.wsState !== 'open') net.append(h('span', { class: 'muted grow' }, 'Sin conexión con el servidor.'),
          h('button', { class: 'btn sm', onclick: () => this._reconnectNow() }, 'Reconectar'));
      };
      return { el, update };
    }

    _buildRoom() {
      const el = h('div', { class: 'pane hidden' });
      const update = () => {
        el.textContent = '';
        if (this.mode === 'lobby') {
          el.append(h('div', { class: 'muted' }, 'No estás en ninguna sala. Crea una o únete desde la pestaña «Salas».'));
          return;
        }
        const r = this.room;
        const isHost = this.mode === 'host';
        el.append(this._card(null,
          h('div', { class: 'row' }, h('b', { class: 'grow' }, r.name), h('span', { class: 'chip' }, isHost ? '👑 Anfitrión' : 'Invitado')),
          h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'muted' }, 'Código'), h('code', { class: 'code' }, r.code),
            h('button', { class: 'btn sm', onclick: () => this._copy(r.code) }, 'Copiar')),
          r.priv ? h('div', { class: 'muted', style: 'margin-top:6px' }, '🔒 Sala privada: no aparece en la lista.') : null));
        if (this.mode === 'joining') el.append(h('div', { class: 'warn' }, 'Entrando a la sala… esperando al anfitrión.'));
        if (this.mode === 'guest' && !this.hostOnline) el.append(h('div', { class: 'warn' }, 'Sin señal del anfitrión. Tus cambios se guardan cuando vuelva.'));
        if (this.mode === 'guest' && this.pending.size) el.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, `${this.pending.size} cambio(s) esperando confirmación del anfitrión.`));
        el.append(h('div', { class: 'muted', style: 'margin-bottom:8px' },
          this.ready ? `Sincronizado · cambio #${isHost ? this.seq : this.lastSeq}` : 'Sincronizando…'));
        const rows = [...this.members.values()].sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0) || a.name.localeCompare(b.name));
        const memCard = this._card(`Participantes (${rows.length})`);
        for (const m of rows) {
          const me = m.uid === this.me.uid;
          const online = me || Date.now() - m.last < 8000;
          memCard.append(h('div', { class: 'mem' },
            h('span', { class: 'dot', style: `background:${m.color};opacity:${online ? 1 : 0.35}` }),
            h('div', { class: 'grow' },
              h('div', null, m.name, me ? ' (tú)' : '', m.host ? ' 👑' : ''),
              h('div', { class: 'muted' }, online ? (m.tg ? `editando: ${m.tg}` : 'en línea') : 'sin señal')),
            isHost && !me ? h('button', { class: 'btn sm', title: 'Recargar el proyecto a esta persona', onclick: () => this.hostReload(m.uid) }, 'Recargar') : null,
            isHost && !me ? h('button', { class: 'btn sm danger', onclick: () => this.kick(m.uid) }, 'Expulsar') : null));
        }
        el.append(memCard);
        const acts = h('div', { class: 'row wrap' });
        if (this.mode === 'guest') acts.append(h('button', { class: 'btn', onclick: () => this.resyncMe() }, '↻ Re-sincronizar mi proyecto'));
        if (isHost) acts.append(h('button', { class: 'btn', onclick: () => this.hostReloadAll() }, '↻ Recargar a todos'));
        acts.append(h('button', { class: 'btn danger', onclick: () => this.leaveRoom() }, isHost ? 'Cerrar sala' : 'Salir de la sala'));
        el.append(acts);
      };
      return { el, update };
    }

    _buildChat() {
      const list = h('div', { class: 'chatlist' });
      const input = h('input', { type: 'text', maxlength: '500', placeholder: 'Escribe un mensaje…' });
      const send = () => { this.sendChat(input.value); input.value = ''; };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      const el = h('div', { class: 'pane chat hidden' }, list, h('div', { class: 'chatbar' }, input, h('button', { class: 'btn primary', onclick: send }, 'Enviar')));
      const update = () => {
        const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
        list.textContent = '';
        if (!this.chat.length) list.append(h('div', { class: 'muted' }, this.room ? 'Aún no hay mensajes.' : 'Entra a una sala para chatear.'));
        for (const m of this.chat) {
          const t = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (m.sys) list.append(h('div', { class: 'msg sys' }, `${m.text}`));
          else list.append(h('div', { class: 'msg' }, h('span', { class: 'who', style: `color:${colorFor(m.u)}` }, m.n), h('span', { class: 'ts' }, t), h('div', null, m.text)));
        }
        if (stick) list.scrollTop = list.scrollHeight;
      };
      return { el, update, input };
    }

    _buildLog() {
      const list = h('div');
      const el = h('div', { class: 'pane hidden' },
        h('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Todo lo que hace la gente en la sala. El anfitrión lo ordena y lo guarda.'), list);
      const update = () => {
        list.textContent = '';
        if (!this.activity.length) list.append(h('div', { class: 'muted' }, 'Sin actividad todavía.'));
        for (const a of this.activity.slice(-150).reverse()) {
          const t = new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          if (a.sys) list.append(h('div', { class: 'act err' }, h('span', { class: 'ts' }, t), a.text));
          else list.append(h('div', { class: 'act' }, h('span', { class: 'ts' }, t), h('b', { style: `color:${colorFor(a.u)}` }, a.n), ' ', a.text));
        }
      };
      return { el, update };
    }

    _tab(id) {
      this.activeTab = id;
      for (const k of Object.keys(this._tabs)) {
        this._tabs[k].el.classList.toggle('hidden', k !== id);
        this.$tabBtns[k].classList.toggle('on', k === id);
      }
      if (id === 'chat') this.unread = 0;
      if (id === 'lobby') { this._wantConn = true; this._connect(); this._sendEnv('lq', {}, { drop: true }); }
      this._ui();
      if (id === 'chat') setTimeout(() => this._tabs.chat.input.focus(), 30);
    }
    _openPanel() {
      this.$panel.classList.remove('hidden');
      if (this.mode === 'lobby') { this._wantConn = true; this._connect(); }
      this._ui();
    }
    _closePanel() { this.$panel.classList.add('hidden'); this._ui(); }
    _togglePanel() { this.$panel.classList.contains('hidden') ? this._openPanel() : this._closePanel(); }
    _panelOpen() { return !this.$panel.classList.contains('hidden'); }

    _ui() {
      if (this._uiT) return;
      this._uiT = setTimeout(() => { this._uiT = null; try { this._render(); } catch (e) { console.error('[Colab]', e); } }, 50);
    }
    _render() {
      // estado en la cabecera
      let txt; let cls;
      if (this.wsState === 'open') {
        cls = 'ok';
        txt = this.mode === 'lobby' ? 'Conectado' : `${this.room.name} · ${this.room.code}`;
        if (this.mode === 'guest' && !this.hostOnline) { cls = 'wait'; txt = 'Anfitrión sin señal'; }
      } else if (this.wsState === 'connecting' || (this._wantConn && this.wsState === 'off' && !this._manualClose)) { cls = 'wait'; txt = 'Conectando…'; }
      else { cls = 'bad'; txt = 'Sin conexión'; }
      this.$status.className = 'chip ' + cls; this.$status.textContent = txt;
      this.$fabDot.className = 'fabdot ' + cls;
      const showUnread = this.unread > 0 && !(this._panelOpen() && this.activeTab === 'chat');
      this.$badge.classList.toggle('hidden', !showUnread); this.$badge.textContent = String(this.unread);
      this.$tabBtns.chat._dot.classList.toggle('hidden', !(this.unread > 0 && this.activeTab !== 'chat'));
      // progreso
      if (this.progress) {
        const p = this.progress; const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        this.$prog.classList.remove('hidden');
        this.$prog.textContent = '';
        this.$prog.append(h('div', null, p.label + (p.total ? ` (${p.done}/${p.total})` : '')), h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })));
      } else this.$prog.classList.add('hidden');
      if (this._panelOpen()) {
        if (this.activeTab === 'chat') this.unread = 0;
        this._tabs[this.activeTab].update();
      }
    }
    _setProgress(label, done, total) { this.progress = label ? { label, done: done || 0, total: total || 0 } : null; this._ui(); }

    _toast(text, kind) {
      if (kind !== 'err' && !this.cfg.toasts) return;
      const t = h('div', { class: 'toast ' + (kind || '') }, text);
      this.$toasts.append(t);
      while (this.$toasts.children.length > 4) this.$toasts.firstChild.remove();
      setTimeout(() => t.remove(), kind === 'err' ? 7000 : 4500);
    }
    _copy(text) {
      try { navigator.clipboard.writeText(text).then(() => this._toast('Código copiado')); } catch (_) { this._toast(text); }
    }
    _modal(title, text, buttons) {
      return new Promise((resolve) => {
        const ov = h('div', { class: 'modal' });
        const done = (v) => { ov.remove(); resolve(v); };
        ov.append(h('div', { class: 'dlg' }, h('h3', null, title), h('p', null, text),
          h('div', { class: 'row end wrap' }, buttons.map((b) => h('button', { class: 'btn ' + (b.cls || ''), onclick: () => done(b.value) }, b.label)))));
        this.$root.append(ov);
      });
    }
    _confirm(title, text, okLabel, danger) {
      return this._modal(title, text, [{ label: 'Cancelar', value: false }, { label: okLabel || 'Aceptar', value: true, cls: danger ? 'danger' : 'primary' }]);
    }
    _reload() { try { window.location.reload(); } catch (_) { /* ignore */ } }

    /* ---------------------- mensajes de sistema / registro ---------------------- */
    _sysMsg(text, kind) {
      this.chat.push({ sys: true, text, ts: Date.now() });
      if (this.chat.length > 300) this.chat.shift();
      this._toast((kind === 'join' ? '🟢 ' : kind === 'leave' ? '🟠 ' : '') + text, kind);
      this._ui();
    }
    _logLine(text) {
      this.activity.push({ sys: true, text, ts: Date.now() });
      if (this.activity.length > 300) this.activity.shift();
      this._ui();
    }
    _err(e, prefix) {
      const msg = (prefix ? prefix + ': ' : '') + (e && e.message ? e.message : String(e));
      console.error('[Colab]', e);
      this._logLine(msg);
      this._toast(msg, 'err');
    }
    // Una línea por persona y por «racha» de trabajo (8 s): nunca un renglón por cada evento.
    _act(op) {
      if (op.k === 'pr') return; // posición/tamaño de sprites: demasiado ruido
      const T = op.ev && op.ev.type;
      let kind;
      if (op.k === 'ev') kind = ({ create: 'agregó bloques', delete: 'eliminó bloques', move: 'movió bloques', change: 'editó bloques', var_create: 'creó variables', var_rename: 'renombró variables', var_delete: 'eliminó variables' })[T] || 'editó bloques';
      else if (op.k === 'st') kind = 'cambió sprites, disfraces o sonidos';
      else kind = 'hizo un cambio grande';
      const now = Date.now();
      let a = this.activity[this.activity.length - 1];
      if (!(a && !a.sys && a.u === op.o && now - a.ts < 8000)) {
        a = { u: op.o, n: op.n || '?', ts: now, kinds: [], wheres: [], text: '' };
        this.activity.push(a);
        if (this.activity.length > 300) this.activity.shift();
      }
      a.ts = now;
      if (!a.kinds.includes(kind)) a.kinds.push(kind);
      if (op.tn) { const w = op.tn === '@stage' ? 'Escenario' : op.tn; if (!a.wheres.includes(w)) a.wheres.push(w); }
      a.text = a.kinds.join(' y ') + (a.wheres.length ? ' en «' + a.wheres[0] + '»' + (a.wheres.length > 1 ? ' y otros' : '') : '');
      this._ui();
    }

    /* =============================== chat ================================ */
    sendChat(text) {
      text = String(text || '').trim().slice(0, 500);
      if (!text || !this.room) return;
      const m = { id: rid(6), u: this.me.uid, n: this.me.name, text, ts: Date.now() };
      this._addChat(m);
      this._sendEnv('chat', { m: { id: m.id, text } });
    }
    _addChat(m) {
      if (this.chat.some((x) => x.id === m.id)) return false;
      this.chat.push(m);
      if (this.chat.length > 300) this.chat.shift();
      this._ui();
      return true;
    }
    _hChat(env) {
      const m = env.m;
      if (!m || typeof m.text !== 'string') return;
      const msg = { id: String(m.id || rid(6)).slice(0, 12), u: env.f, n: String(env.n || '?').slice(0, 24), text: m.text.slice(0, 500), ts: Date.now() };
      if (!this._addChat(msg)) return;
      const watching = this._panelOpen() && this.activeTab === 'chat';
      if (!watching) { this.unread++; this._toast(`💬 ${msg.n}: ${msg.text.slice(0, 80)}`, 'chat'); }
    }

    /* =============================== red ================================= */
    _connect() {
      // No fiarse solo de la bandera: si el socket real está cerrándose o cerrado, descartarlo y reconectar.
      if (this.ws && this.ws.readyState > 1) { try { this.ws.close(); } catch (_) { /* ignore */ } this.ws = null; this.wsState = 'off'; }
      if (this.ws && (this.wsState === 'open' || this.wsState === 'connecting')) return;
      clearTimeout(this._wsTimer);
      this._manualClose = false;
      let ws;
      try { ws = new WebSocket(String(this.cfg.server).trim()); } catch (e) { this.wsState = 'off'; this._toast('URL del servidor inválida', 'err'); this._ui(); return; }
      this.ws = ws; this.wsState = 'connecting'; this._ui();
      ws.addEventListener('open', () => { if (this.ws !== ws) return; this.wsState = 'open'; this._wsTry = 0; this._onOpen(); this._ui(); });
      ws.addEventListener('message', (ev) => { if (this.ws === ws) this._onRaw(ev.data); });
      ws.addEventListener('close', () => {
        if (this.ws !== ws) return;
        this.ws = null; this.wsState = 'off'; this._ui();
        if (!this._manualClose && this._wantConn) this._scheduleReconnect();
      });
      ws.addEventListener('error', () => { /* siempre va seguido de close */ });
    }
    _scheduleReconnect() {
      clearTimeout(this._wsTimer);
      const d = Math.min(15000, 1000 * Math.pow(2, this._wsTry++));
      this._wsTimer = setTimeout(() => this._connect(), d);
    }
    _reconnectNow() {
      this._manualClose = true;
      clearTimeout(this._wsTimer);
      const old = this.ws; this.ws = null; this.wsState = 'off';
      try { old && old.close(); } catch (_) { /* ignore */ }
      this._wsTry = 0; this._wantConn = true;
      this._connect();
    }
    _rawSend(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
    _onOpen() {
      const clean = this.me.name.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 14) || 'user';
      this._rawSend({ cmd: 'setid', val: clean + '#' + this.me.uid.slice(0, 4) });
      while (this._outQ.length) this._rawSend(this._outQ.shift());
      if (this.mode === 'guest') this._sendJoin(true);
      else if (this.mode === 'host') {
        for (const m of this.members.values()) m.last = Date.now(); // gracia tras reconectar
        this._sendEnv('hostback', {});
        this._announce();
      } else if (this.mode === 'lobby') this._sendEnv('lq', {}, { drop: true });
    }
    _sendEnv(t, body, opts) {
      const env = Object.assign({ p: PROTO, f: this.me.uid, n: this.me.name, t }, this.room ? { r: this.room.code } : {}, body || {});
      const msg = { cmd: 'gmsg', val: JSON.stringify(env) };
      if (this.wsState === 'open' && this.ws && this.ws.readyState === 1) this._rawSend(msg);
      else if (!(opts && opts.drop)) { this._outQ.push(msg); if (this._outQ.length > 300) this._outQ.shift(); }
    }
    _sendChunked(t, ops, extra) {
      let chunk = []; let size = 0;
      for (const o of ops) {
        const s = JSON.stringify(o).length;
        if (chunk.length && size + s > MAX_INLINE) { this._sendEnv(t, Object.assign({ ops: chunk }, extra)); chunk = []; size = 0; }
        chunk.push(o); size += s;
      }
      if (chunk.length) this._sendEnv(t, Object.assign({ ops: chunk }, extra));
    }
    _onRaw(data) {
      let msg;
      try { msg = JSON.parse(data); } catch (_) { return; }
      if (!msg || msg.cmd !== 'gmsg') return;
      let env = msg.val;
      if (typeof env === 'string') { try { env = JSON.parse(env); } catch (_) { return; } }
      if (!env || typeof env !== 'object' || env.p !== PROTO || env.f === this.me.uid) return;
      this._dispatch(env);
    }

    _dispatch(env) {
      const t = env.t;
      if (t === 'lq') { if (this.mode === 'host') this._announce(); return; }
      if (t === 'ann') {
        if (env.code && !(this.room && this.room.code === env.code)) {
          const code = String(env.code).slice(0, 8);
          this.lobby.set(code, { code, name: String(env.rn || '').slice(0, 40), host: String(env.n || '').slice(0, 24), count: +env.cnt || 1, ts: Date.now() });
          this._ui();
        }
        return;
      }
      if (!this.room || env.r !== this.room.code) return;
      const m = this.members.get(env.f);
      if (m) {
        m.last = Date.now();
        if (env.n && m.name !== env.n) { m.name = String(env.n).slice(0, 24); if (this.mode === 'host') this._broadcastRoster(); }
      }
      if (env.f === this.room.hostUid) this._hostHeard();
      const fromHost = env.f === this.room.hostUid;
      const run = (fn) => { try { const r = fn.call(this, env); if (r && r.catch) r.catch((e) => this._err(e)); } catch (e) { this._err(e); } };
      switch (t) {
        case 'join': run(this._hJoin); break;
        case 'prep': if (env.to === this.me.uid) this._setProgress('El anfitrión está preparando el proyecto…'); if (this._joinWait) this._joinWait.deadline = Date.now() + 180000; break;
        case 'welcome': run(this._hWelcome); break;
        case 'roster': if (fromHost && this.mode !== 'host') this._setRoster(env.list || []); break;
        case 'hb': this._hHb(env); break;
        case 'cur': this._onCur(env); break;
        case 'chat': this._hChat(env); break;
        case 'up': run(this._hUp); break;
        case 'ops': if (fromHost) run(this._hOps); break;
        case 'sync': run(this._hSync); break;
        case 'force': if (fromHost) run(this._hForce); break;
        case 'nj': if (fromHost && env.to === this.me.uid && this.mode === 'guest' && Date.now() - this._lastNj > 4000) { this._lastNj = Date.now(); this._sendJoin(true); } break;
        case 'leave': this._hLeave(env); break;
        case 'close': if (fromHost && this.mode === 'guest') run(this._hClose); break;
        case 'kick': if (fromHost && env.to === this.me.uid) run(this._hKick); break;
        case 'assets': if (env.map && typeof env.map === 'object') Object.assign(this.assetUrls, env.map); break;
        default: break;
      }
    }
    _hostHeard() {
      this.hostSeen = Date.now();
      if (!this.hostOnline) {
        this.hostOnline = true;
        if (this.mode === 'guest' && this.ready) { this._toast('El anfitrión volvió', 'join'); this._resendPending(); this._requestSync(true); }
        this._ui();
      }
    }

    /* ============================ salas y presencia ============================ */
    _freshCode() {
      let c = roomCode();
      while (this.lobby.has(c)) c = roomCode();
      return c;
    }
    _rosterList() { return [...this.members.values()].map((m) => ({ u: m.uid, n: m.name })); }
    _broadcastRoster() { this._sendEnv('roster', { list: this._rosterList() }); this._ui(); }
    _announce() {
      if (this.mode !== 'host' || this.room.priv) return;
      this._sendEnv('ann', { code: this.room.code, rn: this.room.name, cnt: this.members.size }, { drop: true });
    }

    async createRoom(name, priv) {
      if (this.mode !== 'lobby') return;
      this._wantConn = true; this._connect();
      const code = this._freshCode();
      this.room = {
        code, name: String(name || '').trim().slice(0, 40) || `Sala de ${this.me.name}`,
        hostUid: this.me.uid, hostName: this.me.name, priv: !!priv
      };
      this.mode = 'host'; this.ready = true; this.seq = 0; this.lastSeq = 0;
      this.opLog = []; this.snap = null; this.assetUrls = {}; this.pending.clear(); this.lastCid.clear();
      this.chat = []; this.activity = [];
      this.members = new Map([[this.me.uid, { uid: this.me.uid, name: this.me.name, color: this.me.color, last: Date.now(), tg: this._editingName(), host: true }]]);
      this.lastStructSig = this._structSig(); this._lastProps = {};
      this._hook();
      this._sysMsg(`Sala «${this.room.name}» creada. Código: ${code}`);
      this._announce();
      this._tab('room');
    }

    async joinRoom(code) {
      code = String(code || '').trim().toUpperCase();
      if (this.mode !== 'lobby') return;
      if (!/^[A-Z0-9]{4,8}$/.test(code)) { this._toast('Escribe un código válido', 'err'); return; }
      const ok = await this._confirm('Unirte a la sala',
        'Tu proyecto actual será REEMPLAZADO por el de la sala. Guárdalo antes (Archivo → Guardar en tu computadora) si lo quieres conservar. Únete solo a salas de gente de confianza.', 'Unirme');
      if (!ok || this.mode !== 'lobby') return;
      this._wantConn = true; this._connect();
      const known = this.lobby.get(code);
      this.room = { code, name: (known && known.name) || code, hostUid: null, hostName: '', priv: false };
      this.mode = 'joining'; this.ready = false; this.lastSeq = -1; this.members = new Map();
      this.assetUrls = {}; this._early = []; this._applyQ = []; this.pending.clear();
      this.chat = []; this.activity = [];
      this._joinWait = { deadline: Date.now() + 9000, tries: 0 };
      this._sendJoin(false);
      this._tab('room');
    }
    _sendJoin(rejoin) { this._sendEnv('join', { rj: rejoin ? this.lastSeq : -1 }); }

    async _hJoin(env) {
      if (this.mode !== 'host') return;
      const uid = env.f;
      const known = this.members.has(uid);
      const rj = typeof env.rj === 'number' ? env.rj : -1;
      this.members.set(uid, { uid, name: String(env.n || 'Usuario').slice(0, 24), color: colorFor(uid), last: Date.now(), tg: '', host: false });
      if (!this.lastCid.has(uid)) this.lastCid.set(uid, new Set());
      if (!known) this._sysMsg(`${env.n} ${rj >= 0 ? 'se reconectó' : 'se unió a la sala'}`, 'join');
      this._broadcastRoster();
      if (rj >= 0 && rj <= this.seq) {
        this._sendEnv('welcome', { to: uid, rejoin: 1, rn: this.room.name, roster: this._rosterList(), seq: this.seq });
        return;
      }
      this._sendEnv('prep', { to: uid });
      try {
        const snap = await this._ensureSnapshot();
        // Historial de chat acotado para que el mensaje de bienvenida quepa en un solo paquete.
        const chat = []; let csz = 0;
        for (let i = this.chat.length - 1; i >= 0 && chat.length < 60; i--) {
          const c = this.chat[i];
          if (c.sys) continue;
          const sz = c.text.length + c.n.length + 70;
          if (csz + sz > 6000) break;
          csz += sz; chat.unshift({ id: c.id, u: c.u, n: c.n, text: c.text, ts: c.ts });
        }
        this._sendEnv('welcome', { to: uid, rn: this.room.name, roster: this._rosterList(), snap, seq: snap.seq, chat });
      } catch (e) {
        this._err(e, 'No pude preparar el proyecto para ' + env.n);
        this._sendEnv('kick', { to: uid, why: 'El anfitrión no pudo preparar el proyecto.' });
        this.members.delete(uid); this._broadcastRoster();
      }
    }

    async _hWelcome(env) {
      if (env.to !== this.me.uid || (this.mode !== 'joining' && this.mode !== 'guest')) return;
      this.room.hostUid = env.f; this.room.hostName = String(env.n || ''); this.room.name = String(env.rn || this.room.name);
      this.hostSeen = Date.now(); this.hostOnline = true;
      this._setRoster(env.roster || []);
      if (env.rejoin) {
        this.mode = 'guest'; this._joinWait = null;
        this._resendPending(); this._requestSync(true); this._ui();
        return;
      }
      if (this.mode !== 'joining') return;
      this._joinWait = null; this.mode = 'guest';
      if (Array.isArray(env.chat)) for (const c of env.chat) this._addChat({ id: String(c.id), u: String(c.u), n: String(c.n).slice(0, 24), text: String(c.text).slice(0, 500), ts: +c.ts || Date.now() });
      try {
        if (!env.snap) throw new Error('El anfitrión no envió el proyecto');
        await this._applyBundle(env.snap);
      } catch (e) {
        this._err(e, 'No se pudo cargar el proyecto de la sala');
        this._exitRoomState();
        return;
      }
      this.lastSeq = env.snap.seq;
      this.ready = true;
      this.lastStructSig = this._structSig(); this._lastProps = {};
      this._hook();
      const early = this._early.splice(0);
      for (const e of early) this._hOps(e);
      this._requestSync(true);
      this._sysMsg(`Te uniste a «${this.room.name}»`, 'join');
      this._ui();
    }

    _setRoster(list) {
      const prev = this.members; const next = new Map();
      for (const r of list) {
        const uid = String(r.u); const old = prev.get(uid);
        next.set(uid, { uid, name: String(r.n || '?').slice(0, 24), color: colorFor(uid), last: old ? old.last : Date.now(), tg: old ? old.tg : '', host: uid === this.room.hostUid, curAt: old ? old.curAt : 0 });
      }
      this.members = next;
      for (const [uid, m] of next) if (!prev.has(uid) && uid !== this.me.uid && this.ready) this._sysMsg(`${m.name} se unió a la sala`, 'join');
      for (const [uid, m] of prev) {
        if (next.has(uid) || uid === this.me.uid) continue;
        this._removeCursor(uid);
        if (this._leftRecently.has(uid)) this._leftRecently.delete(uid);
        else this._sysMsg(`${m.name} se desconectó`, 'leave');
      }
      this._ui();
    }

    _hHb(env) {
      const m = this.members.get(env.f);
      if (m) m.tg = String(env.tg || '').slice(0, 40);
      else if (this.mode === 'host' && Date.now() - this._lastNj > 1500) { this._lastNj = Date.now(); this._sendEnv('nj', { to: env.f }); }
      if (this.mode === 'guest' && this.ready && env.f === this.room.hostUid && typeof env.seq === 'number') {
        if (env.seq > this.lastSeq) { if (++this._lagTicks >= 2) { this._lagTicks = 0; this._requestSync(); } } else this._lagTicks = 0;
      }
      this._ui();
    }

    _hLeave(env) {
      const m = this.members.get(env.f);
      if (!m) return;
      this._leftRecently.add(env.f);
      this._removeCursor(env.f);
      this._sysMsg(`${m.name} salió de la sala`, 'leave');
      if (this.mode === 'host') { this.members.delete(env.f); this._broadcastRoster(); }
    }
    async _hClose() {
      this._sysMsg('El anfitrión cerró la sala', 'leave');
      this._exitRoomState();
      const again = await this._modal('Sala cerrada', 'El anfitrión cerró la sala. Conservas tu copia del proyecto en este editor. ¿Quieres reiniciar el editor ahora?',
        [{ label: 'Seguir aquí', value: false }, { label: 'Reiniciar editor', value: true, cls: 'primary' }]);
      if (again) this._reload();
    }
    async _hKick(env) {
      this._exitRoomState();
      this._toast(env.why || 'Fuiste expulsado de la sala', 'err');
    }
    _exitRoomState() {
      this.mode = 'lobby'; this.room = null; this.members = new Map(); this.ready = false;
      this.seq = 0; this.lastSeq = -1; this.opLog = []; this.snap = null;
      this.pending.clear(); this.lastCid.clear(); this._applyQ = []; this._early = []; this._upQ = [];
      this.hostOnline = true; this._joinWait = null; this.progress = null;
      this._clearCursors();
      this._tab('lobby');
    }

    async leaveRoom() {
      if (this.mode === 'lobby') return;
      const host = this.mode === 'host';
      const ok = await this._confirm(host ? 'Cerrar la sala' : 'Salir de la sala',
        (host ? 'Cerrarás la sala para todos y ' : '') + 'el editor se reiniciará al salir. Guarda antes tu copia si quieres conservarla (Archivo → Guardar en tu computadora).',
        host ? 'Cerrar y reiniciar' : 'Salir y reiniciar', true);
      if (!ok) return;
      this._sendEnv(host ? 'close' : 'leave', {});
      const ws = this.ws;
      this._exitRoomState();
      setTimeout(() => { this._manualClose = true; this._wantConn = false; try { ws && ws.close(); } catch (_) { /* ignore */ } this._reload(); }, 250);
    }

    async kick(uid) {
      const m = this.members.get(uid);
      if (!m || this.mode !== 'host') return;
      if (!(await this._confirm('Expulsar', `¿Expulsar a ${m.name} de la sala?`, 'Expulsar', true))) return;
      this._sendEnv('kick', { to: uid, why: 'El anfitrión te expulsó de la sala.' });
      this.members.delete(uid); this._removeCursor(uid);
      this._sysMsg(`${m.name} fue expulsado`, 'leave');
      this._broadcastRoster();
    }
    async hostReload(uid, force = true) {
      if (this.mode !== 'host') return;
      try {
        // Manual (botón «Recargar») = foto nueva del estado real del anfitrión.
        // Automático (alguien muy desfasado) = foto existente + registro de cambios, sin resubir todo.
        const snap = await this._ensureSnapshot(force);
        this._sendEnv('force', { to: uid, snap });
        this._toast('Proyecto reenviado');
      } catch (e) { this._err(e, 'No se pudo recargar'); }
    }
    async hostReloadAll() {
      if (this.mode !== 'host') return;
      try {
        const snap = await this._ensureSnapshot(true);
        this._sendEnv('force', { all: 1, snap });
        this._toast('Proyecto reenviado a todos');
      } catch (e) { this._err(e, 'No se pudo recargar'); }
    }
    resyncMe() {
      if (this.mode !== 'guest') return;
      this._toast('Pidiendo el proyecto al anfitrión…');
      this._lastSyncAt = 0;
      this._sendEnv('sync', { last: -1 });
    }

    /* ============================ temporizador ============================ */
    _tick() {
      this._t++;
      const now = Date.now();
      if (this.room && this.wsState === 'open' && this._t % 2 === 0 && (this.mode === 'host' || this.mode === 'guest')) {
        this._sendEnv('hb', { tg: this._editingName(), seq: this.mode === 'host' ? this.seq : undefined }, { drop: true });
      }
      if (this._t % 4 === 0) this._announce();
      for (const [k, v] of this.lobby) if (now - v.ts > 14000) this.lobby.delete(k);
      if (this._t % 20 === 0) this._leftRecently.clear();
      if (this.mode === 'host') {
        for (const [uid, m] of [...this.members]) {
          if (uid !== this.me.uid && now - m.last > 12000) {
            this.members.delete(uid); this._removeCursor(uid);
            this._sysMsg(`${m.name} perdió la conexión`, 'leave');
            this._broadcastRoster();
          }
        }
        const me = this.members.get(this.me.uid); if (me) me.tg = this._editingName();
        if (this._t % 10 === 0 && this.snap && !this._snapP && (this.opLog.length > 400 || (this.seq > this.snap.seq && now - (this.snap.ts || 0) > 60000))) {
          this._ensureSnapshot(true).catch((e) => this._err(e, 'Snapshot automático'));
        }
      }
      // Cambios sin confirmar tras 5 s (mensaje perdido): reenviar; el anfitrión ignora los duplicados.
      if (this.mode === 'guest' && this.ready && this.wsState === 'open' && this.pending.size && now - this._lastResend > 5000) {
        let oldest = now;
        for (const p of this.pending.values()) if (p.ts && p.ts < oldest) oldest = p.ts;
        if (now - oldest > 5000) { this._lastResend = now; this._resendPending(); }
      }
      if (this.mode === 'guest' && this.hostOnline && now - this.hostSeen > 9000) {
        this.hostOnline = false;
        this._toast('Sin señal del anfitrión. Tus cambios se enviarán cuando vuelva.', 'err');
        this._ui();
      }
      if (this.mode === 'joining' && this._joinWait && now > this._joinWait.deadline) {
        if (this._joinWait.tries < 2) { this._joinWait.tries++; this._joinWait.deadline = now + 8000; this._sendJoin(false); }
        else { this._toast('La sala no responde. ¿El anfitrión sigue conectado y el código es correcto?', 'err'); this._exitRoomState(); }
      }
      for (const [uid, c] of this._cursors) {
        const m = this.members.get(uid); const age = now - (m ? m.curAt || 0 : 0);
        c.el.style.opacity = age > 25000 ? '0' : age > 8000 ? '0.35' : '1';
      }
      this._pollProps();
      if (this._t % 3 === 0 && this._panelOpen()) this._ui();
    }

    /* ============================ cursores ============================ */
    _bindGlobal() {
      window.addEventListener('pointermove', (e) => {
        if (!this.room || !this.cfg.cursors) return;
        // Sobre el editor de bloques: coordenadas DEL ESPACIO DE TRABAJO (igual para todos aunque cada uno
        // tenga otro scroll, zoom o tamaño de ventana). Fuera del editor: fracción de la ventana.
        const p = this._wsPoint(e.clientX, e.clientY);
        this._curOut = p ? { w: 1, x: p.x, y: p.y } : { w: 0, x: e.clientX / Math.max(1, window.innerWidth), y: e.clientY / Math.max(1, window.innerHeight) };
      }, { capture: true, passive: true });
      this._curTimer = setInterval(() => {
        for (const uid of this._cursors.keys()) this._placeCursor(uid); // seguir tu propio scroll/zoom
        if (!this._curOut || this.wsState !== 'open' || !this.room || !(this.mode === 'host' || this.ready)) return;
        const c = this._curOut; this._curOut = null;
        this._sendEnv('cur', { w: c.w, x: r3(c.x), y: r3(c.y), tg: this._editingName() }, { drop: true });
      }, 70);
      window.addEventListener('pagehide', () => {
        if (this.mode !== 'lobby' && this.wsState === 'open') this._sendEnv(this.mode === 'host' ? 'close' : 'leave', {});
      });
    }
    _onCur(env) {
      if (!this.cfg.cursors || typeof env.x !== 'number' || typeof env.y !== 'number') return;
      const m = this.members.get(env.f);
      if (!m) return;
      m.curAt = Date.now(); m.tg = String(env.tg || '').slice(0, 40);
      let c = this._cursors.get(env.f);
      if (!c) {
        const lab = h('div', { class: 'lab', style: `background:${m.color}` });
        const el = h('div', { class: 'cur' }, lab);
        el.insertAdjacentHTML('afterbegin', cursorSvg(m.color));
        this.$cursors.append(el);
        c = { el, lab }; this._cursors.set(env.f, c);
      }
      c.lab.textContent = m.name + (m.tg ? ' · ' + m.tg : '');
      m.cur = { w: env.w ? 1 : 0, x: env.x, y: env.y };
      this._placeCursor(env.f);
      c.el.style.opacity = '1';
    }
    _wsGeom() {
      try {
        const B = this._blockly; const ws = B && B.getMainWorkspace && B.getMainWorkspace();
        if (!ws || typeof ws.getParentSvg !== 'function') return null;
        const r = ws.getParentSvg().getBoundingClientRect();
        if (!r || !r.width) return null;
        return { r, sx: +ws.scrollX || 0, sy: +ws.scrollY || 0, k: +ws.scale || 1 };
      } catch (_) { return null; }
    }
    _wsPoint(cx, cy) {
      const g = this._wsGeom();
      if (!g || cx < g.r.left || cx > g.r.right || cy < g.r.top || cy > g.r.bottom) return null;
      return { x: (cx - g.r.left - g.sx) / g.k, y: (cy - g.r.top - g.sy) / g.k };
    }
    // Coloca el cursor de otra persona. Si estaba sobre el editor de bloques, se proyecta con TU scroll/zoom;
    // si edita otro sprite, su posición no tiene sentido aquí y se oculta (el nombre del sprite va en la lista).
    _placeCursor(uid) {
      const m = this.members.get(uid); const c = this._cursors.get(uid);
      if (!m || !c || !m.cur) return;
      let px; let py;
      if (m.cur.w) {
        const g = this._wsGeom();
        if (!g || (m.tg || '') !== this._editingName()) { c.el.style.visibility = 'hidden'; return; }
        px = Math.max(g.r.left, Math.min(g.r.right - 4, g.r.left + g.sx + m.cur.x * g.k));
        py = Math.max(g.r.top, Math.min(g.r.bottom - 4, g.r.top + g.sy + m.cur.y * g.k));
      } else {
        px = Math.max(0, Math.min(1, m.cur.x)) * window.innerWidth; py = Math.max(0, Math.min(1, m.cur.y)) * window.innerHeight;
      }
      c.el.style.visibility = '';
      c.el.style.transform = `translate(${px}px,${py}px)`;
    }
    _removeCursor(uid) { const c = this._cursors.get(uid); if (c) { c.el.remove(); this._cursors.delete(uid); } }
    _clearCursors() { for (const c of this._cursors.values()) c.el.remove(); this._cursors.clear(); }

    /* ===================== YYF (archivos pesados) ===================== */
    async _yyfUpload(data, filename) {
      const base = this._yyfBase();
      let last;
      for (let i = 0; i < 3; i++) {
        try {
          const fd = new FormData();
          fd.append('file', new Blob([data]), filename);
          const r = await fetch(base + '/api/upload', { method: 'POST', body: fd });
          if (!r.ok) throw new Error('YYF respondió ' + r.status);
          const j = await r.json();
          if (!j || !j.fileUrl) throw new Error('Respuesta inválida de YYF');
          const fu = String(j.fileUrl);
          return /^https?:\/\//i.test(fu) ? fu : base + (fu.startsWith('/') ? '' : '/') + fu;
        } catch (e) { last = e; await sleep(400 * (i + 1)); }
      }
      throw last;
    }
    async _fetchBytes(url) {
      const base = this._yyfBase();
      if (typeof url !== 'string' || !url.startsWith(base + '/')) {
        throw new Error('Enlace no permitido: no pertenece al servidor YYF de la sala.');
      }
      let last;
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch(url);
          if (!r.ok) throw new Error('YYF respondió ' + r.status);
          return new Uint8Array(await r.arrayBuffer());
        } catch (e) { last = e; await sleep(400 * (i + 1)); }
      }
      throw last;
    }

    /* ================= proyecto: exportar / aplicar paquete ================= */
    _collectAssets() {
      const m = new Map();
      const add = (it) => {
        if (!it || !it.assetId || !it.dataFormat) return;
        const d = it.asset && it.asset.data;
        if (d) m.set(it.assetId + '.' + it.dataFormat, d instanceof Uint8Array ? d : new Uint8Array(d));
      };
      for (const t of Scratch.vm.runtime.targets) {
        if (!t.isOriginal) continue;
        (t.getCostumes() || []).forEach(add);
        (t.getSounds() || []).forEach(add);
      }
      return m;
    }
    _projectAssetKeys(proj) {
      const keys = new Set();
      for (const t of proj.targets || []) {
        for (const c of (t.costumes || []).concat(t.sounds || [])) {
          const k = c.md5ext || (c.assetId && c.dataFormat ? c.assetId + '.' + c.dataFormat : null);
          if (k) keys.add(k);
        }
      }
      return keys;
    }
    _stripSelf(p) {
      if (Array.isArray(p.extensions)) p.extensions = p.extensions.filter((x) => x !== EXT_ID);
      if (p.extensionURLs && typeof p.extensionURLs === 'object') delete p.extensionURLs[EXT_ID];
    }

    // Foto del proyecto: project.json (+ mapa de assets) en UN archivo en YYF; los assets nuevos van aparte, una sola vez cada uno.
    // OJO: la parte síncrona (toJSON + assets) debe ocurrir antes del primer await.
    async _exportBundle() {
      const vm = Scratch.vm;
      const proj = JSON.parse(vm.toJSON());
      this._stripSelf(proj);
      const local = this._collectAssets();
      const keys = [...this._projectAssetKeys(proj)];
      const todo = keys.filter((k) => !this.assetUrls[k] && local.has(k));
      const fresh = {};
      let done = 0;
      if (todo.length) this._setProgress('Subiendo archivos a YYF', 0, todo.length);
      try {
        await pool(3, todo, async (k) => {
          const url = await this._yyfUpload(local.get(k), k);
          this.assetUrls[k] = url; fresh[k] = url;
          this._setProgress('Subiendo archivos a YYF', ++done, todo.length);
        });
        if (Object.keys(fresh).length) this._sendEnv('assets', { map: fresh });
        const assets = {};
        for (const k of keys) if (this.assetUrls[k]) assets[k] = this.assetUrls[k];
        let bytes = enc(JSON.stringify({ v: 1, project: proj, assets }));
        let z = 0;
        if (hasStreams()) { bytes = await gzip(bytes); z = 1; }
        this._setProgress('Subiendo proyecto a YYF', 0, 0);
        const url = await this._yyfUpload(bytes, z ? 'project.json.gz' : 'project.json');
        return { b: url, z, n: bytes.length, ts: Date.now() };
      } finally { this._setProgress(null); }
    }

    _applyBundle(ref) {
      // Una carga a la vez.
      const run = () => this._doApplyBundle(ref);
      this._loadChain = this._loadChain.then(run, run);
      return this._loadChain;
    }
    async _doApplyBundle(ref) {
      const vm = Scratch.vm;
      this._setProgress('Descargando proyecto…', 0, 0);
      try {
        let bytes = await this._fetchBytes(ref.b);
        if (ref.z) bytes = await gunzip(bytes);
        const bundle = JSON.parse(dec(bytes));
        const proj = bundle.project;
        if (!proj || !Array.isArray(proj.targets)) throw new Error('Paquete de proyecto inválido');
        Object.assign(this.assetUrls, bundle.assets || {});
        const keys = [...this._projectAssetKeys(proj)];
        const local = this._collectAssets();
        const files = [{ name: 'project.json', data: enc(JSON.stringify(proj)) }];
        const need = [];
        for (const k of keys) { const a = local.get(k); if (a) files.push({ name: k, data: a }); else need.push(k); }
        let done = 0;
        if (need.length) this._setProgress('Descargando archivos', 0, need.length);
        await pool(4, need, async (k) => {
          const url = (bundle.assets || {})[k];
          if (!url) throw new Error('Falta el archivo ' + k);
          files.push({ name: k, data: await this._fetchBytes(url) });
          this._setProgress('Descargando archivos', ++done, need.length);
        });
        const zip = makeZip(files);
        const prev = this._editingName();
        this.loading = true;
        try {
          await vm.loadProject(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
          this._quietUntil = Date.now() + 500;
        } finally { setTimeout(() => { this.loading = false; }, 250); }
        try {
          const t = vm.runtime.targets.find((x) => x.isOriginal && !x.isStage && x.getName() === prev);
          if (t) vm.setEditingTarget(t.id);
        } catch (_) { /* ignore */ }
        this.lastStructSig = this._structSig(); this._lastProps = {};
      } finally { this._setProgress(null); }
    }

    _structSig() {
      const arr = [];
      for (const t of Scratch.vm.runtime.targets) {
        if (!t.isOriginal) continue;
        arr.push([t.isStage ? 1 : 0, t.getName(),
          (t.getCostumes() || []).map((c) => [c.name, c.assetId, c.dataFormat, c.rotationCenterX, c.rotationCenterY, c.bitmapResolution]),
          (t.getSounds() || []).map((s) => [s.name, s.assetId, s.dataFormat])]);
      }
      return JSON.stringify(arr);
    }

    // Snapshot del anfitrión (lo usan los que entran o se recargan).
    _isIdle() { return !this._draining && !this._applyQ.length; }
    async _whenIdle() { while (!this._isIdle()) await sleep(30); }
    _ensureSnapshot(force) {
      if (this._snapP) return this._snapP;
      const need = !this.snap || force || (this.seq - this.snap.seq > 300);
      if (!need) return Promise.resolve(this.snap);
      this._snapP = (async () => {
        try {
          await this._whenIdle();
          const seq = this.seq; // misma "tic" que toJSON (dentro de _exportBundle)
          const ref = await this._exportBundle();
          ref.seq = seq;
          if (!this.snap || ref.seq >= this.snap.seq) { this.snap = ref; this.opLog = this.opLog.filter((o) => o.seq > seq); }
          return this.snap;
        } finally { this._snapP = null; }
      })();
      return this._snapP;
    }

    /* ==================== sincronización de cambios ==================== */
    _inRoomReady() { return (this.mode === 'host' || this.mode === 'guest') && this.ready; }
    _canEmit() { return this._inRoomReady() && !this.loading && !this.applyingRemote; }
    _editingName() {
      try { const t = Scratch.vm.editingTarget; return t ? (t.isStage ? 'Escenario' : t.getName()) : ''; } catch (_) { return ''; }
    }
    _findTarget(tn) {
      return Scratch.vm.runtime.targets.find((t) => t.isOriginal && (tn === '@stage' ? t.isStage : (!t.isStage && t.getName() === tn)));
    }

    // Engancha el listener de eventos de Blockly del VM (una sola vez).
    _hook() {
      if (!this._hooked) {
        try {
          const vm = Scratch.vm;
          const proto = Object.getPrototypeOf(vm.runtime.getTargetForStage().blocks);
          if (!proto || typeof proto.blocklyListen !== 'function') throw new Error('blocklyListen no encontrado');
          const orig = proto.blocklyListen; const self = this;
          proto.blocklyListen = function (e) {
            try { self._onBlocklyEvent(this, e); } catch (_) { /* nunca romper el editor */ }
            return orig.apply(this, arguments);
          };
          this._hooked = true;
        } catch (e) { this._logLine('No se pudo enganchar el editor de bloques: ' + e.message); }
      }
      try { if (!this._blockly && Scratch.gui && Scratch.gui.getBlockly) Scratch.gui.getBlockly().then((b) => { this._blockly = b; }).catch(() => {}); } catch (_) { /* ignore */ }
    }
    _onBlocklyEvent(blocks, e) {
      if (!this._canEmit() || !e || typeof e !== 'object') return;
      if (!SYNC_EVENTS.has(e.type)) return;
      if (typeof e.blockId !== 'string' && typeof e.varId !== 'string') return;
      const t = Scratch.vm.editingTarget;
      if (!t || t.blocks !== blocks) return; // ignora el flyout y otros
      // 1) Eco de una recarga del espacio de trabajo (el editor re-emite eventos de TODOS los bloques):
      //    justo después de refrescar/cargar, crear/borrar/variables no son acciones de una persona.
      if (Date.now() < this._quietUntil && (e.type === 'create' || e.type === 'delete' || e.type.startsWith('var_'))) return;
      // 2) Un evento que no cambia nada (el proyecto ya está así) no es un cambio.
      if (this._isNoop(t, blocks, e)) return;
      this._queueUp({ k: 'ev', tn: targetKey(t), ev: serializeEvent(e) });
    }
    _isNoop(t, blocks, e) {
      const get = (id) => (typeof blocks.getBlock === 'function' ? blocks.getBlock(id) : (blocks._blocks || {})[id]);
      const stage = Scratch.vm.runtime.getTargetForStage();
      const hasVar = (id) => !!((t.variables && t.variables[id]) || (stage && stage.variables && stage.variables[id]));
      switch (e.type) {
        case 'create': return !!get(e.blockId);
        case 'delete': return !get(e.blockId);
        case 'change': {
          if (e.element !== 'field') return false;
          const b = get(e.blockId); if (!b) return true;
          const f = b.fields && b.fields[e.name];
          return !!f && String(f.value) === String(e.newValue);
        }
        case 'move': {
          const b = get(e.blockId); if (!b) return true;
          return !b.parent && !e.newParentId && !!e.newCoordinate && b.x === e.newCoordinate.x && b.y === e.newCoordinate.y;
        }
        case 'var_create': return hasVar(e.varId);
        case 'var_delete': return !hasVar(e.varId);
        case 'var_rename': { const v = (t.variables && t.variables[e.varId]) || (stage && stage.variables && stage.variables[e.varId]); return !v || v.name === e.newName; }
        default: return false;
      }
    }
    _onProjectChanged() {
      // OJO: no descartar el evento aunque haya una carga remota en curso; si no, un cambio hecho justo
      // después de recibir uno ajeno se pierde. La firma de estructura decide si hay algo nuevo que enviar.
      if (!this._inRoomReady()) return;
      clearTimeout(this._psT);
      this._psT = setTimeout(() => this._checkStruct(), 500);
    }
    async _checkStruct() {
      if (!this._inRoomReady()) return;
      if (this.loading || this.applyingRemote || this._applyQ.length) {
        clearTimeout(this._psT);
        this._psT = setTimeout(() => this._checkStruct(), 400); // volver a mirar cuando termine la carga
        return;
      }
      if (this.structBusy) { this.structDirty = true; return; }
      const sig = this._structSig();
      if (sig === this.lastStructSig) return;
      this.structBusy = true;
      try {
        this.lastStructSig = sig;
        const man = await this._exportBundle();
        this._queueUp({ k: 'st', man });
      } catch (e) { this.lastStructSig = null; this._err(e, 'No se pudo compartir el cambio de sprites/disfraces/sonidos'); }
      finally {
        this.structBusy = false;
        if (this.structDirty) { this.structDirty = false; this._checkStruct(); }
      }
    }
    _pollProps() {
      if (!this.cfg.syncProps || !this._canEmit()) return;
      const vm = Scratch.vm;
      try {
        if (vm.runtime.threads && vm.runtime.threads.length) return;
        const t = vm.editingTarget;
        if (!t || t.isStage) return;
        const key = targetKey(t); const p = propsOf(t); const sig = JSON.stringify(p);
        if (this._lastProps[key] === undefined) { this._lastProps[key] = sig; return; }
        if (this._lastProps[key] !== sig) { this._lastProps[key] = sig; this._queueUp({ k: 'pr', tn: key, pr: p }); }
      } catch (_) { /* ignore */ }
    }

    _queueUp(op) {
      // Mover/editar el mismo bloque muchas veces seguidas = un solo cambio (el último).
      const coal = (op.k === 'ev' && op.ev && (op.ev.type === 'move' || op.ev.type === 'change')) || op.k === 'pr';
      if (coal) {
        const prev = this._upQ.find((o) => o.k === op.k && o.tn === op.tn && (op.k === 'pr' || (o.ev.type === op.ev.type && o.ev.blockId === op.ev.blockId && (o.ev.name || '') === (op.ev.name || ''))));
        if (prev) { if (op.k === 'pr') prev.pr = op.pr; else prev.ev = op.ev; prev.ts = Date.now(); return; }
      }
      // Freno de seguridad: nadie hace >150 cambios distintos por segundo; eso es un bucle.
      if (op.k === 'ev') {
        const now = Date.now();
        if (now < this._blockUntil) return;
        if (now - this._burstAt > 1000) { this._burstAt = now; this._burstN = 0; }
        if (++this._burstN > 150) {
          this._blockUntil = now + 5000; this._burstN = 0;
          this._logLine('Demasiados cambios seguidos del editor: pausa de 5 s para evitar un bucle.');
          this._toast('Demasiados cambios seguidos: pausa de 5 s para evitar un bucle', 'err');
          return;
        }
      }
      op.cid = ++this._cid; op.ts = Date.now();
      if (this.mode !== 'host') this.pending.set(op.cid, op);
      this._upQ.push(op);
      if (!this._upT) this._upT = setTimeout(() => this._flushUp(), 60);
      this._ui();
    }
    async _flushUp() {
      this._upT = null;
      if (this._upBusy) { this._upT = setTimeout(() => this._flushUp(), 60); return; }
      this._upBusy = true;
      try {
        const ops = this._upQ.splice(0);
        const out = [];
        for (const op of ops) {
          let o = op;
          if (op.k !== 'st' && JSON.stringify(op).length > MAX_INLINE) {
            try {
              const url = await this._yyfUpload(enc(JSON.stringify(op)), 'op-' + rid(6) + '.json');
              o = { cid: op.cid, k: 'big', url, ts: op.ts };
              if (this.mode !== 'host') this.pending.set(op.cid, o);
            } catch (e) { this._err(e, 'No se pudo subir un cambio grande'); continue; }
          }
          out.push(o);
        }
        if (out.length) {
          if (this.mode === 'host') this._sequence(out, this.me.uid, this.me.name, false);
          else if (this.mode === 'guest') this._sendChunked('up', out);
        }
      } finally {
        this._upBusy = false;
        if (this._upQ.length && !this._upT) this._upT = setTimeout(() => this._flushUp(), 60);
      }
    }
    _resendPending() {
      if (this.mode !== 'guest' || !this.pending.size) return;
      const ops = [...this.pending.values()].sort((a, b) => a.cid - b.cid);
      this._sendChunked('up', ops);
    }

    // Anfitrión: numera, guarda y reparte (y aplica si viene de otra persona).
    _sequence(ops, uid, name, applyLocally) {
      const stamped = [];
      for (const op of ops) {
        const s = Object.assign({}, op, { seq: ++this.seq, o: uid, n: name });
        stamped.push(s); this.opLog.push(s);
        if (s.k === 'st' && s.man) { this.snap = Object.assign({}, s.man, { seq: s.seq }); this.opLog = this.opLog.filter((x) => x.seq > s.seq); }
        this._act(s);
      }
      if (this.opLog.length > 8000) this.opLog.splice(0, this.opLog.length - 8000);
      this._bcast.push(...stamped);
      if (!this._bcastT) this._bcastT = setTimeout(() => { this._bcastT = null; this._sendChunked('ops', this._bcast.splice(0)); }, 40);
      if (applyLocally) { this._applyQ.push(...stamped); this._drain(); }
    }
    _hUp(env) {
      if (this.mode !== 'host') return;
      if (!this.members.has(env.f)) { if (Date.now() - this._lastNj > 1500) { this._lastNj = Date.now(); this._sendEnv('nj', { to: env.f }); } return; }
      const out = [];
      // Deduplicación por conjunto (no por contador): un cambio perdido y reenviado después de otro más nuevo no se descarta.
      let seen = this.lastCid.get(env.f);
      if (!seen) { seen = new Set(); this.lastCid.set(env.f, seen); }
      for (const op of env.ops || []) {
        if (!op || typeof op.cid !== 'number' || seen.has(op.cid)) continue;
        if (!['ev', 'pr', 'st', 'big'].includes(op.k)) continue;
        if (op.k === 'ev' && !(op.ev && SYNC_EVENTS.has(op.ev.type))) continue; // nada de stackclick, etc.
        seen.add(op.cid); out.push(op);
      }
      if (seen.size > 4000) { const lim = Math.max(...seen) - 2000; for (const c of [...seen]) if (c < lim) seen.delete(c); }
      if (out.length) this._sequence(out, env.f, String(env.n || '?').slice(0, 24), true);
    }
    _hSync(env) {
      if (this.mode !== 'host') return;
      const uid = env.f;
      if (!this.members.has(uid)) { this._sendEnv('nj', { to: uid }); return; }
      const last = +env.last;
      const base = this.opLog.length ? this.opLog[0].seq - 1 : this.seq;
      if (!(last >= base) || last > this.seq) { this.hostReload(uid, false); return; }
      const ops = this.opLog.filter((o) => o.seq > last);
      if (ops.length) this._sendChunked('ops', ops, { to: uid });
    }

    // Invitado: recibe ops ordenadas del anfitrión.
    _hOps(env) {
      if (this.mode !== 'guest') return;
      if (env.to && env.to !== this.me.uid) return;
      if (!this.ready) { this._early.push(env); return; }
      let any = false;
      for (const op of env.ops || []) {
        if (typeof op.seq !== 'number' || op.seq <= this.lastSeq) continue;
        if (op.seq !== this.lastSeq + 1) { this._requestSync(); break; }
        this.lastSeq = op.seq;
        this._act(op);
        if (op.o === this.me.uid) { this.pending.delete(op.cid); continue; }
        this._applyQ.push(op); any = true;
      }
      if (any) this._drain();
      this._ui();
    }
    _requestSync(force) {
      const now = Date.now();
      if (!force && now - this._lastSyncAt < 2500) return;
      this._lastSyncAt = now;
      this._sendEnv('sync', { last: this.lastSeq });
    }
    async _hForce(env) {
      if (this.mode !== 'guest') return;
      if (!env.all && env.to !== this.me.uid) return;
      this.ready = false; this._early = []; this._applyQ = []; this.pending.clear();
      try {
        await this._applyBundle(env.snap);
        this.lastSeq = env.snap.seq;
        this._toast('Proyecto recargado desde el anfitrión');
      } catch (e) { this._err(e, 'No se pudo recargar el proyecto'); }
      this.ready = true;
      const early = this._early.splice(0);
      for (const e of early) this._hOps(e);
      this._requestSync(true);
    }

    // Cola de aplicación (en orden, una a una).
    async _drain() {
      if (this._draining) return;
      this._draining = true;
      try {
        while (this._applyQ.length) {
          const op = this._applyQ.shift();
          try { await this._applyOp(op); }
          catch (e) { this._err(e, 'No se pudo aplicar un cambio de ' + (op.n || 'alguien')); }
        }
      } finally { this._draining = false; }
      if (this._needRefresh) { this._needRefresh = false; this._scheduleRefresh(); }
    }
    async _applyOp(op) {
      if (op.k === 'ev') this._applyEv(op);
      else if (op.k === 'pr') this._applyProps(op);
      else if (op.k === 'st') { await this._waitUiIdle(3000); await this._applyBundle(op.man); }
      else if (op.k === 'big') {
        const real = JSON.parse(dec(await this._fetchBytes(op.url)));
        if (real.k !== 'ev' && real.k !== 'pr') throw new Error('Cambio grande inválido');
        await this._applyOp(Object.assign({}, real, { seq: op.seq, o: op.o, n: op.n, cid: op.cid }));
      }
    }
    _noteMiss() {
      const now = Date.now();
      if (now - this._missAt > 5000) this._miss = 0;
      this._missAt = now;
      if (++this._miss >= 3 && this.mode === 'guest') { this._miss = 0; this._requestSync(true); this.resyncMe(); }
    }
    _applyEv(op) {
      const vm = Scratch.vm;
      if (!op.ev || typeof op.ev !== 'object' || !SYNC_EVENTS.has(op.ev.type)) return;
      const t = this._findTarget(op.tn);
      if (!t) { this._noteMiss(); return; }
      const ev = Object.assign({}, op.ev);
      if (typeof ev.xml === 'string') ev.xml = { outerHTML: ev.xml };
      this.applyingRemote = true;
      try {
        if (ev.type === 'var_create' || ev.type === 'var_rename' || ev.type === 'var_delete') this._applyVarEv(t, ev);
        else t.blocks.blocklyListen(ev);
      } finally { this.applyingRemote = false; }
      try { vm.runtime.emitProjectChanged(); } catch (_) { /* ignore */ }
      if (vm.editingTarget === t) this._needRefresh = true;
    }
    _applyVarEv(t, ev) {
      const rt = Scratch.vm.runtime; const stage = rt.getTargetForStage();
      // Scratch solo renombra/borra variables PROPIAS del objetivo (lookupVariableById también ve las globales).
      const own = (x) => !!x.variables && Object.prototype.hasOwnProperty.call(x.variables, ev.varId);
      if (ev.type === 'var_create') {
        if (ev.isLocal && !t.isStage && !ev.isCloud) { if (!own(t)) t.createVariable(ev.varId, ev.varName, ev.varType); }
        else if (!own(stage)) stage.createVariable(ev.varId, ev.varName, ev.varType, ev.isCloud);
      } else if (ev.type === 'var_rename') {
        if (!t.isStage && own(t)) { t.renameVariable(ev.varId, ev.newName); t.blocks.updateBlocksAfterVarRename(ev.varId, ev.newName); }
        else { stage.renameVariable(ev.varId, ev.newName); for (const x of rt.targets) x.blocks.updateBlocksAfterVarRename(ev.varId, ev.newName); }
      } else if (ev.type === 'var_delete') {
        (!t.isStage && own(t) ? t : stage).deleteVariable(ev.varId);
      }
    }
    _applyProps(op) {
      const t = this._findTarget(op.tn); const p = op.pr;
      if (!t || t.isStage || !p) return;
      const vm = Scratch.vm;
      try { t.setXY(+p.x, +p.y, true); } catch (_) { /* ignore */ }
      try { t.setSize(+p.s); } catch (_) { /* ignore */ }
      try { t.setDirection(+p.d); } catch (_) { /* ignore */ }
      try { t.setVisible(!!p.v); } catch (_) { /* ignore */ }
      try { if (p.r) t.setRotationStyle(p.r); } catch (_) { /* ignore */ }
      try { t.setDraggable(!!p.dr); } catch (_) { /* ignore */ }
      try { if (Number.isInteger(p.c) && p.c !== t.currentCostume) t.setCostume(p.c); } catch (_) { /* ignore */ }
      this._lastProps[targetKey(t)] = JSON.stringify(propsOf(t));
      try { vm.runtime.requestTargetsUpdate(t); } catch (_) { /* ignore */ }
    }

    // Refresco del espacio de trabajo cuando cambian los bloques que estás viendo.
    _uiBusy() {
      const B = this._blockly;
      if (!B) return false;
      try {
        const ws = B.getMainWorkspace && B.getMainWorkspace();
        if (ws && ws.isDragging && ws.isDragging()) return true;
        if (B.WidgetDiv && B.WidgetDiv.isVisible && B.WidgetDiv.isVisible()) return true;
        if (B.DropDownDiv && B.DropDownDiv.isVisible && B.DropDownDiv.isVisible()) return true;
      } catch (_) { /* ignore */ }
      return false;
    }
    async _waitUiIdle(max) {
      const t0 = Date.now();
      while (this._uiBusy() && Date.now() - t0 < max) await sleep(150);
    }
    _scheduleRefresh() {
      clearTimeout(this._refreshT);
      this._refreshT = setTimeout(() => this._tryRefresh(0), 120);
    }
    _tryRefresh(n) {
      if (this._uiBusy() && n < 20) { this._refreshT = setTimeout(() => this._tryRefresh(n + 1), 250); return; }
      try { this._quietUntil = Date.now() + 300; Scratch.vm.emitWorkspaceUpdate(); } catch (_) { /* ignore */ }
    }
  }

  Scratch.extensions.register(new ProjectCollab());
})(Scratch);