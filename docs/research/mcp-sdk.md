# Research: MCP TypeScript SDK & stdio server best practices (2026)

## Summary

`@modelcontextprotocol/sdk` is at **1.29.0** (MIT). The idiomatic 2026 pattern is the high-level `McpServer` class with `registerTool` (not the low-level `Server` + `setRequestHandler`), connected via `StdioServerTransport`. Imports use ESM subpaths `@modelcontextprotocol/sdk/server/mcp.js` and `@modelcontextprotocol/sdk/server/stdio.js`. Tool input/output schemas are declared as a RAW Zod SHAPE (a plain object map of `field -> ZodType`, NOT a wrapped `z.object`), which the SDK converts to JSON Schema for `tools/list`. Both Zod v3 (>=3.25) and Zod v4 (current 4.4.3) are supported because the SDK depends on `zod: ^3.25 || ^4.0` and ships an internal zod-compat layer — **pin Zod v4 and import `import * as z from "zod/v4"`**. The package's exports are dual ESM/CJS; bundle with esbuild `--platform=node --format=esm --target=node20` into a single `.mjs`. The skeleton below typechecks under strict+nodenext against the real 1.29.0 types AND runs end-to-end over stdio.

## 1. Version & idiomatic stdio server

- `@modelcontextprotocol/sdk` = **1.29.0**, MIT. `package.json` declares `"type": "commonjs"` but ships dual builds via `exports`: `import` -> `./dist/esm/...`, `require` -> `./dist/cjs/...`. Default `protocolVersion` negotiated in test: `2025-06-18`.
- **Use `McpServer` (high-level), not `Server` + `setRequestHandler`.** `Server` is explicitly `@deprecated`. `McpServer.server` exposes the underlying `Server` if you need raw notifications/handlers.
- **Use `registerTool`, not `.tool()`.** All `.tool()`/`.resource()`/`.prompt()` overloads are `@deprecated`. `registerTool` wires both list+call handlers and does input/output validation for you.

### Exact import statements (verified to resolve + run)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
```

Note the mandatory `.js` extension. `McpServer` is NOT re-exported from the package root. `StdioServerTransport` constructor is `(stdin?: Readable, stdout?: Writable)` — default no-arg uses `process.stdin`/`process.stdout`.

(Caution: web summaries occasionally abbreviate the path to `@modelcontextprotocol/server` — WRONG. The real package is `@modelcontextprotocol/sdk`.)

## 2. Input schemas: raw Zod shape, Zod v3 vs v4

`registerTool` real signature:

```ts
registerTool<OutputArgs extends ZodRawShapeCompat | AnySchema,
             InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>
): RegisteredTool;
```

- `inputSchema`/`outputSchema` accept `ZodRawShapeCompat` (= `Record<string, AnySchema>`, a RAW shape like `{ name: z.string() }`) OR an `AnySchema`. Idiomatic form is the **raw shape**: `inputSchema: { format: z.enum([...]), total: z.number() }`. For zero-arg tools pass `inputSchema: {}`.
- **Zod compat is built in.** `zod-compat.d.ts`: `export type AnySchema = z3.ZodTypeAny | z4.$ZodType;`. The dep/peer range is `zod: "^3.25 || ^4.0"`. **Pin Zod v4 (4.4.3) and import `import * as z from "zod/v4"`** (exactly what the SDK README uses). The handler arg type is inferred from the shape (`ShapeOutput<Args>`).

### Complete minimal working server (typechecked + verified over stdio)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const log = (...a: unknown[]) => console.error('[invoice-iob]', ...a); // stderr only

const server = new McpServer(
  { name: 'invoice-iob', version: '0.1.0' },
  { capabilities: { tools: {}, logging: {} } },
);

const FORMATS = ['xrechnung-ubl', 'xrechnung-cii', 'ubl', 'cii', 'factur-x'] as const;

server.registerTool(
  'list_formats',
  {
    title: 'List supported e-invoice formats',
    description: 'Returns the EN 16931 output formats this server can produce.',
    inputSchema: {}, // zero-arg tool
    outputSchema: { formats: z.array(z.string()) },
  },
  async () => {
    const structured = { formats: [...FORMATS] };
    return {
      content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured, // must match outputSchema
    };
  },
);

server.registerTool(
  'create_invoice',
  {
    title: 'Create an EN 16931 e-invoice',
    description: 'Generates an e-invoice document in the requested format.',
    inputSchema: {
      // RAW zod shape, not z.object(...)
      format: z.enum(FORMATS).describe('Target output format.'),
      seller: z.string().min(1),
      buyer: z.string().min(1),
      total: z.number().positive(),
    },
    outputSchema: { format: z.string(), filename: z.string(), bytes: z.number() },
  },
  async ({ format, seller, buyer, total }) => {
    // args fully typed from shape
    try {
      if (total > 1_000_000) {
        return {
          content: [{ type: 'text', text: `Refusing: total ${total} exceeds limit.` }],
          isError: true,
        };
      }
      const filename = `invoice-${format}.xml`;
      const structured = { format, filename, bytes: 1234 };
      log('created', filename);
      return {
        content: [{ type: 'text', text: `Created ${filename}` }],
        structuredContent: structured,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Generation failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('ready on stdio');
}
main().catch((e) => {
  log('fatal', e);
  process.exit(1);
});
```

## 3. Structured content / outputSchema / content types / errors

- **outputSchema + structuredContent:** when you declare `outputSchema`, the handler SHOULD return `structuredContent` (validated against it; a mismatch throws and surfaces as a protocol error). Best practice: ALSO return a `content` text block for clients/models that don't consume structured content.
- **CallToolResult fields:** `content: ContentBlock[]`, optional `structuredContent`, optional `isError`, optional `_meta`.
- **Content block types:** `text`, `image` (`{data, mimeType}`), `audio`, `resource_link`, embedded `resource` (`{uri, mimeType, text|blob}`). For invoice-iob: a `text` summary + `structuredContent`; for the generated XML/PDF use an embedded `resource` (text for XML, base64 `blob` for PDF) or a `resource_link` to a written file.
- **Error surfacing — two channels:**
  1. **Tool/business errors** (EN16931 invalid, generation failed): return `{ content: [...], isError: true }` — a SUCCESSFUL JSON-RPC response flagging tool failure so the model can react.
  2. **Protocol errors** (unknown tool, malformed params, crash): `throw` — the SDK returns a JSON-RPC error object. `registerTool` already auto-validates `inputSchema`, so bad args are rejected before your handler runs.

## 4. Hard rule: stdout = JSON-RPC, logs = stderr

A stdio MCP server's stdout is the newline-delimited JSON-RPC channel; ANY stray write to stdout corrupts the stream and the client hangs on `connect()`. **Never use `console.log` / `process.stdout.write` for diagnostics — use `console.error` (stderr).**

- `server.sendLoggingMessage(params, sessionId?)` — emits an MCP `notifications/message` log to the CLIENT (requires `capabilities.logging: {}`); travels over the protocol, safe.
- For local diagnostics, `console.error`. If using pino/winston, set the destination to `process.stderr` (fd 2).

## 5. ESM/CJS + esbuild

- SDK ships dual (ESM at `dist/esm`, CJS at `dist/cjs`) via conditional `exports`. Authoring in ESM with the `/server/mcp.js` subpaths is the documented path.
- **esbuild config:** `--platform=node --format=esm --target=node20 --bundle`. Single `.mjs`. Because some transitive deps call CJS `require`, add a banner shim:
  `--banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"`
  (Verified: ~800KB single-file bundle ran the full handshake. `--format=cjs --target=node20` also works.)
- Keep validators OUT of the bundle (CI-only). tsconfig for typechecking: `"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022","strict":true`.

## Decisions

- **Use `McpServer` + `registerTool` + `StdioServerTransport`**, not the low-level `Server`/`setRequestHandler`.
- **Declare tool schemas as RAW Zod shapes** (`{ field: z.type() }`), not `z.object()`.
- **Pin Zod v4 (4.4.3), import `import * as z from "zod/v4"`.**
- **Connect over `StdioServerTransport` with default constructor.**
- **stdout = JSON-RPC only; diagnostics → stderr via `console.error`; client logs via `server.sendLoggingMessage`.**
- **Business failures → `{ content, isError: true }`; throw only for protocol/internal errors.**
- **Bundle with esbuild `--platform=node --format=esm --target=node20 --bundle` + createRequire banner.**
- **Return generated artifacts as embedded resource content blocks** (text XML, base64 PDF) alongside a text summary + structuredContent.

## Packages

| name                      | version | license | purpose                                                                                                    |
| ------------------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| @modelcontextprotocol/sdk | 1.29.0  | MIT     | MCP server/client SDK; McpServer + registerTool + StdioServerTransport. ~800KB single .mjs after bundling. |
| zod                       | 4.4.3   | MIT     | Tool input/output schemas as raw shapes; import via `zod/v4`.                                              |
| zod-to-json-schema        | 3.25.2  | ISC     | Transitive (SDK converts schemas to JSON Schema). Do NOT add directly.                                     |

## Risks

- SDK pulls large server-oriented transitive deps (express ^5, hono ^4, ajv, jose) even for stdio-only — inflates the `.mcpb`. Rely on esbuild tree-shaking with `--platform=node`; HTTP transports aren't imported by a stdio-only entrypoint.
- esbuild ESM bundling can break on transitive CJS `require()` — the createRequire banner shim is required.
- Mixing schema instances from two different zod installs could confuse version detection — hoist a single zod@4 across the monorepo.
- Any accidental console.log/library log to stdout corrupts JSON-RPC and hangs Claude Desktop. Audit transitive deps; test the bundled `.mjs` over a real stdio handshake before shipping.
- outputSchema validation is enforced — keep FormatProvider return types in lockstep with declared schemas.
- SDK is pre-2.0 and evolving fast; pin the exact version and re-verify `registerTool`/`StdioServerTransport` on each upgrade.

## Citations

- https://www.npmjs.com/package/@modelcontextprotocol/sdk
- https://github.com/modelcontextprotocol/typescript-sdk
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md
- https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
- https://modelcontextprotocol.io/docs/develop/build-server
- https://www.npmjs.com/package/zod
- https://www.npmjs.com/package/zod-to-json-schema
