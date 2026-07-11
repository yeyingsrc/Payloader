# Payloader Production Readiness Design

## Status

Approved for implementation by the user's request to complete all identified optimizations and continue until the project is ready to deploy.

## Product Decision

Payloader is a task-focused security knowledge workbench and local content-management product. The production surface must prioritize trustworthy content, fast retrieval, safe administration, and reproducible releases. Decorative "cyber" styling is secondary to legibility and operational confidence.

## Goals

1. Preserve the current runtime database and prevent destructive reset or import operations from silently losing content.
2. Ensure public client downloads represent the current frontend and public data, while retaining the last successful artifacts after a failed build.
3. Remove confirmed command corruption, codec regressions, replacement-character corruption, misleading tutorial placeholders, and navigation defects.
4. Make the primary public workflow and admin workflow usable with keyboard, screen readers, mobile touch, and both themes.
5. Establish repeatable quality gates for TypeScript, JavaScript, SQLite content, APIs, frontend builds, and browser behavior.
6. Provide a deployable Node-based production container and accurate operating documentation.

## Non-Goals

- Rewriting the product in another framework.
- Replacing SQLite or the Electron packaging model.
- Translating thousands of low-quality English fields automatically without editorial review.
- Removing existing public data, protected links, administrator authentication, or offline-client isolation.

## Architecture

### Runtime And Data Safety

- `data/payloader.sqlite` remains the authoritative mutable runtime database.
- `server/default-seed.sqlite` remains the reset baseline, but it must be refreshed only from a validated runtime snapshot.
- Every reset creates a consistent SQLite backup before any delete statement executes.
- The admin API exposes a JSON export of the current content package and a reset-impact preview.
- Reset responses include before/after counts and backup metadata. A reset cannot proceed if backup creation fails.
- Database initialization is represented by one shared promise so concurrent requests cannot observe partially seeded state.
- Request bodies are decoded once from complete buffers to preserve UTF-8 across chunk boundaries.

### Client Release Safety

- Build metadata separates the last successful build from the current or last failed job.
- A failed build never replaces the public download allowlist.
- Status checks compare current source and public-data hashes with the last successful build and report stale state without deleting artifacts.
- Public download endpoints only serve successful, current-contract artifacts and expose staleness explicitly.

### Content Quality

- A deterministic content-quality verifier scans runtime and seed databases.
- Blocking checks reject replacement characters, known source-code fragments inside command fields, empty commands, invalid platforms, dangling navigation references, and invalid JSON.
- Reporting checks quantify untranslated English, orphaned content, duplicate display names, shallow/template tutorial sections, and missing WAF variants.
- Confirmed corrupt command fields and replacement characters are repaired in the legacy source, runtime DB, and default seed.
- Template tutorials are not presented as substantive tutorials. Imported quick-reference entries keep their commands but omit generic placeholder tutorial sections.
- English UI chrome remains translatable, but the public language switch is hidden until content coverage meets the quality threshold. Chinese is the production default.

### Frontend Experience

- The visual direction is a restrained security workbench: neutral surfaces, one cyan/teal action accent, and semantic success/warning/error colors.
- Header hierarchy is navigation, product identity, search, primary content tabs, then secondary utilities.
- Mobile keeps a compact two-row shell; secondary utilities move into an overflow menu and all touch targets are at least 44px.
- The empty state offers direct category actions instead of decorative skull imagery and instruction cards.
- Sidebar items use semantic buttons/tree semantics, support keyboard navigation, expose state through ARIA, and preserve mobile drawer behavior.
- Modals expose dialog semantics, close on Escape, trap/restore focus, and provide live status feedback.
- Available client downloads appear before the target matrix.
- `EncodingTools` loads on demand.

### Admin Experience

- The existing module navigation and dense operational layout remain.
- CSS override conflicts are removed so client target cards cannot overlap.
- Custom content previews use text-safe DOM output.
- Reset actions show impact and backup behavior before confirmation.

### Delivery And Quality Gates

- Node `>=22.12` is the supported runtime; Docker uses a compatible Node image and runs the full server rather than static Nginx only.
- `npm run check` runs type checking, lint, codec verification, content verification, tests, and a production build.
- ESLint covers browser TS/TSX, admin JS, server MJS/CJS, and scripts with appropriate globals.
- Node's built-in test runner covers data safety, import validation, release metadata, codec routing, and content-quality rules.
- CI runs the same quality gate on Windows-independent commands.
- Runtime sources, admin sources, scripts, seed data, and required frontend modules are tracked; runtime databases, uploads, build artifacts, audit outputs, and temporary keys remain ignored.

## Compatibility And Preservation

- Existing public API response fields remain compatible; new fields are additive.
- Existing admin authentication, CSRF handling, protected Xeye link enforcement, global-variable replacement, and Electron network isolation remain.
- Runtime data is backed up before migration or cleanup scripts modify it.
- Existing successful client artifacts stay downloadable until a newly verified successful build replaces them.

## Acceptance Criteria

1. `npm run check` exits successfully.
2. Reset impact can be inspected and every reset creates a usable backup before mutation.
3. Export returns the current content counts and valid JSON.
4. Current client status detects source/data staleness; failed builds preserve last-success downloads.
5. Content verifier reports zero blocking errors for runtime and seed.
6. No confirmed command contains TypeScript source fragments or U+FFFD.
7. Public navigation has no dangling references and all non-intentional public records are reachable.
8. Desktop and mobile browser checks show no overlap, no horizontal overflow, accessible primary navigation, visible focus, and usable dialogs.
9. Production Docker image serves `/`, `/admin/`, `/api/public-data`, and health/readiness endpoints.
10. README documents the actual Node/API/SQLite deployment model and backup/restore workflow.

## Verification Evidence

- Static: `npm run typecheck`, `npm run lint`, and `node --check` for server/admin/scripts.
- Focused: `npm run test`, `npm run verify:codec`, and `npm run verify:content`.
- Build: `npm run build`, plus Docker build where the local engine is available.
- Runtime: API health, public data, admin unauthorized/authenticated, export, reset-impact, and client-status probes.
- Browser: 1280x800, 768x1024, and 390x844 public/admin screenshots plus accessibility snapshots and console checks.

