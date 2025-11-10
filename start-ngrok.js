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
    console.log('🔗 Entra a: ' + url + '/?room=codigo&name=TuNombre');

    
    const serverProcess = exec('node signaling/server.js');
    serverProcess.stdout.pipe(process.stdout);
    serverProcess.stderr.pipe(process.stderr);
  } catch (err) {
    console.error('❌ Error al iniciar Ngrok:', err);
  }
})();
