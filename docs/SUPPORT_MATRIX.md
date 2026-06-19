# Support matrix (living)

> Which countries and formats invoice-iob can emit, and which are on the roadmap. This is the
> living version of PRD §9.4 — kept in sync as providers land. New countries/formats are added as
> **plugins, not forks** (see [`PROVIDER_GUIDE.md`](PROVIDER_GUIDE.md)).

**Legend.** **Status** — `Shipped` means it works in the build today (the launch XML set);
`P1`/`P2`/`P3` are roadmap phases (see [`PLAN.md`](../PLAN.md)); `Near-term` / `Planned` are not
yet implemented. **Bundleable** — whether the provider is pure-JS and ships in the default
one-click Node-only `.mcpb` (✅), or needs a runtime/toolchain the default bundle can't carry (⚠️ /
TBD). See [`PROVIDER_GUIDE.md`](PROVIDER_GUIDE.md) for what `bundleable` means.

| Country | Format | Standard | Output | Status | Bundleable |
| ------- | ------ | -------- | ------ | ------ | ---------- |
| DE | XRechnung (UBL / CII) | EN 16931 CIUS — XRechnung 3.0 | XML | **Shipped** (Launch / P0) | ✅ |
| EU | UBL / CII | EN 16931 | XML | **Shipped** (Launch / P0) | ✅ |
| DE | ZUGFeRD / Factur-X | EN 16931 | Hybrid PDF/A-3 | Planned (P2) | ✅ |
| FR | Factur-X | EN 16931 | Hybrid PDF/A-3 | Near-term (P3) — engine already supports | ✅ |
| IT | FatturaPA | National (SdI) | XML | Planned (P3) | TBD — needs a JS lib |
| ES | Facturae | National | XML (+ XAdES) | Planned (P3) | ⚠️ signature toolchain |
| PL | KSeF | National | XML | Planned (P3) | TBD |

## Shipped today

The launch set (P0, working end-to-end and covered by the smoke test) is the four EN 16931 XML
providers:

| `format` (id / aliases) | Provider package |
| ----------------------- | ---------------- |
| `xrechnung-cii` | `@invoice-iob/format-xrechnung` |
| `xrechnung-ubl` | `@invoice-iob/format-xrechnung` |
| `ubl` | `@invoice-iob/format-ubl-cii` |
| `cii` | `@invoice-iob/format-ubl-cii` |

All four are pure JS over [`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu), so they
ship in the default `.mcpb` and `list_formats` reports `available: true` for them.

## Roadmap

- **P2 — DE ZUGFeRD / Factur-X (hybrid PDF/A-3).** Visual PDF (P1) embedded with the engine's
  Factur-X assembly. Bundleable: the engine does the PDF/A-3 machinery in pure JS — but only on the
  supply-a-PDF path. The Factur-X path must **always** pass `options.pdf` and **never**
  `options.spreadsheet` / `options.libreOfficePath` (the LibreOffice guard). CI gates it with
  veraPDF (PDF/A-3b) and Mustangproject (Factur-X profile/container).
- **FR — Factur-X (near-term).** The engine already emits Factur-X, so France is mostly a profile
  and language change once the P2 hybrid path exists. Bundleable.
- **IT — FatturaPA (planned).** National SdI XML, **not** in `@e-invoice-eu/core`. Needs a separate
  JS library; bundleability is TBD on that choice.
- **ES — Facturae (planned).** National XML that requires an **XAdES electronic signature**. The
  signing toolchain is the open question for bundleability (⚠️) — a Java/native signer would make
  the provider non-bundleable (`bundleable: false`, `requires: [...]`).
- **PL — KSeF (planned).** National XML via the KSeF system; engine/lib and bundleability TBD.

> FatturaPA / Facturae / KSeF are **not** in `@e-invoice-eu/core` — they need different
> engines/libs (and ES/IT add e-signature). That is exactly why the engine abstraction and the
> `bundleable` / `requires` opt-in split exist: a non-bundleable provider can join the registry and
> the matrix without bloating or breaking the default Node-only install.

Roadmap order is **FR → IT → ES → PL** (PRD §14 / [`PLAN.md`](../PLAN.md)). To add a row, implement
a `FormatProvider` per [`PROVIDER_GUIDE.md`](PROVIDER_GUIDE.md) and update this table.
