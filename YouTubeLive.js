class YouTubeLiveChatExt {
  constructor() {
    this.ws = null;
    this.messageQueue = []; // La fila de espera para no crashear
    this.queueInterval = null;
    this.reconnectTimeout = null;

    this.author = '';
    this.message = '';
    this.avatar = '';
    this.isMod = false;
    this.isOwner = false;

    // Estado para la reconexión automática: si el servidor (ahora remoto y
    // compartido por varios proyectos) se reinicia o se cae un momento, la
    // extensión se reconecta sola y retoma el mismo video sin que el
    // proyecto tenga que hacer nada.
    this.connected = false;
    this.currentUrl = '';
    this.currentVideoId = '';
    this.manualDisconnect = false; // true cuando el usuario pide desconectar a propósito
  }

  getInfo() {
    return {
      id: 'ytlivechatws',
      name: 'YouTube Live Chat',
      color1: '#FF0000',
      color2: '#CC0000',
      blocks: [
        {
          opcode: 'connectWS',
          blockType: Scratch.BlockType.COMMAND,
          text: 'conectar a [URL]',
          arguments: {
            URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'wss://ytchat.wisp.uno' }
          }
        },
        {
          opcode: 'startLive',
          blockType: Scratch.BlockType.COMMAND,
          text: 'escuchar video ID [ID]',
          arguments: {
            ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'dQw4w9WgXcQ' }
          }
        },
        {
          opcode: 'onNewComment',
          blockType: Scratch.BlockType.EVENT, // Usa EVENT, es fundamental para no trabarse
          text: 'al recibir comentario',
          isEdgeActivated: false
        },
        {
          opcode: 'getCommentData',
          blockType: Scratch.BlockType.REPORTER,
          text: 'obtener [DATO] del comentario',
          arguments: {
            DATO: {
              type: Scratch.ArgumentType.STRING,
              menu: 'datosMenu'
            }
          }
        },
        {
          opcode: 'isConnected',
          blockType: Scratch.BlockType.BOOLEAN,
          text: '¿conectado al servidor?'
        },
        {
          opcode: 'disconnectWS',
          blockType: Scratch.BlockType.COMMAND,
          text: 'desconectar'
        }
      ],
      menus: {
        datosMenu: {
          acceptReporters: true,
          items: ['autor', 'mensaje', 'foto de perfil', 'es moderador', 'es creador']
        }
      }
    };
  }

  connectWS(args) {
    this.manualDisconnect = false;
    this.currentUrl = args.URL;
    this._abrirConexion();
  }

  _abrirConexion() {
    if (this.ws) {
      this.ws.onclose = null; // evita que el socket viejo dispare otra reconexión al cerrarlo
      this.ws.close();
    }
    if (this.queueInterval) clearInterval(this.queueInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

    this.ws = new WebSocket(this.currentUrl);

    // Libera un mensaje cada 50ms hacia los bloques de TurboWarp
    this.queueInterval = setInterval(() => {
      if (this.messageQueue.length > 0) {
        const payload = this.messageQueue.shift();

        this.author = payload.author;
        this.message = payload.message;
        this.avatar = payload.avatar;
        this.isMod = payload.isMod;
        this.isOwner = payload.isOwner;

        Scratch.vm.runtime.startHats('ytlivechatws_onNewComment');
      }
    }, 50);

    this.ws.onopen = () => {
      this.connected = true;
      console.log('YouTubeLiveChat: conectado');

      // Si ya había un video en curso (por ejemplo, tras una reconexión), lo retomamos solos
      if (this.currentVideoId) {
        this.ws.send(JSON.stringify({ action: 'START', videoId: this.currentVideoId }));
      }
    };

    this.ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      // Simplemente mete el mensaje limpio a la fila
      if (payload.type === 'COMMENT') {
        this.messageQueue.push(payload.data);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.queueInterval) clearInterval(this.queueInterval);

      if (this.manualDisconnect) return; // el usuario pidió desconectar, no reintentamos

      // El servidor ahora es remoto y compartido: puede reiniciarse o
      // cortarse un momento. Reintentamos solos en vez de dejar el
      // proyecto sin chat para siempre.
      console.warn('YouTubeLiveChat: conexión perdida, reintentando en 3s...');
      this.reconnectTimeout = setTimeout(() => this._abrirConexion(), 3000);
    };
  }

  startLive(args) {
    this.currentVideoId = args.ID;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'START',
        videoId: this.currentVideoId
      }));
    } else {
      console.warn('WebSocket no está conectado todavía; se enviará solo en cuanto conecte.');
    }
  }

  disconnectWS() {
    this.manualDisconnect = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.queueInterval) clearInterval(this.queueInterval);

    if (this.ws) {
      this.ws.onclose = null; // ya nos encargamos nosotros, no dejamos que dispare otra reconexión
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  getCommentData(args) {
    switch (args.DATO) {
      case 'autor': return this.author;
      case 'mensaje': return this.message;
      case 'foto de perfil': return this.avatar;
      case 'es moderador': return this.isMod;
      case 'es creador': return this.isOwner;
      default: return '';
    }
  }
}

Scratch.extensions.register(new YouTubeLiveChatExt());
