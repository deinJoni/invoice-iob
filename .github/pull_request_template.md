<!--
Thanks for contributing to invoice-iob! Keep the description short and link any
related issue (e.g. "Closes #123"). New country/format providers should reference
the matching "New country/format provider" issue.
-->

## What & why

<!-- One or two sentences: what does this change and why. -->

Closes #

## Checklist

- [ ] `pnpm run typecheck` passes (`tsc --noEmit`)
- [ ] `pnpm test` passes
- [ ] `pnpm run build` succeeds (esbuild → `dist/bundle/server/index.mjs`)
- [ ] `pnpm run format:check` passes (ran `pnpm run format` if needed)
- [ ] No native runtime dependency added to the default `.mcpb` bundle (no JVM / LibreOffice / Ghostscript / Chromium); validators stay dev/CI-only

### For new / changed format providers

- [ ] CI fixtures added (reuse the `scripts/smoke.mjs` pattern to generate them)
- [ ] An authoritative validator is wired into CI for this format, and it parses the report — **not** the exit code (e.g. KoSIT exits 0 even for invalid invoices; assert the VARL `<rep:assessment>` is `<rep:accept>` with zero `<rep:message level="error">`)
- [ ] Support matrix updated (README formats table + `list_formats`) and a `CODEOWNERS` line added for any new package
- [ ] Renderer reads amounts from the canonical model and does **not** recompute totals/VAT
