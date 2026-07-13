import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  findNativePackage,
  nativePackageName,
} from '../scripts/build-client-shells.mjs';

test('official shell targets map to canonical native Release package names', () => {
  assert.equal(nativePackageName('win-x64-nsis', '2.0.0'), 'Payloader-Client-Setup-2.0.0-x64.exe');
  assert.equal(nativePackageName('win-arm64-nsis', '2.0.0'), 'Payloader-Client-Setup-2.0.0-arm64.exe');
  assert.equal(nativePackageName('win-ia32-nsis', '2.0.0'), 'Payloader-Client-Setup-2.0.0-ia32.exe');
  assert.equal(nativePackageName('linux-x64-appimage', '2.0.0'), 'Payloader-Client-2.0.0-x64.AppImage');
  assert.equal(nativePackageName('linux-arm64-appimage', '2.0.0'), 'Payloader-Client-2.0.0-arm64.AppImage');
  assert.equal(nativePackageName('linux-armv7l-appimage', '2.0.0'), 'Payloader-Client-2.0.0-armv7l.AppImage');
  assert.equal(nativePackageName('mac-x64-dmg', '2.0.0'), 'Payloader-Client-2.0.0-x64.dmg');
  assert.equal(nativePackageName('mac-arm64-dmg', '2.0.0'), 'Payloader-Client-2.0.0-arm64.dmg');
  assert.equal(nativePackageName('mac-universal-dmg', '2.0.0'), 'Payloader-Client-2.0.0-universal.dmg');
  assert.throws(() => nativePackageName('unknown', '2.0.0'), /Unknown client shell target/);
  assert.throws(() => nativePackageName('win-x64-nsis', 'latest'), /Invalid client version/);
});

test('native package discovery accepts one root package and rejects missing or ambiguous output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'payloader-native-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const unpacked = join(root, 'win-unpacked');
  await mkdir(unpacked, { recursive: true });
  await writeFile(join(unpacked, 'Payloader.exe'), 'unpacked executable');
  const installer = join(root, 'Payloader-Client-Setup-2.0.0-x64.exe');
  await writeFile(installer, 'installer');

  assert.equal(await findNativePackage(root, 'win-x64-nsis'), installer);

  await writeFile(join(root, 'duplicate.exe'), 'duplicate');
  await assert.rejects(
    findNativePackage(root, 'win-x64-nsis'),
    /Expected one root-level .* package, found 2/,
  );

  const empty = await mkdtemp(join(tmpdir(), 'payloader-native-release-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(
    findNativePackage(empty, 'linux-x64-appimage'),
    /Expected one root-level .* package, found 0/,
  );
});
