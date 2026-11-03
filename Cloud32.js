// Cloud32 TurboWarp Extension v8.0
// - Salas por prefijo: en la sala "sala32" la variable X viaja como "sala32:X" (el servidor no sabe de salas)
// - Reconexión automática con backoff, heartbeat y detección de conexión zombi
// - Los eventos de sockets viejos se ignoran (antes marcaban como desconectado al socket nuevo)
(function(Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('Cloud32 requiere modo no aislado.');
  }

  const EXT_ID  = 'Cloud32'; // debe coincidir con el id de getInfo(): los hats se disparan por "<id>_<opcode>"
  const WS_BASE = "wss://cloud32.vercel.app";

  // ─── Parámetros de conexión ───
  const HEARTBEAT_MS       = 15000;     // cada cuánto se manda un ping de aplicación
  const PONG_TIMEOUT_MS    = 10000;     // si tras un ping no llega NADA en este tiempo, el socket se da por muerto
  const CONNECT_TIMEOUT_MS = 12000;     // un intento que no abre en este tiempo se cancela y se reintenta
  const RECONNECT_BASE_MS  = 500;       // 0.5s, 1s, 2s, 4s, 8s, 10s, 10s...  (con jitter)
  const RECONNECT_MAX_MS   = 10000;
  const MAX_BUFFERED       = 512 * 1024; // si el socket tiene más que esto sin enviar, se pausa el envío de variables

  // ─── Salas ───
  // Separador entre sala y nombre. Evita choques: sala "a" + variable "bX"  vs  sala "ab" + variable "X".
  const ROOM_SEP = ':';

  const HAT_OPCODES = {
    connected:    EXT_ID + '_whenConnected',
    disconnected: EXT_ID + '_whenDisconnected',
    userJoined:   EXT_ID + '_whenUserJoins',
    userLeft:     EXT_ID + '_whenUserLeaves',
    chat:         EXT_ID + '_whenChatReceived',
  };
  const VAR_HAT = EXT_ID + '_whenVarChanged';

  class Cloud32Extension {
    constructor() {
      // Conexión
      this._ws = null;
      this._connected = false;
      this._wantConnected = false;   // intención del usuario: true tras "conectar", false tras "desconectar"
      this._url = '';
      this._retries = 0;
      this._reconnectTimer = null;
      this._connectTimer = null;
      this._hbTimer = null;
      this._pongTimer = null;
      this._lastRx = 0;
      this._waiters = [];

      // Jugador / sala
      this._username = '';
      this._room = '';

      // Variables (las claves incluyen la sala: "sala32:X")
      this._vars = {};
      this._lastVarName  = '';
      this._lastVarValue = '';
      this._outQueue = {};
      this._lastSentVars = {};

      // Hats
      this._pendingEvents = new Set();

      // Radar de jugadores
      this._rawUsers = [];           // tal cual los manda el servidor ("sala32:Ana", "Carlos"...)
      this._users = [];              // solo los de mi sala, sin prefijo
      this._lastJoinedUser = '';
      this._lastLeftUser = '';

      // Chat
      this._lastChatMsg = '';
      this._lastChatUser = '';

      setInterval(() => this._flush(), 1000 / 60);

      // Volver a la pestaña o recuperar internet: comprobar la conexión al instante
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => this._probe());
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this._probe(); });
      }
    }

    getInfo() {
      return {
        id: EXT_ID,
        name: 'Cloud32 2.2',
        color1: '#2fff00',
        color2: '#22cc00',
        color3: '#119900',
        blocks: [
          { opcode: 'connect', blockType: Scratch.BlockType.COMMAND, text: 'conectar a [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: WS_BASE + '/' } } },
          { opcode: 'disconnect', blockType: Scratch.BlockType.COMMAND, text: 'desconectar' },
          { opcode: 'isConnected', blockType: Scratch.BlockType.BOOLEAN, text: '¿conectado?' },

          { blockType: Scratch.BlockType.LABEL, text: '─── Salas ───' },
          { opcode: 'joinRoom', blockType: Scratch.BlockType.COMMAND, text: 'entrar a sala [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'sala32' } } },
          { opcode: 'leaveRoom', blockType: Scratch.BlockType.COMMAND, text: 'salir de la sala' },
          { opcode: 'getRoom', blockType: Scratch.BlockType.REPORTER, text: 'mi sala' },

          { blockType: Scratch.BlockType.LABEL, text: '─── Jugadores & Radar ───' },
          { opcode: 'setUsername', blockType: Scratch.BlockType.COMMAND, text: 'usar nombre [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Jugador1' } } },
          { opcode: 'getUsername', blockType: Scratch.BlockType.REPORTER, text: 'mi nombre' },
          { opcode: 'getUsersList', blockType: Scratch.BlockType.REPORTER, text: 'lista de jugadores (texto)' },
          { opcode: 'getUsersJSON', blockType: Scratch.BlockType.REPORTER, text: 'jugadores (JSON)' },
          { opcode: 'getUsersCount', blockType: Scratch.BlockType.REPORTER, text: 'cantidad de jugadores' },
          { opcode: 'isUserConnected', blockType: Scratch.BlockType.BOOLEAN, text: '¿jugador [NAME] conectado?', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Enemigo' } } },
          { opcode: 'whenUserJoins', blockType: Scratch.BlockType.HAT, text: 'cuando alguien entra', isEdgeActivated: false },
          { opcode: 'lastJoined', blockType: Scratch.BlockType.REPORTER, text: 'último en entrar' },
          { opcode: 'whenUserLeaves', blockType: Scratch.BlockType.HAT, text: 'cuando alguien sale', isEdgeActivated: false },
          { opcode: 'lastLeft', blockType: Scratch.BlockType.REPORTER, text: 'último en salir' },

          { blockType: Scratch.BlockType.LABEL, text: '─── Chat ───' },
          { opcode: 'sendChat', blockType: Scratch.BlockType.COMMAND, text: 'enviar mensaje de chat [MSG]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hola!' } } },
          { opcode: 'whenChatReceived', blockType: Scratch.BlockType.HAT, text: 'cuando llega un mensaje de chat', isEdgeActivated: false },
          { opcode: 'lastChatMessage', blockType: Scratch.BlockType.REPORTER, text: 'último mensaje de chat' },
          { opcode: 'lastChatUser', blockType: Scratch.BlockType.REPORTER, text: 'quién envió el último mensaje' },

          { blockType: Scratch.BlockType.LABEL, text: '─── Variables Nube ───' },
          { opcode: 'setVar', blockType: Scratch.BlockType.COMMAND, text: 'poner nube [NAME] en [VALUE]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'X' }, VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'getVar', blockType: Scratch.BlockType.REPORTER, text: 'nube [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'X' } } },
          { opcode: 'whenVarChanged', blockType: Scratch.BlockType.HAT, text: 'cuando nube [NAME] cambia', isEdgeActivated: false, arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'X' } } },
          { opcode: 'lastVarName',  blockType: Scratch.BlockType.REPORTER, text: 'última nube cambiada' },
          { opcode: 'lastVarValue', blockType: Scratch.BlockType.REPORTER, text: 'valor de última nube' },

          { blockType: Scratch.BlockType.LABEL, text: '─── Sistema ───' },
          { opcode: 'isReconnecting', blockType: Scratch.BlockType.BOOLEAN, text: '¿reconectando?' },
          { opcode: 'whenConnected', blockType: Scratch.BlockType.HAT, text: 'cuando me conecto', isEdgeActivated: false },
          { opcode: 'whenDisconnected', blockType: Scratch.BlockType.HAT, text: 'cuando me desconecto', isEdgeActivated: false },
        ]
      };
    }

    // ═══════════════════════ CONEXIÓN ═══════════════════════

    connect({ SERVER }) {
      let url = String(SERVER || '').trim() || (WS_BASE + '/');
      url = url.replace(/^http/i, 'ws'); // http(s):// -> ws(s)://
      this._wantConnected = true;

      const ws = this._ws;
      const alive = ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
      // Si ya estamos conectados (o conectando) a ese mismo server, no se rompe la conexión: solo se espera
      if (!(alive && url === this._url)) {
        if (url !== this._url) {          // otro servidor: lo que teníamos ya no vale
          this._vars = {};
          this._outQueue = {};
          this._rawUsers = [];
          this._users = [];
        }
        this._url = url;
        this._retries = 0;
        this._open();
      }
      return this._waitConnected();
    }

    disconnect() {
      this._wantConnected = false;
      this._clearReconnect();
      if (this._ws) this._handleDown(this._ws);
      this._rawUsers = [];
      this._users = [];
      this._outQueue = {};
      this._flushWaiters();
    }

    isConnected()    { return this._connected; }
    isReconnecting() { return this._wantConnected && !this._connected; }

    _open() {
      this._clearReconnect();
      this._detachSocket();
      this._connected = false;

      let ws;
      try { ws = new WebSocket(this._url); }
      catch (e) {                         // URL inválida: reintentar no sirve de nada
        console.error('[Cloud32] URL inválida:', this._url);
        this._wantConnected = false;
        this._flushWaiters();
        return;
      }
      this._ws = ws;

      this._connectTimer = setTimeout(() => {
        if (ws === this._ws && ws.readyState === WebSocket.CONNECTING) this._handleDown(ws);
      }, CONNECT_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        if (ws !== this._ws) return;      // socket viejo
        clearTimeout(this._connectTimer);
        this._connected = true;
        this._retries = 0;
        this._lastRx = performance.now();
        this._lastSentVars = {};          // el servidor pudo reiniciarse: no confiar en lo último que enviamos
        this._startHeartbeat();
        if (this._wireName()) this._sendIdentity();   // nombre + sala se restauran solos tras reconectar
        this._fireHat('connected');
        this._flushWaiters();
      });

      ws.addEventListener('message', (evt) => {
        if (ws !== this._ws) return;
        this._lastRx = performance.now(); // cualquier mensaje prueba que la conexión está viva
        let msg;
        try { msg = JSON.parse(evt.data); } catch (_) { return; }
        if (!msg || typeof msg !== 'object') return;
        try { this._handleMsg(msg); } catch (e) { console.error('[Cloud32] error procesando mensaje:', e); }
      });

      ws.addEventListener('close', () => this._handleDown(ws));
      // 'error' siempre va seguido de 'close', ahí se maneja todo
    }

    // Suelta el socket actual SIN disparar nuestros handlers (sus eventos quedan ignorados)
    _detachSocket() {
      const ws = this._ws;
      if (!ws) return;
      this._ws = null;
      clearTimeout(this._connectTimer);
      this._stopHeartbeat();
      try { ws.close(); } catch (_) {}
    }

    // El socket cayó (cierre, error, timeout o conexión zombi)
    _handleDown(ws) {
      if (ws !== this._ws) return;        // evento de un socket viejo: ignorar
      this._detachSocket();
      const wasConnected = this._connected;
      this._connected = false;
      if (wasConnected) this._fireHat('disconnected');
      if (this._wantConnected) this._scheduleReconnect();
      else this._flushWaiters();
    }

    _scheduleReconnect() {
      if (!this._wantConnected || this._reconnectTimer) return;
      const base  = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, this._retries));
      const delay = base * (0.5 + Math.random() * 0.5);   // jitter: evita que todos reconecten a la vez
      this._retries++;
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        if (this._wantConnected) this._open();
      }, delay);
    }

    _clearReconnect() {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Comprobación inmediata (volvió internet / volvió la pestaña)
    _probe() {
      if (!this._wantConnected) return;
      const ws = this._ws;
      if (this._connected && ws && ws.readyState === WebSocket.OPEN) {
        this._ping(5000);
      } else if (!ws || ws.readyState !== WebSocket.CONNECTING) {
        this._retries = 0;
        this._open();
      }
    }

    _startHeartbeat() {
      this._stopHeartbeat();
      this._hbTimer = setInterval(() => this._ping(PONG_TIMEOUT_MS), HEARTBEAT_MS);
    }

    _stopHeartbeat() {
      clearInterval(this._hbTimer);
      clearTimeout(this._pongTimer);
      this._hbTimer = null;
      this._pongTimer = null;
    }

    // Manda un ping; si en timeoutMs no llegó NADA del servidor, el socket está zombi (wifi caída, PC dormida...)
    _ping(timeoutMs) {
      const ws = this._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const sentAt = performance.now();
      this._send({ cmd: 'ping' });
      clearTimeout(this._pongTimer);
      this._pongTimer = setTimeout(() => {
        if (ws === this._ws && this._lastRx < sentAt) this._handleDown(ws);
      }, timeoutMs);
    }

    _waitConnected() {
      if (this._connected) return Promise.resolve();
      return new Promise((resolve) => {
        const waiter = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          const i = this._waiters.indexOf(waiter);
          if (i !== -1) this._waiters.splice(i, 1);
          resolve();
        }, 8000);
        this._waiters.push(waiter);
      });
    }

    _flushWaiters() {
      const list = this._waiters;
      this._waiters = [];
      list.forEach(fn => fn());
    }

    _send(msg) {
      const ws = this._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify(msg)); } catch (e) { console.error('[Cloud32] error al enviar:', e); }
    }

    // ═══════════════════════ SALAS ═══════════════════════

    _clean(s) { return String(s ?? '').split(ROOM_SEP).join('').trim(); }

    joinRoom({ ROOM }) { this._setRoom(this._clean(ROOM).slice(0, 24)); }
    leaveRoom()        { this._setRoom(''); }
    getRoom()          { return this._room; }

    _setRoom(room) {
      if (room === this._room) return;
      this._room = room;
      // Eventos de variables pendientes de la sala anterior ya no valen
      for (const k of this._pendingEvents) if (k.startsWith('var:')) this._pendingEvents.delete(k);
      this._refreshUsers(false);           // recalcula quién está en mi sala, sin disparar hats
      if (this._connected) this._sendIdentity();
    }

    // Nombre que ve el servidor: "sala32:Jugador1" (o "Jugador1" si no hay sala)
    _wireName()     { return this._room ? this._room + ROOM_SEP + this._username : this._username; }
    _sendIdentity() { this._send({ cmd: 'setid', val: this._wireName() }); }
    _varKey(name)   { return this._room ? this._room + ROOM_SEP + name : name; }

    _split(wire) {
      const i = wire.indexOf(ROOM_SEP);
      return i === -1 ? { room: '', name: wire } : { room: wire.slice(0, i), name: wire.slice(i + 1) };
    }

    // ═══════════════════════ JUGADORES ═══════════════════════

    setUsername({ NAME }) {
      this._username = this._clean(NAME).slice(0, 20);
      if (this._connected) this._sendIdentity();
    }
    getUsername()   { return this._username; }
    getUsersList()  { return this._users.join(', '); }
    getUsersJSON()  { return JSON.stringify(this._users); }
    getUsersCount() { return this._users.length; }
    isUserConnected({ NAME }) { return this._users.includes(String(NAME).trim()); }
    lastJoined()    { return this._lastJoinedUser; }
    lastLeft()      { return this._lastLeftUser; }

    _roomUsers() {
      const out = [];
      for (const wire of this._rawUsers) {
        const { room, name } = this._split(String(wire));
        if (room === this._room && name && !out.includes(name)) out.push(name);
      }
      return out;
    }

    _refreshUsers(fire) {
      const mine   = this._roomUsers();
      const joined = mine.filter(u => !this._users.includes(u));
      const left   = this._users.filter(u => !mine.includes(u));
      this._users = mine;
      if (!fire) return;
      joined.forEach(u => { this._lastJoinedUser = u; this._fireHat('userJoined'); });
      left.forEach(u =>   { this._lastLeftUser = u;   this._fireHat('userLeft'); });
    }

    // ═══════════════════════ CHAT ═══════════════════════

    sendChat({ MSG }) {
      if (!this._connected) return;
      this._send({ cmd: 'gmsg', val: String(MSG) });
    }
    lastChatMessage() { return this._lastChatMsg; }
    lastChatUser()    { return this._lastChatUser; }

    // ═══════════════════════ VARIABLES ═══════════════════════

    setVar({ NAME, VALUE }) {
      if (!this._wantConnected) return;     // mientras reconecta, las escrituras quedan en cola (último valor gana)
      const key = this._varKey(String(NAME));
      const val = String(VALUE);
      if (this._lastSentVars[key] === val) return;
      this._outQueue[key] = val;
      this._lastSentVars[key] = val;
    }

    getVar({ NAME }) { return this._vars[this._varKey(String(NAME))] ?? ''; }
    lastVarName()    { return this._lastVarName; }
    lastVarValue()   { return this._lastVarValue; }

    _flush() {
      const ws = this._ws;
      if (!this._connected || !ws || ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > MAX_BUFFERED) return;   // red lenta: esperar, la cola conserva el último valor de cada variable
      const queue = this._outQueue;
      const keys = Object.keys(queue);
      if (keys.length === 0) return;
      this._outQueue = {};
      for (const name of keys) this._send({ cmd: 'gvar', name: name, val: queue[name] });
    }

    _applyVarUpdate(wireName, val) {
      this._vars[wireName] = val;                       // se guarda todo, de cualquier sala
      this._lastSentVars[wireName] = String(val ?? '');
      const { room, name } = this._split(wireName);
      if (room !== this._room) return;                  // otra sala: no dispara nada
      this._lastVarName  = name;
      this._lastVarValue = String(val ?? '');
      this._fireHat('var:' + name);
    }

    // ═══════════════════════ HATS ═══════════════════════

    whenConnected()     { return this._consumeEvent('connected'); }
    whenDisconnected()  { return this._consumeEvent('disconnected'); }
    whenUserJoins()     { return this._consumeEvent('userJoined'); }
    whenUserLeaves()    { return this._consumeEvent('userLeft'); }
    whenChatReceived()  { return this._consumeEvent('chat'); }
    whenVarChanged({ NAME }) { return this._consumeEvent('var:' + String(NAME)); }

    _fireHat(event) {
      this._pendingEvents.add(event);     // Set: acotado (antes era un array que crecía sin límite)
      const vm = Scratch.vm;
      if (!vm) return;
      const opcode = event.startsWith('var:') ? VAR_HAT : HAT_OPCODES[event];
      if (!opcode) return;
      try { vm.runtime.startHats(opcode); } catch (e) { console.error('[Cloud32] startHats:', e); }
    }

    _consumeEvent(key) {
      return this._pendingEvents.delete(key);
    }

    // ═══════════════════════ MENSAJES DEL SERVIDOR ═══════════════════════

    _handleMsg(msg) {
      switch (msg.cmd) {
        // Batch del servidor: varias variables en un solo mensaje
        case 'gvars':
          if (Array.isArray(msg.updates)) {
            for (const u of msg.updates) this._applyVarUpdate(String(u.name), u.val);
          }
          break;

        case 'gvar':
          this._applyVarUpdate(String(msg.name), msg.val);
          break;

        case 'gmsg': {
          // El servidor manda el nombre con prefijo de sala: "sala32:Ana"
          const { room, name } = this._split(String(msg.origin?.username || ''));
          if (room !== this._room) break;
          this._lastChatMsg  = String(msg.val ?? '');
          this._lastChatUser = name;
          this._fireHat('chat');
          break;
        }

        case 'ulist':
          this._rawUsers = Array.isArray(msg.val) ? msg.val : [];
          this._refreshUsers(true);
          break;

        // 'pong': no hace falta nada, ya se anotó _lastRx al recibir el mensaje
      }
    }
  }

  Scratch.extensions.register(new Cloud32Extension());
})(Scratch);
