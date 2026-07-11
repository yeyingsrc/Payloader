import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import test from 'node:test';

test('public runtime endpoints and admin boundary are available', async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'payloader-api-smoke-'));
  process.env.PAYLOADER_DATA_DIR = join(tempRoot, 'data');
  process.env.PAYLOADER_CLIENT_BUILD_ROOT = join(tempRoot, 'client-builds');
  process.env.PAYLOADER_CLIENT_TMP_ROOT = join(tempRoot, 'client-tmp');
  process.env.PAYLOADER_ADMIN_USER = 'smoke-admin';
  process.env.PAYLOADER_ADMIN_PASSWORD = 'Smoke-Test-Password-123!';

  const [{ createAdminServer }, { closeStore }] = await Promise.all([
    import(`../server/admin-server.mjs?api-smoke=${Date.now()}`),
    import('../server/data-store.mjs'),
  ]);

  const server = createAdminServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeStore();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const ready = await fetch(`${baseUrl}/api/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });

  const publicData = await fetch(`${baseUrl}/api/public-data`);
  assert.equal(publicData.status, 200);
  const publicPayload = await publicData.json();
  assert.ok(Array.isArray(publicPayload.payloads));
  assert.ok(Array.isArray(publicPayload.tools));
  assert.ok(Array.isArray(publicPayload.navigation));

  const clientBuild = await fetch(`${baseUrl}/api/client-build`);
  assert.equal(clientBuild.status, 200);
  const clientPayload = await clientBuild.json();
  assert.equal(typeof clientPayload.available, 'boolean');
  assert.equal(typeof clientPayload.lastBuildFailed, 'boolean');
  assert.equal('lastFailure' in clientPayload, false);

  const unauthorizedAdmin = await fetch(`${baseUrl}/api/admin/settings`);
  assert.equal(unauthorizedAdmin.status, 401);

  const userAgent = 'payloader-api-smoke';
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': userAgent,
    },
    body: JSON.stringify({
      username: process.env.PAYLOADER_ADMIN_USER,
      password: process.env.PAYLOADER_ADMIN_PASSWORD,
    }),
  });
  assert.equal(login.status, 200);
  const loginPayload = await login.json();
  assert.equal(loginPayload.authenticated, true);
  assert.equal(loginPayload.user, 'smoke-admin');
  assert.equal(typeof loginPayload.csrfToken, 'string');
  assert.ok(loginPayload.csrfToken.length >= 32);
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie?.startsWith('payloader_admin_session='));

  const authenticatedHeaders = {
    cookie,
    'user-agent': userAgent,
    'x-payloader-csrf': loginPayload.csrfToken,
  };
  const exportResponse = await fetch(`${baseUrl}/api/admin/export`, { headers: authenticatedHeaders });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-disposition') || '', /^attachment; filename="payloader-export-/);
  const exportPayload = await exportResponse.json();
  assert.equal(exportPayload.format, 'payloader.export.v1');
  assert.ok(Array.isArray(exportPayload.data.payloads));
  assert.ok(Array.isArray(exportPayload.data.tools));
  assert.ok(Array.isArray(exportPayload.data.navigation));

  const impactResponse = await fetch(`${baseUrl}/api/admin/reset-impact?target=payloads`, { headers: authenticatedHeaders });
  assert.equal(impactResponse.status, 200);
  const impactPayload = await impactResponse.json();
  assert.equal(impactPayload.target, 'payloads');
  assert.ok(impactPayload.before.payloads > 0);
  assert.ok(impactPayload.seed.payloads > 0);
});
