import { spawn } from 'node:child_process';
import { open, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, findCloudflared, isRunning, projectDirectory, runtimeDirectory, connectionPath } from './runtime.mjs';
import { startBridge } from './server.mjs';

const config = await loadConfig();
if (await isRunning(config)) {
  console.log('Roblox MCP is already running. For an active HTTPS tunnel see connection.md; stop local mode before starting HTTPS.');
  process.exit(0);
}
const tunnelExecutable = await findCloudflared();
const lockPath = path.join(runtimeDirectory, 'launcher.lock');
async function lock() {
  const handle = await open(lockPath, 'wx', 0o600);
  await handle.writeFile(String(process.pid));
  await handle.close();
}
try { await lock(); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const previousPid = Number(await readFile(lockPath, 'utf8'));
  let alive = false;
  if (Number.isInteger(previousPid) && previousPid > 0) {
    try { process.kill(previousPid, 0); alive = true; } catch (pidError) {
      if (pidError.code !== 'ESRCH') throw pidError;
    }
  }
  if (alive) {
    console.log('Roblox launcher is already running/starting. For an unavailable bridge, use stop.ps1 before restarting.');
    process.exit(0);
  }
  await unlink(lockPath);
  await lock();
}

let tunnel;
let stopping = false;
let baseUrl;
let registered = false;
let published = false;
let buffer = '';
let writes = Promise.resolve();
const onStopped = async () => {
  stopping = true;
  if (tunnel && tunnel.exitCode === null) tunnel.kill(); // Only the tunnel; the MCP child closes through SDK.
  await writes.catch(() => {});
  await unlink(lockPath).catch(() => {});
  await writeFile(connectionPath, JSON.stringify({ running: false, stoppedAt: new Date().toISOString() }, null, 2));
  await writeFile(path.join(projectDirectory, 'connection.md'), '# Roblox MCP остановлен\n\nЗапустите start.ps1 для нового HTTPS-адреса. Roblox Studio оставлен открытым.\n');
  console.log('Roblox MCP and tunnel stopped; Studio was left open.');
};

let bridge;
try {
  bridge = await startBridge(config, onStopped);
  tunnel = spawn(tunnelExecutable, [
    'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${config.port}`,
    '--http-host-header', 'localhost', '--protocol', 'http2',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  tunnel.stderr.setEncoding('utf8');
  tunnel.stderr.on('data', chunk => {
    process.stderr.write(chunk);
    buffer = (buffer + chunk).slice(-16000);
    const found = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found) baseUrl = found[0];
    if (buffer.includes('Registered tunnel connection')) registered = true;
    if (!baseUrl || !registered || published) return;
    published = true;
    const record = { running: true, baseUrl, serverUrl: `${baseUrl}/mcp`, token: config.token,
      readOnly: config.readOnly, startedAt: new Date().toISOString() };
    const instruction = [
      '# Roblox Studio MCP для Notion', '',
      'Settings → Connections → Discover → Custom MCP.',
      'Name: **Roblox Studio — этот ПК**. Authentication: **Bearer token**. Prefix: **Bearer**.', '',
      'Server URL:', '', `\`${record.serverUrl}\``, '',
      'Token (без слова Bearer):', '', `\`${config.token}\``, '',
      `Режим: ${config.readOnly ? 'только чтение' : 'чтение, редактирование, Luau и playtest'}.`, '',
      'Откройте Studio и нужный Place; включите Assistant → … → Manage MCP Servers → Enable Studio as MCP server.',
      'Начните с roblox_list_roblox_studios и явно выберите studio_id.',
      'Luau имеет права Studio на выбранный проект; это не sandbox. Для изменения инструментов оставьте подтверждение Notion.',
      'ПК должен быть включён. Временный HTTPS-домен меняется после перезапуска туннеля.',
      'Этот файл содержит ключ. Не публикуйте его и не передавайте чужим аккаунтам.', '',
    ].join('\n');
    writes = writes.then(async () => {
      await writeFile(connectionPath, JSON.stringify(record, null, 2), { mode: 0o600 });
      await writeFile(path.join(projectDirectory, 'connection.md'), instruction, { mode: 0o600 });
      console.log(`Public MCP URL: ${record.serverUrl}. Key saved in connection.md.`);
    }).catch(() => { console.error('Cannot save connection settings.'); void bridge.stop(); });
  });
  tunnel.on('error', () => { console.error('Cannot start cloudflared.'); process.exitCode = 1; void bridge.stop(); });
  tunnel.on('exit', code => {
    if (!stopping) { console.error(`Tunnel closed (${code}).`); process.exitCode = 1; void bridge.stop(); }
  });
  process.on('SIGINT', () => { void bridge.stop(); });
  process.on('SIGTERM', () => { void bridge.stop(); });
} catch (error) {
  console.error('Startup failed:', error.code || 'Check installation and local log');
  if (bridge) await bridge.stop();
  else await unlink(lockPath).catch(() => {});
  process.exitCode = 1;
}
