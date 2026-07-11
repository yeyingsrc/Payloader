import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const defaultSeedPath = fileURLToPath(new URL('../server/default-seed.sqlite', import.meta.url));

const uniqueModuleUrl = (path, label) => (
  new URL(`${path}?data-safety=${encodeURIComponent(`${label}-${Date.now()}-${Math.random()}`)}`, import.meta.url).href
);

const importStore = async ({ dataDir, seedPath = defaultSeedPath, label }) => {
  process.env.PAYLOADER_DATA_DIR = dataDir;
  process.env.PAYLOADER_SEED_DB = seedPath;
  return import(uniqueModuleUrl('../server/data-store.mjs', label));
};

const makeTempDataDir = async label => {
  const root = await mkdtemp(join(tmpdir(), `payloader-${label}-`));
  return { root, dataDir: join(root, 'data') };
};

const fileExists = async path => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const isInvalidTargetError = error => error?.status === 400 && /target/i.test(error.message);

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

test('database initialization is shared until seed and migrations complete', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('init-race');
  const store = await importStore({ ...temp, label: 'init-race' });
  t.after(async () => {
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  const defaults = await store.loadDefaultData();
  const [publicData, adminPayloads, settings] = await Promise.all([
    store.getPublicData(),
    store.listAdminItems('payloads'),
    store.getSettings(),
    store.getMetadataValue('seeded'),
  ]);

  assert.equal(adminPayloads.length, defaults.payloads.length);
  assert.ok(publicData.payloads.length > 0);
  assert.equal(settings.siteTitle.zh, 'PAYLOADER');
  assert.equal(await store.getMetadataValue('seeded'), '1');
});

test('failed database initialization closes the candidate and can be retried', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('init-retry');
  const missingSeedPath = join(temp.root, 'seed', 'default-seed.sqlite');
  const store = await importStore({ ...temp, seedPath: missingSeedPath, label: 'init-retry' });
  t.after(async () => {
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  await assert.rejects(store.getPublicData(), /Default seed database not found/);

  await mkdir(dirname(missingSeedPath), { recursive: true });
  await copyFile(defaultSeedPath, missingSeedPath);
  const payloads = await store.listAdminItems('payloads');

  assert.ok(payloads.length > 0);
  assert.equal(await store.getMetadataValue('seeded'), '1');
});

test('closeStore invalidates an in-flight initializer before it can publish the database', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('init-close-race');
  const store = await importStore({ ...temp, label: 'init-close-race' });
  const publishReached = deferred();
  const releasePublish = deferred();
  t.after(async () => {
    store.setStoreTestHooks(null);
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  store.setStoreTestHooks({
    beforeInitializationPublish: async () => {
      publishReached.resolve();
      await releasePublish.promise;
    },
  });
  const firstInitialization = store.ensureStoreReady();
  await publishReached.promise;

  store.closeStore();
  releasePublish.resolve();

  await assert.rejects(
    firstInitialization,
    error => error?.code === 'ERR_STORE_INITIALIZATION_CANCELLED',
  );
  store.setStoreTestHooks(null);
  assert.equal(await store.ensureStoreReady(), true);
});

test('reset impact is read-only and reset creates a restorable WAL-safe backup', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('reset-backup');
  const store = await importStore({ ...temp, label: 'reset-backup' });
  t.after(async () => {
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  const defaults = await store.loadDefaultData();
  const customPayload = {
    id: 'custom-before-reset',
    name: { zh: '重置前自定义项', en: 'Custom item before reset' },
    description: { zh: '用于验证重置备份', en: 'Used to verify reset backups' },
    category: { zh: '测试', en: 'Test' },
    execution: [],
  };
  await store.saveAdminItem('payloads', customPayload);

  const impact = await store.getResetImpact('payloads');
  assert.equal(impact.target, 'payloads');
  assert.deepEqual(impact.affected, ['payloads']);
  assert.equal(impact.before.payloads, defaults.payloads.length + 1);
  assert.equal(impact.seed.payloads, defaults.payloads.length);
  assert.equal(impact.delta.payloads, -1);
  assert.equal(impact.changes.payloads.removed, 1);
  assert.ok((await store.listAdminItems('payloads')).some(item => item.id === customPayload.id));

  const exported = await store.createDataExportPackage();
  assert.equal(exported.format, 'payloader.export.v1');
  assert.ok(exported.data.payloads.some(item => item.id === customPayload.id));
  assert.equal(exported.summary.payloads, defaults.payloads.length + 1);

  await assert.rejects(
    store.getResetImpact('../all'),
    error => error?.status === 400 && /target/i.test(error.message),
  );

  const reset = await store.resetDefaultData('payloads');
  assert.equal(reset.impact.target, 'payloads');
  assert.deepEqual(reset.before, impact.before);
  assert.deepEqual(reset.seed, impact.seed);
  assert.deepEqual(reset.delta, impact.delta);
  assert.ok(reset.data && Array.isArray(reset.data.payloads));
  assert.equal(reset.backup.integrity, 'ok');
  assert.ok(['node:sqlite.backup', 'checkpoint-vacuum-into'].includes(reset.backup.method));
  assert.equal(isAbsolute(reset.backup.path), false);
  assert.match(reset.backup.fileName, /^payloader-before-reset-payloads-[a-zA-Z0-9-]+\.sqlite$/);

  const backupPath = resolve(temp.dataDir, reset.backup.path);
  const backupRelativePath = relative(resolve(temp.dataDir, 'backups'), backupPath);
  assert.ok(backupRelativePath && !backupRelativePath.startsWith('..') && !isAbsolute(backupRelativePath));
  assert.equal(await fileExists(backupPath), true);
  assert.ok(store.loadContentDataFromDatabase(backupPath).payloads.some(item => item.id === customPayload.id));
  assert.ok(!(await store.listAdminItems('payloads')).some(item => item.id === customPayload.id));
});

test('reset targets require an exact supported string for direct calls', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('reset-targets');
  const store = await importStore({ ...temp, label: 'reset-targets' });
  t.after(async () => {
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  const invalidTargets = [undefined, null, '', ['all'], { target: 'all' }];
  for (const target of invalidTargets) {
    await assert.rejects(store.getResetImpact(target), isInvalidTargetError);
  }
  for (const target of invalidTargets) {
    assert.throws(() => store.resetDefaultData(target), isInvalidTargetError);
  }
});

test('reset leaves all content untouched when the pre-reset backup fails', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('backup-failure');
  const store = await importStore({ ...temp, label: 'backup-failure' });
  t.after(async () => {
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  await store.ensureStoreReady();
  await store.saveAdminItem('payloads', {
    id: 'must-survive-backup-failure',
    name: 'Must survive backup failure',
    description: 'Backup failure regression item',
    category: 'Test',
    execution: [],
  });
  await writeFile(join(temp.dataDir, 'backups'), 'not a directory', { flag: 'wx' });

  const readCounts = async () => ({
    payloads: (await store.listAdminItems('payloads')).length,
    tools: (await store.listAdminItems('tools')).length,
    navigation: (await store.listAdminItems('navigation')).length,
  });
  const before = await readCounts();

  await assert.rejects(store.resetDefaultData('all'));

  assert.deepEqual(await readCounts(), before);
  assert.ok((await store.listAdminItems('payloads')).some(item => item.id === 'must-survive-backup-failure'));
});

test('writes queue behind the complete reset backup and mutation transaction', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('reset-mutation-queue');
  const store = await importStore({ ...temp, label: 'reset-mutation-queue' });
  const backupReached = deferred();
  const releaseBackup = deferred();
  t.after(async () => {
    store.setStoreTestHooks(null);
    store.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  await store.ensureStoreReady();
  store.setStoreTestHooks({
    beforeResetBackup: async () => {
      backupReached.resolve();
      await releaseBackup.promise;
    },
  });

  const resetPromise = store.resetDefaultData('payloads');
  await backupReached.promise;
  let saveSettled = false;
  const savePromise = store.saveAdminItem('payloads', {
    id: 'queued-during-reset',
    name: 'Queued during reset',
    description: 'Must be written after reset completes',
    category: 'Test',
    execution: [],
  }).finally(() => {
    saveSettled = true;
  });
  await new Promise(resolveImmediate => setImmediate(resolveImmediate));
  assert.equal(saveSettled, false);

  releaseBackup.resolve();
  const reset = await resetPromise;
  await savePromise;

  const backupPath = resolve(temp.dataDir, reset.backup.path);
  assert.ok(!store.loadContentDataFromDatabase(backupPath).payloads.some(item => item.id === 'queued-during-reset'));
  assert.ok((await store.listAdminItems('payloads')).some(item => item.id === 'queued-during-reset'));
});

test('body decoding and health, readiness, and authenticated safety APIs honor boundaries', { concurrency: false }, async t => {
  const temp = await makeTempDataDir('admin-api');
  const missingSeedPath = join(temp.root, 'seed', 'default-seed.sqlite');
  process.env.PAYLOADER_DATA_DIR = temp.dataDir;
  process.env.PAYLOADER_SEED_DB = missingSeedPath;
  process.env.PAYLOADER_ADMIN_USER = 'data-safety-admin';
  process.env.PAYLOADER_ADMIN_PASSWORD = 'data-safety-password';
  process.env.PAYLOADER_PORT = '0';

  const admin = await import(uniqueModuleUrl('../server/admin-server.mjs', 'admin-api'));
  const canonicalStore = await import('../server/data-store.mjs');
  const server = admin.createAdminServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  t.after(async () => {
    await new Promise(resolveClose => server.close(resolveClose));
    canonicalStore.closeStore();
    await rm(temp.root, { recursive: true, force: true });
  });

  const utf8Body = Buffer.from('{"message":"你好，Payloader 🙂"}', 'utf8');
  const splitAt = Buffer.from('{"message":"你', 'utf8').length - 1;
  const request = Readable.from([utf8Body.subarray(0, splitAt), utf8Body.subarray(splitAt)]);
  request.headers = {};
  assert.equal(await admin.readBody(request), utf8Body.toString('utf8'));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const runtimeDbPath = join(temp.dataDir, 'payloader.sqlite');
  assert.equal(await fileExists(runtimeDbPath), false);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal(await fileExists(runtimeDbPath), false);

  const unavailable = await fetch(`${baseUrl}/api/ready`);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).status, 'not_ready');

  await mkdir(dirname(missingSeedPath), { recursive: true });
  await copyFile(defaultSeedPath, missingSeedPath);
  const ready = await fetch(`${baseUrl}/api/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).status, 'ready');

  const unauthorizedExport = await fetch(`${baseUrl}/api/admin/export`);
  assert.equal(unauthorizedExport.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'data-safety-admin', password: 'data-safety-password' }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];

  const exportResponse = await fetch(`${baseUrl}/api/admin/export`, { headers: { cookie } });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-disposition'), /^attachment; filename="payloader-export-/);
  assert.equal((await exportResponse.json()).format, 'payloader.export.v1');

  const impactResponse = await fetch(`${baseUrl}/api/admin/reset-impact?target=payloads`, { headers: { cookie } });
  assert.equal(impactResponse.status, 200);
  assert.equal((await impactResponse.json()).target, 'payloads');

  const invalidImpact = await fetch(`${baseUrl}/api/admin/reset-impact?target=..%2Fall`, { headers: { cookie } });
  assert.equal(invalidImpact.status, 400);

  const missingImpact = await fetch(`${baseUrl}/api/admin/reset-impact`, { headers: { cookie } });
  assert.equal(missingImpact.status, 400);

  const emptyImpact = await fetch(`${baseUrl}/api/admin/reset-impact?target=`, { headers: { cookie } });
  assert.equal(emptyImpact.status, 400);

  const invalidReset = await fetch(`${baseUrl}/api/admin/reset-defaults`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-payloader-csrf': session.csrfToken,
    },
    body: JSON.stringify({ target: '../all' }),
  });
  assert.equal(invalidReset.status, 400);

  for (const body of [{}, { target: '' }, { target: ['all'] }]) {
    const response = await fetch(`${baseUrl}/api/admin/reset-defaults`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-payloader-csrf': session.csrfToken,
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
});

test('readBody destroys requests rejected by the Content-Length preflight', { concurrency: false }, async () => {
  const admin = await import(uniqueModuleUrl('../server/admin-server.mjs', 'body-preflight'));
  let destroyed = false;
  const request = {
    headers: { 'content-length': '101' },
    destroy: () => {
      destroyed = true;
    },
  };

  await assert.rejects(
    admin.readBody(request, 100),
    error => error?.status === 413,
  );
  assert.equal(destroyed, true);
});
