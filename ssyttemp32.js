(function (Scratch) {
  "use strict";
  if (!Scratch.extensions.unsandboxed) throw new Error("ssyttemp32 extension must run unsandboxed");

  const menuIconURI = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNDUuMzU4IiBoZWlnaHQ9IjE0NS4zNTgiIHZpZXdCb3g9IjAgMCAxNDUuMzU4IDE0NS4zNTgiPjxwYXRoIGQ9Ik0wIDcyLjY3OUMwIDMyLjUzOSAzMi41NCAwIDcyLjY3OSAwczcyLjY3OSAzMi41NCA3Mi42NzkgNzIuNjc5LTMyLjU0IDcyLjY3OS03Mi42NzkgNzIuNjc5UzAgMTEyLjgxOCAwIDcyLjY3OSIgZmlsbD0iI2MzMDAwMCIvPjxwYXRoIGQ9Ik05LjA0MSA3Mi42NzljMC0zNS4xNDYgMjguNDkyLTYzLjYzOCA2My42MzgtNjMuNjM4czYzLjYzOCAyOC40OTIgNjMuNjM4IDYzLjYzOC0yOC40OTIgNjMuNjM4LTYzLjYzOCA2My42MzhTOS4wNDEgMTA3LjgyNSA5LjA0MSA3Mi42NzkiIGZpbGw9InJlZCIvPjxwYXRoIGQ9Ik05OS40MTQgNzYuNjQxYy0xMC41ODYgNS44Ni0zMC4xIDE2LjY1OS0zNi4yODcgMjAuMDgzLTMuNjk1IDIuMDQ1LTcuOTEyIDEuMDM5LTcuOTEyLTMuOTEzdi0zOS4zN2MwLTQuMTg1IDMuNTI0LTcuMDU1IDYuNzctNS4yNThsMzcuNDI5IDIwLjcxNWM0LjIwNiAyLjMyOCA0LjIgNS40MTkgMCA3Ljc0MyIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==";
  const blockIconURI = "";

  const Cast = Scratch.Cast;

  class Ssyttemp32Extension {
    constructor() {
      this.lastError = "Ninguno";
      this.activeUrls = new Map(); // directUrl -> timestamp de expiración
    }

    getInfo() {
      return {
        id: 'ssyttemp32',
        name: 'ssyttemp32',
        menuIconURI,
        blockIconURI,
        color1: '#ff0000',
        color2: '#c10000',
        color3: '#820000',
        blocks: [
          {
            opcode: 'getDirectUrl',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener url temporal directa para el video [VIDEO_ID] como [TYPE]',
            arguments: {
              VIDEO_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'dkfgnPDe09w' },
              TYPE: { type: Scratch.ArgumentType.STRING, menu: 'EXPORT_TYPES' }
            }
          },
          '---',
          {
            opcode: 'getTimeLeft',
            blockType: Scratch.BlockType.REPORTER,
            text: 'tiempo restante para la url [URL]',
            arguments: {
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://ssyttemp32.wisp.uno/file/...' }
            }
          },
          {
            opcode: 'getLastError',
            blockType: Scratch.BlockType.REPORTER,
            text: 'último error'
          }
        ],
        menus: {
          EXPORT_TYPES: ['mp4', 'mp3']
        }
      };
    }

    async getDirectUrl(args) {
      const videoId = Cast.toString(args.VIDEO_ID);
      const type = Cast.toString(args.TYPE);
      const serverURL = 'https://ssyttemp32.wisp.uno/api/convert';

      if (!videoId || videoId === 'Invalid URL') {
        this.lastError = "ID de video inválido";
        return 'Error: ID inválido';
      }

      try {
        if (!(await Scratch.canFetch(serverURL))) {
          this.lastError = "El sandbox bloquea las peticiones de red";
          return 'Error: Sandbox bloquea red';
        }

        const response = await Scratch.fetch(serverURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ videoId, type })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          this.lastError = errData.error || response.statusText;
          return 'Error: ' + this.lastError;
        }

        const data = await response.json();
        if (data.success && data.directUrl) {
          if (data.expiresAt) {
            this.activeUrls.set(data.directUrl, data.expiresAt);
          }
          return data.directUrl;
        } else {
          this.lastError = "Respuesta inválida del servidor";
          return 'Error: Respuesta inválida';
        }
      } catch (e) {
        this.lastError = e.message || String(e);
        console.warn('Error en la extensión ssyttemp32: ' + e);
        return 'Error: Falló la conexión';
      }
    }

    getTimeLeft(args) {
      const url = Cast.toString(args.URL);
      if (!this.activeUrls.has(url)) return "Desconocido / Expirado";

      const expiresAt = this.activeUrls.get(url);
      const timeLeftMs = expiresAt - Date.now();

      if (timeLeftMs <= 0) {
        return "Expirado";
      }

      const totalSeconds = Math.floor(timeLeftMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;

      return `${minutes}m ${seconds}s`;
    }

    getLastError() {
      return this.lastError;
    }
  }

  Scratch.extensions.register(new Ssyttemp32Extension());
})(Scratch);