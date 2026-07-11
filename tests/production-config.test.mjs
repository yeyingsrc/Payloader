import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readProjectFile = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('package exposes one cross-platform production quality gate on supported Node', async () => {
  const [packageSource, qualityRunner] = await Promise.all([
    readProjectFile('package.json'),
    readProjectFile('scripts/run-quality-gate.mjs'),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.engines?.node, '>=22.13.0');
  assert.match(packageJson.devDependencies?.vite || '', /^\^8\./);
  assert.doesNotMatch(packageJson.devDependencies?.vite || '', /(?:alpha|beta|rc)/i);
  assert.match(packageJson.devDependencies?.['@vitejs/plugin-react'] || '', /^\^(?:5\.(?:[2-9]|\d{2,})|[6-9])\./);
  assert.equal(typeof packageJson.dependencies?.['electron-builder'], 'string');
  assert.equal(typeof packageJson.devDependencies?.electron, 'string');
  for (const script of ['typecheck', 'test', 'verify:codec', 'verify:content', 'check']) {
    assert.equal(typeof packageJson.scripts?.[script], 'string', `missing npm script: ${script}`);
  }
  assert.equal(packageJson.scripts.check, 'node scripts/run-quality-gate.mjs');
  assert.equal(packageJson.scripts.build, 'node scripts/run-production-build.mjs');
  for (const command of Object.values(packageJson.scripts)) {
    assert.doesNotMatch(command, /&&|\|\|/);
  }
  for (const step of ['typecheck', 'lint', 'verify:codec', 'verify:content', 'test', 'build']) {
    assert.match(qualityRunner, new RegExp(`['"]${step.replace(':', '\\:')}['"]`));
  }
  assert.match(qualityRunner, /spawnSync\(process\.execPath/);
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
  assert.doesNotMatch(dockerfile, /COPY --from=builder --chown=node:node/);
  assert.doesNotMatch(dockerfile, /nginx/);
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
  assert.match(workflow, /docker build --tag payloader:ci/);
  assert.match(workflow, /--read-only/);
  assert.match(workflow, /\/tmp:rw,exec,mode=1777/);
  assert.match(workflow, /\/app\/data:rw,uid=1000,gid=1000,mode=0700/);
  assert.match(workflow, /linux-x64-appimage/);
  assert.match(workflow, /smoke-running-server\.mjs/);
  assert.match(dockerignore, /node_modules/);
  assert.match(dockerignore, /data/);
  assert.match(dockerignore, /\.playwright-cli/);
  assert.match(dockerignore, /\*\.bak-\*/);
  assert.match(smokeScript, /\/api\/admin\/reset-impact/);
  assert.match(smokeScript, /\/api\/admin\/client-builds\/generate/);
  assert.match(readme, /Node\.js 22\.13/);
  assert.match(readme, /\/api\/health/);
  assert.match(readme, /\/api\/ready/);
  assert.match(readme, /data\/payloader\.sqlite/);
  assert.match(readme, /data\/backups/);
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
