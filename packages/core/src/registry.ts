/**
 * The format registry. Providers register here (via each format package's `register()`
 * entrypoint, composed by the server — explicit DI rather than import side-effects, so the
 * bundler can't tree-shake registrations away). `create_invoice` resolves a `format` string
 * to a provider; `list_formats` enumerates the registry.
 */
import type { FormatMeta, FormatProvider } from './provider.ts';

/** Normalize a format id / alias for case-insensitive lookup. */
export function normalizeFormatId(id: string): string {
  return id.trim().toLowerCase();
}

export interface ListOptions {
  /** When true, exclude providers not bundleable in this build. */
  availableOnly?: boolean;
}

export class FormatRegistry {
  readonly #byKey = new Map<string, FormatProvider>();
  readonly #order: FormatProvider[] = [];

  /** Register a provider under its id and all aliases. Throws on a conflicting key. */
  register(provider: FormatProvider): void {
    const keys = [provider.meta.id, ...(provider.meta.aliases ?? [])].map(normalizeFormatId);
    for (const key of keys) {
      const existing = this.#byKey.get(key);
      if (existing && existing !== provider) {
        throw new Error(
          `Format id/alias "${key}" is already registered by "${existing.meta.id}".`,
        );
      }
      this.#byKey.set(key, provider);
    }
    if (!this.#order.includes(provider)) this.#order.push(provider);
  }

  /** Resolve a format string (id or alias, case-insensitive) to a provider. */
  resolve(formatId: string): FormatProvider | undefined {
    return this.#byKey.get(normalizeFormatId(formatId));
  }

  has(formatId: string): boolean {
    return this.#byKey.has(normalizeFormatId(formatId));
  }

  /** Enumerate distinct providers' metadata in registration order. */
  list(options: ListOptions = {}): FormatMeta[] {
    return this.#order
      .filter((p) => !options.availableOnly || p.meta.bundleable)
      .map((p) => p.meta);
  }

  /** All canonical ids + aliases currently resolvable (for error messages). */
  knownIds(): string[] {
    return [...this.#byKey.keys()];
  }

  /** Canonical ids only (one per provider), in registration order. */
  canonicalIds(): string[] {
    return this.#order.map((p) => p.meta.id);
  }
}
