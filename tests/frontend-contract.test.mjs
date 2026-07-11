import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relativePath => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('encoding tools are loaded on demand from App', async () => {
  const [app, header] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/Header.tsx'),
  ]);

  assert.match(app, /lazy\(\(\)\s*=>\s*import\(['"]\.\/components\/EncodingTools['"]\)\)/);
  assert.match(app, /<Suspense\b/);
  assert.doesNotMatch(header, /import\s+EncodingTools\s+from/);
});

test('public shell exposes skip navigation and a labelled main landmark', async () => {
  const [app, main] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/MainContent.tsx'),
  ]);

  assert.match(app, /href=["']#main-content["']/);
  assert.match(main, /<main\b[^>]*id=["']main-content["']/s);
});

test('sidebar uses an accessible tree with semantic controls', async () => {
  const sidebar = await read('src/components/Sidebar.tsx');

  assert.match(sidebar, /role=["']tree["']/);
  assert.match(sidebar, /role=["']treeitem["']/);
  assert.match(sidebar, /aria-expanded=/);
  assert.match(sidebar, /aria-selected=/);
  assert.match(sidebar, /ArrowDown/);
  assert.match(sidebar, /Home/);
  assert.match(sidebar, /<button\b[^>]*className=.*tree-item/s);
});

test('sidebar search keeps one roving tab stop on the first visible root', async () => {
  const sidebar = await read('src/components/Sidebar.tsx');

  assert.match(sidebar, /firstVisibleRootId/);
  assert.match(sidebar, /isTreeItemVisible/);
  assert.match(sidebar, /isFirst=\{item\.id === firstVisibleRootId\}/);
  assert.doesNotMatch(sidebar, /isFirst=\{index === 0\}/);
});

test('dialogs are labelled, modal, keyboard closable, and focus managed', async () => {
  const [header, syntaxModal] = await Promise.all([
    read('src/components/Header.tsx'),
    read('src/components/SyntaxModal.tsx'),
  ]);

  for (const source of [header, syntaxModal]) {
    assert.match(source, /role=["']dialog["']/);
    assert.match(source, /aria-modal=["']true["']/);
    assert.match(source, /Escape/);
    assert.match(source, /previousFocus|previouslyFocused/);
  }
});

test('encoding dialog close control meets the minimum touch target', async () => {
  const header = await read('src/components/Header.tsx');
  const closeButtonRule = header.match(/\.close-btn\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(closeButtonRule, /width:\s*44px/);
  assert.match(closeButtonRule, /height:\s*44px/);
});

test('mobile search input meets the minimum touch target', async () => {
  const header = await read('src/components/Header.tsx');

  assert.match(header, /\.search-input\s*\{[^}]*height:\s*44px/s);
  assert.doesNotMatch(header, /\.search-input\s*\{[^}]*height:\s*42px/s);
});

test('payload tutorial and WAF states are content driven', async () => {
  const detail = await read('src/components/PayloadDetail.tsx');

  assert.match(detail, /hasSubstantiveTutorial/);
  assert.match(detail, /hasWafContent/);
  assert.match(detail, /hasSubstantiveTutorial\s*&&/);
});

test('download artifacts render before the secondary target matrix', async () => {
  const downloads = await read('src/components/ClientDownloads.tsx');
  const artifactIndex = downloads.indexOf('{grouped.map');
  const matrixIndex = downloads.lastIndexOf('{renderTargetMatrix()}');

  assert.ok(artifactIndex >= 0, 'download artifact list is missing');
  assert.ok(matrixIndex > artifactIndex, 'target matrix must follow available downloads');
  assert.match(downloads, /freshness\?\.isCurrent/);
  assert.match(downloads, /lastBuildFailed/);
  assert.doesNotMatch(downloads, /info\?\.lastFailure/);
});

test('global styles preserve visible keyboard focus', async () => {
  const styles = await read('src/styles/global.css');

  assert.match(styles, /:focus-visible/);
  assert.doesNotMatch(styles, /button\s*\{[^}]*outline\s*:\s*none/s);
});

test('admin custom content is rendered through text-safe DOM APIs', async () => {
  const customModule = await read('admin/custom-module.js');

  assert.match(customModule, /textContent\s*=/);
  assert.match(customModule, /replaceChildren\(/);
  assert.doesNotMatch(customModule, /listEl\.innerHTML\s*=\s*customs\.map/);
});

test('admin client target cards retain their grid contract', async () => {
  const polish = await read('admin/admin-polish.css');

  assert.doesNotMatch(polish, /\[aria-label=["']客户端生成目标矩阵["']\]\s*>\s*\*\s*\{[^}]*display\s*:\s*flex/s);
  assert.match(polish, /client-target-card[^{]*\{[^}]*overflow-wrap|client-target-card[\s\S]*overflow-wrap/);
});

test('admin reset previews impact, creates a backup, and reports its location', async () => {
  const admin = await read('admin/admin.js');

  assert.match(admin, /\/api\/admin\/reset-impact\?target=/);
  assert.match(admin, /impact\.before/);
  assert.match(admin, /impact\.seed/);
  assert.match(admin, /impact\.delta/);
  assert.match(admin, /backup\?\.(?:path|fileName)|backup\.(?:path|fileName)/);
  assert.doesNotMatch(admin, /此操作不可撤销/);
  assert.doesNotMatch(admin, /const renderClientBuildForm =/);
});
