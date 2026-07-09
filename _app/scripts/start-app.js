const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// __dirname is _app/scripts
const appDir = path.resolve(__dirname, '..');
const projectRoot = path.resolve(appDir, '..');
const clientDist = path.join(appDir, 'client', 'dist');

// Function to find a free port starting from a default
function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      server.once('close', () => {
        resolve(startPort);
      });
      server.close();
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

async function main() {
  console.log('=== Запуск StrataNote Collaborative App ===');
  console.log('Поиск свободного порта...');
  const port = await findFreePort(3001);
  console.log(`Выбран свободный порт: ${port}`);

  // Check if build is required
  if (!fs.existsSync(clientDist)) {
    console.log('Скомпилированный фронтенд не найден. Запуск сборки (это займет около 40-50 секунд)...');
    await runCommand('npm', ['run', 'build'], appDir);
  } else {
    console.log('Фронтенд уже собран. Если вы хотите обновить сборку, удалите папку "_app/client/dist" или выполните "npm run build" вручную.');
  }

  // Check if sync agent has dependencies
  const syncMcpDir = path.resolve(projectRoot, '_sync_mcp');
  if (fs.existsSync(syncMcpDir)) {
    const syncNodeModules = path.join(syncMcpDir, 'node_modules');
    const sqliteModule = path.join(syncNodeModules, 'sqlite3');
    if (!fs.existsSync(syncNodeModules) || !fs.existsSync(sqliteModule)) {
      console.log('Зависимости для локального агента _sync_mcp не полные или не найдены. Установка/обновление (это может занять около 10-15 секунд)...');
      await runCommand('npm', ['install'], syncMcpDir);
    }
  }

  console.log(`Запуск сервера на порту ${port}...`);
  
  // Start server
  const serverProcess = spawn('npm', ['start'], {
    cwd: appDir,
    env: Object.assign({}, process.env, { PORT: port.toString() }),
    shell: true,
    stdio: 'inherit'
  });

  // Start Sync Agent
  let syncProcess = null;
  if (fs.existsSync(syncMcpDir)) {
    console.log('Запуск локального агента синхронизации MCP...');
    syncProcess = spawn('npm', ['start'], {
      cwd: syncMcpDir,
      shell: true,
      stdio: 'inherit'
    });

    syncProcess.on('close', (code) => {
      console.log(`Процесс локального агента синхронизации завершился с кодом ${code}`);
    });
  }

  // Open browser after a small delay (1.5 seconds) to let server bind
  setTimeout(() => {
    const url = `http://localhost:${port}`;
    console.log(`Открытие браузера: ${url}`);
    
    // Command to open default browser on Windows
    exec(`start ${url}`, (err) => {
      if (err) {
        console.error('Не удалось автоматически открыть браузер:', err);
      }
    });
  }, 1500);

  // Clean up child processes on exit
  const cleanUp = () => {
    if (serverProcess) {
      try { serverProcess.kill(); } catch (e) {}
    }
    if (syncProcess) {
      try { syncProcess.kill(); } catch (e) {}
    }
  };

  process.on('SIGINT', () => {
    cleanUp();
    process.exit(0);
  });

  process.on('exit', () => {
    cleanUp();
  });

  serverProcess.on('close', (code) => {
    console.log(`Процесс сервера завершился с кодом ${code}`);
    cleanUp();
    process.exit(code);
  });
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, shell: true, stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Команда ${command} завершилась с кодом ${code}`));
    });
  });
}

main().catch(err => {
  console.error('Ошибка при запуске приложения:', err);
  process.exit(1);
});
