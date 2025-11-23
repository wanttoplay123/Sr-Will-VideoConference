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
              console.log(`[SERVER] ${userName} raised hand in room '${room}'.`);
            }
          }
          break;

        case 'hand-lowered':
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
              console.log(`[SERVER] Hand lowered for ${msg.name} in room '${room}'.`);
            }
          }
          break;

        case 'give-word':
          console.log(`[SERVER] Received give-word: ${JSON.stringify(msg)}`);
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

              // Auto lower hand
              roomClients.forEach(client => {
                if (client.readyState === 1) {
                  client.send(JSON.stringify({
                    type: 'hand-lowered',
                    name: msg.target
                  }));
                }
              });
              console.log(`[SERVER] Hand automatically lowered for ${msg.target}.`);
            }
          } else {
            console.log(`[SERVER] Cannot give word - missing requirements (room: ${!!room}, target: ${!!msg.target})`);
          }
          break;
