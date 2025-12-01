const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const activeRooms = new Map();
const activePolls = new Map();
const activeScreenShares = new Map(); // Rastrear quién está compartiendo pantalla en cada sala
const waitingRoom = new Map(); // Map<room, Map<userName, ws>> - Cola de espera por sala

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
    console.log(`[SERVER] ⛔ ${ws.userName || 'unknown'} intentó ${action} sin aprobación`);
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
          console.log('[SERVER] ✅ Using ngrok URL from config:', baseUrl);
        }
      } else {
        console.warn('[SERVER] ⚠️ frontendConfig.json no existe');
      }
    } catch (err) {
      console.error('[SERVER] ❌ Error leyendo frontendConfig.json:', err.message);
    }

    // Construir URL completa
    let url = `${baseUrl}/index.html?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
    if (moderator) {
      url += `&moderator=${moderator}`;
    }

    console.log('[SERVER] 🔗 URL generada:', url);

    res.json({
      success: true,
      url: url,
      baseUrl: baseUrl,
      params: { room, name, moderator }
    });

  } catch (error) {
    console.error('[SERVER] Error generando URL:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

wss.on('connection', (ws) => {
  let room = null;
  let userName = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      console.log(`[SERVER] Message received from ${userName || 'unknown'}:`, msg.type);

      switch (msg.type) {
        case 'join':
          room = msg.room;
          userName = msg.name;
          const isModerator = msg.moderator;

          // ✅ VALIDAR que el nombre no esté vacío
          if (!userName || userName.trim() === '') {
            userName = 'Usuario-' + Math.random().toString(36).substr(2, 6);
            console.warn(`[SERVER] ⚠️ Usuario sin nombre detectado, asignando: ${userName}`);
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
              console.log(`[SERVER] ✅ Room '${room}' created by ${userName} (admin).`);
            } else {
              ws.send(JSON.stringify({ 
                type: "joined", 
                exists: false, 
                message: "La sala no existe. Solo un moderador puede crearla." 
              }));
              console.log(`[SERVER] ❌ User ${userName} tried to join non-existent room '${room}'.`);
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
              console.log(`[SERVER] ❌ User ${userName} tried to join room '${room}' but name is already in use.`);
              ws.close(1008, "Username already in use");
              return;
            }

            if (isModerator) {
              // Moderador entra directamente
              ws.approved = true;
              roomClients.add(ws);
              ws.send(JSON.stringify({ type: "joined", exists: true }));
              console.log(`[SERVER] ✅ Moderator ${userName} joined room '${room}'.`);
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
                console.log(`[SERVER] ⏳ ${userName} waiting for approval in room '${room}'.`);
              } else {
                // No hay moderadores - Entrar directamente
                ws.approved = true;
                roomClients.add(ws);
                ws.send(JSON.stringify({ type: "joined", exists: true }));
                console.log(`[SERVER] ✅ User ${userName} joined room '${room}' (no moderators present).`);
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
              console.log(`[SERVER] ⚠️ User ${msg.userId} not in waiting room`);
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
              
              console.log(`[SERVER] ✅ User ${msg.userId} approved to join room '${room}' by ${userName}.`);
              
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
              console.log(`[SERVER] ⚠️ User ${msg.userId} not in waiting room`);
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
              
              console.log(`[SERVER] ❌ User ${msg.userId} rejected from room '${room}' by ${userName}.`);
              
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

        case 'signal':
          // ✅ VALIDAR APROBACIÓN
          if (!requireApproval(ws, 'enviar señales WebRTC')) break;
          
          if (room && userName) {
            const roomClients = activeRooms.get(room);
            if (roomClients) {
              roomClients.forEach(client => {
                // Solo enviar a usuarios aprobados
                if (client.readyState === 1 && client.userName === msg.target && client !== ws && isUserApproved(client)) {
                  client.send(JSON.stringify({
                    type: "signal",
                    sender: userName,
                    payload: msg.payload
                  }));
                }
              });
            }
          }
          break;

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
            console.log(`[SERVER] Room clients count: ${roomClients ? roomClients.size : 0}`);
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
              console.log(`[SERVER] Word given to ${msg.target} by ${userName} in room '${room}' for ${msg.duration || 60} seconds. Sent to ${sentCount} clients.`);
            }
          } else {
            console.log(`[SERVER] Cannot give word - missing requirements (room: ${!!room}, target: ${!!msg.target})`);
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
              console.log(`[SERVER] 🔇 ${msg.target} muted automatically when word taken in room '${room}'.`);

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
              console.log(`[SERVER] Word taken from ${msg.target} by ${userName} in room '${room}'.`);
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
              console.log(`[SERVER] Floor granted to ${msg.target} by ${userName} in room '${room}'. Hand lowered for ${msg.target}.`);
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
              console.log(`[SERVER] Floor ended for ${msg.name} in room '${room}'. Hand lowered.`);
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
              console.log(`[SERVER] Hand lowered for ${msg.name} in room '${room}' (distributed to all clients).`);
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
            console.log(`[SERVER] Poll started in room '${room}' by ${userName}:`, pollData.question);

            setTimeout(() => {
              if (activePolls.has(room) && activePolls.get(room).id === pollData.id) {
                console.log(`[SERVER] Automatically ending poll for room '${room}'.`);
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
              console.log(`[SERVER] Sent 'poll-started' to ${roomClients.size} clients in room '${room}'.`);
            }
          } else {
            console.warn(`[SERVER] Failed attempt to start poll. Room: ${room}, Moderator: ${ws.isModerator}, Poll data present: ${!!msg.poll}`);
          }
          break;

        case 'submit-vote':
          if (room && userName && msg.vote && activePolls.has(room)) {
            const currentPoll = activePolls.get(room);

            if (Date.now() > currentPoll.endTime) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "poll_ended", message: "The poll has ended and cannot be voted on." }));
              }
              console.log(`[SERVER] ${userName} tried to vote in an ended poll in room '${room}'.`);
              return;
            }

            if (!currentPoll.votedUsers) {
              currentPoll.votedUsers = new Set();
            }
            if (currentPoll.votedUsers.has(userName)) {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "already_voted", message: "You have already voted in this poll." }));
              }
              console.log(`[SERVER] ${userName} tried to vote again in room '${room}'.`);
              return;
            }

            if (currentPoll.results.hasOwnProperty(msg.vote.optionId)) {
              currentPoll.results[msg.vote.optionId]++;
              currentPoll.votedUsers.add(userName);
              currentPoll.votes.push({ voter: userName, optionId: msg.vote.optionId, optionText: msg.vote.optionText });
              console.log(`[SERVER] Vote received from ${userName} in room '${room}' for option '${msg.vote.optionText}'.`);

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
                    console.log(`[SERVER] Sent poll-update to moderator ${client.userName} in room '${room}'.`);
                  }
                });
              }
            } else {
              console.warn(`[SERVER] Invalid vote option received from ${userName} in room '${room}':`, msg.vote.optionId);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: "vote-submitted", status: "error", message: "Invalid vote option." }));
              }
            }
          } else {
            console.warn(`[SERVER] Failed attempt to submit vote. Room: ${room}, User: ${userName}, Vote: ${!!msg.vote}, Active poll: ${activePolls.has(room)}`);
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

            console.log(`[SERVER] Poll ended in room '${room}'. Question: ${endedPoll.question}, Results:`, results);

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
          } else {
            console.warn(`[SERVER] Failed attempt to end poll. Room: ${room}, Moderator: ${ws.isModerator}, Active poll: ${activePolls.has(room)}`);
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
                console.log(`[SERVER] Failed attempt to assign moderator role: ${msg.target} is already a moderator in room '${room}'.`);
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

              console.log(`[SERVER] ${msg.target} assigned as moderator in room '${room}' by ${userName}.`);

            } else {
              ws.send(JSON.stringify({
                type: "error",
                message: `User ${msg.target} not found in the room.`
              }));
              console.log(`[SERVER] Failed attempt to assign moderator role: ${msg.target} not found in room '${room}'.`);
            }

          } else {
            ws.send(JSON.stringify({
              type: "error",
              message: "Only moderators can assign moderator roles."
            }));
            console.log(`[SERVER] Failed attempt to assign moderator role. Room: ${room}, Moderator: ${ws.isModerator}, Target: ${msg.target}`);
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
                console.log(`[SERVER] Failed attempt to revoke moderator role: ${msg.target} is not a moderator in room '${room}'.`);
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

              console.log(`[SERVER] ${msg.target} moderator role revoked in room '${room}' by ${userName}.`);

            } else {
              ws.send(JSON.stringify({
                type: "error",
                message: `User ${msg.target} not found in the room.`
              }));
              console.log(`[SERVER] Failed attempt to revoke moderator role: ${msg.target} not found in room '${room}'.`);
            }

          } else {
            ws.send(JSON.stringify({
              type: "error",
              message: "Only moderators can revoke moderator roles."
            }));
            console.log(`[SERVER] Failed attempt to revoke moderator role. Room: ${room}, Moderator: ${ws.isModerator}, Target: ${msg.target}`);
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
              console.log(`[SERVER] ${msg.target} microphone set to ${msg.micActive ? 'active' : 'muted'} by ${userName} in room '${room}'.`);
            } else {
              ws.send(JSON.stringify({ type: "error", message: `User ${msg.target} not found in the room.` }));
              console.log(`[SERVER] Failed attempt to mute/unmute: ${msg.target} not found in room '${room}'.`);
            }
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Only moderators can mute participants." }));
            console.log(`[SERVER] Failed attempt to mute participant. Room: ${room}, Moderator: ${ws.isModerator}, Target: ${msg.target}`);
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
                console.log(`[SERVER] Silencing ${clientToMute.userName} as part of mute-all by ${userName} in room '${room}'.`);
              } else if (clientToMute.isRoomAdmin) {
                console.log(`[SERVER] Skipping admin ${clientToMute.userName} from mute-all in room '${room}'.`);
              }
            });
            console.log(`[SERVER] Mute-all action by ${userName} in room '${room}' completed.`);
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Only moderators can mute all participants." }));
            console.log(`[SERVER] Failed attempt to mute all participants. Room: ${room}, Moderator: ${ws.isModerator}`);
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
              console.log(`[SERVER] ${msg.target} kicked from room '${room}' by ${userName}.`);
              if (roomClients.size === 0) {
                activeRooms.delete(room);
                activePolls.delete(room);
                console.log(`[SERVER] Room '${room}' is empty and deleted.`);
              }
            } else {
              ws.send(JSON.stringify({ type: "error", message: `User ${msg.target} not found in the room.` }));
              console.log(`[SERVER] Failed attempt to kick: ${msg.target} not found in room '${room}'.`);
            }
          } else {
            ws.send(JSON.stringify({ type: "error", message: "Only moderators can kick participants." }));
            console.log(`[SERVER] Failed attempt to kick participant. Room: ${room}, Moderator: ${ws.isModerator}, Target: ${msg.target}`);
          }
          break;

        case 'chat':
          console.log(`[SERVER] Chat message received. Room: ${room}, User: ${userName}, Message: ${msg.message}`);
          if (room && userName && msg.message) {
            const roomClients = activeRooms.get(room);
            console.log(`[SERVER] Room clients count: ${roomClients ? roomClients.size : 0}`);
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
                  console.log(`[SERVER] Chat message sent to ${client.userName}`);
                }
              });
              console.log(`[SERVER] Chat message from ${userName} in room '${room}' sent to ${sentCount} clients: ${msg.message}`);
            } else {
              console.log(`[SERVER] No room clients found for room '${room}'`);
            }
          } else {
            console.log(`[SERVER] Chat message rejected. Room: ${!!room}, User: ${!!userName}, Message: ${!!msg.message}`);
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
              console.log(`[SERVER] Participant state update for ${userName} in room '${room}': mic=${msg.micActive}, cam=${msg.camActive}`);
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
            console.log(`[SERVER] Screen share state saved for room '${room}': ${userName}`);
            
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
                  console.log(`[SERVER] screen-share-started sent to specific user ${msg.targetUser}`);
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
                console.log(`[SERVER] screen-share-started by ${userName} in room '${room}'.`);
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
                console.log(`[SERVER] Screen share state cleared for room '${room}'`);
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
              console.log(`[SERVER] screen-share-stopped by ${userName} in room '${room}'.`);
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
              console.log(`[SERVER] ${userName} left room '${room}'.`);
              if (roomClients.size === 0) {
                activeRooms.delete(room);
                activePolls.delete(room);
                console.log(`[SERVER] Room '${room}' is empty and deleted.`);
              }
            }
          }
          break;

        default:
          console.warn(`[SERVER] Unknown message type: ${msg.type}`);
          break;
      }
    } catch (error) {
      console.error('[SERVER] Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[SERVER] Client ${userName || 'unknown'} disconnected.`);
    if (room && activeRooms.has(room)) {
      const roomClients = activeRooms.get(room);
      roomClients.delete(ws);
      
      // ✅ Limpiar screen share si el usuario que compartía se desconecta
      if (activeScreenShares.has(room)) {
        const screenShare = activeScreenShares.get(room);
        if (screenShare.userId === userName) {
          activeScreenShares.delete(room);
          console.log(`[SERVER] Screen share cleared: ${userName} disconnected from room '${room}'`);
          
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
        console.log(`[SERVER] Room '${room}' is empty and deleted.`);
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
        console.log(`[SERVER] Notified room '${room}' that ${userName} disconnected and lowered their hand.`);
      }
    }
  });

  ws.on('error', (error) => {
    console.error(`[SERVER] WebSocket connection error for ${userName || 'unknown'}:`, error);
  });

  function notifyNewPeer(roomClients, newClient, newUserName, micActive, camActive) {
    // ✅ Notificar al nuevo participante sobre pantalla compartida activa
    if (activeScreenShares.has(room)) {
      const screenShare = activeScreenShares.get(room);
      console.log(`[SERVER] Sending active screen share info to ${newUserName}: ${screenShare.userId}`);
      
      // Enviar después de un pequeño delay para que el cliente esté listo
      setTimeout(() => {
        if (newClient.readyState === 1) {
          newClient.send(JSON.stringify({
            type: 'screen-share-started',
            userId: screenShare.userId,
            streamId: screenShare.streamId,
            isSync: true // Marcar que es una sincronización
          }));
          console.log(`[SERVER] ✅ Screen share sync sent to ${newUserName}`);
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
  console.log(`WebSocket server running at http://0.0.0.0:${PORT}`);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`ERROR: Port ${PORT} is already in use`);
    process.exit(1);
  }
});

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server shut down successfully');
    process.exit(0);
  });
});