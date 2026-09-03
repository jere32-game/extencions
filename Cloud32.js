// Cloud32 TurboWarp Extension v6.1 (Soporte JSON)
(function(Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('Cloud32 requiere modo no aislado.');
  }

  const WS_BASE = "wss://cloud32.vercel.app";

  class JereServerExtension {
    constructor() {
      this._ws          = null;
      this._connected   = false;
      this._username    = '';
      this._rooms       = new Set();
      this._vars         = {};
      this._lastVarName  = '';
      this._lastVarValue = '';
      this._pendingEvents = [];
      
      // Control de 60 FPS
      this._outQueue = {};       
      this._lastSentVars = {};   
      setInterval(() => this._flush(), 1000 / 60);

      // Radar de Jugadores
      this._users = [];
      this._lastJoinedUser = '';
      this._lastLeftUser = '';
    }

    getInfo() {
      return {
        id: 'Cloud32',
        name: 'Cloud32 2.1',
        color1: '#2fff00',
        color2: '#22cc00',
        color3: '#119900',
        blocks: [
          { opcode: 'connect', blockType: Scratch.BlockType.COMMAND, text: 'conectar a [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: WS_BASE + '/' } } },
          { opcode: 'disconnect', blockType: Scratch.BlockType.COMMAND, text: 'desconectar' },
          { opcode: 'isConnected', blockType: Scratch.BlockType.BOOLEAN, text: '¿conectado?' },
          
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

          { blockType: Scratch.BlockType.LABEL, text: '─── Salas (Rooms) ───' },
          { opcode: 'joinRoom', blockType: Scratch.BlockType.COMMAND, text: 'entrar a sala [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'Partida1' } } },
          { opcode: 'leaveRoom', blockType: Scratch.BlockType.COMMAND, text: 'salir de sala [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'Partida1' } } },
          
          { blockType: Scratch.BlockType.LABEL, text: '─── Variables Nube ───' },
          { opcode: 'setVar', blockType: Scratch.BlockType.COMMAND, text: 'poner nube [NAME] en [VALUE]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'X' }, VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'getVar', blockType: Scratch.BlockType.REPORTER, text: 'nube [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'X' } } },
          { opcode: 'whenVarChanged', blockType: Scratch.BlockType.HAT, text: 'cuando nube [NAME] cambia', isEdgeActivated: false, arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'X' } } },
          { opcode: 'lastVarName',  blockType: Scratch.BlockType.REPORTER, text: 'última nube cambiada' },
          { opcode: 'lastVarValue', blockType: Scratch.BlockType.REPORTER, text: 'valor de última nube' },
          
          { blockType: Scratch.BlockType.LABEL, text: '─── Sistema ───' },
          { opcode: 'whenConnected', blockType: Scratch.BlockType.HAT, text: 'cuando me conecto', isEdgeActivated: false },
          { opcode: 'whenDisconnected', blockType: Scratch.BlockType.HAT, text: 'cuando me desconecto', isEdgeActivated: false },
        ]
      };
    }

    connect({ SERVER }) {
      return new Promise((resolve) => {
        const url = (SERVER || WS_BASE + '/').trim();
        if (this._ws) { try { this._ws.close(); } catch(_) {} this._ws = null; }
        let ws;
        try { ws = new WebSocket(url); } catch(e) { resolve(); return; }
        this._ws = ws;
        
        ws.addEventListener('open', () => {
          this._connected = true;
          this._outQueue = {}; 
          this._lastSentVars = {}; 
          this._users = [];
          this._fireHat('connected');
          if (this._username) this._send({ cmd: 'setid', val: this._username });
          if (this._rooms.size > 0) this._send({ cmd: 'link', val: Array.from(this._rooms) });
          resolve();
        });
        
        ws.addEventListener('message', (evt) => {
          let msg; try { msg = JSON.parse(evt.data); } catch(_) { return; }
          this._handleMsg(msg);
        });
        
        ws.addEventListener('close', () => { 
          this._connected = false; 
          this._outQueue = {}; 
          this._lastSentVars = {}; 
          this._users = [];
          this._fireHat('disconnected'); 
        });
        ws.addEventListener('error', () => { this._connected = false; resolve(); });
        setTimeout(resolve, 8000);
      });
    }

    disconnect() {
      if (this._ws) { try { this._ws.close(); } catch(_) {} this._ws = null; }
      this._connected = false;
    }

    isConnected() { return this._connected; }

    setUsername({ NAME }) {
      this._username = String(NAME).trim().slice(0, 20);
      if (this._connected) this._send({ cmd: 'setid', val: this._username });
    }
    getUsername()   { return this._username; }
    getUsersList()  { return this._users.join(', '); }
    
    // 🔥 NUEVO BLOQUE: Devuelve el array de jugadores en formato JSON
    getUsersJSON()  { return JSON.stringify(this._users); }
    
    getUsersCount() { return this._users.length; }
    isUserConnected({ NAME }) { return this._users.includes(String(NAME).trim()); }
    lastJoined()    { return this._lastJoinedUser; }
    lastLeft()      { return this._lastLeftUser; }

    joinRoom({ ROOM }) {
      const rooms = String(ROOM).split(',').map(r => r.trim()).filter(Boolean);
      rooms.forEach(r => this._rooms.add(r));
      if (this._connected) this._send({ cmd: 'link', val: rooms });
    }
    leaveRoom({ ROOM }) {
      const rooms = String(ROOM).split(',').map(r => r.trim()).filter(Boolean);
      rooms.forEach(r => this._rooms.delete(r));
      if (this._connected) this._send({ cmd: 'unlink', val: rooms });
    }

    setVar({ NAME, VALUE }) {
      if (!this._connected) return;
      const nameStr = String(NAME);
      const valStr = String(VALUE);
      if (this._lastSentVars[nameStr] === valStr) return;
      this._outQueue[nameStr] = valStr;
      this._lastSentVars[nameStr] = valStr;
    }

    _flush() {
      if (!this._connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) return;
      const keys = Object.keys(this._outQueue);
      if (keys.length === 0) return; 
      for (const name of keys) {
        this._send({ cmd: 'gvar', name: name, val: this._outQueue[name] });
      }
      this._outQueue = {}; 
    }
    
    getVar({ NAME })  { return this._vars[String(NAME)] ?? ''; }
    whenVarChanged({ NAME }) { return this._consumeEvent('var:' + NAME); }
    lastVarName()  { return this._lastVarName; }
    lastVarValue() { return this._lastVarValue; }

    whenConnected()    { return this._consumeEvent('connected'); }
    whenDisconnected() { return this._consumeEvent('disconnected'); }
    whenUserJoins()    { return this._consumeEvent('userJoined'); }
    whenUserLeaves()   { return this._consumeEvent('userLeft'); }

    _send(msg) {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify(msg));
      }
    }

    _fireHat(event) {
      this._pendingEvents.push(event);
      if (Scratch.vm) {
        const map = { 
          connected: 'jereserver_whenConnected', 
          disconnected: 'jereserver_whenDisconnected',
          userJoined: 'jereserver_whenUserJoins',
          userLeft: 'jereserver_whenUserLeaves'
        };
        if (map[event]) Scratch.vm.runtime.startHats(map[event]);
        if (event.startsWith('var:')) Scratch.vm.runtime.startHats('jereserver_whenVarChanged', { NAME: event.slice(4) });
      }
    }

    _consumeEvent(key) {
      const idx = this._pendingEvents.indexOf(key);
      if (idx !== -1) { this._pendingEvents.splice(idx, 1); return true; }
      return false;
    }

    _handleMsg(msg) {
      switch(msg.cmd) {
        case 'gvar':
          this._vars[msg.name]  = msg.val;
          this._lastSentVars[msg.name] = String(msg.val ?? ''); 
          this._lastVarName     = msg.name;
          this._lastVarValue    = String(msg.val ?? '');
          this._fireHat('var:' + msg.name);
          break;
          
        case 'ulist':
          const newUsers = msg.val || [];
          const joined = newUsers.filter(u => !this._users.includes(u));
          const left = this._users.filter(u => !newUsers.includes(u));
          
          this._users = newUsers;
          
          joined.forEach(u => {
            this._lastJoinedUser = u;
            this._fireHat('userJoined');
          });
          
          left.forEach(u => {
            this._lastLeftUser = u;
            this._fireHat('userLeft');
          });
          break;
      }
    }
  }

  Scratch.extensions.register(new JereServerExtension());
})(Scratch);