# Direct Release Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish directly runnable `.exe`, `.AppImage`, and `.dmg` clients in GitHub Releases while preserving the existing injectable official-shell archives.

**Architecture:** Replace the official shell builder's directory-only electron-builder invocation with one real native packaging invocation per target. Reuse its unpacked directory for the shell transport, copy the native package into the Release artifact directory, and generate a SHA256 sidecar. Keep the shell manifest and backend assembly contract unchanged.

**Tech Stack:** Node.js 22, electron-builder, GitHub Actions, Node test runner, PowerShell verification on Windows.

---

### Task 1: Protect Native Release Package Contracts

**Files:**
- Create: `tests/client-shell-release-assets.test.mjs`
- Modify: `tests/production-config.test.mjs`
- Test: `tests/client-shell-release-assets.test.mjs`

- [ ] **Step 1: Write failing tests for canonical package names and package discovery**

Import exported helpers from `scripts/build-client-shells.mjs` and assert these mappings:

```js
assert.equal(nativePackageName('win-x64-nsis', '2.0.0'), 'Payloader-Client-Setup-2.0.0-x64.exe');
assert.equal(nativePackageName('linux-arm64-appimage', '2.0.0'), 'Payloader-Client-2.0.0-arm64.AppImage');
assert.equal(nativePackageName('mac-universal-dmg', '2.0.0'), 'Payloader-Client-2.0.0-universal.dmg');
```

Create a temporary electron output directory and assert `findNativePackage` accepts one root-level native package, ignores unpacked executables, and rejects zero or duplicate packages.

- [ ] **Step 2: Add a failing production configuration contract**

Require the official builder to use each configured native target and reject the directory-only build path:

```js
assert.doesNotMatch(builder, /['"]--dir['"]/);
assert.match(builder, /nativePackageName/);
assert.match(builder, /findNativePackage/);
assert.match(builder, /\.sha256\.txt/);
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```powershell
node --test tests/client-shell-release-assets.test.mjs tests/production-config.test.mjs
```

Expected: FAIL because native package helpers and real package output do not exist yet.

### Task 2: Build Native Packages And Shell Archives Together

**Files:**
- Modify: `scripts/build-client-shells.mjs`
- Modify: `server/client-builder.mjs`
- Test: `tests/client-shell-release-assets.test.mjs`

- [ ] **Step 1: Make the shell builder safely importable by tests**

Guard CLI execution with the existing project pattern:

```js
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
```

- [ ] **Step 2: Add canonical native package helpers**

Export `nativePackageName(targetId, version)` and `findNativePackage(outputDir, targetId)`. Package discovery must inspect only root-level files with the target's expected extension and throw unless exactly one exists.

- [ ] **Step 3: Replace directory-only packaging with the real target**

Build arguments must follow the server builder's established form:

```js
[
  electronBuilderCli,
  `--${config.builderPlatform}`,
  config.builderTarget,
  `--${config.builderArch}`,
  '--publish',
  'never',
]
```

After packaging, locate the unpacked application for shell transport and the root native package for direct release download.

- [ ] **Step 4: Stage and hash the native package**

Copy the native package to `PAYLOADER_CLIENT_SHELL_OUTPUT_DIR` using the canonical Release name and write `<name>.sha256.txt`. The job must fail before artifact upload if copy, stat, or hashing fails.

- [ ] **Step 5: Use the root application version in Electron metadata**

Change the prepared Electron package from:

```js
version: '1.0.0',
```

to:

```js
version: packageInfo.version,
```

- [ ] **Step 6: Run focused tests and confirm success**

Run:

```powershell
node --test tests/client-shell-release-assets.test.mjs tests/production-config.test.mjs
```

Expected: all focused tests PASS.

### Task 3: Verify Release Staging And Regression Safety

**Files:**
- Modify only if a discovered contract gap requires it: `.github/workflows/client-shells.yml`
- Test: `tests/production-config.test.mjs`

- [ ] **Step 1: Confirm workflow artifact globs retain native files**

The existing `artifacts/client-shells/*` upload and download paths must carry native packages, checksums, shell archives, and manifests through build, merge, and Release jobs. Add a focused assertion if the contract is not already explicit.

- [ ] **Step 2: Run the full local quality gate**

Run:

```powershell
npm run check
```

Expected: attribution, typecheck, lint, 114 codec checks, content checks, all Node tests, and production build PASS.

- [ ] **Step 3: Review the final diff**

Run:

```powershell
git diff --check
git diff --stat
```

Confirm no administrator, database, authentication, frontend, or unrelated files changed.

### Task 4: Publish And Prove Native Release Downloads

**Files:**
- No additional source changes unless remote verification exposes a reproducible defect.

- [ ] **Step 1: Commit and push the exact implementation files**

Stage only the build script, version source, focused tests, workflow contract if changed, and this plan.

- [ ] **Step 2: Run GitHub Client Shells with `release_tag=v2.0.0`**

Wait for Windows, Linux, macOS, merge, and Release jobs to complete successfully.

- [ ] **Step 3: Verify Release assets through the GitHub API**

Require at least one asset ending in each of:

```text
.exe
.AppImage
.dmg
```

Verify all nine canonical native package names and matching SHA256 files are present, non-empty, and attached to the non-draft `v2.0.0` Release.

- [ ] **Step 4: Verify repository and quality state**

Confirm private remote `main` equals local HEAD, the Quality workflow is green, and unrelated untracked user files remain untouched.
