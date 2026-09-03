// ============================================================
// TurboWarp Voice Chat Extension - Chat de Voz Múltiple
// ============================================================
// Cómo usar:
//   1. Abre TurboWarp: https://turbowarp.org/editor
//   2. Haz clic en "Extensiones" → "Extensión personalizada"
//   3. Pega esta URL y marca "Ejecutar sin sandbox"
//   4. URL de tu servidor WebSocket: https://chat-vocie-32.vercel.app/api/voice
// ============================================================

(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error(
      'La extensión "Chat de Voz" requiere modo sin sandbox.\n' +
      'Actívalo al cargar la extensión.'
    );
  }

  const DEFAULT_WS = 'wss://chat-vocie-32.vercel.app/api/voice';

  // ---- URIs de Arte / Iconos ----
  const ASSETS = {
    icon: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/icon.svg',
    connect: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/Mic%20cam.svg',
    disconnect: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/disconect.svg',
    unmute: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/Mic.svg',
    mute: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/Mut%20(1).svg',
    config: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/Mic%20viv.svg',
    missing: 'https://raw.githubusercontent.com/jere32-game/Mic-Asest/refs/heads/main/Mic.svg'
  };

  // ---- helpers ----

  function calcRMS(float32) {
    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    return Math.sqrt(sum / float32.length);
  }

  function rmsToPercent(rms) {
    // rough mapping: 0 → 0%, 0.2 → ~100%
    return Math.min(100, Math.round(rms * 500));
  }

  // ---- extension ----

  class VoiceChat {
    constructor() {
      this._ws         = null;
      this._users      = [];
      this._connected  = false;
      this._username   = '';
      this._room       = '';

      // audio capture
      this._audioCtx        = null;
      this._mediaStream     = null;
      this._sourceNode      = null;
      this._scriptProcessor = null;
      this._analyserNode    = null;
      
      this._micChain        = null;   // Cadena de efectos global
      this._micGain         = null;   // mute control
      this._silentGain      = null;   // prevents mic playback
      this._muted           = false;
      this._myVolume        = 0;
      this._analyserBuf     = null;

      // per-user playback
      this._gainNodes          = new Map(); // username -> GainNode
      this._nextPlayTime       = new Map(); // username -> number (AudioContext time)
      this._volumeLevels       = new Map(); // username -> 0-100 (live RMS)
      this._volumeOverrides    = new Map(); // username -> 0-100 (set by block)
      this._userChains         = new Map(); // username -> Cadena de efectos local
      this._userFilterSettings = new Map(); // username -> { type, pct }

      // configuraciones de filtro propias
      this._myFilterType       = 'paso bajo';
      this._myFilterPct        = 0;

      // hat event
      this._usersChangedFlag = false;
    }

    getInfo() {
      return {
        id: 'TurboVoiceChat',
        name: 'Chat de Voz',
        menuIconURI: ASSETS.icon,
        color1: '#1D4ED8',
        color2: '#1E40AF',
        color3: '#1E3A8A',
        blocks: [
          // ── Conexión ────────────────────────────────────────
          {
            opcode: 'connect',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.connect,
            text: 'conectar a sala [ROOM] como [NAME] servidor [SERVER]',
            arguments: {
              ROOM:   { type: Scratch.ArgumentType.STRING, defaultValue: 'sala1' },
              NAME:   { type: Scratch.ArgumentType.STRING, defaultValue: 'jugador1' },
              SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: DEFAULT_WS },
            },
          },
          {
            opcode: 'disconnect',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.disconnect,
            text: 'desconectar de la sala',
          },

          // ── Estado ──────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: '─── Estado ───' },
          {
            opcode: 'isConnected',
            blockType: Scratch.BlockType.BOOLEAN,
            blockIconURI: ASSETS.missing,
            text: '¿conectado?',
          },
          {
            opcode: 'getUsers',
            blockType: Scratch.BlockType.REPORTER,
            blockIconURI: ASSETS.missing,
            text: 'usuarios en la sala',
            disableMonitor: false,
          },
          {
            opcode: 'getUserCount',
            blockType: Scratch.BlockType.REPORTER,
            blockIconURI: ASSETS.missing,
            text: 'cantidad de usuarios',
            disableMonitor: false,
          },
          {
            opcode: 'myUsername',
            blockType: Scratch.BlockType.REPORTER,
            blockIconURI: ASSETS.missing,
            text: 'mi nombre de usuario',
          },

          // ── Volumen ─────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: '─── Volumen ───' },
          {
            opcode: 'getMyVolume',
            blockType: Scratch.BlockType.REPORTER,
            blockIconURI: ASSETS.config,
            text: 'mi nivel de micrófono (0-100)',
            disableMonitor: false,
          },
          {
            opcode: 'getUserVolume',
            blockType: Scratch.BlockType.REPORTER,
            blockIconURI: ASSETS.config,
            text: 'nivel de voz de [USER] (0-100)',
            arguments: {
              USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'jugador1' },
            },
          },
          {
            opcode: 'setUserVolume',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.config,
            text: 'poner volumen de [USER] a [VOL] %',
            arguments: {
              USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'jugador1' },
              VOL:  { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
            },
          },

          // ── Filtros ─────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: '─── Filtros ───' },
          {
            opcode: 'applyGlobalFilter',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.config,
            text: 'aplicar filtro [FILTER] en porcentaje [PCT] a mi mismo (globalmente)',
            arguments: {
              FILTER: { type: Scratch.ArgumentType.STRING, menu: 'filterMenu', defaultValue: 'paso bajo' },
              PCT:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: 'applyLocalFilter',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.config,
            text: 'aplicar filtro [FILTER] en porcentaje [PCT] a [USER] (localmente)',
            arguments: {
              FILTER: { type: Scratch.ArgumentType.STRING, menu: 'filterMenu', defaultValue: 'paso bajo' },
              PCT:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
              USER:   { type: Scratch.ArgumentType.STRING, defaultValue: 'jugador1' },
            },
          },

          // ── Micrófono ────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: '─── Micrófono ───' },
          {
            opcode: 'muteMic',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.mute,
            text: 'silenciar micrófono',
          },
          {
            opcode: 'unmuteMic',
            blockType: Scratch.BlockType.COMMAND,
            blockIconURI: ASSETS.unmute,
            text: 'activar micrófono',
          },
          {
            opcode: 'isMuted',
            blockType: Scratch.BlockType.BOOLEAN,
            blockIconURI: ASSETS.missing,
            text: '¿micrófono silenciado?',
          },

          // ── Eventos ──────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: '─── Eventos ───' },
          {
            opcode: 'whenUsersChange',
            blockType: Scratch.BlockType.HAT,
            blockIconURI: ASSETS.config,
            text: 'cuando cambia la lista de usuarios',
            isEdgeActivated: false,
          },
        ],
        menus: {
          filterMenu: {
            acceptReporters: true,
            items: [
              'paso bajo',
              'paso alto',
              'paso banda',
              'estante bajo',
              'estante alto',
              'pico',
              'muesca',
              'todo paso',
              'distorsion',
              'robot',
              'pitch (tono)'
            ]
          }
        }
      };
    }

    // ── GESTIÓN DE FILTROS (CADENA COMPLETA) ────────────────────────────────

    _buildEffectChain(ctx) {
      const biquad = ctx.createBiquadFilter();
      const distortion = ctx.createWaveShaper();
      const robotGain = ctx.createGain();

      // Cadena lineal: Entrada -> Filtro -> Distorsión -> Ganancia (Robot) -> Salida
      biquad.connect(distortion);
      distortion.connect(robotGain);

      return {
        input: biquad,
        biquad: biquad,
        distortion: distortion,
        robotGain: robotGain,
        output: robotGain,
        robotOsc: null // Oscilador que se crea solo cuando se usa el filtro 'robot'
      };
    }

    _applyFilterToChain(chain, typeName, pct, ctx) {
      if (!chain || !ctx) return;
      pct = Math.max(0, Math.min(100, Number(pct) || 0));

      // 1. REINICIAR LA CADENA (Filtro transparente por defecto)
      chain.biquad.type = 'lowpass';
      chain.biquad.frequency.value = 24000;
      chain.biquad.gain.value = 0;
      chain.biquad.Q.value = 1;
      chain.distortion.curve = null;
      if (chain.robotOsc) {
        try { chain.robotOsc.stop(); } catch(e){}
        try { chain.robotOsc.disconnect(); } catch(e){}
        chain.robotOsc = null;
      }

      // Si el pct es 0 o es un filtro de pitch (el pitch se procesa por datos crudos), dejamos la cadena limpia
      if ((pct === 0 && typeName !== 'pitch (tono)') || typeName === 'pitch (tono)') return;
      
      const pctNorm = pct / 100;

      // 2. APLICAR EL FILTRO SELECCIONADO
      if (['paso bajo', 'paso alto', 'paso banda', 'estante bajo', 'estante alto', 'pico', 'muesca', 'todo paso'].includes(typeName)) {
        const map = {
          'paso bajo': 'lowpass',
          'paso alto': 'highpass',
          'paso banda': 'bandpass',
          'estante bajo': 'lowshelf',
          'estante alto': 'highshelf',
          'pico': 'peaking',
          'muesca': 'notch',
          'todo paso': 'allpass'
        };
        chain.biquad.type = map[typeName];

        if (typeName === 'paso bajo') {
          chain.biquad.frequency.value = 24000 - (pctNorm * 23800);
        } else if (typeName === 'paso alto') {
          chain.biquad.frequency.value = pctNorm * 5000;
        } else if (typeName === 'paso banda' || typeName === 'muesca' || typeName === 'todo paso') {
          chain.biquad.frequency.value = 100 + (pctNorm * 4000);
          chain.biquad.Q.value = 1 + (pctNorm * 15); // Aumenta la resonancia
        } else if (typeName === 'estante bajo' || typeName === 'estante alto' || typeName === 'pico') {
          chain.biquad.frequency.value = 1000;
          chain.biquad.gain.value = (pctNorm * 30) - 15; // Rango de -15dB a +15dB
        }

      } else if (typeName === 'distorsion') {
        const k = pctNorm * 100;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
          let x = i * 2 / n_samples - 1;
          curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        chain.distortion.curve = curve;

      } else if (typeName === 'robot') {
        chain.robotOsc = ctx.createOscillator();
        chain.robotOsc.type = 'sine';
        chain.robotOsc.frequency.value = 10 + (pctNorm * 90);
        chain.robotOsc.connect(chain.robotGain.gain);
        chain.robotOsc.start();
      }
    }

    applyGlobalFilter({ FILTER, PCT }) {
      this._myFilterType = FILTER;
      this._myFilterPct = PCT;
      if (this._micChain && this._audioCtx) {
        this._applyFilterToChain(this._micChain, FILTER, PCT, this._audioCtx);
      }
    }

    applyLocalFilter({ FILTER, PCT, USER }) {
      const username = String(USER);
      this._userFilterSettings.set(username, { type: FILTER, pct: PCT });
      if (this._userChains.has(username) && this._audioCtx) {
        this._applyFilterToChain(this._userChains.get(username), FILTER, PCT, this._audioCtx);
      }
    }

    // ── CONNECT ─────────────────────────────────────────────────────────────

    async connect({ ROOM, NAME, SERVER }) {
      this._doDisconnect();

      this._username = String(NAME).trim().slice(0, 32) || 'anon';
      this._room     = String(ROOM).trim().slice(0, 64) || 'default';

      try {
        this._audioCtx = new AudioContext({ sampleRate: 48000 });
        await this._audioCtx.resume();

        this._mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        this._sourceNode = this._audioCtx.createMediaStreamSource(this._mediaStream);

        // Configuración de la cadena de efectos global (para mi voz)
        this._micChain = this._buildEffectChain(this._audioCtx);
        this._applyFilterToChain(this._micChain, this._myFilterType, this._myFilterPct, this._audioCtx);

        this._micGain = this._audioCtx.createGain();
        this._micGain.gain.value = 1;

        this._sourceNode.connect(this._micChain.input);
        this._micChain.output.connect(this._micGain);

        this._analyserNode = this._audioCtx.createAnalyser();
        this._analyserNode.fftSize = 512;
        this._micGain.connect(this._analyserNode);
        this._analyserBuf = new Float32Array(this._analyserNode.fftSize);

        const BUFFER_SIZE = 4096;
        this._scriptProcessor = this._audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

        this._scriptProcessor.onaudioprocess = (evt) => {
          this._analyserNode.getFloatTimeDomainData(this._analyserBuf);
          this._myVolume = rmsToPercent(calcRMS(this._analyserBuf));

          if (this._ws && this._ws.readyState === WebSocket.OPEN && !this._muted) {
            const samples = evt.inputBuffer.getChannelData(0);
            let pcm = new Float32Array(samples);

            // --- APLICACIÓN DEL PITCH GLOBAL (Algoritmo de Remuestreo Granular) ---
            if (this._myFilterType === 'pitch (tono)' && this._myFilterPct !== 50) {
              let pct = Math.max(0, Math.min(100, this._myFilterPct));
              let rate = pct < 50 ? 0.5 + (pct / 50) * 0.5 : 1.0 + ((pct - 50) / 50) * 1.0;
              let pitched = new Float32Array(pcm.length);
              
              for (let i = 0; i < pcm.length; i++) {
                // Al leer más rápido o lento pero mantener el tamaño del array forzado,
                // logramos el pitch sin cambiar la duración en absoluto.
                pitched[i] = pcm[Math.floor(i * rate) % pcm.length];
              }
              pcm = pitched;
            }

            const sampleRate = this._audioCtx.sampleRate;
            const buf = new ArrayBuffer(4 + pcm.byteLength);
            const dv = new DataView(buf);
            dv.setUint32(0, sampleRate, true);
            new Uint8Array(buf).set(new Uint8Array(pcm.buffer), 4);
            this._ws.send(buf);
          }
        };

        this._analyserNode.connect(this._scriptProcessor);

        this._silentGain = this._audioCtx.createGain();
        this._silentGain.gain.value = 0.00001;
        this._scriptProcessor.connect(this._silentGain);
        this._silentGain.connect(this._audioCtx.destination);

      } catch (err) {
        console.warn('VoiceChat: mic access failed — listen-only mode:', err);
        if (!this._audioCtx) {
          this._audioCtx = new AudioContext({ sampleRate: 48000 });
          await this._audioCtx.resume();
        }
      }

      try {
        this._ws = new WebSocket(String(SERVER));
        this._ws.binaryType = 'arraybuffer';

        this._ws.onopen = () => {
          this._connected = true;
          this._ws.send(JSON.stringify({
            type: 'join',
            room: this._room,
            username: this._username,
          }));
        };

        this._ws.onmessage = (evt) => {
          if (typeof evt.data === 'string') {
            try {
              const msg = JSON.parse(evt.data);
              if (msg.type === 'users') {
                const prev = this._users.join(',');
                this._users = Array.isArray(msg.users) ? msg.users : [];
                if (this._users.join(',') !== prev) {
                  this._usersChangedFlag = true;
                }
              }
            } catch (_) { /* ignore */ }
          } else {
            this._handleAudioPacket(evt.data);
          }
        };

        this._ws.onclose = () => {
          this._connected = false;
          if (this._users.length > 0) {
            this._users = [];
            this._usersChangedFlag = true;
          }
        };

      } catch (err) {
        console.error('VoiceChat: WebSocket connect failed:', err);
      }
    }

    // ── AUDIO PLAYBACK ───────────────────────────────────────────────────────

    _handleAudioPacket(buffer) {
      if (!this._audioCtx) return;

      try {
        const view = new DataView(buffer);
        const userLen      = view.getUint16(0, true);
        const usernameBytes = new Uint8Array(buffer, 2, userLen);
        const username     = new TextDecoder().decode(usernameBytes);
        const offset       = 2 + userLen;
        const sampleRate   = view.getUint32(offset, true);
        const pcmOffset    = offset + 4;
        const pcmByteLen   = buffer.byteLength - pcmOffset;
        const pcmLen       = Math.floor(pcmByteLen / 4);
        if (pcmLen <= 0) return;

        const aligned = new ArrayBuffer(pcmLen * 4);
        new Uint8Array(aligned).set(new Uint8Array(buffer, pcmOffset, pcmLen * 4));
        const pcmData = new Float32Array(aligned);

        // --- APLICACIÓN DEL PITCH LOCAL (Algoritmo de Remuestreo Granular) ---
        const savedF = this._userFilterSettings.get(username);
        if (savedF && savedF.type === 'pitch (tono)' && savedF.pct !== 50) {
          let pct = Math.max(0, Math.min(100, savedF.pct));
          let rate = pct < 50 ? 0.5 + (pct / 50) * 0.5 : 1.0 + ((pct - 50) / 50) * 1.0;
          let pitched = new Float32Array(pcmData.length);
          
          for (let i = 0; i < pcmData.length; i++) {
            pitched[i] = pcmData[Math.floor(i * rate) % pcmData.length];
          }
          // Reemplazamos la onda original por la modeada
          for (let i = 0; i < pcmData.length; i++) {
            pcmData[i] = pitched[i];
          }
        }

        // Live volume level
        this._volumeLevels.set(username, rmsToPercent(calcRMS(pcmData)));

        const audioBuffer = this._audioCtx.createBuffer(1, pcmLen, sampleRate);
        audioBuffer.copyToChannel(pcmData, 0);

        if (!this._userChains.has(username)) {
          const chain = this._buildEffectChain(this._audioCtx);
          this._userChains.set(username, chain);

          const initFilter = this._userFilterSettings.get(username) || { type: 'paso bajo', pct: 0 };
          this._applyFilterToChain(chain, initFilter.type, initFilter.pct, this._audioCtx);

          const gn = this._audioCtx.createGain();
          const override = this._volumeOverrides.get(username);
          gn.gain.value = override !== undefined ? override / 100 : 1;
          
          chain.output.connect(gn);
          gn.connect(this._audioCtx.destination);
          
          this._gainNodes.set(username, gn);
        }

        const source = this._audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        
        // Ya no cambiamos el playbackRate, el PCM ya viene alterado con magia matemática
        source.connect(this._userChains.get(username).input);

        const now  = this._audioCtx.currentTime;
        const prev = this._nextPlayTime.get(username) ?? now;
        let startAt = Math.max(now + 0.02, prev);

        if (startAt - now > 0.4) {
          startAt = now + 0.02;
        }

        source.start(startAt);
        // La duración ahora SIEMPRE será la original del buffer sin importar el pitch. ¡Cero Lag!
        this._nextPlayTime.set(username, startAt + audioBuffer.duration);

      } catch (err) {
        console.warn('VoiceChat: error decoding audio packet:', err);
      }
    }

    // ── DISCONNECT ───────────────────────────────────────────────────────────

    _doDisconnect() {
      if (this._ws) {
        try { this._ws.close(); } catch (_) { /* ignore */ }
        this._ws = null;
      }
      if (this._scriptProcessor) {
        try { this._scriptProcessor.disconnect(); } catch (_) { /* ignore */ }
        this._scriptProcessor = null;
      }
      if (this._mediaStream) {
        this._mediaStream.getTracks().forEach((t) => t.stop());
        this._mediaStream = null;
      }
      if (this._audioCtx) {
        try { this._audioCtx.close(); } catch (_) { /* ignore */ }
        this._audioCtx = null;
      }
      
      if (this._micChain && this._micChain.robotOsc) {
          try { this._micChain.robotOsc.stop(); } catch(e){}
      }
      this._micChain = null;

      for (let chain of this._userChains.values()) {
          if (chain.robotOsc) {
             try { chain.robotOsc.stop(); } catch(e){}
          }
      }

      this._gainNodes.clear();
      this._nextPlayTime.clear();
      this._volumeLevels.clear();
      this._userChains.clear();
      this._connected  = false;
      this._users      = [];
      this._myVolume   = 0;
      this._muted      = false;
    }

    disconnect() {
      this._doDisconnect();
    }

    // ── REPORTERS / BOOLEANS ─────────────────────────────────────────────────

    isConnected()   { return this._connected; }
    getUsers()      { return JSON.stringify(this._users); }
    getUserCount()  { return this._users.length; }
    myUsername()    { return this._username; }
    getMyVolume()   { return this._myVolume; }
    isMuted()       { return this._muted; }

    getUserVolume({ USER }) {
      return this._volumeLevels.get(String(USER)) ?? 0;
    }

    setUserVolume({ USER, VOL }) {
      const username = String(USER);
      const vol      = Math.max(0, Math.min(100, Number(VOL) || 0));
      this._volumeOverrides.set(username, vol);
      const gn = this._gainNodes.get(username);
      if (gn) gn.gain.setTargetAtTime(vol / 100, this._audioCtx?.currentTime ?? 0, 0.05);
    }

    muteMic() {
      this._muted = true;
      if (this._micGain) this._micGain.gain.setTargetAtTime(0, this._audioCtx.currentTime, 0.01);
    }

    unmuteMic() {
      this._muted = false;
      if (this._micGain) this._micGain.gain.setTargetAtTime(1, this._audioCtx.currentTime, 0.01);
    }

    whenUsersChange() {
      if (this._usersChangedFlag) {
        this._usersChangedFlag = false;
        return true;
      }
      return false;
    }
  }

  Scratch.extensions.register(new VoiceChat());

})(Scratch);