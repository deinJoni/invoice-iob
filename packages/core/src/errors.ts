import type { ValidationIssue } from './provider.ts';

/**
 * Errors use explicit field declarations (not TS parameter properties) so the source is
 * "erasable" — runnable directly by Node's native type-stripping (e.g. `node --test`) and by
 * esbuild. `tsconfig` enforces this via `erasableSyntaxOnly`.
 */

/** Thrown when friendly input fails schema validation or basic sanity checks. */
export class InvoiceInputError extends Error {
  override readonly name = 'InvoiceInputError';
  readonly issues?: ReadonlyArray<{ path: string; message: string }>;
  constructor(message: string, issues?: ReadonlyArray<{ path: string; message: string }>) {
    super(message);
    this.issues = issues;
  }
}

/** Thrown when a built canonical invoice violates a format's business rules. */
export class InvoiceValidationError extends Error {
  override readonly name = 'InvoiceValidationError';
  readonly issues: ValidationIssue[];
  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.issues = issues;
  }
}

/** Thrown when a requested format id is not registered / not available in this build. */
export class FormatNotFoundError extends Error {
  override readonly name = 'FormatNotFoundError';
  readonly formatId: string;
  readonly available: string[];
  constructor(formatId: string, available: string[]) {
    super(
      `Unknown or unavailable format "${formatId}". Available formats: ${available.join(', ') || '(none)'}. ` +
        `Call list_formats to see options.`,
    );
    this.formatId = formatId;
    this.available = available;
  }
}

/** Thrown by an engine adapter when something the engine requires is wrong/unsafe. */
export class EngineError extends Error {
  override readonly name = 'EngineError';
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}
