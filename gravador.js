(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('Esta extensión requiere ejecutarse de forma Unsandboxed.');
  }

  let audioContext = null;
  let mediaStream = null;
  let processorNode = null;
  let recordedBuffers = [];
  let isListening = false;
  let lastDataURL = '';
  let sampleRate = 44100;

  class GrabadorDirectoPuro {
    getInfo() {
      return {
        id: 'grabadordirectopuro',
        name: 'Grabador Directo Puro',
        color1: '#a855f7',
        color2: '#9333ea',
        blocks: [
          {
            opcode: 'encenderMicrofono',
            blockType: Scratch.BlockType.COMMAND,
            text: '1. Encender micrófono'
          },
          {
            opcode: 'iniciarCaptura',
            blockType: Scratch.BlockType.COMMAND,
            text: '2. Empezar a grabar'
          },
          {
            opcode: 'detenerCaptura',
            blockType: Scratch.BlockType.COMMAND,
            text: '3. Detener y procesar WAV'
          },
          {
            opcode: 'apagarMicrofono',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Apagar hardware del micrófono'
          },
          {
            opcode: 'obtenerDataURL',
            blockType: Scratch.BlockType.REPORTER,
            text: 'último audio WAV (Data URL)'
          },
          {
            opcode: 'estaGrabando',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '¿grabando activamente?'
          }
        ]
      };
    }

    async encenderMicrofono() {
      if (mediaStream) return;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            latency: 0
          }
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        sampleRate = audioContext.sampleRate;

        const source = audioContext.createMediaStreamSource(mediaStream);
        // Nodo de procesamiento de bajo nivel (4096 muestras)
        processorNode = audioContext.createScriptProcessor(4096, 1, 1);

        processorNode.onaudioprocess = (e) => {
          if (!isListening) return;
          // Capturamos el audio crudo en tiempo real
          const inputData = e.inputBuffer.getChannelData(0);
          recordedBuffers.push(new Float32Array(inputData));
        };

        source.connect(processorNode);
        processorNode.connect(audioContext.destination);
      } catch (err) {
        console.error('Error al encender el micrófono nativo:', err);
      }
    }

    iniciarCaptura() {
      if (!mediaStream) {
        console.warn("El micrófono no está encendido. Enciéndelo primero.");
        return;
      }
      recordedBuffers = [];
      isListening = true;
    }

    detenerCaptura() {
      return new Promise((resolve) => {
        if (!isListening) {
          resolve();
          return;
        }
        isListening = false;

        // Esperamos 300ms adicionales (Post-roll automático) para evitar cortes al final de la frase
        setTimeout(() => {
          if (recordedBuffers.length === 0) {
            lastDataURL = '';
            resolve();
            return;
          }

          // Calculamos el tamaño total de los fragmentos
          let totalLength = 0;
          for (let i = 0; i < recordedBuffers.length; i++) {
            totalLength += recordedBuffers[i].length;
          }

          // Ensamblamos el WAV manualmente
          const wavBuffer = new ArrayBuffer(44 + totalLength * 2);
          const view = new DataView(wavBuffer);

          /* Cabecera RIFF */
          view.setUint32(0, 0x52494646, false); // "RIFF"
          view.setUint32(4, 36 + totalLength * 2, true);
          view.setUint32(8, 0x57415645, false); // "WAVE"

          /* Sub-chunk formato */
          view.setUint32(12, 0x666d7420, false); // "fmt "
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true); // PCM
          view.setUint16(22, 1, true); // Mono
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);

          /* Sub-chunk datos */
          view.setUint32(36, 0x64617461, false); // "data"
          view.setUint32(40, totalLength * 2, true);

          // Escribir muestras
          let offset = 44;
          for (let i = 0; i < recordedBuffers.length; i++) {
            const channel = recordedBuffers[i];
            for (let j = 0; j < channel.length; j++) {
              let sample = channel[j];
              sample = Math.max(-1, Math.min(1, sample));
              view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
              offset += 2;
            }
          }

          const blob = new Blob([view], { type: 'audio/wav' });
          const reader = new FileReader();
          reader.onloadend = () => {
            lastDataURL = reader.result;
            resolve();
          };
          reader.readAsDataURL(blob);
        }, 300);
      });
    }

    apagarMicrofono() {
      isListening = false;
      if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
      }
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }
      recordedBuffers = [];
      lastDataURL = '';
      console.log('Micrófono apagado y liberado por completo.');
    }

    obtenerDataURL() {
      return lastDataURL;
    }

    estaGrabando() {
      return isListening;
    }
  }

  Scratch.extensions.register(new GrabadorDirectoPuro());
})(Scratch);