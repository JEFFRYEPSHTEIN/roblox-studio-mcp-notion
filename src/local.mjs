import { startBridge } from './server.mjs';
import { loadConfig } from './runtime.mjs';

const bridge = await startBridge(await loadConfig());
console.log(`Roblox MCP local HTTP ready on 127.0.0.1:${bridge.port}. No public tunnel started.`);
process.on('SIGINT', () => { void bridge.stop(); });
process.on('SIGTERM', () => { void bridge.stop(); });
