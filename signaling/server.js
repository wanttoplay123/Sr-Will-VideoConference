const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ============ LIVEKIT CLOUD (GRATIS hasta 50GB/mes) ============
const { AccessToken } = require('livekit-server-sdk');

// LiveKit Cloud - Plan gratuito: 50GB/mes incluidos
// Si excedes 50GB, cuesta $0.10/GB adicional
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIWQaPgYTxcTRM';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '8HyxcE4lAJBH9YBfzMeNWTy2vmaJtbnp9JPrt1piiqJ';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://videoconferenciasrwill-1ylt1746.livekit.cloud';
// ==================================================================

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const activeRooms = new Map();
const activePolls = new Map();
const activeScreenShares = new Map(); // Rastrear quién está compartiendo pantalla en cada sala
const waitingRoom = new Map(); // Map<room, Map<userName, ws>> - Cola de espera por sala

// ============= CONFIGURACIÓN DE LOGGING =============
// Poner en false para producción (mejora rendimiento)
const DEBUG_MODE = false;

// Wrapper para logs que respeta DEBUG_MODE
const devLog = DEBUG_MODE ? console.log.bind(console) : () => {};
// Solo errores críticos se muestran siempre
const criticalLog = console.error.bind(console);
// ====================================================

// ============ FUNCIÓN DE VALIDACIÓN DE APROBACIÓN ============
function isUserApproved(ws) {
  return ws.approved === true || ws.isModerator === true;
}

function requireApproval(ws, action = 'esta acción') {
  if (!isUserApproved(ws)) {
    ws.send(JSON.stringify({
      type: "error",
      message: `No tienes permiso para ${action}. Debes ser aprobado primero.`
    }));
    devLog(`[SERVER] ⛔ ${ws.userName || 'unknown'} intentó ${action} sin aprobación`);
    return false;
  }
  return true;
}

app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ============ LIVEKIT CLOUD TOKEN ENDPOINT (50GB/mes GRATIS) ============
app.get('/livekit-token', async (req, res) => {
    const { room, name, moderator } = req.query;
    
    if (!room || !name) {
        return res.status(400).json({ error: 'room y name son requeridos' });
    }
    
    try {
        const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity: name,
            name: name,
            ttl: '24h',
        });
        
        at.addGrant({
            roomJoin: true,
            room: room,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });
        
        const token = await at.toJwt();
        
        // Siempre usar LiveKit Cloud URL
        const wsUrl = LIVEKIT_URL;
        
        res.json({ 
            token, 
            wsUrl,
            message: 'Token generado - LiveKit Cloud (50GB/mes GRATIS)'
        });
        console.log(`[LIVEKIT] ✅ Token generado para ${name} en sala ${room}`);
    } catch (error) {
        console.error('[LIVEKIT] Error generando token:', error.message);
        res.status(500).json({ error: 'Error generando token', details: error.message });
    }
});
// =========================================================================

// Ruta para obtener información del servidor (para ngrok)
app.get('/server-info', (req, res) => {
  const host = req.get('host');
  const isNgrok = host.includes('ngrok') || host.includes('ngrok-free');
  const protocol = req.protocol;
  const baseUrl = `${protocol}://${host}`;

  res.json({
    baseUrl: baseUrl,
    isNgrok: isNgrok,
    port: PORT
  });
});

// Endpoint para generar URL de join completa
app.get('/generate-join-url', (req, res) => {
  try {
    const { room, name, moderator } = req.query;

    if (!room || !name) {
      return res.status(400).json({
        error: 'Faltan parámetros: room y name son requeridos'
      });
    }

    // Leer configuración de ngrok
    const configPath = path.join(__dirname, 'public', 'frontendConfig.json');
    let baseUrl = `${req.protocol}://${req.get('host')}`; // fallback

    try {
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configData);
        if (config.wsUrl) {
          baseUrl = config.wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        }
      } else {
      }
    } catch (err) {
    }

    // Construir URL completa
    let url = `${baseUrl}/index.html?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
    if (moderator) {
      url += `&moderator=${moderator}`;
    }
    res.json({
      success: true,
      url: url,
      baseUrl: baseUrl,
      params: { room, name, moderator }
    });

  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

wss.on('connection', (ws) => {
  let room = null;
  let userName = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      switch (msg.type) {
        case 'join':
          room = msg.room;
          userName = msg.name;
          const isModerator = msg.moderator;

          // ✅ VALIDAR que el nombre no esté vacío
          if (!userName || userName.trim() === '') {
            userName = 'Usuario-' + Math.random().toString(36).substr(2, 6);
          }

          ws.userName = userName;
          ws.isModerator = isModerator;
          ws.room = room;

          if (!activeRooms.has(room)) {
            // Sala no existe - Solo moderadores pueden crearla
            if (isModerator) {
              ws.isRoomAdmin = true;
              ws.approved = true; // Moderador aprobado automáticamente
              activeRooms.set(room, new Set([ws]));
              ws.send(JSON.stringify({ type: "joined", exists: true, isRoomAdmin: true }));
            } else {
              ws.send(JSON.stringify({ 
                type: "joined", 
                exists: false, 
                message: "La sala no existe. Solo un moderador puede crearla." 
              }));
              ws.close(1008, "Room does not exist");
              return;
            }
          } else {
            // Sala existe
            const roomClients = activeRooms.get(room);
            const userExists = Array.from(roomClients).some(client => client.userName === userName);
            
            if (userExists) {
              ws.send(JSON.stringify({ 
                type: "joined", 
                exists: true, 
                error: "Ya existe un usuario con este nombre en la sala." 
              }));
              ws.close(1008, "Username already in use");
              return;
            }

            if (isModerator) {
              // Moderador entra directamente
              ws.approved = true;
              roomClients.add(ws);
              ws.send(JSON.stringify({ type: "joined", exists: true }));
              notifyNewPeer(roomClients, ws, userName, msg.micActive, msg.camActive);
            } else {
              // Participante regular - Debe esperar aprobación
              const moderators = Array.from(roomClients).filter(client => client.isModerator);
              
              if (moderators.length > 0) {
                // Hay moderadores - Agregar a sala de espera
                if (!waitingRoom.has(room)) {
                  waitingRoom.set(room, new Map());
                }
                waitingRoom.get(room).set(userName, ws);
                
                // Notificar a TODOS los moderadores
                moderators.forEach(moderator => {
                  if (moderator.readyState === 1) {
                    moderator.send(JSON.stringify({
                      type: 'join-request',
                      userId: userName,
                      room: room
                    }));
                  }
                });
                
                // Notificar al participante que está en espera
                ws.send(JSON.stringify({ 
                  type: "waiting-for-approval",
                  message: "Esperando aprobación del moderador..." 
                }));
              } else {
                // No hay moderadores - Entrar directamente
                ws.approved = true;
                roomClients.add(ws);
                ws.send(JSON.stringify({ type: "joined", exists: true }));
                notifyNewPeer(roomClients, ws, userName, msg.micActive, msg.camActive);
              }
            }
          }
          break;

        case 'approve-join':
          if (room && ws.isModerator && msg.userId) {
            const roomClients = activeRooms.get(room);
            const waiting = waitingRoom.get(room);
            
            if (!waiting || !waiting.has(msg.userId)) {
              break;
            }
            
            const pendingClient = waiting.get(msg.userId);
            
            if (pendingClient && pendingClient.readyState === 1 && roomClients) {
              // Aprobar y mover a la sala
              pendingClient.approved = true;
              roomClients.add(pendingClient);
              waiting.delete(msg.userId);
              
              // Si la sala de espera queda vacía, eliminarla
              if (waiting.size === 0) {
                waitingRoom.delete(room);
              }
              
              pendingClient.send(JSON.stringify({ 
                type: "join-approved", 
                exists: true,
                message: "Has sido aceptado en la reunión"
              }));
              // Notificar a todos sobre el nuevo participante
              notifyNewPeer(roomClients, pendingClient, msg.userId, true, true);
              
              // Notificar a todos los moderadores que se eliminó la solicitud
              Array.from(roomClients)
                .filter(client => client.isModerator && client.readyState === 1)
                .forEach(moderator => {
                  moderator.send(JSON.stringify({
                    type: "join-request-removed",
                    userId: msg.userId
                  }));
                });
            }
          }
          break;

        case 'reject-join':
          if (room && ws.isModerator && msg.userId) {
            const roomClients = activeRooms.get(room);
            const waiting = waitingRoom.get(room);
            
            if (!waiting || !waiting.has(msg.userId)) {
              break;
            }
            
            const pendingClient = waiting.get(msg.userId);
            
            if (pendingClient && pendingClient.readyState === 1) {
              // Rechazar y cerrar conexión
              pendingClient.send(JSON.stringify({ 
                type: "join-rejected", 
                exists: false, 
                message: "Tu solicitud fue rechazada por el moderador." 
              }));
              
              waiting.delete(msg.userId);
              
              // Si la sala de espera queda vacía, eliminarla
              if (waiting.size === 0) {
                waitingRoom.delete(room);
              }
              
              setTimeout(() => {
                if (pendingClient.readyState === 1) {
                  pendingClient.close(1008, "Join request rejected");
                }
              }, 1000);
              // Notificar a todos los moderadores que se eliminó la solicitud
              if (roomClients) {
                Array.from(roomClients)
                  .filter(client => client.isModerator && client.readyState === 1)
                  .forEach(moderator => {
                    moderator.send(JSON.stringify({ 
                      type: "join-request-removed", 
                      userId: msg.userId 
                    }));
                  });
              }
            }
          }
          break;

        // ============ CASE 'SIGNAL' ELIMINADO ============
        // La señalización P2P WebRTC ya no se usa con Livekit SFU
        // Los tracks de audio/video ahora van directamente al servidor Livekit
        // ==================================================

        case 'raise-hand':
          if (room && userName) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1 && client !== ws) {
                  client.send(JSON.stringify({
                    type: 'raise-hand',
                    name: msg.name
                  }));
                }
              });
            }
          }
          break;

        case 'give-word':
          if (room && msg.target) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              let sentCount = 0;
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  const messageToSend = {
                    type: 'give-word',
                    target: msg.target,
                    duration: msg.duration || 60,
                    grantedBy: userName
                  };
                  client.send(JSON.stringify(messageToSend));
                  sentCount++;
                }
              });
            }
          }
          break;

        case 'take-word':
          // Relaxed check: removed ws.isModerator
          if (room && msg.target) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              // 🔇 PRIMERO: Silenciar automáticamente al participante
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'mute-participant',
                    target: msg.target,
                    micActive: false,
                    mutedBy: userName
                  }));
                }
              });
              // 📢 SEGUNDO: Notificar que se quitó la palabra
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'take-word',
                    target: msg.target,
                    takenBy: userName
                  }));
                }
              });
            }
          }
          break;

        case 'floor-granted':
          if (room && ws.isModerator && msg.target) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'floor-granted',
                    target: msg.target,
                    grantedBy: userName
                  }));
                  client.send(JSON.stringify({
                    type: 'hand-lowered',
                    name: msg.target
                  }));
                }
              });
            }
          }
          break;

        case 'floor-ended':
          if (room && userName) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'floor-ended',
                    name: msg.name
                  }));
                  client.send(JSON.stringify({
                    type: 'hand-lowered',
                    name: msg.name
                  }));
                }
              });
            }
          }
          break;

        case 'hand-lowered':
          if (room && msg.name) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'hand-lowered',
                    name: msg.name
                  }));
                }
              });
            }
          }
          break;

        case 'start-poll':
          if (room && ws.isModerator && msg.poll) {
            const pollData = {
              ...msg.poll,
              results: {},
              votedUsers: new Set(),
              votes: [],
              endTime: Date.now() + (msg.poll.duration * 1000)
            };
            msg.poll.options.forEach(option => {
              pollData.results[option.id] = 0;
            });

            activePolls.set(room, pollData);
            setTimeout(() => {
              if (activePolls.has(room) && activePolls.get(room).id === pollData.id) {
                const endedPoll = activePolls.get(room);
                activePolls.delete(room);

                const roomClients = activeRooms.get(room);
                if (roomClients) {
                  roomClients.forEach(client => {
                    if (client.readyState === 1) {
                      client.send(JSON.stringify({
                        type: "poll-ended",
                        pollId: endedPoll.id,
                        results: endedPoll.results,
                        question: endedPoll.question,
                        options: endedPoll.options,
                        votes: endedPoll.votes || []
                      }));
                    }
                  });
                }
              }
            }, msg.poll.duration * 1000);

            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: "poll-started",
                    poll: pollData
                  }));
                }
              });
            }
          } else {
          }
          break;

        case 'submit-vote':
          if (room && userName && msg.vote && activePolls.has(room)) {
            const currentPoll = activePolls.get(room);

            if (Date.now() > currentPoll.endTime) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "poll_ended", message: "The poll has ended and cannot be voted on." }));
              }
              return;
            }

            if (!currentPoll.votedUsers) {
              currentPoll.votedUsers = new Set();
            }
            if (currentPoll.votedUsers.has(userName)) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "already_voted", message: "You have already voted in this poll." }));
              }
              return;
            }

            if (currentPoll.results.hasOwnProperty(msg.vote.optionId)) {
              currentPoll.results[msg.vote.optionId]++;
              currentPoll.votedUsers.add(userName);
              currentPoll.votes.push({ voter: userName, optionId: msg.vote.optionId, optionText: msg.vote.optionText });
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "success", message: "Your vote has been recorded." }));
              }

              const roomClients = activeRooms.get(room);
              if (roomClients) {
                roomClients.forEach(client => {
                  if (client.isModerator && client.readyState === 1) {
                    client.send(JSON.stringify({
                      type: "poll-update",
                      pollId: currentPoll.id,
                      results: currentPoll.results,
                      votes: currentPoll.votes,
                      question: currentPoll.question,
                      options: currentPoll.options,
                      endTime: currentPoll.endTime
                    }));
                  }
                });
              }
            } else {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "error", message: "Invalid vote option." }));
              }
            }
          } else {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "vote-submitted", status: "error", message: "Could not record vote." }));
            }
          }
          break;

        case 'end-poll':
          if (room && ws.isModerator && activePolls.has(room)) {
            const endedPoll = activePolls.get(room);
            activePolls.delete(room);
            const results = endedPoll.results;
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: "poll-ended",
                    pollId: endedPoll.id,
                    results: results,
                    question: endedPoll.question,
                    options: endedPoll.options,
                    votes: endedPoll.votes || []
                  }));
                }
              });
            }
          }
          break;

        // ✅ Compartir resultados de encuesta con todos los participantes
        case 'broadcast-results':
          if (room && ws.isModerator && msg.poll) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                // Enviar a todos EXCEPTO al moderador que compartió (él ya los ve)
                if (client.readyState === 1 && !client.isModerator) {
                  client.send(JSON.stringify({
                    type: "poll-results-shared",
                    pollId: msg.poll.id,
                    question: msg.poll.question,
                    options: msg.poll.options,
                    results: msg.poll.results,
                    totalVotes: msg.poll.totalVotes || 0,
                    voters: msg.poll.voters || [],
                    ended: msg.poll.ended || false,
                    sharedBy: userName
                  }));
                }
              });
            }
          } else {
          }
          break;

        case 'assign-moderator':
          if (room && ws.isModerator && msg.target && activeRooms.has(room)) {
            const roomClients = activeRooms.get(room);
            const targetClient = Array.from(roomClients).find(client => client.userName === msg.target && client.readyState === 1);

            if (targetClient) {
              if (targetClient.isModerator) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: `${msg.target} is already a moderator.`
                }));
                return;
              }

              // ✅ Asignar moderador
              targetClient.isModerator = true;

              // 🔁 Notificar a todos los clientes que se asignó un moderador
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: "moderator-assigned",
                    name: msg.target,
                    role: "Moderador"
                  }));

                  // (opcional) mantener compatibilidad con mensajes anteriores
                  client.send(JSON.stringify({
                    type: "moderator-assigned",
                    target: msg.target,
                    assignedBy: userName
                  }));
                }
              });
            } else {
              ws.send(JSON.stringify({
                type: "error",
                message: `User ${msg.target} not found in the room.`
              }));
            }

          } else {
            ws.send(JSON.stringify({
              type: "error",
              message: "Only moderators can assign moderator roles."
            }));
          }
          break;

        case 'revoke-moderator':
          if (room && ws.isModerator && msg.target && activeRooms.has(room)) {
            const roomClients = activeRooms.get(room);
            const targetClient = Array.from(roomClients).find(client => client.userName === msg.target && client.readyState === 1);

            if (targetClient) {
              if (!targetClient.isModerator) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: `${msg.target} is not a moderator.`
                }));
                return;
              }

              // ✅ Quitar rol de moderador
              targetClient.isModerator = false;

              // 🔁 Notificar a todos los clientes que se quitó el moderador
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: "moderator-revoked",
                    name: msg.target,
                    role: "Participante"
                  }));

                  // (opcional) mantener compatibilidad con mensajes anteriores
                  client.send(JSON.stringify({
                    type: "moderator-revoked",
                    target: msg.target,
                    revokedBy: userName
                  }));
                }
              });
            } else {
              ws.send(JSON.stringify({
                type: "error",
                message: `User ${msg.target} not found in the room.`
              }));
            }

          } else {
            ws.send(JSON.stringify({
              type: "error",
              message: "Only moderators can revoke moderator roles."
            }));
          }
          break;


        case 'mute-participant':
          if (room && ws.isModerator && msg.target && activeRooms.has(room)) {
            const roomClients = activeRooms.get(room);
            const targetClient = Array.from(roomClients).find(client => client.userName === msg.target && client.readyState === 1);
            if (targetClient) {
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'mute-participant',
                    target: msg.target,
                    micActive: msg.micActive,
                    mutedBy: userName
                  }));
                }
              });
            } else {
              ws.send(JSON.stringify({ type: "error", message: `User ${msg.target} not found in the room.` }));
            }
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Only moderators can mute participants." }));
          }
          break;

        case 'mute-all-participants':
          if (room && ws.isModerator && activeRooms.has(room)) {
            const roomClients = activeRooms.get(room);
            roomClients.forEach(clientToMute => {
              // ✅ No silenciar al admin de la sala ni al moderador que ejecuta la acción
              if (clientToMute.readyState === 1 && !clientToMute.isRoomAdmin && clientToMute !== ws) {
                // Enviar a TODOS para que actualicen la UI, pero solo el target se silencia
                roomClients.forEach(client => {
                  if (client.readyState === 1) {
                    client.send(JSON.stringify({
                      type: 'mute-participant',
                      target: clientToMute.userName,
                      micActive: false,
                      mutedBy: userName
                    }));
                  }
                });
              } else if (clientToMute.isRoomAdmin) {
              }
            });
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Only moderators can mute all participants." }));
          }
          break;

        case 'kick-participant':
          if (room && ws.isModerator && msg.target && activeRooms.has(room)) {
            const roomClients = activeRooms.get(room);
            const targetClient = Array.from(roomClients).find(client => client.userName === msg.target && client.readyState === 1);
            if (targetClient) {
              roomClients.delete(targetClient);
              targetClient.send(JSON.stringify({
                type: 'kick-participant',
                target: msg.target,
                kickedBy: userName
              }));
              targetClient.close(1008, "Kicked from room");
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'kick-participant',
                    target: msg.target,
                    kickedBy: userName
                  }));
                  client.send(JSON.stringify({
                    type: 'peer-disconnected',
                    userId: msg.target
                  }));
                  client.send(JSON.stringify({
                    type: 'hand-lowered',
                    name: msg.target
                  }));
                }
              });
              if (roomClients.size === 0) {
                activeRooms.delete(room);
                activePolls.delete(room);
              }
            } else {
              ws.send(JSON.stringify({ type: "error", message: `User ${msg.target} not found in the room.` }));
            }
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Only moderators can kick participants." }));
          }
          break;

        case 'chat':
          if (room && userName && msg.message) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              let sentCount = 0;
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  const chatMsg = {
                    type: 'chat',
                    author: userName,
                    message: msg.message,
                    timestamp: msg.timestamp || new Date().toISOString()
                  };
                  client.send(JSON.stringify(chatMsg));
                  sentCount++;
                }
              });
            } else {
            }
          } else {
          }
          break;

        case 'participant-state-update':
          if (room && userName) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1 && client !== ws) {
                  client.send(JSON.stringify({
                    type: 'participant-state-update',
                    name: userName,
                    micActive: msg.micActive,
                    camActive: msg.camActive
                  }));
                }
              });
            }
          }
          break;

        case 'screen-share-started':
          if (room && userName) {
            // ✅ Guardar estado de screen share para nuevos participantes
            activeScreenShares.set(room, {
              userId: userName,
              streamId: msg.streamId,
              timestamp: Date.now()
            });
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              // ✅ Si hay targetUser, solo enviar a ese usuario específico
              if (msg.targetUser) {
                const targetClient = Array.from(roomClients).find(c => c.userName === msg.targetUser);
                if (targetClient && targetClient.readyState === 1) {
                  targetClient.send(JSON.stringify({
                    type: 'screen-share-started',
                    userId: userName,
                    streamId: msg.streamId,
                    isSync: true
                  }));
                }
              } else {
                // Enviar a todos (comportamiento normal)
                roomClients.forEach(client => {
                  if (client.readyState === 1 && client !== ws) {
                    client.send(JSON.stringify({
                      type: 'screen-share-started',
                      userId: userName,
                      streamId: msg.streamId
                    }));
                  }
                });
              }
            }
          }
          break;

        case 'screen-share-stopped':
          if (room && userName) {
            // ✅ Limpiar estado de screen share
            if (activeScreenShares.has(room)) {
              const currentShare = activeScreenShares.get(room);
              if (currentShare.userId === userName) {
                activeScreenShares.delete(room);
              }
            }
            
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                if (client.readyState === 1 && client !== ws) {
                  client.send(JSON.stringify({
                    type: 'screen-share-stopped',
                    userId: userName,
                    streamId: msg.streamId
                  }));
                }
              });
            }
          }
          break;

        case 'leave':
          if (room && userName) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.delete(ws);
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'peer-disconnected',
                    userId: userName
                  }));
                  client.send(JSON.stringify({
                    type: 'hand-lowered',
                    name: userName
                  }));
                }
              });
              if (roomClients.size === 0) {
                activeRooms.delete(room);
                activePolls.delete(room);
              }
            }
          }
          break;

        default:
          break;
      }
    } catch (error) {
    }
  });

  ws.on('close', () => {
    if (room && activeRooms.has(room)) {
      const roomClients = activeRooms.get(room);
      roomClients.delete(ws);
      
      // ✅ Limpiar screen share si el usuario que compartía se desconecta
      if (activeScreenShares.has(room)) {
        const screenShare = activeScreenShares.get(room);
        if (screenShare.userId === userName) {
          activeScreenShares.delete(room);
          // Notificar a todos que el screen share terminó
          roomClients.forEach(client => {
            if (client.readyState === 1) {
              client.send(JSON.stringify({
                type: 'screen-share-stopped',
                userId: userName
              }));
            }
          });
        }
      }

      if (roomClients.size === 0) {
        activeRooms.delete(room);
        activePolls.delete(room);
        activeScreenShares.delete(room); // También limpiar screen share
      } else {
        roomClients.forEach(client => {
          if (client.readyState === 1) {
            client.send(JSON.stringify({
              type: 'peer-disconnected',
              userId: userName
            }));
            client.send(JSON.stringify({
              type: 'hand-lowered',
              name: userName
            }));
          }
        });
      }
    }
  });

  ws.on('error', (error) => {
  });

  function notifyNewPeer(roomClients, newClient, newUserName, micActive, camActive) {
    // ✅ Notificar al nuevo participante sobre pantalla compartida activa
    if (activeScreenShares.has(room)) {
      const screenShare = activeScreenShares.get(room);
      // Enviar después de un pequeño delay para que el cliente esté listo
      setTimeout(() => {
        if (newClient.readyState === 1) {
          newClient.send(JSON.stringify({
            type: 'screen-share-started',
            userId: screenShare.userId,
            streamId: screenShare.streamId,
            isSync: true // Marcar que es una sincronización
          }));
        }
      }, 500);
    }
    
    roomClients.forEach(client => {
      if (client !== newClient && client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'new-peer',
          userId: newUserName,
          name: newUserName,
          isModerator: newClient.isModerator || false,
          micActive: micActive ?? true,
          camActive: camActive ?? true
        }));
        newClient.send(JSON.stringify({
          type: 'new-peer',
          userId: client.userName,
          name: client.userName,
          isModerator: client.isModerator || false,
          micActive: client.micActive ?? true,
          camActive: client.camActive ?? true,
          initiateOffer: true
        }));
      }
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`💰 Livekit token endpoint: http://localhost:${PORT}/livekit-token`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`❌ Puerto ${PORT} en uso`);
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 Cerrando servidor...');
  server.close(() => {
    process.exit(0);
  });
});