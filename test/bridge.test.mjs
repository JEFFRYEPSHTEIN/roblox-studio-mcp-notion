import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startBridge } from '../src/server.mjs';

const token = 'test-only-key-never-use-this-in-a-real-server';
const reads = ['list_roblox_studios', 'search_game_tree', 'inspect_instance', 'script_read', 'script_search', 'script_grep', 'get_studio_state', 'get_console_output', 'screen_capture'];
const writes = ['multi_edit', 'execute_luau', 'start_stop_play'];
const coreNames = [...reads, ...writes];
function tool(name) {
  return {
    name, title: `Title ${name}`, description: `Upstream description for ${name}`,
    inputSchema: { type: 'object', properties: name === 'list_roblox_studios' ? {} : { studio_id: { type: 'string', minLength: 1 } }, required: name === 'list_roblox_studios' ? [] : ['studio_id'], additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
    _meta: { source: 'test-fixture' },
  };
}
function fakeUpstream() {
  return {
    ready: true, tools: [...coreNames.map(tool), tool('generate_mesh'), tool('publish_game')],
    calls: [], discoveries: 0, closed: false,
    async getTools() { this.discoveries++; return this.tools; },
    async callTool(name, args) {
      this.calls.push({ name, args });
      if (name === 'screen_capture') return {
        content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png', annotations: { audience: ['user'] }, _meta: { imageDetail: 'original' } }],
        structuredContent: { studio: args.studio_id }, _meta: { trace: 'preserved' },
      };
      return { content: [{ type: 'text', text: name === 'list_roblox_studios' ? 'No Studio instances. Enable Studio as MCP server.' : JSON.stringify(args) }] };
    },
    async close() { this.ready = false; this.closed = true; },
  };
}
async function fixture(t, config = {}, upstream = fakeUpstream()) {
  let stopped = 0;
  const bridge = await startBridge({ port: 0, token, readOnly: false, ...config }, async () => { stopped++; }, async () => upstream);
  t.after(() => bridge.stop());
  const base = `http://127.0.0.1:${bridge.port}`;
  const clients = [];
  t.after(async () => { await Promise.allSettled(clients.map(client => client.close())); });
  return {
    bridge, upstream, base, stopped: () => stopped,
    async connect() {
      const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      return client;
    },
    request(path, options = {}) { return fetch(`${base}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } }); },
  };
}

test('unauthenticated requests are rejected before parsing or upstream discovery/calls', async t => {
  const f = await fixture(t);
  const baseline = f.upstream.discoveries;
  for (const Authorization of ['', 'Bearer wrong']) {
    const response = await f.request('/mcp', { method: 'POST', headers: { Authorization }, body: '{invalid-json' });
    assert.equal(response.status, 401);
  }
  assert.equal(f.upstream.discoveries, baseline);
  assert.equal(f.upstream.calls.length, 0);
});

test('only 12 allowed tools are registered with required inputs and correct read/write annotations', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(value => value.name).sort(), coreNames.map(name => `roblox_${name}`).sort());
  for (const definition of tools) {
    const name = definition.name.slice('roblox_'.length);
    assert.equal(definition.annotations.readOnlyHint, reads.includes(name));
    assert.equal(definition.title, `Title ${name}`);
    assert.equal(definition._meta.source, 'test-fixture');
    if (name !== 'list_roblox_studios') assert.ok(definition.inputSchema.required.includes('studio_id'));
  }
  const invalid = await client.callTool({ name: 'roblox_execute_luau', arguments: {} });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /studio_id/);
  assert.equal(f.upstream.calls.length, 0);
  const unknown = await client.callTool({ name: 'roblox_publish_game', arguments: {} });
  assert.equal(unknown.isError, true);
  assert.equal(f.upstream.calls.length, 0);
});

test('content images, structured output and metadata are forwarded intact', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  const result = await client.callTool({ name: 'roblox_screen_capture', arguments: { studio_id: 'chosen-studio' } });
  assert.deepEqual(result, {
    content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png', annotations: { audience: ['user'] }, _meta: { imageDetail: 'original' } }],
    structuredContent: { studio: 'chosen-studio' }, _meta: { trace: 'preserved' },
  });
  assert.deepEqual(f.upstream.calls, [{ name: 'screen_capture', args: { studio_id: 'chosen-studio' } }]);
});

test('readOnly mode omits all writes and never forwards an attempted write', async t => {
  const f = await fixture(t, { readOnly: true });
  const client = await f.connect();
  assert.deepEqual((await client.listTools()).tools.map(value => value.name).sort(), reads.map(name => `roblox_${name}`).sort());
  const result = await client.callTool({ name: 'roblox_execute_luau', arguments: { studio_id: 'chosen-studio' } });
  assert.equal(result.isError, true);
  assert.equal(f.upstream.calls.length, 0);
});

test('no Studio response is truthful, disconnection is 503 and local shutdown remains usable', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  const result = await client.callTool({ name: 'roblox_list_roblox_studios', arguments: {} });
  assert.match(result.content[0].text, /No Studio instances/);
  f.upstream.ready = false;
  assert.equal((await f.request('/health')).status, 503);
  assert.equal((await f.request('/mcp', { method: 'POST', body: '{}' })).status, 503);
  assert.equal((await f.request('/_status')).status, 503);
  const shutdown = await f.request('/_shutdown', { method: 'POST' });
  assert.equal(shutdown.status, 200);
  await f.bridge.stop();
  assert.equal(f.upstream.closed, true);
  assert.equal(f.stopped(), 1);
});

test('host/origin and external proxy management requests are blocked', async t => {
  const f = await fixture(t);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.base}/health`, { headers: { Host: 'attacker.example' } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject); request.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await f.request('/health', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await f.request('/health', { headers: { Origin: 'https://app.notion.com' } })).status, 200);
  for (const headers of [{ 'cf-ray': 'edge' }, { 'x-forwarded-for': '1.2.3.4' }, { Forwarded: 'for=1.2.3.4' }, { Authorization: 'Bearer wrong' }]) {
    assert.equal((await f.request('/_status', { headers })).status, 403);
    assert.equal((await f.request('/_shutdown', { method: 'POST', headers })).status, 403);
  }
  assert.equal(f.upstream.closed, false);
});

test('invalid JSON, too-large body and wrong MCP method return actionable HTTP errors', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/mcp', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await f.request('/mcp', { method: 'POST', body: ' '.repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal((await f.request('/mcp')).status, 405);
  assert.equal(f.upstream.calls.length, 0);
});

test('unsupported upstream schemas fail closed and close the official connection', async () => {
  const upstream = fakeUpstream();
  upstream.tools = [{ ...tool('execute_luau'), inputSchema: { type: 'object', if: { properties: { studio_id: { const: 'wrong' } } }, then: { required: ['studio_id'] } } }];
  await assert.rejects(startBridge({ port: 0, token }, async () => {}, async () => upstream), /Unsupported.*schema/i);
  assert.equal(upstream.closed, true);
});

test('selected-place tools fail closed if an upstream update makes studio_id optional', async () => {
  const upstream = fakeUpstream();
  upstream.tools = [{ ...tool('execute_luau'), inputSchema: { type: 'object', properties: { studio_id: { type: 'string' } } } }];
  await assert.rejects(startBridge({ port: 0, token }, async () => {}, async () => upstream), /required string studio_id/);
  assert.equal(upstream.closed, true);
});

test('blank studio_id is never forwarded or automatically selected', async t => {
  const upstream = fakeUpstream();
  upstream.tools = [{ ...tool('execute_luau'), inputSchema: { type: 'object', properties: { studio_id: { type: 'string' } }, required: ['studio_id'] } }];
  const f = await fixture(t, {}, upstream);
  const client = await f.connect();
  const result = await client.callTool({ name: 'roblox_execute_luau', arguments: { studio_id: '   ' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /explicitly chosen nonempty studio_id/);
  assert.equal(upstream.calls.length, 0);
});

test('changed tool schemas refresh per request and newly discovered unapproved tools stay hidden', async t => {
  const f = await fixture(t);
  const client = await f.connect();
  assert.equal((await client.listTools()).tools.length, 12);
  f.upstream.tools = [tool('list_roblox_studios'), tool('upload_asset')];
  assert.deepEqual((await client.listTools()).tools.map(value => value.name), ['roblox_list_roblox_studios']);
  const removed = await client.callTool({ name: 'roblox_execute_luau', arguments: { studio_id: 'chosen' } });
  assert.equal(removed.isError, true);
  assert.equal(f.upstream.calls.length, 0);
});

test('write operations from concurrent HTTP clients are serialized without changing selected IDs', async t => {
  const upstream = fakeUpstream();
  let active = 0, peak = 0;
  upstream.callTool = async function (name, args) {
    active++; peak = Math.max(peak, active); this.calls.push({ name, args });
    await delay(20); active--;
    return { content: [{ type: 'text', text: args.studio_id }] };
  };
  const f = await fixture(t, {}, upstream);
  const [first, second] = await Promise.all([f.connect(), f.connect()]);
  const results = await Promise.all([
    first.callTool({ name: 'roblox_execute_luau', arguments: { studio_id: 'first-studio' } }),
    second.callTool({ name: 'roblox_multi_edit', arguments: { studio_id: 'second-studio' } }),
  ]);
  assert.equal(peak, 1);
  assert.deepEqual(results.map(value => value.content[0].text), ['first-studio', 'second-studio']);
});
