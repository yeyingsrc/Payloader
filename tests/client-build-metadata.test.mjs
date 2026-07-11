import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const importBuilder = async (buildRoot, label) => {
  process.env.PAYLOADER_CLIENT_BUILD_ROOT = buildRoot;
  const moduleUrl = new URL('../server/client-builder.mjs', import.meta.url);
  moduleUrl.searchParams.set('client-build-metadata-test', `${label}-${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
};

const makeTempBuildRoot = async label => {
  const root = await mkdtemp(join(tmpdir(), `payloader-client-build-${label}-`));
  return { root, buildRoot: join(root, 'client-builds') };
};

const artifactFileName = 'Payloader-Client-20260711-000000-deadbeef-win-x64-nsis.exe';

const makeSuccess = (builder, overrides = {}) => {
  const { contract } = builder.__clientBuildTest;
  const item = {
    targetId: 'win-x64-nsis',
    platform: 'windows',
    platformLabel: 'Windows',
    arch: 'x64',
    archLabel: 'Intel / AMD 64-bit',
    format: 'Windows Installer',
    fileName: artifactFileName,
    size: 8,
    sha256: 'abc123',
    generatedAt: '2026-07-11T00:00:00.000Z',
    runtime: contract.runtime,
    distribution: contract.distribution,
    buildContractVersion: contract.buildContractVersion,
    mimeType: 'application/vnd.microsoft.portable-executable',
  };
  return {
    id: 'success-build',
    status: 'success',
    message: 'Ready to download 1 client build',
    startedAt: '2026-07-11T00:00:00.000Z',
    finishedAt: '2026-07-11T00:00:10.000Z',
    metadataVersion: contract.metadataVersion,
    runtime: contract.runtime,
    distribution: contract.distribution,
    buildContractVersion: contract.buildContractVersion,
    sourceHash: 'stored-source',
    publicDataHash: 'stored-public-data',
    latest: item,
    items: [item],
    ...overrides,
  };
};

const fileExists = async filePath => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

test('a failed build is persisted separately without replacing the last successful release', { concurrency: false }, async t => {
  const temp = await makeTempBuildRoot('failure');
  const builder = await importBuilder(temp.buildRoot, 'failure-writer');
  t.after(async () => {
    await rm(temp.root, { recursive: true, force: true });
  });

  const success = makeSuccess(builder);
  await mkdir(temp.buildRoot, { recursive: true });
  await writeFile(join(temp.buildRoot, artifactFileName), 'artifact', 'utf8');
  await builder.__clientBuildTest.persistSuccessfulMetadata(success);

  const failure = {
    id: 'failed-build',
    status: 'failed',
    message: 'packaging failed',
    startedAt: '2026-07-11T00:01:00.000Z',
    finishedAt: '2026-07-11T00:01:05.000Z',
    logs: ['stderr: simulated failure'],
  };
  await builder.__clientBuildTest.persistFailureMetadata(failure);

  const latestOnDisk = JSON.parse(await readFile(builder.__clientBuildTest.paths.latestFile, 'utf8'));
  const failureOnDisk = JSON.parse(await readFile(builder.__clientBuildTest.paths.lastFailureFile, 'utf8'));
  assert.equal(latestOnDisk.id, success.id);
  assert.equal(latestOnDisk.status, 'success');
  assert.equal(failureOnDisk.id, failure.id);
  assert.equal((await builder.clientBuildDownload(artifactFileName))?.fileName, artifactFileName);

  const restarted = await importBuilder(temp.buildRoot, 'failure-reader');
  restarted.__clientBuildTest.setFreshnessHashProvider(async () => ({
    sourceHash: success.sourceHash,
    publicDataHash: success.publicDataHash,
  }));
  const status = await restarted.getClientBuildStatus();
  assert.equal(status.active, null);
  assert.equal(status.latest.id, success.id);
  assert.equal(status.lastFailure.id, failure.id);
  assert.deepEqual(status.lastFailure.logs, failure.logs);
  const publicInfo = await restarted.getPublicClientBuildInfo();
  const serializedPublicInfo = JSON.stringify(publicInfo);
  assert.equal(Object.hasOwn(publicInfo, 'lastFailure'), false);
  assert.equal(publicInfo.lastBuildFailed, true);
  assert.equal(serializedPublicInfo.includes(failure.message), false);
  assert.equal(serializedPublicInfo.includes(failure.logs[0]), false);

  const nextSuccess = makeSuccess(restarted, {
    id: 'next-success-build',
    startedAt: '2026-07-11T00:02:00.000Z',
    finishedAt: '2026-07-11T00:02:10.000Z',
  });
  await restarted.__clientBuildTest.persistSuccessfulMetadata(nextSuccess);
  const recoveredStatus = await restarted.getClientBuildStatus();
  assert.equal(recoveredStatus.latest.id, nextSuccess.id);
  assert.equal(recoveredStatus.lastFailure, null);
  assert.equal(await fileExists(restarted.__clientBuildTest.paths.lastFailureFile), false);
  assert.equal((await restarted.getPublicClientBuildInfo()).lastBuildFailed, false);
});

test('freshness classifies frontend and public-data hash mismatches independently', { concurrency: false }, async t => {
  const temp = await makeTempBuildRoot('classification');
  const builder = await importBuilder(temp.buildRoot, 'classification');
  t.after(async () => {
    await rm(temp.root, { recursive: true, force: true });
  });
  const success = makeSuccess(builder);

  const sourceMismatch = builder.__clientBuildTest.evaluateFreshness(
    success,
    { sourceHash: 'current-source', publicDataHash: success.publicDataHash },
    '2026-07-11T01:00:00.000Z',
  );
  assert.deepEqual(sourceMismatch, {
    isCurrent: false,
    sourceCurrent: false,
    publicDataCurrent: true,
    reasons: ['frontend-source-changed'],
    checkedAt: '2026-07-11T01:00:00.000Z',
    currentSourceHash: 'current-source',
    currentPublicDataHash: success.publicDataHash,
  });

  const publicDataMismatch = builder.__clientBuildTest.evaluateFreshness(
    success,
    { sourceHash: success.sourceHash, publicDataHash: 'current-public-data' },
    '2026-07-11T01:01:00.000Z',
  );
  assert.equal(publicDataMismatch.sourceCurrent, true);
  assert.equal(publicDataMismatch.publicDataCurrent, false);
  assert.deepEqual(publicDataMismatch.reasons, ['public-data-changed']);
});

test('current-contract artifacts remain downloadable when freshness is stale', { concurrency: false }, async t => {
  const temp = await makeTempBuildRoot('stale-download');
  const builder = await importBuilder(temp.buildRoot, 'stale-download');
  t.after(async () => {
    await rm(temp.root, { recursive: true, force: true });
  });
  const success = makeSuccess(builder);
  await mkdir(temp.buildRoot, { recursive: true });
  await writeFile(join(temp.buildRoot, artifactFileName), 'artifact', 'utf8');
  await builder.__clientBuildTest.persistSuccessfulMetadata(success);
  builder.__clientBuildTest.setFreshnessHashProvider(async () => ({
    sourceHash: 'changed-source',
    publicDataHash: 'changed-public-data',
  }));

  const [status, publicInfo, download] = await Promise.all([
    builder.getClientBuildStatus(),
    builder.getPublicClientBuildInfo(),
    builder.clientBuildDownload(artifactFileName),
  ]);

  assert.equal(status.latest.status, 'success');
  assert.equal(status.items.length, 1);
  assert.equal(status.freshness.isCurrent, false);
  assert.deepEqual(status.freshness.reasons, ['frontend-source-changed', 'public-data-changed']);
  assert.equal(publicInfo.available, true);
  assert.equal(publicInfo.items.length, 1);
  assert.equal(publicInfo.freshness.isCurrent, false);
  assert.equal(download?.fileName, artifactFileName);
});

test('old-contract and legacy failed latest metadata never enter the download allowlist', { concurrency: false }, async t => {
  const oldContractTemp = await makeTempBuildRoot('old-contract');
  const oldContractBuilder = await importBuilder(oldContractTemp.buildRoot, 'old-contract');
  const oldContractSuccess = makeSuccess(oldContractBuilder, {
    buildContractVersion: oldContractBuilder.__clientBuildTest.contract.buildContractVersion - 1,
  });
  oldContractSuccess.items = oldContractSuccess.items.map(item => ({
    ...item,
    buildContractVersion: oldContractSuccess.buildContractVersion,
  }));
  oldContractSuccess.latest = oldContractSuccess.items[0];
  await mkdir(oldContractTemp.buildRoot, { recursive: true });
  await writeFile(join(oldContractTemp.buildRoot, artifactFileName), 'artifact', 'utf8');
  await oldContractBuilder.__clientBuildTest.persistSuccessfulMetadata(oldContractSuccess);
  oldContractBuilder.__clientBuildTest.setFreshnessHashProvider(async () => ({
    sourceHash: oldContractSuccess.sourceHash,
    publicDataHash: oldContractSuccess.publicDataHash,
  }));

  const oldContractInfo = await oldContractBuilder.getPublicClientBuildInfo();
  assert.equal(oldContractInfo.available, false);
  assert.equal(oldContractInfo.staleLatest.buildContractVersion, oldContractSuccess.buildContractVersion);
  assert.equal(oldContractInfo.freshness.isCurrent, false);
  assert.ok(oldContractInfo.freshness.reasons.includes('build-contract-changed'));
  assert.equal(await oldContractBuilder.clientBuildDownload(artifactFileName), null);

  const legacyFailureTemp = await makeTempBuildRoot('legacy-failure');
  const legacyFailureBuilder = await importBuilder(legacyFailureTemp.buildRoot, 'legacy-failure');
  await mkdir(legacyFailureTemp.buildRoot, { recursive: true });
  await writeFile(legacyFailureBuilder.__clientBuildTest.paths.latestFile, JSON.stringify({
    id: 'legacy-failure',
    status: 'failed',
    message: 'old process failed',
    startedAt: '2026-07-11T02:00:00.000Z',
    finishedAt: '2026-07-11T02:00:01.000Z',
  }), 'utf8');
  legacyFailureBuilder.__clientBuildTest.setFreshnessHashProvider(async () => ({
    sourceHash: 'current-source',
    publicDataHash: 'current-public-data',
  }));
  const legacyStatus = await legacyFailureBuilder.getClientBuildStatus();
  assert.equal(legacyStatus.latest, null);
  assert.equal(legacyStatus.staleLatest, null);
  assert.equal(legacyStatus.lastFailure.id, 'legacy-failure');
  assert.equal(await legacyFailureBuilder.clientBuildDownload('latest'), null);

  t.after(async () => {
    await Promise.all([
      rm(oldContractTemp.root, { recursive: true, force: true }),
      rm(legacyFailureTemp.root, { recursive: true, force: true }),
    ]);
  });
});

test('concurrent status requests share one cached freshness computation', { concurrency: false }, async t => {
  const temp = await makeTempBuildRoot('freshness-cache');
  const builder = await importBuilder(temp.buildRoot, 'freshness-cache');
  t.after(async () => {
    await rm(temp.root, { recursive: true, force: true });
  });
  const success = makeSuccess(builder);
  await mkdir(temp.buildRoot, { recursive: true });
  await writeFile(join(temp.buildRoot, artifactFileName), 'artifact', 'utf8');
  await builder.__clientBuildTest.persistSuccessfulMetadata(success);

  let computations = 0;
  builder.__clientBuildTest.setFreshnessHashProvider(async () => {
    computations += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return {
      sourceHash: success.sourceHash,
      publicDataHash: success.publicDataHash,
    };
  });

  const [first, second, publicInfo] = await Promise.all([
    builder.getClientBuildStatus(),
    builder.getClientBuildStatus(),
    builder.getPublicClientBuildInfo(),
  ]);

  assert.equal(computations, 1);
  assert.equal(first.freshness.isCurrent, true);
  assert.equal(second.freshness.checkedAt, first.freshness.checkedAt);
  assert.equal(publicInfo.freshness.checkedAt, first.freshness.checkedAt);
  assert.equal(await fileExists(builder.__clientBuildTest.paths.lastFailureFile), false);
});

test('persisting a success invalidates freshness cache and the TTL stays within the polling bound', { concurrency: false }, async t => {
  const temp = await makeTempBuildRoot('freshness-invalidation');
  const builder = await importBuilder(temp.buildRoot, 'freshness-invalidation');
  t.after(async () => {
    await rm(temp.root, { recursive: true, force: true });
  });
  const success = makeSuccess(builder);
  await builder.__clientBuildTest.persistSuccessfulMetadata(success);

  let computations = 0;
  builder.__clientBuildTest.setFreshnessHashProvider(async () => {
    computations += 1;
    return {
      sourceHash: success.sourceHash,
      publicDataHash: success.publicDataHash,
    };
  });
  assert.ok(builder.__clientBuildTest.freshnessCacheTtlMs >= 5_000);
  assert.ok(builder.__clientBuildTest.freshnessCacheTtlMs <= 15_000);

  const first = await builder.getClientBuildStatus();
  assert.equal(first.freshness.isCurrent, true);
  assert.equal(computations, 1);

  await builder.__clientBuildTest.persistSuccessfulMetadata({
    ...success,
    message: 'Same release confirmed again',
    finishedAt: '2026-07-11T00:03:00.000Z',
  });
  const second = await builder.getClientBuildStatus();
  assert.equal(second.freshness.isCurrent, true);
  assert.equal(computations, 2);
});

test('admin failed-build rendering reads the independent lastFailure field', async () => {
  const adminSource = await readFile(new URL('../admin/admin.js', import.meta.url), 'utf8');
  const helperSource = adminSource.match(/const clientBuildFailed = \(\) => \{[\s\S]*?\n\};/)?.[0] || '';
  assert.match(helperSource, /state\.clientBuildStatus\?\.lastFailure/);
  assert.doesNotMatch(helperSource, /latest\?\.status === 'failed'/);
});
