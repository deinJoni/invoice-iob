# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-19

Initial MVP. The full launch format set works end-to-end from a single canonical model, and all
official-validator CI gates are green (KoSIT for XRechnung; Mustangproject — which embeds veraPDF —
for the ZUGFeRD/Factur-X hybrid PDF/A-3).

### Added

- **MCP server** (`@invoice-iob/server`) over stdio: tools `create_invoice` and `list_formats`,
  structured output, stderr-only logging, local file output (`<invoiceNumber>-<format>.{xml,pdf}`).
- **Extensible core** (`@invoice-iob/core`): canonical EN 16931 invoice model (single source of
  truth), `FormatProvider` interface, format registry, friendly-input zod schema, input mapper and
  a cents-based VAT/tax engine, shared EN 16931 pre-flight checks.
- **Engine adapter** (`@invoice-iob/engine-e-invoice-eu`): canonical → UBL-JSON serializer over
  `@e-invoice-eu/core`, XML + Factur-X generate wrappers, and a LibreOffice-avoidance guard.
- **XML providers**: `XRECHNUNG-CII`, `XRECHNUNG-UBL` (XRechnung 3.0 CIUS + BR-DE rules), `UBL`,
  `CII` (generic EN 16931).
- **Visual PDF provider** (`PDF`): template-driven A4 invoice, IBM Plex Sans (OFL) subset-embedded,
  §14 UStG mandatory fields, DE/EN labels; amounts read from the canonical model.
- **ZUGFeRD/Factur-X provider** (`ZUGFERD` / `FACTUR-X`): hybrid PDF/A-3, default profile EN 16931.
- **Packaging**: one-click `.mcpb` (≈1.6 MB) for Claude Desktop; install snippets for Claude Code,
  Cursor, VS Code, and generic MCP clients — all from one esbuild bundle.
- **CI**: build · typecheck · test · pack · smoke, plus the KoSIT (P0) and Mustang/veraPDF (P2)
  conformance gates.
- **OSS scaffolding & docs**: README, CONTRIBUTING (with the add-a-format recipe), CODE_OF_CONDUCT,
  CODEOWNERS, issue/PR templates, `docs/{STACK,ARCHITECTURE,PROVIDER_GUIDE,SUPPORT_MATRIX,CI}.md`.

[Unreleased]: https://github.com/deinJoni/invoice-iob/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/deinJoni/invoice-iob/releases/tag/v0.1.0
