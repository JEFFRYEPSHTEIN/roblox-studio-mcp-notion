# External components

This repository contains bridge source and documentation. Vendor binaries, account credentials and Roblox Places are not bundled.

| Component | Version / source | License / terms |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.31.0, npm; [official SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT; see the installed package LICENSE |
| `zod` | 4.6.5, npm; [official project](https://github.com/colinhacks/zod) | MIT; see the installed package LICENSE |
| Roblox Studio / StudioMCP | Installed by the user through Roblox; [Studio MCP](https://create.roblox.com/docs/studio/mcp) | Roblox vendor terms; binaries are not redistributed |
| `cloudflared` | Installed separately; [official releases](https://github.com/cloudflare/cloudflared/releases) | Apache-2.0; [official license](https://github.com/cloudflare/cloudflared/blob/master/LICENSE) |
| Node.js | User-installed runtime; [official project](https://nodejs.org/) | Node.js distribution LICENSE and bundled third-party notices |

Transitive npm dependencies are recorded in `package-lock.json`; their own licenses apply. This bridge is an independent integration and is not an official Notion, Roblox or Cloudflare product.
