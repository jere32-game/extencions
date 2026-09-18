(function(Scratch) {
  'use strict';

  class ExtensionIAParalela {
    constructor() {
      // Base de datos de personajes
      this.personajes = {}; 
      this.modelo = "openai"; 
    }

    getInfo() {
      return {
        id: 'iaParalelaUltra',
        name: 'IA: Multihilo (Rápida)',
        color1: '#00C853', // Verde para indicar velocidad/estabilidad
        color2: '#009624',
        blocks: [
          '--- Gestión ---',
          {
            opcode: 'crearPersonaje',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Crear personaje [NAME] | Rol: [ROLE] | Pers: [PER]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Tripulante' },
              ROLE: { type: Scratch.ArgumentType.STRING, defaultValue: 'astronauta' },
              PER: { type: Scratch.ArgumentType.STRING, defaultValue: 'nervioso' }
            }
          },
          {
            opcode: 'borrarPersonaje',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Borrar personaje [NAME]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Tripulante' }
            }
          },
          '--- Acciones Paralelas ---',
          {
            opcode: 'enviarMensajeAsync',
            blockType: Scratch.BlockType.COMMAND,
            text: '⚡ Enviar mensaje a [NAME]: [PROMPT]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Tripulante' },
              PROMPT: { type: Scratch.ArgumentType.STRING, defaultValue: '¿Dónde estabas?' }
            }
          },
          {
            opcode: 'estaPensando',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '¿[NAME] está escribiendo?',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Tripulante' }
            }
          },
          {
            opcode: 'obtenerRespuesta',
            blockType: Scratch.BlockType.REPORTER,
            text: 'Respuesta de [NAME]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Tripulante' }
            }
          }
        ]
      };
    }

    crearPersonaje(args) {
      this.personajes[args.NAME] = {
        rol: args.ROLE,
        personalidad: args.PER,
        historial: [],
        pensando: false,
        ultimaRespuesta: ""
      };
    }

    borrarPersonaje(args) {
      if (this.personajes[args.NAME]) {
        delete this.personajes[args.NAME];
      }
    }

    // EL TRUCO ESTÁ AQUÍ:
    // No usamos "await" que congele el script. Disparamos el fetch y liberamos el bloque.
    enviarMensajeAsync(args) {
      const nombre = args.NAME;
      const pj = this.personajes[nombre];
      
      if (!pj) return; // Si no existe, no hace nada

      pj.pensando = true;
      pj.ultimaRespuesta = "";

      const systemPrompt = `Tu nombre es ${nombre}. Rol: ${pj.rol}. Personalidad: ${pj.personalidad}. Responde brevemente en español.`;
      
      pj.historial.push(`Usuario: ${args.PROMPT}`);
      if (pj.historial.length > 6) pj.historial = pj.historial.slice(-6);
      
      const conversacion = pj.historial.join('\n');
      const fullPrompt = `${systemPrompt}\n\nHistorial:\n${conversacion}\n\n${nombre}:`;

      const url = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=${this.modelo}`;

      // Llamada en segundo plano
      fetch(url)
        .then(response => {
          if (!response.ok) throw new Error("API Error");
          return response.text();
        })
        .then(texto => {
          const respuesta = texto.trim();
          pj.historial.push(`${nombre}: ${respuesta}`);
          pj.ultimaRespuesta = respuesta;
          pj.pensando = false;
        })
        .catch(error => {
          pj.ultimaRespuesta = "(Error de red)";
          pj.pensando = false;
        });
    }

    estaPensando(args) {
      const pj = this.personajes[args.NAME];
      return pj ? pj.pensando : false;
    }

    obtenerRespuesta(args) {
      const pj = this.personajes[args.NAME];
      return pj ? pj.ultimaRespuesta : "";
    }
  }

  Scratch.extensions.register(new ExtensionIAParalela());
})(Scratch);