# Payloader Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current Payloader worktree into a data-safe, content-correct, accessible, reproducibly deployable release candidate.

**Architecture:** Preserve React/Vite, the Node HTTP server, SQLite, and Electron. Add safety boundaries and deterministic verifiers around mutable data and release metadata, then simplify the UI shell and enforce every contract through one repeatable quality gate.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Node 22+/`node:sqlite`, vanilla admin JavaScript/CSS, Electron Builder, ESLint 9, Node test runner, Docker.

---

### Task 1: Protect Runtime Data And Reset Operations

**Files:** `server/data-store.mjs`, `server/admin-server.mjs`, `admin/admin.js`, `tests/data-safety.test.mjs`

- [x] Write a test that resets a temporary runtime/seed pair and asserts a backup exists before counts change.
- [x] Replace the global early-visible DB connection with one initialization promise.
- [x] Add consistent SQLite backup and JSON export helpers restricted to `data/backups`.
- [x] Add authenticated export and reset-impact APIs; abort reset when backup fails.
- [x] Show current/seed count deltas and backup behavior in the reset confirmation UI.
- [x] Run the focused test and temporary-directory API probes.

### Task 2: Make Client Publication Last-Good And Staleness-Aware

**Files:** `server/client-builder.mjs`, `src/components/ClientDownloads.tsx`, `admin/admin.js`, `tests/client-build-metadata.test.mjs`

- [x] Add tests proving build failure cannot replace success metadata and a hash mismatch reports stale.
- [x] Separate active/failed job state from persisted last-success metadata.
- [x] Compare current source/public-data hashes during status checks with a short cache.
- [x] Preserve the successful artifact allowlist after failures.
- [x] Show stale, failed, and current states distinctly in public/admin views.
- [x] Run metadata tests and public download HEAD probes.

### Task 3: Repair Codec Correctness

**Files:** `src/components/EncodingTools.tsx`, `scripts/verify-encoding-tools.mjs`

- [x] Preserve the failing DLP case and add GSM 03.38 default/extension round-trip vectors.
- [x] Route explicit DLP/ElGamal evidence before generic ECC inference.
- [x] Require curve-specific evidence for ECC.
- [x] Replace corrupted GSM tables with canonical default and extension mappings.
- [x] Expose or remove unreachable codec variants.
- [x] Run `npm run verify:codec` until every vector passes.

### Task 4: Repair And Govern Content

**Files:** `scripts/verify-content-quality.mjs`, `scripts/repair-content-quality.mjs`, `src/data/webPayloads.ts`, `server/default-seed.sqlite`, `data/payloader.sqlite`, `tests/content-quality.test.mjs`

- [x] Back up runtime and seed databases before mutation.
- [x] Add blocking checks for invalid JSON, U+FFFD, source fragments in commands, invalid platforms, empty commands, and dangling references.
- [x] Report untranslated English, orphan records, duplicate names, template tutorials, category/tree mismatch, and WAF coverage.
- [x] Fix the four confirmed command contaminations and every confirmed U+FFFD string.
- [x] Remove generic tutorial placeholders from imported quick-reference records.
- [x] Attach unintended orphan records and correct confirmed navigation misplacements.
- [x] Validate runtime, refresh the seed from the validated runtime snapshot, and validate both.

### Task 5: Rebuild The Public Application Shell

**Files:** `src/App.tsx`, `src/components/Header.tsx`, `src/components/Sidebar.tsx`, `src/components/MainContent.tsx`, `src/components/ClientDownloads.tsx`, `src/components/SyntaxModal.tsx`, `src/styles/global.css`

- [x] Add semantic tree navigation, keyboard movement, visible focus, and a skip link.
- [x] Add dialog semantics, Escape/focus behavior, and live status regions.
- [x] Replace the decorative empty state with direct category actions.
- [x] Simplify desktop/mobile headers and make touch targets at least 44px.
- [x] Make tabs/search leave the download view and unify search-result navigation.
- [x] Put downloads before the target matrix and collapse secondary mobile detail.
- [x] Lazy-load EncodingTools and hide the language toggle until content is ready.
- [x] Apply restrained neutral/teal tokens, AA contrast, and reduced-motion rules.

### Task 6: Repair Admin Safety And Layout

**Files:** `admin/custom-module.js`, `admin/admin-polish.css`, `admin/admin.css`

- [x] Replace unescaped custom-card interpolation with escaped text-safe output.
- [x] Remove the flex override that breaks client target card layout.
- [x] Verify target labels wrap without overlap from 390px through 1280px.
- [x] Remove redundant save affordances where the same command remains visible.

### Task 7: Establish Reproducible Quality Gates

**Files:** `eslint.config.js`, `package.json`, `package-lock.json`, `tests/api-smoke.test.mjs`, `.github/workflows/quality.yml`, `.gitignore`

- [x] Add browser and Node ESLint scopes with correct globals.
- [x] Fix lint errors without weakening meaningful rules.
- [x] Add `typecheck`, `test`, `verify:content`, and aggregate `check` scripts plus Node `>=22.13` engine constraints.
- [x] Cover health, public data, unauthorized admin, and client status APIs.
- [x] Track required sources while ignoring mutable databases, backups, uploads, builds, reports, keys, and temporary fixtures.
- [x] Add CI that runs `npm ci` and `npm run check` on Node 22.

### Task 8: Match Production Deployment To Runtime Architecture

**Files:** `Dockerfile`, `.dockerignore`, `README.md`, `server/admin-server.mjs`

- [x] Add liveness and database-readiness endpoints.
- [x] Build the frontend and run the full Node server as a non-root final image with a persisted data volume.
- [x] Document Node 22+, data paths, backup/export/reset, reverse proxy, and client releases.
- [x] Remove pure-static deployment and stale count claims.
- [x] Run local server smoke and Docker probes when Docker is available.

### Task 9: Full Release Candidate Verification

**Files:** Review all files changed by Tasks 1-8.

- [x] Run `npm run check` and retain exact evidence.
- [x] Probe public/admin/export/reset-impact/client-status/health endpoints on an unused port.
- [x] Verify reset and restore using temporary database copies.
- [x] Test desktop, tablet, and mobile public workflows in a real browser.
- [x] Test admin client cards, custom escaping, reset confirmation, and responsive behavior.
- [x] Check browser console/network errors and production bundle sizes.
- [x] Confirm no repository-side temporary servers, screenshots, credentials, or test databases remain; retain only the intentional local release-candidate container.
- [x] Audit every acceptance criterion in the production-readiness design.

## Completion Evidence (2026-07-12)

- `npm run check` passed: typecheck, lint, 91 codec regressions, both content databases with zero blocking errors, 52 Node tests, and the Vite production build.
- `npm audit` passed for production and full dependency trees with zero vulnerabilities when run against the official npm registry.
- `payloader:release-verified` is 106,393,952 bytes and runs as UID/GID 1000 with root-owned application code, a mode-0700 `noexec` data mount, and a separate executable `/tmp` build cache.
- The read-only container passed readiness and release smoke probes at `http://127.0.0.1:18081`.
- The final Linux x64 AppImage is 126,892,522 bytes with SHA256 `0291b242c67b64d244c43b60f7a354679f842c52269f9deda52897410c692b26`; its source and public-data freshness checks are current.
- Real-browser checks passed at 1280x800, 768x1024, and 390x844. Public/admin views had no horizontal overflow or clipped controls, visible mobile actions met the 44px touch target, dialogs restored focus, and console checks were clean.
- Stored content reports 764 payloads and 338 editable tools. The public snapshot intentionally reports 763 payloads and 339 tools because it deduplicates the legacy `jwt-none-alg` alias and injects the protected `xss-platform` system tool.
- The detached clean verification worktree was removed after fresh-install, quality-gate, Docker-build, and browser validation. Existing user-authored untracked scratch files were left untouched.
