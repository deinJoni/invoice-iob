/**
 * The extension point. A new country/format is a new `FormatProvider` — the core pipeline
 * is untouched. Providers declare metadata, validate the canonical model against their
 * CIUS/business rules, and render an artifact. They register into a {@link FormatRegistry};
 * `list_formats` reads the registry.
 */
import type { CanonicalInvoice } from './model.ts';

export type OutputKind = 'xml' | 'pdf' | 'hybrid';

/** Underlying syntax of the artifact. */
export type Syntax = 'UBL' | 'CII' | 'PDF' | 'hybrid' | (string & {});

export interface FormatMeta {
  /** Canonical, stable id in kebab-case, e.g. "xrechnung-cii", "zugferd". */
  id: string;
  /** Case-insensitive alternative ids accepted by the registry, e.g. ["factur-x"]. */
  aliases?: string[];
  /** Human-readable label for `list_formats`. */
  label: string;
  /** ISO 3166-1 alpha-2 country code, or "EU" for the pan-European generic formats. */
  country: string;
  /** Governing standard, e.g. "EN 16931" or "EN 16931 CIUS — XRechnung 3.0". */
  standard: string;
  syntax: Syntax;
  outputKind: OutputKind;
  /** Profiles this format accepts (for hybrids), if any. */
  profiles?: string[];
  /** Default profile when none is supplied. */
  defaultProfile?: string;
  /** File extension without the dot, e.g. "xml" or "pdf". */
  fileExtension: string;
  /** MIME type of the rendered artifact. */
  mimeType: string;
  /**
   * `true` if the provider is pure-JS and ships in the default Node-only `.mcpb`.
   * `false` if it needs a runtime not bundled by default (JVM, Go, external binary).
   */
  bundleable: boolean;
  /** Optional native runtime dependencies (only for non-bundleable providers). */
  requires?: string[];
}

export interface RenderOptions {
  /** Selected profile (hybrids); ignored by single-profile formats. */
  profile?: string;
  /** BCP-47-ish language tag for canned document text, e.g. "de-de". */
  lang?: string;
}

export interface RenderedArtifact {
  bytes: Uint8Array;
  mimeType: string;
  /** File extension without the dot. */
  extension: string;
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  /** Business-rule id where applicable, e.g. "BR-DE-15". */
  rule?: string;
  message: string;
  severity: IssueSeverity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface FormatProvider {
  readonly meta: FormatMeta;

  /**
   * Validate the canonical model against this format's CIUS / business rules
   * (e.g. German BR-DE-*, mandatory Leitweg-ID). Returns issues; does not throw.
   * Note: this is the cheap pre-flight check inside the server, NOT the authoritative
   * external validator (KoSIT/veraPDF) that runs in CI.
   */
  validate(model: CanonicalInvoice, profile?: string): ValidationResult;

  /** Produce the artifact bytes from the canonical model. */
  render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact>;

  /** Optionally fold country-specific friendly input into the model's extension area. */
  mapExtensions?(input: unknown): Record<string, unknown>;
}

/** Convenience constructor for a passing/failing {@link ValidationResult}. */
export function validationResult(issues: ValidationIssue[]): ValidationResult {
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}
