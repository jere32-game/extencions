// Name: DiscordBot EXPANDE V11 (ULTIMATE + DM GLOBAL + BOTONES + ID)
// Author: Mistium (Modded by Gemini)
// Description: Make discord bots in turbowarp with EVERYTHING: DMs, Moderation, Voice, Soundboard, Slash Commands, Embeds, Threads, Join Events, Buttons, and more!
// License: MPL-2.0

(function(Scratch) {
  const API = 'https://apps.mistium.com/discord';
  const WS = 'wss://gateway.discord.gg/?v=10&encoding=json';
  let bot_data = null;
  
  const util = {
    s: val => Scratch.Cast.toString(val),
    log: console.log,
    err: console.error,
    limit: (arr, max) => { while (arr.length > max) arr.shift(); }
  };

  class DiscordBot {
    constructor() {
      this.token = null;
      this.client = null;
      this.messages = [];
      this.interactions = [];
      this.status = "online";
      this.activity = null;
      this.ping = 0; 
      this.lastHeartbeatAck = 0; 
      
      this.lastMessages = new Map(); 
      this.lastProcessedIds = new Map(); 

      this.lastInteractions = new Map();
      this.lastProcessedInteractions = new Map();

      this.lastDMs = new Map();
      this.lastProcessedDMIds = new Map();

      // DM Global
      this.lastGlobalDM = null;
      this.lastProcessedGlobalDMId = null;

      this.lastJoinedMembers = new Map();
      this.lastProcessedJoinIds = new Map();

      // Botones
      this.lastButtonInteractions = new Map();
      this.lastProcessedButtonInteractions = new Map();

      // Eventos de Voz (Mejorados con Tracking de Estado)
      this.voiceStates = new Map(); // user_id -> channel_id actual
      
      this.lastVoiceJoins = new Map();
      this.lastProcessedVoiceJoins = new Map();
      this.lastVoiceEventData = null;

      this.lastVoiceLeaves = new Map();
      this.lastProcessedVoiceLeaves = new Map();
      this.lastVoiceLeaveEventData = null;

      this.messageCache = new Map();
      this.maxCachePerChannel = 100;
      this.guildCache = new Map();
      
      this.conn = {
        isConnecting: false,
        attempts: 0,
        maxAttempts: 10,
        reconnectTimer: null,
        heartbeatTimer: null,
        seq: null,
        sessionId: null,
        rateLimited: false,
        rateLimitReset: 0
      };
    }

    getInfo() {
      return {
        id: 'mistiumDiscordBot',
        name: 'DiscordBot EXPANDE',
        description: 'A Discord bot for Scratch with full features: DMs, moderation, voice, soundboard, slash commands, embeds, buttons, and more.',
        color1: "#7289DA",
        blockIconURI: 'https://yyf.mubilop.com/file/bffd7207/Discord.svg',
        menuIconURI: 'https://yyf.mubilop.com/file/bffd7207/Discord.svg',
        blocks: [
          // ==============================
          // CONNECTION
          // ==============================
          {
            opcode: 'setToken',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set token to [TOKEN] (THIS ALLOWS FULL ACCESS TO YOUR BOT, DO NOT SHARE EVER)',
            arguments: { TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: 'token' } }
          },
          { opcode: 'connectToDiscord', blockType: Scratch.BlockType.COMMAND, text: 'connect to discord' },
          { opcode: 'disconnectFromDiscord', blockType: Scratch.BlockType.COMMAND, text: 'disconnect from discord' },
          { opcode: 'connected', blockType: Scratch.BlockType.BOOLEAN, text: 'connected to discord' },
          { opcode: 'botinfo', blockType: Scratch.BlockType.REPORTER, text: 'bot information' },
          { opcode: 'getBotPing', blockType: Scratch.BlockType.REPORTER, text: 'latencia del bot (ping ms)' },
          { opcode: 'getGuilds', blockType: Scratch.BlockType.REPORTER, text: 'get all guilds' },
          {
            opcode: 'getGuildInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get guild info [GUILD_ID]',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'guild_id' } }
          },

          '---',

          // ==============================
          // SUPER MEGA ULTRA EXPANSIÓN
          // ==============================
          {
            opcode: 'getUserAvatar',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener URL del avatar de [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'getUserInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener nombre del usuario [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'getMemberNickname',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener apodo de [USER_ID] en servidor [GUILD_ID]',
            arguments: {
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'getGuildMemberCount',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ver cantidad de miembros del server [GUILD_ID]',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' } }
          },
          {
            opcode: 'sendEmbed',
            blockType: Scratch.BlockType.COMMAND,
            text: 'enviar embed a [CHANNEL_ID] con título [TITLE] descripción [DESC] color HEX [COLOR]',
            arguments: {
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' },
              TITLE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Mi Embed' },
              DESC: { type: Scratch.ArgumentType.STRING, defaultValue: 'Descripción increíble' },
              COLOR: { type: Scratch.ArgumentType.STRING, defaultValue: '00FF00' }
            }
          },
          {
            opcode: 'createThread',
            blockType: Scratch.BlockType.COMMAND,
            text: 'crear hilo [NAME] en canal [CHANNEL_ID] desde mensaje [MESSAGE_ID]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Nuevo Hilo' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' },
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del mensaje base' }
            }
          },
          {
            opcode: 'whenMemberJoins',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando un miembro se una al servidor [GUILD_ID]',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' } }
          },
          {
            opcode: 'getJoinedMemberId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del miembro que se acaba de unir a [GUILD_ID]',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' } }
          },

          '---',

          // ==============================
          // VOZ Y SOUNDBOARD
          // ==============================
          {
            opcode: 'whenVoiceChannelJoin',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando alguien se una a la voz en [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'getVoiceJoinUserId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del usuario que se unió a voz'
          },
          {
            opcode: 'whenVoiceChannelLeave',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando alguien salga de la voz en [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'getVoiceLeaveUserId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del usuario que salió de voz'
          },
          {
            opcode: 'joinVoiceChannel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'unirse a canal de voz [CHANNEL_ID] en servidor [GUILD_ID] (escucha pero no habla)',
            arguments: {
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal de voz' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'updateVoiceState',
            blockType: Scratch.BlockType.COMMAND,
            text: 'actualizar estado de voz en [GUILD_ID] canal [CHANNEL_ID] mutear mic: [MUTE] ensordecer: [DEAF]',
            arguments: {
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' },
              MUTE: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: true },
              DEAF: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: false }
            }
          },
          {
            opcode: 'leaveVoiceChannel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'salir del canal de voz en servidor [GUILD_ID]',
            arguments: {
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'moveUserVoiceChannel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'mover usuario [USER_ID] al canal de voz [CHANNEL_ID] en servidor [GUILD_ID]',
            arguments: {
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'nuevo id del canal' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'getGuildSounds',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener lista de sonidos (Soundboard) del servidor [GUILD_ID]',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' } }
          },
          {
            opcode: 'sendSoundboardSound',
            blockType: Scratch.BlockType.COMMAND,
            text: 'reproducir sonido de Soundboard [SOUND_ID] en canal de voz [CHANNEL_ID]',
            arguments: {
              SOUND_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del sonido' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal de voz' }
            }
          },

          '---',

          // ==============================
          // EVENT & TRACKING (INCLUYE DM GLOBAL)
          // ==============================
          {
            opcode: 'whenMessageReceived',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando reciba mensaje en canal [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'getMsgContent',
            blockType: Scratch.BlockType.REPORTER,
            text: 'contenido del ultimo mensaje en [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'getMsgAuthor',
            blockType: Scratch.BlockType.REPORTER,
            text: 'autor del ultimo mensaje en [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'getMsgAuthorId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del autor del ultimo mensaje en [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'getMsgId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del ultimo mensaje en [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },

          '---',

          {
            opcode: 'whenDMReceived',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando reciba DM del usuario [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'getDMMsgContent',
            blockType: Scratch.BlockType.REPORTER,
            text: 'contenido del ultimo DM de [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'getDMMsgAuthor',
            blockType: Scratch.BlockType.REPORTER,
            text: 'autor del ultimo DM de [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'getDMMsgAuthorId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del autor del ultimo DM de [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'getDMMsgId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del ultimo DM de [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },

          '---',
          
          // DM GLOBAL BLOCKS
          {
            opcode: 'whenGlobalDMReceived',
            blockType: Scratch.BlockType.HAT,
            text: 'al recibir cualquier mensaje DM Global'
          },
          {
            opcode: 'getGlobalDMMsgContent',
            blockType: Scratch.BlockType.REPORTER,
            text: 'contenido del mensaje DM Global'
          },
          {
            opcode: 'getGlobalDMMsgAuthor',
            blockType: Scratch.BlockType.REPORTER,
            text: 'autor del mensaje DM Global'
          },
          {
            opcode: 'getGlobalDMMsgAuthorId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del autor del mensaje DM Global'
          },
          {
            opcode: 'getGlobalDMMsgId',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID de mensaje DM Global'
          },

          '---',

          // ==============================
          // INTERACCIONES Y BOTONES
          // ==============================
          {
            opcode: 'createActionRow',
            blockType: Scratch.BlockType.REPORTER,
            text: 'crear fila de botones (Action Row) vacía'
          },
          {
            opcode: 'addButtonToActionRow',
            blockType: Scratch.BlockType.REPORTER,
            text: 'añadir botón [LABEL] id [ID] estilo [STYLE] a [ROW]',
            arguments: {
              LABEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'Click Aquí' },
              ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'boton_1' },
              STYLE: { menu: 'BUTTON_STYLE' },
              ROW: { type: Scratch.ArgumentType.STRING, defaultValue: '[{"type":1,"components":[]}]' }
            }
          },
          {
            opcode: 'sendMessageWithComponents',
            blockType: Scratch.BlockType.COMMAND,
            text: 'enviar mensaje [MESSAGE] a canal [CHANNEL_ID] con botones [COMPONENTS]',
            arguments: {
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: '¡Mira estos botones!' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' },
              COMPONENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[{...}]' }
            }
          },
          {
            opcode: 'whenButtonClicked',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando alguien presione el botón con id [BUTTON_ID]',
            arguments: { BUTTON_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'boton_1' } }
          },
          {
            opcode: 'getClickedButtonUser',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ID del usuario que presionó el botón [BUTTON_ID]',
            arguments: { BUTTON_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'boton_1' } }
          },
          {
            opcode: 'replyToButton',
            blockType: Scratch.BlockType.COMMAND,
            text: 'responder al botón [BUTTON_ID] con el mensaje [CONTENT]',
            arguments: {
              BUTTON_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'boton_1' },
              CONTENT: { type: Scratch.ArgumentType.STRING, defaultValue: '¡Botón presionado!' }
            }
          },

          '---',

          {
            opcode: 'whenCommandReceived',
            blockType: Scratch.BlockType.HAT,
            text: 'cuando reciba el comando [COMMAND_NAME]',
            arguments: { COMMAND_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'xd' } }
          },
          {
            opcode: 'getCommandInteraction',
            blockType: Scratch.BlockType.REPORTER,
            text: 'interacción del comando [COMMAND_NAME]',
            arguments: { COMMAND_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'xd' } }
          },
          {
            opcode: 'getCommandOption',
            blockType: Scratch.BlockType.REPORTER,
            text: 'valor de la opción [OPTION_NAME] del comando [COMMAND_NAME]',
            arguments: { 
              OPTION_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'nombre de la opcion' },
              COMMAND_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'xd' }
            }
          },
          
          '---',
          
          // ==============================
          // MESSAGES
          // ==============================
          {
            opcode: 'triggerTyping',
            blockType: Scratch.BlockType.COMMAND,
            text: 'mostrar "escribiendo..." en el canal [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'triggerTypingDM',
            blockType: Scratch.BlockType.COMMAND,
            text: 'mostrar "escribiendo..." en DM del usuario [USER_ID]',
            arguments: { USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' } }
          },
          {
            opcode: 'triggerTypingGlobalDM',
            blockType: Scratch.BlockType.COMMAND,
            text: 'mostrar "escribiendo..." al DM Global'
          },
          {
            opcode: 'sendMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'send message [MESSAGE] to channel [CHANNEL]',
            arguments: {
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'message' },
              CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel' }
            }
          },
          {
            opcode: 'editMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'editar mensaje [MESSAGE_ID] en canal [CHANNEL_ID] a [NEW_CONTENT]',
            arguments: {
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' },
              NEW_CONTENT: { type: Scratch.ArgumentType.STRING, defaultValue: 'mensaje editado' }
            }
          },
          {
            opcode: 'getMessage',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get message [MESSAGE_ID] from channel [CHANNEL_ID]',
            arguments: {
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'getChannelMessages',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ver ultimos [AMOUNT] mensajes del canal [CHANNEL_ID]',
            arguments: {
              AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'getDirectMessages',
            blockType: Scratch.BlockType.REPORTER,
            text: 'ver ultimos [AMOUNT] mensajes del MD de [USER_ID]',
            arguments: {
              AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 },
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'user_id' }
            }
          },
          {
            opcode: 'sendDirectMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'DM user [USER_ID] message [MESSAGE]',
            arguments: {
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'user_id' },
              MESSAGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'message' }
            }
          },
          {
            opcode: 'deleteMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'bulkDeleteMessages',
            blockType: Scratch.BlockType.COMMAND,
            text: 'borrar (purge) [AMOUNT] mensajes en canal [CHANNEL_ID]',
            arguments: {
              AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'pinMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'fijar mensaje [MESSAGE_ID] en canal [CHANNEL_ID]',
            arguments: {
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del mensaje' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' }
            }
          },
          {
            opcode: 'unpinMessage',
            blockType: Scratch.BlockType.COMMAND,
            text: 'desfijar mensaje [MESSAGE_ID] en canal [CHANNEL_ID]',
            arguments: {
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del mensaje' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' }
            }
          },
          {
            opcode: 'sendReply',
            blockType: Scratch.BlockType.COMMAND,
            text: 'send reply [REPLY] to message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              REPLY: { type: Scratch.ArgumentType.STRING, defaultValue: 'reply' },
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'addReaction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'add reaction [EMOJI] to message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: 'emoji' },
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          {
            opcode: 'removeReaction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'remove reaction [EMOJI] from message [MESSAGE_ID] in channel [CHANNEL_ID]',
            arguments: {
              EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: 'emoji' },
              MESSAGE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'message_id' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' }
            }
          },
          
          '---',

          // ==============================
          // CHANNELS
          // ==============================
          {
            opcode: 'getGuildChannels',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener canales del servidor [GUILD_ID] (Lista)',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' } }
          },
          {
            opcode: 'getChannelName',
            blockType: Scratch.BlockType.REPORTER,
            text: 'nombre del canal [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },
          {
            opcode: 'createChannel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'crear canal [NAME] tipo [TYPE] [PRIVACY] en servidor [GUILD_ID]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'nuevo-canal' },
              TYPE: { menu: 'CHANNEL_TYPE' },
              PRIVACY: { menu: 'PRIVACY' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'editChannel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'editar canal [CHANNEL_ID] con nombre [NAME] y [PRIVACY] en servidor [GUILD_ID]',
            arguments: {
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'nombre-editado' },
              PRIVACY: { menu: 'PRIVACY' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'setChannelTopic',
            blockType: Scratch.BlockType.COMMAND,
            text: 'cambiar tema (topic) a [TOPIC] en canal [CHANNEL_ID]',
            arguments: {
              TOPIC: { type: Scratch.ArgumentType.STRING, defaultValue: 'Reglas del servidor' },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' }
            }
          },
          {
            opcode: 'setChannelSlowmode',
            blockType: Scratch.BlockType.COMMAND,
            text: 'activar modo lento de [SECONDS] seg en canal [CHANNEL_ID]',
            arguments: {
              SECONDS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 },
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' }
            }
          },
          {
            opcode: 'deleteChannel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'eliminar canal [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' } }
          },

          '---',

          // ==============================
          // ROLES, GUILDS Y MODERACIÓN
          // ==============================
          {
            opcode: 'getGuildRoles',
            blockType: Scratch.BlockType.REPORTER,
            text: 'obtener roles del servidor [GUILD_ID] (Lista)',
            arguments: { GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' } }
          },
          {
            opcode: 'createInvite',
            blockType: Scratch.BlockType.REPORTER,
            text: 'crear invitación para [CHANNEL_ID] con [MAX_USES] usos',
            arguments: {
              CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del canal' },
              MAX_USES: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }
            }
          },
          {
            opcode: 'createRole',
            blockType: Scratch.BlockType.COMMAND,
            text: 'crear rol [NAME] color HEX [COLOR] en servidor [GUILD_ID]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Nuevo Rol' },
              COLOR: { type: Scratch.ArgumentType.STRING, defaultValue: 'FF0000' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'addRole',
            blockType: Scratch.BlockType.COMMAND,
            text: 'añadir rol [ROLE_ID] a usuario [USER_ID] en servidor [GUILD_ID]',
            arguments: {
              ROLE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del rol' },
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'removeRole',
            blockType: Scratch.BlockType.COMMAND,
            text: 'quitar rol [ROLE_ID] a usuario [USER_ID] en servidor [GUILD_ID]',
            arguments: {
              ROLE_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del rol' },
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'timeoutUser',
            blockType: Scratch.BlockType.COMMAND,
            text: 'aislar (timeout) usuario [USER_ID] en [GUILD_ID] por [MINUTES] minutos',
            arguments: {
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' },
              MINUTES: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }
            }
          },
          {
            opcode: 'banUser',
            blockType: Scratch.BlockType.COMMAND,
            text: 'banear usuario [USER_ID] de servidor [GUILD_ID] razón [REASON]',
            arguments: {
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' },
              REASON: { type: Scratch.ArgumentType.STRING, defaultValue: 'romper las reglas' }
            }
          },
          {
            opcode: 'kickUser',
            blockType: Scratch.BlockType.COMMAND,
            text: 'expulsar usuario [USER_ID] de servidor [GUILD_ID]',
            arguments: {
              USER_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del usuario' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'changeBotNickname',
            blockType: Scratch.BlockType.COMMAND,
            text: 'cambiar apodo del bot a [NICKNAME] en servidor [GUILD_ID]',
            arguments: {
              NICKNAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Nuevo Apodo' },
              GUILD_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'id del servidor' }
            }
          },
          {
            opcode: 'changeBotUsername',
            blockType: Scratch.BlockType.COMMAND,
            text: 'cambiar nombre de usuario global del bot a [USERNAME]',
            arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Mi Nuevo Bot' } }
          },

          '---',
          
          // ==============================
          // MESSAGE QUEUE
          // ==============================
          { opcode: 'newMessage', blockType: Scratch.BlockType.BOOLEAN, text: 'new messages?' },
          { opcode: 'popMessage', blockType: Scratch.BlockType.REPORTER, text: 'get next message' },
          { opcode: 'totalMessages', blockType: Scratch.BlockType.REPORTER, text: 'total messages' },
          
          '---',
          
          // ==============================
          // CACHE
          // ==============================
          {
            opcode: 'clearCache',
            blockType: Scratch.BlockType.COMMAND,
            text: 'clear message cache for channel [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' } }
          },
          { opcode: 'clearAllCache', blockType: Scratch.BlockType.COMMAND, text: 'clear all message cache' },
          {
            opcode: 'getCacheSize',
            blockType: Scratch.BlockType.REPORTER,
            text: 'cached messages in channel [CHANNEL_ID]',
            arguments: { CHANNEL_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'channel_id' } }
          },
          
          '---',
          
          // ==============================
          // COMMANDS
          // ==============================
          {
            opcode: 'registerSlashCommand',
            blockType: Scratch.BlockType.COMMAND,
            text: 'register slash command [NAME] with description [DESCRIPTION] options [OPTIONS]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'command' },
              DESCRIPTION: { type: Scratch.ArgumentType.STRING, defaultValue: 'description' },
              OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }
            }
          },
          {
            opcode: 'deleteSlashCommand',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete slash command [NAME]',
            arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'command' } }
          },
          { opcode: 'getAllCommands', blockType: Scratch.BlockType.REPORTER, text: 'all commands' },
          
          '---',
          
          // ==============================
          // COMMAND OPTIONS
          // ==============================
          { opcode: 'createCommandOptions', blockType: Scratch.BlockType.REPORTER, text: 'create options list' },
          {
            opcode: 'addCommandOption',
            blockType: Scratch.BlockType.REPORTER,
            text: 'add [TYPE] option name [NAME] description [DESCRIPTION] required [REQUIRED] to [OPTIONS]',
            arguments: {
              TYPE: { menu: 'OPTION_TYPE' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'option-name' },
              DESCRIPTION: { type: Scratch.ArgumentType.STRING, defaultValue: 'option description' },
              REQUIRED: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: false },
              OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }
            }
          },
          
          '---',
          
          // ==============================
          // INTERACTIONS
          // ==============================
          { opcode: 'newInteraction', blockType: Scratch.BlockType.BOOLEAN, text: 'new interactions?' },
          { opcode: 'popInteraction', blockType: Scratch.BlockType.REPORTER, text: 'get next interaction' },
          { opcode: 'totalInteractions', blockType: Scratch.BlockType.REPORTER, text: 'total interactions' },
          {
            opcode: 'replyToInteraction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'reply to interaction [INTERACTION] with [CONTENT]',
            arguments: {
              INTERACTION: { type: Scratch.ArgumentType.STRING, defaultValue: '{interaction object}' },
              CONTENT: { type: Scratch.ArgumentType.STRING, defaultValue: 'content' }
            }
          },
          {
            opcode: 'deferInteraction',
            blockType: Scratch.BlockType.COMMAND,
            text: 'mostrar "pensando..." a la interacción [INTERACTION]',
            arguments: {
              INTERACTION: { type: Scratch.ArgumentType.STRING, defaultValue: '{interaction object}' }
            }
          },
          {
            opcode: 'editInteractionReply',
            blockType: Scratch.BlockType.COMMAND,
            text: 'editar respuesta de interacción [INTERACTION] con el mensaje [CONTENT]',
            arguments: {
              INTERACTION: { type: Scratch.ArgumentType.STRING, defaultValue: '{interaction object}' },
              CONTENT: { type: Scratch.ArgumentType.STRING, defaultValue: '¡Ya pensé la respuesta!' }
            }
          },
          
          // ==============================
          // STATUS
          // ==============================
          {
            opcode: 'setStatus',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set status to [STATUS]',
            arguments: { STATUS: { menu: 'STATUS' } }
          },
          {
            opcode: 'setActivity',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set activity to [TYPE] [ACTIVITY]',
            arguments: {
              TYPE: { menu: 'ACTIVITY_TYPE' },
              ACTIVITY: { type: Scratch.ArgumentType.STRING, defaultValue: 'activity' }
            }
          }
        ],
        menus: {
          ACTIVITY_TYPE: {
            acceptReporters: true,
            items: [
              { text: "playing", value: 0 },
              { text: "streaming", value: 1 },
              { text: "listening", value: 2 },
              { text: "watching", value: 3 }
            ]
          },
          STATUS: ['online', 'idle', 'dnd', 'invisible'],
          BUTTON_STYLE: {
            acceptReporters: false,
            items: [
              { text: "Primario (Azul)", value: "1" },
              { text: "Secundario (Gris)", value: "2" },
              { text: "Éxito (Verde)", value: "3" },
              { text: "Peligro (Rojo)", value: "4" }
            ]
          },
          OPTION_TYPE: {
            acceptReporters: false,
            items: [
              { text: "string", value: "string" },
              { text: "integer", value: "integer" },
              { text: "boolean", value: "boolean" },
              { text: "user", value: "user" },
              { text: "channel", value: "channel" }
            ]
          },
          CHANNEL_TYPE: {
            acceptReporters: false,
            items: [
              { text: "texto", value: "0" },
              { text: "voz", value: "2" },
              { text: "foro", value: "15" }
            ]
          },
          PRIVACY: {
            acceptReporters: false,
            items: [
              { text: "público", value: "public" },
              { text: "privado", value: "private" },
              { text: "sin cambios", value: "none" }
            ]
          }
        }
      };
    }

    // ==============================================
    //        SUPER MEGA ULTRA EXPANSIÓN LÓGICA
    // ==============================================

    getBotPing() { return this.ping; } 

    getUserAvatar({ USER_ID }) {
      return this._apiRequest(`/users/${util.s(USER_ID)}`)
        .then(u => u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : '')
        .catch(() => '');
    }

    getUserInfo({ USER_ID }) {
      return this._apiRequest(`/users/${util.s(USER_ID)}`)
        .then(u => u.username || u.global_name || "")
        .catch(() => "");
    }

    getMemberNickname({ USER_ID, GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/${util.s(USER_ID)}`)
        .then(m => m.nick || (m.user ? (m.user.global_name || m.user.username) : ""))
        .catch(() => "");
    }

    getGuildMemberCount({ GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}?with_counts=true`)
        .then(g => g.approximate_member_count || 0)
        .catch(() => 0);
    }

    sendEmbed({ CHANNEL_ID, TITLE, DESC, COLOR }) {
      const decColor = parseInt(util.s(COLOR).replace('#', ''), 16) || 0;
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages`, {
        method: 'POST', 
        body: { 
          embeds: [{ 
            title: util.s(TITLE), 
            description: util.s(DESC), 
            color: decColor 
          }] 
        }
      });
    }

    createThread({ NAME, CHANNEL_ID, MESSAGE_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}/threads`, {
        method: 'POST', 
        body: { name: util.s(NAME) }
      });
    }

    whenMemberJoins(args) {
      const guildId = util.s(args.GUILD_ID);
      const lastJoin = this.lastJoinedMembers.get(guildId);
      if (lastJoin && lastJoin.id !== this.lastProcessedJoinIds.get(guildId)) {
        this.lastProcessedJoinIds.set(guildId, lastJoin.id);
        return true;
      }
      return false;
    }

    getJoinedMemberId(args) {
      const data = this.lastJoinedMembers.get(util.s(args.GUILD_ID));
      return data ? data.id : "";
    }

    // ==============================================
    //           Voz y Soundboard
    // ==============================================

    whenVoiceChannelJoin(args) {
      const channelId = util.s(args.CHANNEL_ID);
      const lastJoin = this.lastVoiceJoins.get(channelId);
      if (lastJoin) {
         if (lastJoin.internal_id !== this.lastProcessedVoiceJoins.get(channelId)) {
            this.lastProcessedVoiceJoins.set(channelId, lastJoin.internal_id);
            this.lastVoiceEventData = lastJoin; 
            return true;
         }
      }
      return false;
    }

    getVoiceJoinUserId() {
      return this.lastVoiceEventData ? this.lastVoiceEventData.user_id : "";
    }

    whenVoiceChannelLeave(args) {
      const channelId = util.s(args.CHANNEL_ID);
      const lastLeave = this.lastVoiceLeaves.get(channelId);
      if (lastLeave) {
         if (lastLeave.internal_id !== this.lastProcessedVoiceLeaves.get(channelId)) {
            this.lastProcessedVoiceLeaves.set(channelId, lastLeave.internal_id);
            this.lastVoiceLeaveEventData = lastLeave; 
            return true;
         }
      }
      return false;
    }

    getVoiceLeaveUserId() {
      return this.lastVoiceLeaveEventData ? this.lastVoiceLeaveEventData.user_id : "";
    }

    joinVoiceChannel({ CHANNEL_ID, GUILD_ID }) {
      if (this.client?.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify({
          op: 4,
          d: {
            guild_id: util.s(GUILD_ID),
            channel_id: util.s(CHANNEL_ID),
            self_mute: true,
            self_deaf: false 
          }
        }));
      }
    }

    updateVoiceState({ GUILD_ID, CHANNEL_ID, MUTE, DEAF }) {
      if (this.client?.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify({
          op: 4,
          d: {
            guild_id: util.s(GUILD_ID),
            channel_id: util.s(CHANNEL_ID),
            self_mute: Boolean(MUTE),
            self_deaf: Boolean(DEAF)
          }
        }));
      }
    }

    leaveVoiceChannel({ GUILD_ID }) {
      if (this.client?.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify({
          op: 4,
          d: {
            guild_id: util.s(GUILD_ID),
            channel_id: null,
            self_mute: false,
            self_deaf: false
          }
        }));
      }
    }

    moveUserVoiceChannel({ USER_ID, CHANNEL_ID, GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/${util.s(USER_ID)}`, {
        method: 'PATCH',
        body: { channel_id: util.s(CHANNEL_ID) }
      });
    }

    getGuildSounds({ GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/soundboard-sounds`)
        .then(res => JSON.stringify(res.items || res))
        .catch(err => { util.err('Get sounds error:', err); return '[]'; });
    }

    sendSoundboardSound({ SOUND_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/send-soundboard-sound`, {
        method: 'POST',
        body: { sound_id: util.s(SOUND_ID) }
      });
    }

    // ==============================================
    //           Lógica de Eventos
    // ==============================================

    whenMessageReceived(args) {
      const channelId = util.s(args.CHANNEL_ID);
      const lastMsg = this.lastMessages.get(channelId);
      if (lastMsg && lastMsg.id !== this.lastProcessedIds.get(channelId)) {
        this.lastProcessedIds.set(channelId, lastMsg.id);
        return true;
      }
      return false;
    }

    getMsgContent(args) {
      const data = this.lastMessages.get(util.s(args.CHANNEL_ID));
      return data ? data.content : "";
    }

    getMsgAuthor(args) {
      const data = this.lastMessages.get(util.s(args.CHANNEL_ID));
      return data ? data.author : "";
    }

    getMsgAuthorId(args) {
      const data = this.lastMessages.get(util.s(args.CHANNEL_ID));
      return data ? data.authorId : "";
    }

    getMsgId(args) {
      const data = this.lastMessages.get(util.s(args.CHANNEL_ID));
      return data ? data.id : "";
    }

    whenDMReceived(args) {
      const userId = util.s(args.USER_ID);
      const lastDM = this.lastDMs.get(userId);
      if (lastDM && lastDM.id !== this.lastProcessedDMIds.get(userId)) {
        this.lastProcessedDMIds.set(userId, lastDM.id);
        return true;
      }
      return false;
    }

    getDMMsgContent(args) {
      const data = this.lastDMs.get(util.s(args.USER_ID));
      return data ? data.content : "";
    }

    getDMMsgAuthor(args) {
      const data = this.lastDMs.get(util.s(args.USER_ID));
      return data ? data.author : "";
    }

    getDMMsgAuthorId(args) {
      const data = this.lastDMs.get(util.s(args.USER_ID));
      return data ? data.authorId : "";
    }

    getDMMsgId(args) {
      const data = this.lastDMs.get(util.s(args.USER_ID));
      return data ? data.id : "";
    }

    // --- DM Global ---
    whenGlobalDMReceived() {
      if (this.lastGlobalDM && this.lastGlobalDM.id !== this.lastProcessedGlobalDMId) {
        this.lastProcessedGlobalDMId = this.lastGlobalDM.id;
        return true;
      }
      return false;
    }
    
    getGlobalDMMsgContent() { return this.lastGlobalDM ? this.lastGlobalDM.content : ""; }
    getGlobalDMMsgAuthor() { return this.lastGlobalDM ? this.lastGlobalDM.author : ""; }
    getGlobalDMMsgAuthorId() { return this.lastGlobalDM ? this.lastGlobalDM.authorId : ""; }
    getGlobalDMMsgId() { return this.lastGlobalDM ? this.lastGlobalDM.id : ""; }


    // ==============================================
    //           Lógica de Botones
    // ==============================================

    createActionRow() {
      return JSON.stringify([{ type: 1, components: [] }]);
    }

    addButtonToActionRow({ LABEL, ID, STYLE, ROW }) {
      try {
        let rowData = JSON.parse(util.s(ROW));
        if (!Array.isArray(rowData) || rowData.length === 0) rowData = [{ type: 1, components: [] }];
        
        rowData[0].components.push({
          type: 2,
          label: util.s(LABEL),
          custom_id: util.s(ID),
          style: parseInt(util.s(STYLE)) || 1
        });
        return JSON.stringify(rowData);
      } catch(e) {
        return ROW; 
      }
    }

    sendMessageWithComponents({ MESSAGE, CHANNEL_ID, COMPONENTS }) {
      try {
        let compJSON = JSON.parse(util.s(COMPONENTS));
        return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages`, { 
          method: 'POST', 
          body: { 
            content: util.s(MESSAGE),
            components: compJSON
          } 
        });
      } catch(e) { util.err("Error parseando componentes:", e); }
    }

    whenButtonClicked(args) {
      const btnId = util.s(args.BUTTON_ID);
      const lastInt = this.lastButtonInteractions.get(btnId);
      if (lastInt && lastInt.id !== this.lastProcessedButtonInteractions.get(btnId)) {
        this.lastProcessedButtonInteractions.set(btnId, lastInt.id);
        return true;
      }
      return false;
    }

    getClickedButtonUser(args) {
      const btnId = util.s(args.BUTTON_ID);
      const int = this.lastButtonInteractions.get(btnId);
      if (!int) return "";
      return int.member ? int.member.user.id : (int.user ? int.user.id : "");
    }

    replyToButton({ BUTTON_ID, CONTENT }) {
      const int = this.lastButtonInteractions.get(util.s(BUTTON_ID));
      if (!int) return;
      return this._apiRequest(`/interactions/${int.id}/${int.token}/callback`, {
        method: 'POST',
        body: { type: 4, data: { content: util.s(CONTENT) } }
      });
    }

    // ==============================================
    //           Lógica de Comandos
    // ==============================================

    whenCommandReceived(args) {
      const cmdName = util.s(args.COMMAND_NAME).toLowerCase();
      const lastInt = this.lastInteractions.get(cmdName);
      if (lastInt && lastInt.id !== this.lastProcessedInteractions.get(cmdName)) {
        this.lastProcessedInteractions.set(cmdName, lastInt.id);
        return true;
      }
      return false;
    }

    getCommandInteraction(args) {
      const cmdName = util.s(args.COMMAND_NAME).toLowerCase();
      const lastInt = this.lastInteractions.get(cmdName);
      return lastInt ? JSON.stringify(lastInt) : "";
    }

    getCommandOption(args) {
      const cmdName = util.s(args.COMMAND_NAME).toLowerCase();
      const optName = util.s(args.OPTION_NAME).toLowerCase();
      const lastInt = this.lastInteractions.get(cmdName);
      
      if (lastInt && lastInt.data && lastInt.data.options) {
        const option = lastInt.data.options.find(o => o.name.toLowerCase() === optName);
        return option ? option.value : "";
      }
      return "";
    }

    // ==============================================
    //           Lógica de Canales
    // ==============================================

    getGuildChannels({ GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/channels`)
        .then(channels => JSON.stringify(channels.map(c => c.id)))
        .catch(err => { util.err('Error getting channels:', err); return "[]"; });
    }

    getChannelName({ CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}`)
        .then(data => data.name || "")
        .catch(err => { util.err('Error getting channel name:', err); return ""; });
    }

    createChannel({ NAME, TYPE, PRIVACY, GUILD_ID }) {
      const isPrivate = util.s(PRIVACY) === 'private';
      const body = { 
        name: util.s(NAME), 
        type: parseInt(util.s(TYPE)) 
      };
      if (isPrivate) {
        body.permission_overwrites = [{
          id: util.s(GUILD_ID), 
          type: 0,
          allow: '0',
          deny: '1024' 
        }];
      }
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/channels`, {
        method: 'POST', body: body
      });
    }

    editChannel({ CHANNEL_ID, NAME, PRIVACY, GUILD_ID }) {
      const body = { name: util.s(NAME) };
      if (util.s(PRIVACY) !== 'none') {
        const isPrivate = util.s(PRIVACY) === 'private';
        body.permission_overwrites = [{
          id: util.s(GUILD_ID),
          type: 0,
          allow: '0',
          deny: isPrivate ? '1024' : '0'
        }];
      }
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}`, {
        method: 'PATCH', body: body
      });
    }

    setChannelTopic({ TOPIC, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}`, { 
        method: 'PATCH', 
        body: { topic: util.s(TOPIC) } 
      });
    }

    setChannelSlowmode({ SECONDS, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}`, { 
        method: 'PATCH', 
        body: { rate_limit_per_user: parseInt(util.s(SECONDS)) || 0 } 
      });
    }

    deleteChannel({ CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}`, { method: 'DELETE' });
    }

    // ==============================================
    //           Lógica de Roles y Moderación
    // ==============================================

    getGuildRoles({ GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/roles`)
        .then(roles => JSON.stringify(roles.map(r => r.id)))
        .catch(err => { util.err('Error getting roles:', err); return "[]"; });
    }

    createInvite({ CHANNEL_ID, MAX_USES }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/invites`, { 
        method: 'POST', 
        body: { max_uses: parseInt(util.s(MAX_USES)) || 0, max_age: 0 } 
      }).then(res => `https://discord.gg/${res.code}`).catch(() => 'Error');
    }

    createRole({ NAME, COLOR, GUILD_ID }) {
      const decColor = parseInt(util.s(COLOR).replace('#', ''), 16) || 0;
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/roles`, { 
        method: 'POST', 
        body: { name: util.s(NAME), color: decColor } 
      });
    }

    addRole({ ROLE_ID, USER_ID, GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/${util.s(USER_ID)}/roles/${util.s(ROLE_ID)}`, { method: 'PUT' });
    }

    removeRole({ ROLE_ID, USER_ID, GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/${util.s(USER_ID)}/roles/${util.s(ROLE_ID)}`, { method: 'DELETE' });
    }
    
    timeoutUser({ USER_ID, GUILD_ID, MINUTES }) {
      let mins = parseInt(MINUTES) || 0;
      let until = null;
      if (mins > 0) {
         const date = new Date();
         date.setMinutes(date.getMinutes() + mins);
         until = date.toISOString();
      }
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/${util.s(USER_ID)}`, {
        method: 'PATCH',
        body: { communication_disabled_until: until }
      });
    }

    banUser({ USER_ID, GUILD_ID, REASON }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/bans/${util.s(USER_ID)}`, {
        method: 'PUT',
        body: { delete_message_seconds: 0 },
        headers: { 'X-Audit-Log-Reason': util.s(REASON) } 
      });
    }

    kickUser({ USER_ID, GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/${util.s(USER_ID)}`, { method: 'DELETE' });
    }

    changeBotNickname({ NICKNAME, GUILD_ID }) {
      return this._apiRequest(`/guilds/${util.s(GUILD_ID)}/members/@me`, { 
        method: 'PATCH', 
        body: { nick: util.s(NICKNAME) } 
      });
    }

    changeBotUsername({ USERNAME }) {
      return this._apiRequest(`/users/@me`, { 
        method: 'PATCH', 
        body: { username: util.s(USERNAME) } 
      });
    }

    // ==============================================
    //            Connection Management
    // ==============================================
    
    setToken({ TOKEN }) { this.token = util.s(TOKEN); }

    connectToDiscord() {
      if (this.conn.isConnecting) return util.log('Already connecting...');
      if (!this.token) return util.err('Token not set');
      this.conn.isConnecting = true;
      this.conn.attempts++;
      this._connect();
    }

    disconnectFromDiscord() {
      if (!this.client || this.client.readyState !== WebSocket.OPEN) return;
      clearInterval(this.conn.heartbeatTimer);
      clearTimeout(this.conn.reconnectTimer);
      this.conn.heartbeatTimer = null;
      this.conn.reconnectTimer = null;
      this.conn.isConnecting = false;
      this.client.close(1000, "User disconnect");
    }

    connected() { return (this.client && this.client.readyState === WebSocket.OPEN) || false; }

    botinfo() { return bot_data ? JSON.stringify(bot_data) : "{}"; }

    getGuilds() {
      if (this.guildCache.size > 0) return Promise.resolve(JSON.stringify(Array.from(this.guildCache.values())));
      return new Promise(resolve => {
        this._apiRequest('/users/@me/guilds').then(data => {
          if (Array.isArray(data)) {
            data.forEach(guild => this._cacheGuild(guild));
            resolve(JSON.stringify(data));
          } else resolve('[]');
        }).catch(err => { util.err('Get guilds error:', err); resolve('[]'); });
      });
    }

    getGuildInfo({ GUILD_ID }) {
      const guildId = util.s(GUILD_ID);
      if (this.guildCache.has(guildId)) return Promise.resolve(JSON.stringify(this.guildCache.get(guildId)));
      return new Promise(resolve => {
        this._apiRequest(`/guilds/${guildId}`).then(data => {
          this._cacheGuild(data);
          resolve(JSON.stringify(data));
        }).catch(err => { util.err('Get guild info error:', err); resolve('{"error": "Failed"}'); });
      });
    }

    _connect(resume = false) {
      this.client = new WebSocket(WS);
      this.client.onopen = () => {
        if (resume && this.conn.sessionId && this.conn.seq) {
          this.client.send(JSON.stringify({ op: 6, d: { token: this.token, session_id: this.conn.sessionId, seq: this.conn.seq } }));
        } else {
          this.client.send(JSON.stringify({
            op: 2, d: {
              token: this.token, intents: 4194303, properties: { $os: "windows", $browser: "chrome", $device: "scratch" },
              presence: { status: this.status, activities: this.activity ? [{ name: this.activity[1], type: +this.activity[0] }] : [], afk: false }
            }
          }));
        }
      };
      
      this.client.onmessage = msg => {
        try {
          const data = JSON.parse(msg.data);
          if (data.s) this.conn.seq = data.s;
          switch (data.op) {
            case 0: this._handleEvent(data); break;
            case 7: this._reconnect(true); break;
            case 9: setTimeout(() => this._reconnect(!data.d), Math.floor(Math.random() * 4000) + 1000); break;
            case 10:
              clearInterval(this.conn.heartbeatTimer);
              this.conn.heartbeatTimer = setInterval(() => {
                if (this.client?.readyState === WebSocket.OPEN) {
                  this.lastHeartbeatAck = Date.now();
                  this.client.send(JSON.stringify({op: 1, d: this.conn.seq}));
                }
              }, data.d.heartbeat_interval);
              this.client.send(JSON.stringify({op: 1, d: this.conn.seq}));
              break;
            case 11: 
              this.ping = Date.now() - this.lastHeartbeatAck;
              break;
          }
        } catch (err) { util.err('WS msg error:', err); }
      };
      
      this.client.onclose = evt => {
        clearInterval(this.conn.heartbeatTimer);
        if ([1000, 4004, 4010, 4011, 4012, 4013, 4014].includes(evt.code)) { this.conn.isConnecting = false; return; }
        if (this.conn.attempts >= this.conn.maxAttempts) { this.conn.isConnecting = false; return; }
        const delay = Math.min(Math.pow(2, this.conn.attempts) * 1000, 30000);
        this.conn.reconnectTimer = setTimeout(() => this._reconnect(true), delay);
      };
    }

    _reconnect(tryResume) {
      if (this.client) { this.client.onclose = null; if (this.client.readyState !== WebSocket.CLOSED) this.client.close(); }
      this._connect(tryResume);
    }

    _handleEvent(data) {
      switch (data.t) {
        case 'READY': this.conn.sessionId = data.d.session_id; bot_data = data.d; this.conn.isConnecting = false; this.conn.attempts = 0; break;
        case 'RESUMED': this.conn.isConnecting = false; this.conn.attempts = 0; break;
        case 'GUILD_CREATE': case 'GUILD_UPDATE': this._cacheGuild(data.d); break;
        case 'GUILD_DELETE': this.guildCache.delete(data.d.id); break;
        case 'GUILD_MEMBER_ADD':
          if (data.d.user) {
            this.lastJoinedMembers.set(data.d.guild_id, { id: data.d.user.id });
          }
          break;
        case 'VOICE_STATE_UPDATE': 
          if (data.d) {
            const userId = data.d.user_id;
            const newChannel = data.d.channel_id;
            const oldChannel = this.voiceStates.get(userId);
            
            if (newChannel !== oldChannel) {
              // Disparar Salida (LEAVE) del canal antiguo
              if (oldChannel) {
                this.lastVoiceLeaves.set(oldChannel, {
                  ...data.d,
                  internal_id: Date.now() + Math.random() // ID único de evento
                });
              }
              // Disparar Unión (JOIN) al canal nuevo
              if (newChannel) {
                this.lastVoiceJoins.set(newChannel, {
                  ...data.d,
                  internal_id: Date.now() + Math.random() // ID único de evento
                });
              }
              // Actualizar estado en el tracker
              if (newChannel) {
                this.voiceStates.set(userId, newChannel);
              } else {
                this.voiceStates.delete(userId);
              }
            }
          }
          break;
        case 'MESSAGE_CREATE':
          if (data.d.author) {
            if (!data.d.guild_id) { 
              this.lastDMs.set(data.d.author.id, { 
                id: data.d.id, 
                content: data.d.content, 
                author: data.d.author.username,
                authorId: data.d.author.id 
              });
              
              this.lastGlobalDM = {
                id: data.d.id,
                content: data.d.content,
                author: data.d.author.username,
                authorId: data.d.author.id,
                channelId: data.d.channel_id
              };
            }
            this.lastMessages.set(data.d.channel_id, { 
              id: data.d.id, 
              content: data.d.content, 
              author: data.d.author.username,
              authorId: data.d.author.id 
            });
          }
          this.messages.push(JSON.stringify(data.d));
          util.limit(this.messages, 100);
          this._cacheMessage(data.d);
          break;
        case 'MESSAGE_UPDATE': this._updateCachedMessage(data.d); break;
        case 'MESSAGE_DELETE': this._deleteCachedMessage(data.d.channel_id, data.d.id); break;
        case 'INTERACTION_CREATE': 
          this.interactions.push(JSON.stringify(data.d)); 
          util.limit(this.interactions, 100); 
          
          if (data.d.type === 2 && data.d.data && data.d.data.name) {
            this.lastInteractions.set(data.d.data.name.toLowerCase(), data.d);
          }
          
          if (data.d.type === 3 && data.d.data && data.d.data.custom_id) {
            this.lastButtonInteractions.set(data.d.data.custom_id, data.d);
          }
          break;
      }
    }

    _cacheMessage(message) {
      if (!message.channel_id || !message.id) return;
      if (!this.messageCache.has(message.channel_id)) this.messageCache.set(message.channel_id, []);
      const cache = this.messageCache.get(message.channel_id);
      const existingIndex = cache.findIndex(m => m.id === message.id);
      if (existingIndex !== -1) cache[existingIndex] = message;
      else cache.unshift(message);
      while (cache.length > this.maxCachePerChannel) cache.pop();
    }

    _updateCachedMessage(messageUpdate) {
      if (!messageUpdate.channel_id || !messageUpdate.id) return;
      const cache = this.messageCache.get(messageUpdate.channel_id);
      if (!cache) return;
      const index = cache.findIndex(m => m.id === messageUpdate.id);
      if (index !== -1) cache[index] = { ...cache[index], ...messageUpdate };
    }

    _deleteCachedMessage(channelId, messageId) {
      const cache = this.messageCache.get(channelId);
      if (!cache) return;
      const index = cache.findIndex(m => m.id === messageId);
      if (index !== -1) cache.splice(index, 1);
    }

    _cacheGuild(guild) { if (guild.id) this.guildCache.set(guild.id, guild); }

    clearCache({ CHANNEL_ID }) { this.messageCache.delete(util.s(CHANNEL_ID)); }
    clearAllCache() { this.messageCache.clear(); this.guildCache.clear(); }
    getCacheSize({ CHANNEL_ID }) { const cache = this.messageCache.get(util.s(CHANNEL_ID)); return cache ? cache.length : 0; }

    async _apiRequest(endpoint, options = {}) {
      if (!this.token) return Promise.reject('No token');
      
      const fetchOpts = { method: options.method || 'GET', headers: { 'Authorization': `Bot ${this.token}`, 'Content-Type': 'application/json' } };
      
      if (options.headers) {
        Object.assign(fetchOpts.headers, options.headers);
      }

      if (options.body) fetchOpts.body = JSON.stringify(options.body);
      try {
        const response = await fetch(`${API}${endpoint}`, fetchOpts);
        if (response.status === 429) {
          const data = await response.json();
          await new Promise(r => setTimeout(r, (data.retry_after * 1000) + 100));
          return this._apiRequest(endpoint, options);
        }
        if (response.ok) return (options.method === 'DELETE' || response.headers.get('content-length') === '0' || response.status === 204) ? { success: true } : await response.json();
        return Promise.reject(await response.json());
      } catch (err) { return Promise.reject(err); }
    }

    // --- ESCRITURA EN DM/CANALES ---

    triggerTyping({ CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/typing`, { method: 'POST' });
    }

    triggerTypingDM({ USER_ID }) {
      return this._apiRequest('/users/@me/channels', { method: 'POST', body: { recipient_id: util.s(USER_ID) } })
        .then(d => this._apiRequest(`/channels/${d.id}/typing`, { method: 'POST' }));
    }

    triggerTypingGlobalDM() {
      if (this.lastGlobalDM && this.lastGlobalDM.channelId) {
        return this._apiRequest(`/channels/${this.lastGlobalDM.channelId}/typing`, { method: 'POST' });
      }
    }

    sendMessage({ MESSAGE, CHANNEL }) { return this._apiRequest(`/channels/${util.s(CHANNEL)}/messages`, { method: 'POST', body: { content: util.s(MESSAGE) } }); }
    
    editMessage({ MESSAGE_ID, CHANNEL_ID, NEW_CONTENT }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}`, {
        method: 'PATCH',
        body: { content: util.s(NEW_CONTENT) }
      });
    }

    getMessage({ MESSAGE_ID, CHANNEL_ID }) {
      const mid = util.s(MESSAGE_ID); const cid = util.s(CHANNEL_ID);
      const cache = this.messageCache.get(cid);
      if (cache) { const m = cache.find(x => x.id === mid); if (m) return Promise.resolve(JSON.stringify(m)); }
      return this._apiRequest(`/channels/${cid}/messages/${mid}`).then(d => { this._cacheMessage(d); return JSON.stringify(d); });
    }

    getChannelMessages({ AMOUNT, CHANNEL_ID }) {
      let amount = Math.min(Math.max(parseInt(AMOUNT) || 1, 1), 100);
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages?limit=${amount}`)
        .then(d => {
          if (Array.isArray(d)) {
            return JSON.stringify(d.map(m => `${m.author ? m.author.username : 'unknown'}: ${m.content}`));
          }
          return "[]";
        })
        .catch(() => "[]");
    }

    getDirectMessages({ AMOUNT, USER_ID }) {
      let amount = Math.min(Math.max(parseInt(AMOUNT) || 1, 1), 100);
      return this._apiRequest('/users/@me/channels', { method: 'POST', body: { recipient_id: util.s(USER_ID) } })
        .then(dmChannel => {
          return this._apiRequest(`/channels/${dmChannel.id}/messages?limit=${amount}`)
            .then(d => {
              if (Array.isArray(d)) {
                return JSON.stringify(d.map(m => `${m.author ? m.author.username : 'unknown'}: ${m.content}`));
              }
              return "[]";
            });
        })
        .catch(() => "[]");
    }

    sendDirectMessage({ USER_ID, MESSAGE }) {
      return this._apiRequest('/users/@me/channels', { method: 'POST', body: { recipient_id: util.s(USER_ID) } })
      .then(d => this._apiRequest(`/channels/${d.id}/messages`, { method: 'POST', body: { content: util.s(MESSAGE) } }));
    }

    deleteMessage({ MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}`, { method: 'DELETE' })
      .then(r => { this._deleteCachedMessage(util.s(CHANNEL_ID), util.s(MESSAGE_ID)); return r; });
    }
    
    async bulkDeleteMessages({ AMOUNT, CHANNEL_ID }) {
      let limit = Math.min(Math.max(parseInt(AMOUNT) || 1, 2), 100);
      try {
        const msgs = await this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages?limit=${limit}`);
        const ids = msgs.map(m => m.id);
        if (ids.length < 2) return; 
        return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages/bulk-delete`, {
          method: 'POST',
          body: { messages: ids }
        });
      } catch(e) { util.err('Bulk delete error:', e); }
    }

    pinMessage({ MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/pins/${util.s(MESSAGE_ID)}`, { method: 'PUT' });
    }

    unpinMessage({ MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/pins/${util.s(MESSAGE_ID)}`, { method: 'DELETE' });
    }

    sendReply({ REPLY, MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages`, {
        method: 'POST', body: { content: util.s(REPLY), message_reference: { message_id: util.s(MESSAGE_ID), channel_id: util.s(CHANNEL_ID) } }
      });
    }

    addReaction({ EMOJI, MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}/reactions/${encodeURIComponent(util.s(EMOJI))}/@me`, { method: 'PUT' });
    }

    removeReaction({ EMOJI, MESSAGE_ID, CHANNEL_ID }) {
      return this._apiRequest(`/channels/${util.s(CHANNEL_ID)}/messages/${util.s(MESSAGE_ID)}/reactions/${encodeURIComponent(util.s(EMOJI))}/@me`, { method: 'DELETE' });
    }

    newMessage() { return this.messages.length > 0; }
    popMessage() { return this.messages.shift() || ""; }
    totalMessages() { return this.messages.length; }

    registerSlashCommand({ NAME, DESCRIPTION, OPTIONS }) {
      if (!bot_data?.application?.id) return util.err('Not connected');
      let opts = []; try { if (OPTIONS && OPTIONS !== '[]') opts = JSON.parse(util.s(OPTIONS)); } catch (e) {}
      return this._apiRequest(`/applications/${bot_data.application.id}/commands`, {
        method: 'POST', body: { name: util.s(NAME).toLowerCase(), description: util.s(DESCRIPTION), options: opts, contexts: [0, 1, 2], integration_types: [0, 1] }
      });
    }

    deleteSlashCommand({ NAME }) {
      if (!bot_data?.application?.id) return;
      return this._apiRequest(`/applications/${bot_data.application.id}/commands`).then(d => {
        const cmd = d.find(c => c.name === util.s(NAME));
        if (cmd) return this._apiRequest(`/applications/${bot_data.application.id}/commands/${cmd.id}`, { method: 'DELETE' });
      });
    }

    getAllCommands() {
      if (!bot_data?.application?.id) return '[]';
      return this._apiRequest(`/applications/${bot_data.application.id}/commands`).then(d => JSON.stringify(d.map(c => `/${c.name}`)));
    }

    createCommandOptions() { return '[]'; }
    addCommandOption({ TYPE, NAME, DESCRIPTION, REQUIRED, OPTIONS }) {
      const typeMap = { 'string': 3, 'integer': 4, 'boolean': 5, 'user': 6, 'channel': 7 };
      try {
        let opts = JSON.parse(util.s(OPTIONS || '[]'));
        opts.push({ type: typeMap[TYPE] || 3, name: util.s(NAME).toLowerCase().replace(/\s+/g, '-'), description: util.s(DESCRIPTION), required: Boolean(REQUIRED) });
        return JSON.stringify(opts);
      } catch (e) { return '[]'; }
    }

    newInteraction() { return this.interactions.length > 0; }
    popInteraction() { return this.interactions.shift() || ""; }
    totalInteractions() { return this.interactions.length; }
    
    replyToInteraction({ INTERACTION, CONTENT }) {
      try {
        const i = JSON.parse(util.s(INTERACTION));
        return this._apiRequest(`/interactions/${i.id}/${i.token}/callback`, { method: 'POST', body: { type: 4, data: { content: util.s(CONTENT) } } });
      } catch (e) {}
    }

    deferInteraction({ INTERACTION }) {
      try {
        const i = JSON.parse(util.s(INTERACTION));
        return this._apiRequest(`/interactions/${i.id}/${i.token}/callback`, { 
          method: 'POST', 
          body: { type: 5 } 
        });
      } catch (e) { util.err("Error en deferInteraction:", e); }
    }

    editInteractionReply({ INTERACTION, CONTENT }) {
      try {
        const i = JSON.parse(util.s(INTERACTION));
        const appId = i.application_id || (bot_data && bot_data.application ? bot_data.application.id : "");
        if (!appId) return util.err("Falta application_id para editar respuesta.");
        
        return this._apiRequest(`/webhooks/${appId}/${i.token}/messages/@original`, {
          method: 'PATCH',
          body: { content: util.s(CONTENT) }
        });
      } catch (e) { util.err("Error en editInteractionReply:", e); }
    }

    setStatus({ STATUS }) { this.status = util.s(STATUS); this._updatePresence(); }
    setActivity({ TYPE, ACTIVITY }) { this.activity = [util.s(TYPE), util.s(ACTIVITY)]; this._updatePresence(); }
    _updatePresence() {
      if (this.client?.readyState === WebSocket.OPEN) {
        this.client.send(JSON.stringify({ op: 3, d: { since: null, activities: this.activity ? [{ name: this.activity[1], type: +this.activity[0] }] : [], status: this.status, afk: false } }));
      }
    }
  }

  Scratch.extensions.register(new DiscordBot());
})(Scratch);