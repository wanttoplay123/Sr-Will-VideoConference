const ngrok = require('ngrok');
const { exec } = require('child_process');
const fs = require('fs');

(async function () {
  try {
    const url = await ngrok.connect({
      addr: 3000,
      authtoken: '2yxYfu7OwoYrBI0R3bMq3GcCsc2_5V8Evjcc4iJAhqyz58Vo'
    });

    const wsUrl = url.replace('https://', 'wss://');

    
    const config = { wsUrl };
    fs.writeFileSync('./signaling/public/frontendConfig.json', JSON.stringify(config), 'utf-8');

    console.log('✅ Ngrok iniciado en:', url);
    console.log('🔗 Link de prueba (Admin): ' + url + '/room.html?room=test&name=Admin&moderator=true');
    console.log('📋 Los participantes recibirán un link de index.html automáticamente');

    // Abrir automáticamente la página de index en el navegador
    const joinUrl = `${url}/index.html?room=test&name=Invitado`;
    console.log('🚀 Abriendo página de index automáticamente:', joinUrl);
    
    // En Windows, usar 'start' para abrir el navegador por defecto
    exec(`start "" "${joinUrl}"`, (error) => {
        if (error) {
            console.warn('⚠️ No se pudo abrir el navegador automáticamente:', error.message);
        } else {
            console.log('✅ Página de index abierta en el navegador');
        }
    });

    
    const serverProcess = exec('node signaling/server.js');
    serverProcess.stdout.pipe(process.stdout);
    serverProcess.stderr.pipe(process.stderr);
  } catch (err) {
    console.error('❌ Error al iniciar Ngrok:', err);
  }
})();
