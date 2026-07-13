import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { x as extractTar } from 'tar';

import {
  CLIENT_SHELL_FORMAT,
  acquireClientShellArchive,
  assembleClientShell,
  createClientShellTransport,
  validateClientShellManifest,
  validateShellArchiveEntry,
} from '../server/client-shells.mjs';
import { writeClientDeploymentPackage } from '../server/client-deployment-package.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const makeTemp = label => mkdtemp(join(tmpdir(), `payloader-shell-${label}-`));
const publicData = marker => ({
  payloads: [{ id: marker }],
  tools: [],
  navigation: [],
  toolNavigation: [],
  settings: { logoUrl: '' },
});

const validManifest = entry => ({
  format: CLIENT_SHELL_FORMAT,
  manifestVersion: 1,
  appVersion: '2.0.0',
  generatedAt: '2026-07-13T00:00:00.000Z',
  buildContractVersion: 7,
  deploymentPackageVersion: 1,
  targets: {
    'win-x64-nsis': {
      archive: 'payloader-shell-win-x64.tar.gz',
      platform: 'windows',
      arch: 'x64',
      outputFormat: 'zip',
      signed: false,
      ...entry,
    },
  },
});

test('shell manifest accepts fixed compatible targets and rejects unsafe entries', () => {
  const manifest = validManifest({ size: 12, sha256: 'a'.repeat(64) });
  assert.equal(validateClientShellManifest(manifest).targets['win-x64-nsis'].arch, 'x64');
  assert.throws(
    () => validateClientShellManifest({ ...manifest, targets: { unknown: manifest.targets['win-x64-nsis'] } }),
    /Unknown client shell target/,
  );
  assert.throws(
    () => validateClientShellManifest(validManifest({ archive: '../escape.tar.gz', size: 12, sha256: 'a'.repeat(64) })),
    /Unsafe client shell archive name/,
  );
  assert.throws(
    () => validateClientShellManifest({ ...manifest, buildContractVersion: 6 }),
    /Incompatible client shell build contract/,
  );
  assert.throws(
    () => validateClientShellManifest(manifest, { appVersion: '2.1.0' }),
    /Incompatible client shell application version/,
  );
});

test('archive entry validation rejects traversal, unsafe links, and oversized entries', () => {
  assert.equal(validateShellArchiveEntry({ path: 'Payloader/resources/app.asar', type: 'File', size: 12 }), true);
  assert.equal(validateShellArchiveEntry({
    path: 'Payloader/Framework/Versions/Current',
    linkpath: 'A',
    type: 'SymbolicLink',
    size: 0,
  }), true);
  assert.throws(() => validateShellArchiveEntry({ path: '../escape', type: 'File', size: 1 }), /Unsafe shell archive path/);
  assert.throws(() => validateShellArchiveEntry({ path: 'Payloader/../escape', type: 'File', size: 1 }), /Unsafe shell archive path/);
  assert.throws(() => validateShellArchiveEntry({ path: '/absolute', type: 'File', size: 1 }), /Unsafe shell archive path/);
  assert.throws(() => validateShellArchiveEntry({
    path: 'Payloader/link',
    linkpath: '../../escape',
    type: 'SymbolicLink',
    size: 0,
  }), /escapes the archive root/);
  assert.throws(() => validateShellArchiveEntry({ path: 'Payloader/link', type: 'Link', size: 0 }), /hard links are not allowed/);
  assert.throws(() => validateShellArchiveEntry({ path: 'Payloader/huge', type: 'File', size: 3 * 1024 ** 3 }), /oversized/);
});

test('shell assembly replaces the deployment directory and produces a portable tar archive', async t => {
  const root = await makeTemp('assemble-tar');
  t.after(() => rm(root, { recursive: true, force: true }));
  const shellRoot = join(root, 'shell-root');
  const oldDeployment = join(root, 'old-deployment');
  const newDeployment = join(root, 'new-deployment');
  await writeFile(join(root, 'placeholder'), 'x');
  await writeClientDeploymentPackage({ destination: oldDeployment, publicData: publicData('old') });
  await writeClientDeploymentPackage({ destination: newDeployment, publicData: publicData('new') });
  await createClientShellTransport({
    shellRoot,
    sourceFiles: {
      'payloader': Buffer.from('#!/bin/sh\n'),
      'resources/app.asar': Buffer.from('immutable-code'),
    },
    deploymentPackageDir: oldDeployment,
    destination: join(root, 'shell.tar.gz'),
    platform: 'linux',
  });

  const shellBytes = await readFile(join(root, 'shell.tar.gz'));
  const entry = {
    archive: 'shell.tar.gz',
    platform: 'linux',
    arch: 'x64',
    outputFormat: 'tar.gz',
    signed: false,
    size: shellBytes.length,
    sha256: hash(shellBytes),
  };
  const result = await assembleClientShell({
    shellArchive: join(root, 'shell.tar.gz'),
    shell: entry,
    deploymentPackageDir: newDeployment,
    destination: join(root, 'Payloader-linux-x64.tar.gz'),
    workRoot: root,
  });
  assert.equal(result.outputFormat, 'tar.gz');
  assert.equal(result.sha256.length, 64);

  const inspect = join(root, 'inspect');
  await mkdir(inspect, { recursive: true });
  await extractTar({ file: result.filePath, cwd: inspect });
  const packagedData = JSON.parse(await readFile(join(inspect, 'Payloader', 'deployment.payloader', 'public-data.json'), 'utf8'));
  const code = await readFile(join(inspect, 'Payloader', 'resources', 'app.asar'), 'utf8');
  assert.equal(packagedData.payloads[0].id, 'new');
  assert.equal(code, 'immutable-code');
});

test('Windows shell assembly emits a ZIP without rebuilding the shell', async t => {
  const root = await makeTemp('assemble-zip');
  t.after(() => rm(root, { recursive: true, force: true }));
  const deployment = join(root, 'deployment');
  await writeClientDeploymentPackage({ destination: deployment, publicData: publicData('windows') });
  const transport = join(root, 'shell.tar.gz');
  await createClientShellTransport({
    sourceFiles: { 'Payloader.exe': Buffer.from('MZ-not-a-real-binary') },
    deploymentPackageDir: deployment,
    destination: transport,
    platform: 'windows',
  });
  const bytes = await readFile(transport);
  const result = await assembleClientShell({
    shellArchive: transport,
    shell: {
      archive: 'shell.tar.gz',
      platform: 'windows',
      arch: 'x64',
      outputFormat: 'zip',
      size: bytes.length,
      sha256: hash(bytes),
    },
    deploymentPackageDir: deployment,
    destination: join(root, 'Payloader-windows-x64.zip'),
    workRoot: root,
  });
  const output = await readFile(result.filePath);
  assert.equal(output.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok((await stat(result.filePath)).size > 100);
});

test('remote shell cache coalesces downloads and rejects hash mismatches', async t => {
  const root = await makeTemp('cache');
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from('verified-shell-archive');
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    return new Response(payload, {
      status: 200,
      headers: { 'content-length': String(payload.length) },
    });
  };
  const entry = {
    archive: 'payloader-shell-win-x64.tar.gz',
    size: payload.length,
    sha256: hash(payload),
    assetApiUrl: 'https://api.github.com/repos/example/payloader/releases/assets/1',
  };
  const [first, second] = await Promise.all([
    acquireClientShellArchive(entry, { cacheRoot: root, fetchImpl }),
    acquireClientShellArchive(entry, { cacheRoot: root, fetchImpl }),
  ]);
  assert.equal(first, second);
  assert.equal(requests, 1);

  await assert.rejects(
    acquireClientShellArchive({ ...entry, sha256: 'f'.repeat(64) }, { cacheRoot: join(root, 'bad'), fetchImpl }),
    /hash mismatch/,
  );
});
