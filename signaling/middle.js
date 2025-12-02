/*
 * ARCHIVO DE REFERENCIA / NOTAS
 * Este archivo contiene fragmentos de código de referencia para el servidor WebSocket.
 * NO es ejecutable - solo sirve como documentación.
 * La implementación real está en server.js
 */

/*
// --- RAISE HAND ---
case 'raise-hand': {
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
}


// --- HAND LOWERED ---
case 'hand-lowered': {
  if (room && userName) {
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
}


// --- GIVE WORD ---
case 'give-word': {
  console.log(`[SERVER] Received give-word: ${JSON.stringify(msg)}`);

  if (room && msg.target) {
    const roomClients = activeRooms.get(room);
    if (roomClients) {

      // Send give-word
      roomClients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'give-word',
            target: msg.target,
            duration: msg.duration || 60,
            grantedBy: userName
          }));
        }
      });

      // Auto lower hand
      roomClients.forEach(client => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'hand-lowered',
            name: msg.target
          }));
        }
      });

    }
  } else {
    console.log(
      `[SERVER] Cannot give word - missing requirements (room: ${!!room}, target: ${!!msg.target})`
    );
  }

  break;
}
*/