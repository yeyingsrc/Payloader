import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLIENT_SHELL_MANIFEST_FILE,
  CLIENT_SHELL_TARGETS,
  validateClientShellManifest,
} from '../server/client-shells.mjs';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const inputDirectory = resolve(process.env.PAYLOADER_CLIENT_SHELL_INPUT_DIR || join(rootDir, 'artifacts', 'client-shells'));
const outputDirectory = resolve(process.env.PAYLOADER_CLIENT_SHELL_OUTPUT_DIR || join(rootDir, 'artifacts', 'client-shells-release'));

const files = (await readdir(inputDirectory))
  .filter(name => /^payloader-client-shells-(windows|linux|macos)\.json$/.test(name))
  .sort();
if (files.length !== 3) throw new Error(`Expected three client shell partial manifests, found ${files.length}.`);

const partials = [];
for (const file of files) {
  const manifest = JSON.parse(await readFile(join(inputDirectory, file), 'utf8'));
  validateClientShellManifest(manifest);
  partials.push(manifest);
}

const [first] = partials;
const targets = {};
for (const manifest of partials) {
  for (const key of ['format', 'manifestVersion', 'appVersion', 'buildContractVersion', 'deploymentPackageVersion']) {
    if (manifest[key] !== first[key]) throw new Error(`Client shell partial mismatch: ${key}`);
  }
  for (const [targetId, descriptor] of Object.entries(manifest.targets)) {
    if (targets[targetId]) throw new Error(`Duplicate client shell target: ${targetId}`);
    targets[targetId] = descriptor;
  }
}
const missingTargets = Object.keys(CLIENT_SHELL_TARGETS).filter(targetId => !targets[targetId]);
if (missingTargets.length) throw new Error(`Missing client shell targets: ${missingTargets.join(', ')}`);

const manifest = {
  format: first.format,
  manifestVersion: first.manifestVersion,
  appVersion: first.appVersion,
  generatedAt: new Date().toISOString(),
  buildContractVersion: first.buildContractVersion,
  deploymentPackageVersion: first.deploymentPackageVersion,
  targets,
};
validateClientShellManifest(manifest);
await mkdir(outputDirectory, { recursive: true });
const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const hash = createHash('sha256').update(bytes).digest('hex');
await writeFile(join(outputDirectory, CLIENT_SHELL_MANIFEST_FILE), bytes);
await writeFile(join(outputDirectory, `${CLIENT_SHELL_MANIFEST_FILE}.sha256.txt`), `${hash}  ${CLIENT_SHELL_MANIFEST_FILE}\n`, 'utf8');
process.stdout.write(`${join(outputDirectory, CLIENT_SHELL_MANIFEST_FILE)}\n`);
