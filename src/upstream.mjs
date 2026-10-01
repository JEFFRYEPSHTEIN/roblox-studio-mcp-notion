import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

export const STUDIO_GUIDANCE = 'Open Roblox Studio. In Assistant → … → Manage MCP Servers, enable Studio as MCP server. Then call roblox_list_roblox_studios and explicitly choose the studio_id for the intended Place.';
const DISCOVERY_TIMEOUT = 15_000;
const TOOL_TIMEOUT = 120_000;

/** Launch the official Roblox launcher; do not copy or terminate Studio itself. */
export async function createUpstream(config) {
  const client = new Client({ name: 'notion-roblox-studio-bridge', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: config.studioCommand,
    args: config.studioArgs,
    stderr: 'pipe',
    maxBufferSize: 32 * 1024 * 1024,
  });
  // The official process may log local account/project details. Never echo those logs.
  transport.stderr?.on('data', () => {});
  let connected = false;
  let dirty = true;
  let generation = 0;
  let tools = [];
  let pendingRefresh;
  let closePromise;
  client.onclose = () => { connected = false; };
  client.onerror = () => {};
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    generation++;
    dirty = true;
  });

  async function refresh() {
    if (!connected) throw new Error(`Official Studio MCP connection is closed. ${STUDIO_GUIDANCE}`);
    if (!dirty) return tools;
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = (async () => {
      const startedGeneration = generation;
      const discovered = [];
      const cursors = new Set();
      let cursor;
      const deadline = Date.now() + DISCOVERY_TIMEOUT;
      do {
        if (cursor && cursors.has(cursor)) throw new Error('Official Studio MCP returned a repeated tools cursor. Restart this bridge.');
        if (cursor) cursors.add(cursor);
        if (cursors.size > 32 || discovered.length > 512) throw new Error('Official Studio MCP tool discovery exceeded its limit. Update this bridge.');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Official Studio MCP tool discovery timed out. Restart this bridge.');
        const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: remaining, maxTotalTimeout: remaining });
        discovered.push(...result.tools);
        cursor = result.nextCursor;
      } while (cursor);
      if (!connected) throw new Error(`Official Studio MCP disconnected during discovery. ${STUDIO_GUIDANCE}`);
      tools = discovered;
      dirty = generation !== startedGeneration;
      return tools;
    })();
    try { return await pendingRefresh; }
    finally { pendingRefresh = undefined; }
  }

  async function close() {
    connected = false;
    closePromise ??= client.close(); // SDK owns shutdown of its stdio child.
    return closePromise;
  }

  try {
    await client.connect(transport, { timeout: DISCOVERY_TIMEOUT, maxTotalTimeout: DISCOVERY_TIMEOUT });
    connected = true;
    await refresh();
  } catch (error) {
    await close().catch(() => {});
    throw new Error(`Could not initialize the official Roblox Studio MCP launcher. ${STUDIO_GUIDANCE}`, { cause: error });
  }
  return {
    get ready() { return connected; },
    getTools: refresh,
    async callTool(name, args, options = {}) {
      if (!connected) throw new Error(`Official Studio MCP connection is closed. ${STUDIO_GUIDANCE}`);
      return client.callTool({ name, arguments: args }, undefined, {
        timeout: TOOL_TIMEOUT, maxTotalTimeout: TOOL_TIMEOUT, signal: options.signal,
      });
    },
    close,
  };
}
