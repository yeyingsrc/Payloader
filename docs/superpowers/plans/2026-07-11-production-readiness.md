# Payloader Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current Payloader worktree into a data-safe, content-correct, accessible, reproducibly deployable release candidate.

**Architecture:** Preserve React/Vite, the Node HTTP server, SQLite, and Electron. Add safety boundaries and deterministic verifiers around mutable data and release metadata, then simplify the UI shell and enforce every contract through one repeatable quality gate.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Node 22+/`node:sqlite`, vanilla admin JavaScript/CSS, Electron Builder, ESLint 9, Node test runner, Docker.

---

### Task 1: Protect Runtime Data And Reset Operations

**Files:** `server/data-store.mjs`, `server/admin-server.mjs`, `admin/admin.js`, `tests/data-safety.test.mjs`

- [ ] Write a test that resets a temporary runtime/seed pair and asserts a backup exists before counts change.
- [ ] Replace the global early-visible DB connection with one initialization promise.
- [ ] Add consistent SQLite backup and JSON export helpers restricted to `data/backups`.
- [ ] Add authenticated export and reset-impact APIs; abort reset when backup fails.
- [ ] Show current/seed count deltas and backup behavior in the reset confirmation UI.
- [ ] Run the focused test and temporary-directory API probes.

### Task 2: Make Client Publication Last-Good And Staleness-Aware

**Files:** `server/client-builder.mjs`, `src/components/ClientDownloads.tsx`, `admin/admin.js`, `tests/client-build-metadata.test.mjs`

- [ ] Add tests proving build failure cannot replace success metadata and a hash mismatch reports stale.
- [ ] Separate active/failed job state from persisted last-success metadata.
- [ ] Compare current source/public-data hashes during status checks with a short cache.
- [ ] Preserve the successful artifact allowlist after failures.
- [ ] Show stale, failed, and current states distinctly in public/admin views.
- [ ] Run metadata tests and public download HEAD probes.

### Task 3: Repair Codec Correctness

**Files:** `src/components/EncodingTools.tsx`, `scripts/verify-encoding-tools.mjs`

- [ ] Preserve the failing DLP case and add GSM 03.38 default/extension round-trip vectors.
- [ ] Route explicit DLP/ElGamal evidence before generic ECC inference.
- [ ] Require curve-specific evidence for ECC.
- [ ] Replace corrupted GSM tables with canonical default and extension mappings.
- [ ] Expose or remove unreachable codec variants.
- [ ] Run `npm run verify:codec` until every vector passes.

### Task 4: Repair And Govern Content

**Files:** `scripts/verify-content-quality.mjs`, `scripts/repair-content-quality.mjs`, `src/data/webPayloads.ts`, `server/default-seed.sqlite`, `data/payloader.sqlite`, `tests/content-quality.test.mjs`

- [ ] Back up runtime and seed databases before mutation.
- [ ] Add blocking checks for invalid JSON, U+FFFD, source fragments in commands, invalid platforms, empty commands, and dangling references.
- [ ] Report untranslated English, orphan records, duplicate names, template tutorials, category/tree mismatch, and WAF coverage.
- [ ] Fix the four confirmed command contaminations and every confirmed U+FFFD string.
- [ ] Remove generic tutorial placeholders from imported quick-reference records.
- [ ] Attach unintended orphan records and correct confirmed navigation misplacements.
- [ ] Validate runtime, refresh the seed from the validated runtime snapshot, and validate both.

### Task 5: Rebuild The Public Application Shell

**Files:** `src/App.tsx`, `src/components/Header.tsx`, `src/components/Sidebar.tsx`, `src/components/MainContent.tsx`, `src/components/ClientDownloads.tsx`, `src/components/SyntaxModal.tsx`, `src/styles/global.css`

- [ ] Add semantic tree navigation, keyboard movement, visible focus, and a skip link.
- [ ] Add dialog semantics, Escape/focus behavior, and live status regions.
- [ ] Replace the decorative empty state with direct category actions.
- [ ] Simplify desktop/mobile headers and make touch targets at least 44px.
- [ ] Make tabs/search leave the download view and unify search-result navigation.
- [ ] Put downloads before the target matrix and collapse secondary mobile detail.
- [ ] Lazy-load EncodingTools and hide the language toggle until content is ready.
- [ ] Apply restrained neutral/teal tokens, AA contrast, and reduced-motion rules.

### Task 6: Repair Admin Safety And Layout

**Files:** `admin/custom-module.js`, `admin/admin-polish.css`, `admin/admin.css`

- [ ] Replace unescaped custom-card interpolation with escaped text-safe output.
- [ ] Remove the flex override that breaks client target card layout.
- [ ] Verify target labels wrap without overlap from 390px through 1280px.
- [ ] Remove redundant save affordances where the same command remains visible.

### Task 7: Establish Reproducible Quality Gates

**Files:** `eslint.config.js`, `package.json`, `package-lock.json`, `tests/api-smoke.test.mjs`, `.github/workflows/quality.yml`, `.gitignore`

- [ ] Add browser and Node ESLint scopes with correct globals.
- [ ] Fix lint errors without weakening meaningful rules.
- [ ] Add `typecheck`, `test`, `verify:content`, and aggregate `check` scripts plus Node engine constraints.
- [ ] Cover health, public data, unauthorized admin, and client status APIs.
- [ ] Track required sources while ignoring mutable databases, backups, uploads, builds, reports, keys, and temporary fixtures.
- [ ] Add CI that runs `npm ci` and `npm run check` on Node 22.

### Task 8: Match Production Deployment To Runtime Architecture

**Files:** `Dockerfile`, `.dockerignore`, `README.md`, `server/admin-server.mjs`

- [ ] Add liveness and database-readiness endpoints.
- [ ] Build the frontend and run the full Node server as a non-root final image with a persisted data volume.
- [ ] Document Node 22+, data paths, backup/export/reset, reverse proxy, and client releases.
- [ ] Remove pure-static deployment and stale count claims.
- [ ] Run local server smoke and Docker probes when Docker is available.

### Task 9: Full Release Candidate Verification

**Files:** Review all files changed by Tasks 1-8.

- [ ] Run `npm run check` and retain exact evidence.
- [ ] Probe public/admin/export/reset-impact/client-status/health endpoints on an unused port.
- [ ] Verify reset and restore using temporary database copies.
- [ ] Test desktop, tablet, and mobile public workflows in a real browser.
- [ ] Test admin client cards, custom escaping, reset confirmation, and responsive behavior.
- [ ] Check browser console/network errors and production bundle sizes.
- [ ] Confirm no temporary servers, screenshots, credentials, or test databases remain.
- [ ] Audit every acceptance criterion in the production-readiness design.

