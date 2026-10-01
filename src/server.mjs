import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { createUpstream, STUDIO_GUIDANCE } from './upstream.mjs';

export const READ_ONLY_TOOLS = Object.freeze([
  'list_roblox_studios', 'search_game_tree', 'inspect_instance', 'script_read',
  'script_search', 'script_grep', 'get_studio_state', 'get_console_output', 'screen_capture',
]);
export const WRITE_TOOLS = Object.freeze(['multi_edit', 'execute_luau', 'start_stop_play']);
const coreNames = new Set([...READ_ONLY_TOOLS, ...WRITE_TOOLS]);
const readNames = new Set(READ_ONLY_TOOLS);
const origins = new Set(['https://app.notion.com', 'https://www.notion.so', 'https://notion.so']);
const BODY_LIMIT = 1024 * 1024;
const QUEUE_TIMEOUT = 120_000;

// Unrecognized JSON Schema validation keywords must not silently become Zod metadata.
// This intentionally supports a conservative subset, and fails closed after upstream updates.
const schemaKeywords = new Set([
  '$schema', '$ref', '$defs', 'definitions', '$id', 'id', '$comment', 'type', 'enum', 'const',
  'anyOf', 'oneOf', 'allOf', 'not', 'properties', 'required', 'additionalProperties',
  'patternProperties', 'propertyNames', 'minProperties', 'maxProperties', 'items', 'prefixItems',
  'additionalItems', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
  'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'multipleOf', 'description', 'title', 'default', 'examples', 'deprecated',
  'readOnly', 'writeOnly', 'nullable',
]);
const childSchemas = new Set(['anyOf', 'oneOf', 'allOf', 'not', 'additionalProperties', 'propertyNames', 'items', 'prefixItems', 'additionalItems', 'contains']);
const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

function checkSchema(schema) {
  if (typeof schema === 'boolean') return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('JSON Schema must be an object or boolean');
  for (const [key, value] of Object.entries(schema)) {
    if (!schemaKeywords.has(key) && !key.startsWith('x-')) throw new Error(`Unsupported JSON Schema keyword: ${key}`);
    if (schemaMaps.has(key)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid schema map: ${key}`);
      Object.values(value).forEach(checkSchema);
    } else if (childSchemas.has(key)) {
      if (Array.isArray(value)) value.forEach(checkSchema);
      else checkSchema(value);
    }
  }
}

function objectSchema(schema, name, kind) {
  try {
    checkSchema(schema);
    const converted = z.fromJSONSchema(schema);
    // SDK tool discovery requires an object schema. Avoid normalization to an empty shape.
    if (converted._zod?.def.type !== 'object') throw new Error('Tool schema must be a directly representable object');
    z.toJSONSchema(converted); // Confirm the SDK can export it before accepting requests.
    return converted;
  } catch (error) {
    throw Object.assign(new Error(`Unsupported ${kind} schema for ${name}: ${error.message}. Update this bridge before reconnecting Notion.`), { httpStatus: 503 });
  }
}

function prepareTools(tools, readOnly) {
  if (!Array.isArray(tools)) throw Object.assign(new Error('Official Studio MCP returned an invalid tool list.'), { httpStatus: 503 });
  const seen = new Set();
  return tools.filter(tool => coreNames.has(tool.name) && (!readOnly || readNames.has(tool.name))).map(tool => {
    if (seen.has(tool.name)) throw Object.assign(new Error(`Official Studio MCP returned duplicate tool ${tool.name}. Restart the bridge.`), { httpStatus: 503 });
    seen.add(tool.name);
    if (tool.name !== 'list_roblox_studios' && (tool.inputSchema?.properties?.studio_id?.type !== 'string' || !tool.inputSchema?.required?.includes('studio_id'))) {
      throw Object.assign(new Error(`Unsupported input schema for ${tool.name}: a required string studio_id is mandatory. Update this bridge before reconnecting Notion.`), { httpStatus: 503 });
    }
    return {
      definition: tool,
      input: objectSchema(tool.inputSchema, tool.name, 'input'),
      output: tool.outputSchema ? objectSchema(tool.outputSchema, tool.name, 'output') : undefined,
    };
  });
}

function secretEquals(value, expected) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError); request.off('aborted', onAborted);
    };
    const onError = error => { cleanup(); reject(error); };
    const onAborted = () => onError(Object.assign(new Error('Request was interrupted'), { httpStatus: 400 }));
    const onData = chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        cleanup(); request.resume();
        reject(Object.assign(new Error('Request body exceeds 1 MiB'), { httpStatus: 413 }));
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON request'), { httpStatus: 400 })); }
    };
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError); request.once('aborted', onAborted);
  });
}
function toolError(message) { return { isError: true, content: [{ type: 'text', text: message }] }; }

export async function startBridge(config, onStopped = async () => {}, upstreamFactory = createUpstream) {
  if (typeof config.token !== 'string' || config.token.length < 32) throw new Error('A locally generated MCP token of at least 32 characters is required.');
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('MCP port must be an integer from 0 to 65535.');
  const upstream = await upstreamFactory(config);
  let stopping = false, stopPromise;
  let schemaSignature, prepared = [];
  let schemaError;
  let mutationTail = Promise.resolve();
  const servers = new Set();

  async function refreshTools() {
    const tools = await upstream.getTools();
    const signature = JSON.stringify(tools);
    if (signature !== schemaSignature) {
      try {
        const next = prepareTools(tools, config.readOnly === true);
        prepared = next; schemaSignature = signature; schemaError = undefined;
      } catch (error) { schemaError = error; throw error; }
    }
    return prepared;
  }
  try { await refreshTools(); }
  catch (error) { await upstream.close().catch(() => {}); throw error; }
  const healthy = () => upstream.ready && !stopping && !schemaError;

  async function invoke(name, args, extra) {
    if (!upstream.ready || stopping) return toolError(`Official Studio MCP connection is unavailable. ${STUDIO_GUIDANCE}`);
    if (name !== 'list_roblox_studios' && (typeof args?.studio_id !== 'string' || !args.studio_id.trim())) return toolError('An explicitly chosen nonempty studio_id is required. Call roblox_list_roblox_studios first.');
    const call = async () => {
      try { return await upstream.callTool(name, args, { signal: extra.signal }); }
      catch (error) { return toolError(`Studio operation failed: ${error.message}. ${STUDIO_GUIDANCE}`); }
    };
    if (readNames.has(name)) return call();
    const deadline = Date.now() + QUEUE_TIMEOUT;
    const queued = mutationTail.then(() => {
      if (Date.now() >= deadline || extra.signal?.aborted) return toolError('Studio write queue timed out or was cancelled. Check Studio before retrying.');
      if (!upstream.ready || stopping) return toolError(`Official Studio MCP connection is unavailable. ${STUDIO_GUIDANCE}`);
      return call();
    });
    mutationTail = queued.then(() => {}, () => {});
    let timer;
    const timedOut = new Promise(resolve => { timer = setTimeout(() => resolve(toolError('Studio write queue timed out. Check Studio before retrying.')), QUEUE_TIMEOUT); });
    try { return await Promise.race([queued, timedOut]); }
    finally { clearTimeout(timer); }
  }

  const http = createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      if (typeof host !== 'string' || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(response, 403, { error: 'Invalid Host. Use the loopback address or the prepared tunnel.' });
      if (request.headers.origin && !origins.has(request.headers.origin)) return json(response, 403, { error: 'Only Notion Origin is permitted.' });
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const authorization = request.headers.authorization;
      const bearer = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      const authorized = secretEquals(bearer, config.token);
      if (pathname === '/health' && request.method === 'GET') return json(response, healthy() ? 200 : 503, { ok: !!healthy() });
      if (pathname === '/_status' || pathname === '/_shutdown') {
        const proxied = Object.keys(request.headers).some(name => name === 'forwarded' || name.startsWith('cf-') || name.startsWith('x-forwarded-'));
        if (!authorized || proxied) return json(response, 403, { error: 'Authenticated local management only.' });
        if (pathname === '/_status' && request.method === 'GET') return json(response, healthy() ? 200 : 503, { server: 'notion-roblox-studio', ok: !!healthy(), readOnly: config.readOnly === true });
        if (pathname === '/_shutdown' && request.method === 'POST') {
          json(response, 200, { stopping: true });
          setImmediate(() => { void stop().catch(() => { process.exitCode = 1; }); });
          return;
        }
        return json(response, 405, { error: 'Method not allowed.' });
      }
      if (pathname !== '/mcp') return json(response, 404, { error: 'Not found.' });
      if (!authorized) return json(response, 401, { error: 'MCP Bearer token required. Copy the locally generated token into Notion.' });
      if (request.method !== 'POST') return json(response, 405, { error: 'Use stateless MCP POST.' });
      if (!upstream.ready || stopping) return json(response, 503, { error: `Official Studio MCP is unavailable. ${STUDIO_GUIDANCE}` });
      const body = await readJson(request);
      const currentTools = await refreshTools();
      const server = new McpServer({ name: 'notion-roblox-studio', version: '1.0.0' }, { instructions: STUDIO_GUIDANCE });
      for (const { definition, input, output } of currentTools) {
        const readOnly = readNames.has(definition.name);
        server.registerTool(`roblox_${definition.name}`, {
          title: definition.title,
          description: `${definition.description ?? definition.name}\n${definition.name === 'list_roblox_studios' ? 'List open Studio instances first; never select a Place automatically.' : 'Use an explicitly selected studio_id returned by roblox_list_roblox_studios.'}`,
          inputSchema: input, outputSchema: output,
          annotations: { ...definition.annotations, readOnlyHint: readOnly, ...(readOnly ? {} : { destructiveHint: true, idempotentHint: false }) },
          _meta: definition._meta,
        }, (args, extra) => invoke(definition.name, args, extra));
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      servers.add(server);
      let cleaned = false;
      const cleanup = () => { if (!cleaned) { cleaned = true; servers.delete(server); void server.close().catch(() => {}); } };
      response.once('finish', cleanup); response.once('close', cleanup);
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, error.httpStatus ?? 503, { error: error.httpStatus ? error.message : `Studio MCP request failed. ${STUDIO_GUIDANCE}` });
    }
  });
  http.headersTimeout = 15_000;
  http.requestTimeout = 130_000;
  try {
    await new Promise((resolve, reject) => { http.once('error', reject); http.listen(config.port, '127.0.0.1', resolve); });
  } catch (error) { await upstream.close().catch(() => {}); throw error; }

  async function stop() {
    stopPromise ??= (async () => {
      stopping = true;
      const closed = new Promise(resolve => http.close(resolve));
      await Promise.allSettled([...servers].map(server => server.close()));
      try { await upstream.close(); }
      finally { http.closeAllConnections(); await closed; await onStopped(); }
    })();
    return stopPromise;
  }
  return { stop, port: http.address().port };
}
