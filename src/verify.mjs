import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig, connectionPath, runtimeDirectory } from './runtime.mjs';

const publicMode = process.argv.includes('--public');
const config = await loadConfig();
const endpoint = publicMode
  ? JSON.parse(await readFile(connectionPath, 'utf8')).serverUrl
  : `http://127.0.0.1:${config.port}/mcp`;
const unauthorized = await fetch(endpoint, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000),
});
assert.equal(unauthorized.status, 401, 'A missing key must be rejected');

const client = new Client({ name: 'roblox-studio-mcp-check', version: '1.0.0' }, { capabilities: {} });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  }));
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(tools.includes('roblox_list_roblox_studios'));
  assert.ok(!tools.includes('roblox_upload_image') && !tools.includes('roblox_subagent'));
  if (config.readOnly) {
    assert.ok(!tools.includes('roblox_multi_edit') && !tools.includes('roblox_execute_luau') && !tools.includes('roblox_start_stop_play'));
  }
  const studios = await client.callTool({ name: 'roblox_list_roblox_studios', arguments: {} }, undefined, { timeout: 30000 });
  const report = { checkedAt: new Date().toISOString(), target: publicMode ? 'HTTPS' : 'local',
    missingKeyRejected: true, tools, studioResponse: studios,
    placeMutationVerified: false, notionAgentVerified: false };
  await writeFile(path.join(runtimeDirectory, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(`MCP transport/authentication checked; ${tools.length} exposed tools.`);
  console.log('Studio discovery response:');
  for (const item of studios.content || []) if (item.type === 'text') console.log(item.text);
  if (studios.isError) {
    console.log('Studio returned an error. Open it and enable Studio as MCP server.');
    process.exitCode = 2;
  }
  console.log('No Place or script changed. This does not verify editing from Notion.');
} finally {
  await client.close();
}
