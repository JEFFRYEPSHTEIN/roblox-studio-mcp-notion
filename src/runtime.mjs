import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const runtimeDirectory = path.join(projectDirectory, '.runtime');
export const configPath = path.join(runtimeDirectory, 'config.json');
export const connectionPath = path.join(runtimeDirectory, 'connection.json');
const runFile = promisify(execFile);

export async function findStudioBatch() {
  if (process.platform !== 'win32') throw new Error('This package uses the Windows built-in Roblox Studio MCP.');
  if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is missing. Start under your Windows user account.');
  const batch = path.join(process.env.LOCALAPPDATA, 'Roblox', 'mcp.bat');
  try { await access(batch); } catch {
    throw new Error('Roblox mcp.bat was not found. Install/update Roblox Studio and enable Studio as MCP server in Assistant settings.');
  }
  return batch;
}

export async function loadConfig() {
  await mkdir(runtimeDirectory, { recursive: true });
  let config;
  try { config = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = { token: randomBytes(32).toString('hex'), port: 8769, readOnly: false };
    try { await writeFile(configPath, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 }); }
    catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      config = JSON.parse(await readFile(configPath, 'utf8'));
    }
  }
  if (!/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Invalid key in .runtime/config.json');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid HTTP port');
  if (typeof config.readOnly !== 'boolean') throw new Error('readOnly must be true or false');
  const batch = await findStudioBatch();
  return { ...config, studioCommand: process.env.ComSpec || 'cmd.exe', studioArgs: ['/d', '/c', batch] };
}

export async function findCloudflared() {
  const local = path.join(projectDirectory, 'bin', 'cloudflared.exe');
  try { await access(local); return local; } catch { }
  try {
    const { stdout } = await runFile('where.exe', ['cloudflared.exe'], { windowsHide: true });
    const executable = stdout.trim().split(/\r?\n/)[0];
    if (path.isAbsolute(executable)) { await access(executable); return executable; }
  } catch { }
  throw new Error('Install official cloudflared in PATH or bin/cloudflared.exe. See README.md.');
}

export async function isRunning(config) {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/_status`, {
      headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(2000),
    });
    return response.ok && (await response.json()).server === 'notion-roblox-studio';
  } catch { return false; }
}
