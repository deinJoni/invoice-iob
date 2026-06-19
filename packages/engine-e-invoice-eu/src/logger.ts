/**
 * A logger for `@e-invoice-eu/core`'s `InvoiceService` that routes EVERYTHING to stderr.
 *
 * Load-bearing for MCP: stdout is the JSON-RPC channel. The engine calls `logger.log(...)`
 * for info messages — the default `console.log` would write to stdout and corrupt the
 * protocol (hanging Claude Desktop). So every level here writes to `process.stderr`.
 */
export interface EngineLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
}

function write(level: string, args: unknown[]): void {
  const parts = args.map((a) =>
    typeof a === 'string' ? a : a instanceof Error ? (a.stack ?? a.message) : safeStringify(a),
  );
  process.stderr.write(`[e-invoice-eu:${level}] ${parts.join(' ')}\n`);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** A stderr-only logger instance safe to hand to `new InvoiceService(...)`. */
export const stderrLogger: EngineLogger = {
  log: (...a) => write('log', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
  debug: (...a) => write('debug', a),
};
