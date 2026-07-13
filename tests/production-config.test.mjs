import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('package exposes one cross-platform production quality gate on supported Node', async () => {
  const [packageSource, qualityRunner, performanceRunner, productionBuilder] = await Promise.all([
    readProjectFile('package.json'),
    readProjectFile('scripts/run-quality-gate.mjs'),
    readProjectFile('scripts/run-client-performance-check.mjs'),
    readProjectFile('scripts/run-production-build.mjs'),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.version, '2.0.0');
  assert.equal(typeof packageJson.dependencies?.semver, 'string');
  assert.equal(packageJson.engines?.node, '>=22.13.0');
  assert.match(packageJson.devDependencies?.vite || '', /^\^8\./);
  assert.doesNotMatch(packageJson.devDependencies?.vite || '', /(?:alpha|beta|rc)/i);
  assert.match(packageJson.devDependencies?.['@vitejs/plugin-react'] || '', /^\^(?:5\.(?:[2-9]|\d{2,})|[6-9])\./);
  assert.equal(typeof packageJson.dependencies?.['electron-builder'], 'string');
  assert.equal(typeof packageJson.dependencies?.archiver, 'string');
  assert.equal(typeof packageJson.dependencies?.tar, 'string');
  assert.equal(typeof packageJson.devDependencies?.electron, 'string');
  for (const script of ['typecheck', 'test', 'verify:codec', 'verify:content', 'check']) {
    assert.equal(typeof packageJson.scripts?.[script], 'string', `missing npm script: ${script}`);
  }
  assert.equal(packageJson.scripts.check, 'node scripts/run-quality-gate.mjs');
  assert.equal(packageJson.scripts.build, 'node scripts/run-production-build.mjs');
  assert.equal(packageJson.scripts['verify:attribution'], 'node scripts/verify-project-attribution.mjs');
  assert.equal(packageJson.scripts['verify:client-performance'], 'node scripts/run-client-performance-check.mjs');
  assert.equal(packageJson.scripts['build:client-shells'], 'node scripts/build-client-shells.mjs');
  assert.equal(packageJson.scripts['merge:client-shells'], 'node scripts/merge-client-shell-manifests.mjs');
  for (const command of Object.values(packageJson.scripts)) {
    assert.doesNotMatch(command, /&&|\|\|/);
  }
  for (const step of ['verify:attribution', 'typecheck', 'lint', 'verify:codec', 'verify:content', 'test', 'build']) {
    assert.match(qualityRunner, new RegExp(`['"]${step.replace(':', '\\:')}['"]`));
  }
  assert.match(qualityRunner, /spawnSync\(process\.execPath/);
  assert.match(performanceRunner, /['"]build['"]/);
  assert.match(performanceRunner, /['"]verify:client-performance:runtime['"]/);
  assert.match(productionBuilder, /verifyProjectAttribution/);
  assert.match(productionBuilder, /includeDist:\s*true/);
});

test('official client shells use native runners, smoke native archives, and publish one validated release manifest', async () => {
  const [packageSource, workflow, builder, merger, shellSmoke] = await Promise.all([
    readProjectFile('package.json'),
    readProjectFile('.github/workflows/client-shells.yml'),
    readProjectFile('scripts/build-client-shells.mjs'),
    readProjectFile('scripts/merge-client-shell-manifests.mjs'),
    readProjectFile('scripts/smoke-client-shell.mjs'),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts['verify:client-shell'], 'node scripts/smoke-client-shell.mjs');
  for (const runner of ['windows-latest', 'ubuntu-latest', 'macos-latest']) {
    assert.match(workflow, new RegExp(runner));
  }
  for (const target of [
    'win-x64-nsis',
    'win-arm64-nsis',
    'win-ia32-nsis',
    'linux-x64-appimage',
    'linux-arm64-appimage',
    'linux-armv7l-appimage',
    'mac-x64-dmg',
    'mac-arm64-dmg',
    'mac-universal-dmg',
  ]) {
    assert.match(workflow, new RegExp(target));
  }
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /npm run verify:client-shell/);
  assert.match(workflow, /xvfb-run --auto-servernum npm run verify:client-shell/);
  assert.match(workflow, /npm run merge:client-shells/);
  assert.match(workflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.match(workflow, /gh release upload/);
  assert.match(builder, /createBuildEnvironment\(signingSource, \{ includeSigning: true \}\)/);
  assert.match(builder, /PAYLOADER_SHELL_WINDOWS_/);
  assert.match(builder, /PAYLOADER_SHELL_MACOS_/);
  assert.match(builder, /createClientShellTransport/);
  assert.match(merger, /validateClientShellManifest/);
  assert.match(merger, /missingTargets/);
  assert.match(shellSmoke, /validateClientShellManifest/);
  assert.match(shellSmoke, /PAYLOADER_CLIENT_SHELL_OUTPUT_DIR/);
  assert.match(shellSmoke, /PAYLOADER_CLIENT_PERF_EXECUTABLE/);
  assert.match(shellSmoke, /smoke-client-performance\.mjs/);
  assert.match(shellSmoke, /createHash\(['"]sha256['"]\)/);
  assert.match(shellSmoke, /extractTar/);
});

test('container runs the Node application as a non-root user', async () => {
  const dockerfile = await readProjectFile('Dockerfile');
  assert.match(dockerfile, /FROM node:22(?:\.[0-9]+)*(?:-alpine)?/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /EXPOSE 8081/);
  assert.match(dockerfile, /VOLUME \["\/app\/data"\]/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /\/api\/ready/);
  assert.doesNotMatch(dockerfile, /fetch\('http:\/\/127\.0\.0\.1:8081\/api\/health'/);
  assert.match(dockerfile, /CMD \["node", "server\/admin-server\.mjs"\]/);
  assert.match(dockerfile, /\/app\/node_modules/);
  assert.match(dockerfile, /\/app\/src/);
  assert.match(dockerfile, /\/app\/server/);
  assert.match(dockerfile, /npm prune --omit=dev/);
  assert.match(dockerfile, /ELECTRON_SKIP_BINARY_DOWNLOAD=1/);
  assert.match(dockerfile, /ARG PAYLOADER_COMMIT_SHA/);
  assert.match(dockerfile, /PAYLOADER_COMMIT_SHA=\$PAYLOADER_COMMIT_SHA/);
  assert.doesNotMatch(dockerfile, /COPY --from=builder --chown=node:node/);
  assert.doesNotMatch(dockerfile, /nginx/);
  assert.doesNotMatch(dockerfile, /\bwine\b/i);
  assert.doesNotMatch(dockerfile, /xcode|notarytool/i);
});

test('CI, Docker context, and documentation describe the real runtime', async () => {
  const [workflow, dockerignore, readme, smokeScript] = await Promise.all([
    readProjectFile('.github/workflows/quality.yml'),
    readProjectFile('.dockerignore'),
    readProjectFile('README.md'),
    readProjectFile('scripts/smoke-running-server.mjs'),
  ]);
  assert.match(workflow, /node-version: ['"]22['"]/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /docker build --build-arg PAYLOADER_COMMIT_SHA="\$\{\{ github\.sha \}\}" --tag payloader:ci/);
  assert.match(workflow, /--read-only/);
  assert.match(workflow, /\/tmp:rw,exec,mode=1777/);
  assert.match(workflow, /\/app\/data:rw,uid=1000,gid=1000,mode=0700/);
  assert.match(workflow, /linux-x64-appimage/);
  assert.match(workflow, /smoke-running-server\.mjs/);
  assert.match(workflow, /client-performance:/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /verify:client-performance/);
  assert.match(workflow, /xvfb-run --auto-servernum/);
  assert.match(dockerignore, /node_modules/);
  assert.match(dockerignore, /data/);
  assert.match(dockerignore, /artifacts/);
  assert.match(dockerignore, /output/);
  assert.match(dockerignore, /\.playwright-cli/);
  assert.match(dockerignore, /\*\.bak-\*/);
  assert.match(smokeScript, /\/api\/admin\/reset-impact/);
  assert.match(smokeScript, /\/api\/admin\/client-builds\/generate/);
  assert.match(smokeScript, /\/api\/admin\/version-status/);
  assert.match(smokeScript, /installed\.version/);
  assert.match(readme, /Node\.js 22\.13/);
  assert.match(readme, /\/api\/health/);
  assert.match(readme, /\/api\/ready/);
  assert.match(readme, /data\/payloader\.sqlite/);
  assert.match(readme, /data\/backups/);
  assert.match(readme, /原生性能烟测/);
  assert.match(readme, /windows-latest/);
  assert.match(readme, /ubuntu-latest/);
  assert.match(readme, /macos-latest/);
  assert.match(readme, /系统更新/);
  assert.match(readme, /PAYLOADER_UPDATE_CHECK_INTERVAL_MS/);
  assert.match(readme, /PAYLOADER_GITHUB_TOKEN/);
  assert.match(readme, /PAYLOADER_CLIENT_SHELL_DIR/);
  assert.match(readme, /deployment\.payloader/);
  assert.match(readme, /payloader-client-shells\.json/);
});

test('all mutable server artifacts honor the configured data directory', async () => {
  const [adminServer, clientBuilder] = await Promise.all([
    readProjectFile('server/admin-server.mjs'),
    readProjectFile('server/client-builder.mjs'),
  ]);
  assert.match(adminServer, /const uploadDir = join\(dataDir, 'uploads'\)/);
  assert.match(clientBuilder, /const dataDir = resolve\(process\.env\.PAYLOADER_DATA_DIR \|\| join\(rootDir, 'data'\)\)/);
  assert.match(clientBuilder, /const clientCacheRoot = process\.env\.PAYLOADER_CLIENT_CACHE_DIR/);
  assert.match(clientBuilder, /XDG_CACHE_HOME: join\(clientCacheRoot, 'xdg-cache'\)/);
  assert.match(adminServer, /writeFile\(jwtSecretFile,[\s\S]*?mode:\s*0o600/);
});

test('public metadata does not claim an unconfigured domain or stale inventory', async () => {
  const [indexHtml, appSource, robots] = await Promise.all([
    readProjectFile('index.html'),
    readProjectFile('src/App.tsx'),
    readProjectFile('public/robots.txt'),
  ]);
  assert.doesNotMatch(indexHtml, /payloader\.app/i);
  assert.doesNotMatch(indexHtml, /178\s*(?:个)?Web Payload|129\s*(?:条)?内网|114\s*(?:条)?工具/);
  assert.doesNotMatch(appSource, /178\s*(?:个)?Web Payload|129\s*(?:条)?内网|114\s*(?:条)?工具/);
  assert.doesNotMatch(robots, /^Sitemap:/im);
  assert.match(indexHtml, /安全测试知识与编解码工作台/);
});
