'use strict';

const { app, BrowserWindow, protocol, shell, session } = require('electron');
const { createHash, timingSafeEqual } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { extname, isAbsolute, join, relative, resolve, sep } = require('node:path');

const appRoot = __dirname;
const distRoot = join(appRoot, 'dist');
const appDataRoot = join(appRoot, 'app');
const manifestPath = join(appDataRoot, 'manifest.json');
const publicDataPath = join(appDataRoot, 'public-data.json');
const scheme = 'payloader';
const host = 'app';
const pathSeparator = sep;
const internalOrigin = `${scheme}://${host}`;
const internalUrlPrefix = `${internalOrigin}/`;
const officialProjectUrl = 'https://github.com/3516634930/Payloader';
const protectedXeyeUrl = 'https://xss.icu/';
const protectedXssToolId = 'xss-platform';
const allowedExternalUrls = Object.freeze([officialProjectUrl, protectedXeyeUrl]);
const guardedWebContents = new WeakSet();

protocol.registerSchemesAsPrivileged([
  {
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
      codeCache: true,
    },
  },
]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "img-src 'self' data: blob:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "media-src 'none'",
  "manifest-src 'self'",
  "form-action 'self'",
  `navigate-to 'self' ${allowedExternalUrls.join(' ')}`,
].join('; ');

const baseHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': contentSecurityPolicy,
};

const readText = filePath => readFile(filePath, 'utf8');
const hashText = value => createHash('sha256').update(String(value), 'utf8').digest('hex');
const safeHashEquals = (actual, expected) => {
  const left = Buffer.from(String(actual || ''), 'hex');
  const right = Buffer.from(String(expected || ''), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

const response = (body, options = {}) => new Response(body, {
  status: options.status || 200,
  headers: {
    ...baseHeaders,
    'content-type': options.contentType || 'text/plain; charset=utf-8',
    'cache-control': options.cacheControl || 'no-store',
    ...options.headers,
  },
});

const jsonResponse = value => response(JSON.stringify(value), {
  contentType: 'application/json; charset=utf-8',
});

const isInside = (baseDir, target) => {
  const fromBase = relative(baseDir, target);
  return fromBase && fromBase !== '..' && !fromBase.startsWith(`..${pathSeparator}`) && !isAbsolute(fromBase);
};

const normalizeRoute = pathname => {
  try {
    return decodeURIComponent(pathname || '/');
  } catch {
    return '/';
  }
};

const isInternalAppUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === `${scheme}:` && url.host === host && String(value || '').startsWith(internalUrlPrefix);
  } catch {
    return false;
  }
};

const normalizeAllowedExternalUrl = value => {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search) return '';
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (url.hostname === 'github.com' && pathname === '/3516634930/Payloader' && !url.hash) {
      return officialProjectUrl;
    }
    if (url.hostname === 'xss.icu' && pathname === '/' && !url.hash) {
      return protectedXeyeUrl;
    }
    return '';
  } catch {
    return '';
  }
};

const openAllowedExternalUrl = value => {
  const safeUrl = normalizeAllowedExternalUrl(value);
  if (!safeUrl) return false;
  shell.openExternal(safeUrl).catch(() => {});
  return true;
};

const assertAllowedReferenceList = (items, label) => {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!normalizeAllowedExternalUrl(item)) {
      throw new Error(`Payloader offline snapshot contains blocked ${label}.`);
    }
  }
};

const assertSafeLogoUrl = value => {
  const logoUrl = String(value || '').trim();
  if (!logoUrl) return;
  if (!/^\/uploads\/logo\/logo-[a-zA-Z0-9.-]+\.(png|jpe?g|webp)$/.test(logoUrl)) {
    throw new Error('Payloader offline snapshot contains a blocked logo URL.');
  }
};

const assertOfflineSnapshot = data => {
  if (!data || typeof data !== 'object') {
    throw new Error('Payloader offline snapshot is invalid.');
  }

  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  if (settings.projectUrl !== officialProjectUrl) {
    throw new Error('Payloader offline snapshot project URL integrity check failed.');
  }
  assertSafeLogoUrl(settings.logoUrl);

  for (const payload of Array.isArray(data.payloads) ? data.payloads : []) {
    assertAllowedReferenceList(payload?.references, 'payload reference');
  }

  for (const tool of Array.isArray(data.tools) ? data.tools : []) {
    const externalUrl = String(tool?.externalUrl || '');
    if (externalUrl) {
      if (String(tool?.id || '') !== protectedXssToolId || normalizeAllowedExternalUrl(externalUrl) !== protectedXeyeUrl) {
        throw new Error('Payloader offline snapshot contains a blocked tool external URL.');
      }
    }
    assertAllowedReferenceList(tool?.references, 'tool reference');
  }
};

const guardNavigation = (event, nextUrl) => {
  const targetUrl = typeof nextUrl === 'string' ? nextUrl : event?.url;
  if (isInternalAppUrl(targetUrl)) return;
  event.preventDefault();
};

const guardWebContents = contents => {
  if (!contents || guardedWebContents.has(contents)) return;
  guardedWebContents.add(contents);

  contents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', guardNavigation);
  contents.on('will-frame-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
  contents.on('will-attach-webview', event => {
    event.preventDefault();
  });
  contents.on('did-create-window', childWindow => {
    childWindow.close();
  });
};

const configureOfflineSession = () => {
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isInternalAppUrl(details.url) });
  });
};

let manifest = null;
let publicDataText = null;
let publicDataTextPromise = null;
let publicData = null;
let publicDataPromise = null;
let startupErrorText = '';

// In-memory asset cache — Electron custom-protocol bypasses HTTP disk cache for
// most navigation requests, so we keep buffers in process memory for the lifetime
// of the app. Assets are immutable (Vite content-hashed) so stale-data is not a risk.
const assetCache = new Map();

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const startupErrorPage = () => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payloader 启动失败</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0a0a0f;
      color: #eef2ff;
    }
    main {
      width: min(720px, calc(100vw - 32px));
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-radius: 8px;
      background: #111827;
      padding: 24px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 16px; color: #cbd5e1; line-height: 1.7; }
    pre {
      max-height: 280px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 0;
      padding: 14px;
      border-radius: 8px;
      background: #020617;
      color: #fca5a5;
      font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
    }
  </style>
</head>
<body>
  <main>
    <h1>Payloader 客户端启动失败</h1>
    <p>客户端已拦截外部网络访问。下面是本地离线资源或公开数据快照的加载错误，请重新在后台生成客户端。</p>
    <pre>${escapeHtml(startupErrorText || 'Unknown startup error')}</pre>
  </main>
</body>
</html>`;

const loadManifest = async () => {
  manifest = JSON.parse(await readText(manifestPath));
};

const loadPublicDataText = async () => {
  if (publicDataText) return publicDataText;
  if (publicDataTextPromise) return publicDataTextPromise;
  publicDataTextPromise = (async () => {
    const text = await readText(publicDataPath);
    const expectedHash = String(manifest?.publicDataSha256 || '');
    if (expectedHash && !safeHashEquals(hashText(text), expectedHash)) {
      throw new Error('Payloader offline snapshot hash integrity check failed.');
    }
    publicDataText = text;
    return text;
  })().finally(() => {
    publicDataTextPromise = null;
  });
  return publicDataTextPromise;
};

const loadPublicDataSnapshot = async () => {
  if (publicDataText && publicData) {
    return { text: publicDataText, data: publicData };
  }
  if (publicDataPromise) return publicDataPromise;
  publicDataPromise = (async () => {
    const text = await loadPublicDataText();
    const data = JSON.parse(text);
    assertOfflineSnapshot(data);
    publicData = data;
    return { text, data };
  })().finally(() => {
    publicDataPromise = null;
  });
  return publicDataPromise;
};

const isAdminPath = pathname => (
  pathname === '/admin' ||
  pathname.startsWith('/admin/') ||
  pathname === '/api/admin' ||
  pathname.startsWith('/api/admin/')
);

const safeAssetPath = route => {
  const asset = manifest.routes[route] || (route === '/' ? manifest.routes['/index.html'] : null);
  if (!asset || typeof asset.file !== 'string') return null;
  const target = resolve(appRoot, asset.file);
  const allowed = isInside(distRoot, target) || isInside(appDataRoot, target);
  return allowed ? { ...asset, target } : null;
};

const serveAsset = async asset => {
  let data = assetCache.get(asset.target);
  if (!data) {
    data = await readFile(asset.target);
    assetCache.set(asset.target, data);
  }
  // Vite content-hashed assets (filename contains 8+ hex chars) are immutable.
  const isImmutable = /[.-][0-9a-f]{8,}\.(js|css|woff2?)$/i.test(asset.target);
  return response(data, {
    contentType: asset.mimeType || mimeTypes[extname(asset.target).toLowerCase()] || 'application/octet-stream',
    cacheControl: isImmutable ? 'public, max-age=31536000, immutable' : (asset.cacheControl || 'public, max-age=3600'),
  });
};

const handleProtocol = async request => {
  if (String(request.url || '').length > 4096) {
    return response('URI too long', { status: 414 });
  }

  const url = new URL(request.url);
  if (url.host !== host) {
    return response('Not found', { status: 404 });
  }

  const pathname = normalizeRoute(url.pathname);
  if (startupErrorText && pathname !== '/favicon.ico') {
    return response(startupErrorPage(), {
      status: 500,
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'no-store',
    });
  }

  if (isAdminPath(pathname)) {
    return response('Not found', { status: 404 });
  }

  if (pathname === '/api/public-data') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    try {
      const text = await loadPublicDataText();
      return response(request.method === 'HEAD' ? undefined : text, {
        contentType: 'application/json; charset=utf-8',
      });
    } catch (error) {
      startupErrorText = error && error.stack ? error.stack : String(error || 'Unknown snapshot error');
      return response(startupErrorPage(), {
        status: 500,
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'no-store',
      });
    }
  }

  if (pathname === '/api/custom-tools') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    try {
      const snapshot = await loadPublicDataSnapshot();
      return jsonResponse({
        version: 1,
        categories: snapshot.data.tools.filter(tool => String(tool.id || '').startsWith('custom-')),
      });
    } catch (error) {
      startupErrorText = error && error.stack ? error.stack : String(error || 'Unknown snapshot error');
      return response(startupErrorPage(), {
        status: 500,
        contentType: 'text/html; charset=utf-8',
        cacheControl: 'no-store',
      });
    }
  }

  if (pathname === '/api/client-build') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }
    return jsonResponse({
      available: false,
      latest: null,
      items: [],
      offlineClient: true,
      runtime: 'electron-offline-client',
      distribution: 'packaged-offline-client',
      generatedAt: manifest?.generatedAt || '',
      productName: manifest?.productName || 'Payloader',
      targets: [],
      policies: {
        performance: manifest?.performancePolicy || {},
        security: manifest?.securityPolicy || {},
      },
    });
  }

  if (pathname.startsWith('/api/client-build/download/')) {
    return response('Client build download is available only from the web frontend.', { status: 404 });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return response('Method not allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD' },
    });
  }

  if (pathname === '/favicon.ico') {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  const asset = safeAssetPath(pathname);
  if (asset && existsSync(asset.target)) {
    if (request.method === 'HEAD') {
      return response(undefined, {
        contentType: asset.mimeType || mimeTypes[extname(asset.target).toLowerCase()] || 'application/octet-stream',
        cacheControl: asset.cacheControl || 'public, max-age=3600',
      });
    }
    return serveAsset(asset);
  }

  const indexAsset = !pathname.startsWith('/api/') && !/\.[a-z0-9]{1,12}$/i.test(pathname)
    ? safeAssetPath('/index.html')
    : null;
  if (indexAsset && existsSync(indexAsset.target)) {
    return serveAsset({ ...indexAsset, cacheControl: 'no-store' });
  }

  return response('Not found', { status: 404 });
};

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 390,
    minHeight: 620,
    title: manifest?.productName || 'Payloader',
    backgroundColor: '#0a0a0f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      v8CacheOptions: 'bypassHeatCheck',
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  guardWebContents(win.webContents);

  let shown = false;
  win.once('ready-to-show', () => {
    win.show();
    shown = true;
  });
  // 安全超时：3秒后强制显示
  setTimeout(() => {
    if (!shown) { win.show(); shown = true; }
  }, 3000);

  await win.loadURL(`${scheme}://${host}/`);
};

app.whenReady().then(async () => {
  app.setAppUserModelId('com.payloader.client');
  protocol.handle(scheme, handleProtocol);
  configureOfflineSession();
  app.on('web-contents-created', (_event, contents) => {
    guardWebContents(contents);
  });

  try {
    await loadManifest();
    // Pre-read hashed JS/CSS bundles into assetCache so the renderer gets them from memory
    for (const asset of Object.values(manifest?.routes || {})) {
      if (/[.-][0-9a-f]{8,}\.(js|css)$/i.test(asset.file || '')) {
        const target = join(appRoot, asset.file);
        readFile(target).then(data => assetCache.set(target, data)).catch(() => {});
      }
    }
    void loadPublicDataSnapshot().catch(error => {
      startupErrorText = error && error.stack ? error.stack : String(error || 'Unknown startup error');
    });
  } catch (error) {
    startupErrorText = error && error.stack ? error.stack : String(error || 'Unknown startup error');
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
