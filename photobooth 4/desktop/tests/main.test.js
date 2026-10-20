// โหลด src/main.js กับ electron จำลอง เพื่อเช็กการตั้งค่าความปลอดภัยและตัวเสิร์ฟไฟล์ app://
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const csp = require('../src/csp');

function boot(argv) {
  const rec = { handlers: {}, windows: [], schemes: null, perm: {}, dialogs: [], menu: null, ipc: {} };
  const win = {
    webContents: {
      on: (ev, fn) => { rec['wc:' + ev] = fn; }, setWindowOpenHandler: (fn) => { rec.openHandler = fn; }, toggleDevTools() { rec.devtools = true; },
      getPrintersAsync: async () => []
    },
    setMenuBarVisibility() { }, on() { }, loadURL: (u) => { rec.loaded = u; }, isMinimized: () => false, focus() { }, restore() { },
    isFullScreen: () => false, setFullScreen: (v) => { rec.fullscreen = v; }
  };
  const electron = {
    app: {
      requestSingleInstanceLock: () => true, on: () => { }, whenReady: () => Promise.resolve(), quit: () => { rec.quit = true; },
      getPath: () => '/pics', getVersion: () => '1.0.0'
    },
    BrowserWindow: Object.assign(function (opts) { rec.windows.push(opts); return win; }, { getAllWindows: () => [win] }),
    ipcMain: { handle: (c, fn) => { rec.ipc[c] = fn; } },
    protocol: { registerSchemesAsPrivileged: (s) => { rec.schemes = s; }, handle: (scheme, fn) => { rec.handlers[scheme] = fn; } },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (fn) => { rec.perm.request = fn; },
        setPermissionCheckHandler: (fn) => { rec.perm.check = fn; }
      }
    },
    dialog: { showErrorBox: (...a) => rec.dialogs.push(a), showOpenDialog: async () => ({ canceled: true }) },
    shell: { openPath: async () => '' },
    Menu: { setApplicationMenu: (m) => { rec.menu = m; }, buildFromTemplate: (t) => t },
    powerSaveBlocker: { start: (t) => { rec.psb = t; return 1; } }
  };
  const orig = Module._load;
  const savedArgv = process.argv;
  Module._load = function (request, ...rest) { return request === 'electron' ? electron : orig.call(this, request, ...rest); };
  process.argv = ['node', 'main.js'].concat(argv || []);
  const mainPath = require.resolve('../src/main.js');
  delete require.cache[mainPath];
  try { require(mainPath); } finally { Module._load = orig; process.argv = savedArgv; }
  return rec;
}

const tick = () => new Promise((r) => setImmediate(r));

test('สร้างหน้าต่างด้วยค่าความปลอดภัยที่ถูกต้อง และโหลดหน้า app://', async () => {
  const rec = boot([]);
  await tick();
  assert.deepEqual(rec.schemes[0].privileges, { standard: true, secure: true, supportFetchAPI: true, stream: true });
  const w = rec.windows[0].webPreferences;
  assert.equal(w.contextIsolation, true); assert.equal(w.nodeIntegration, false); assert.equal(w.sandbox, true);
  assert.equal(w.devTools, false);
  assert.ok(w.preload.endsWith(path.join('src', 'preload.js')));
  assert.equal(rec.windows[0].fullscreen, false); assert.equal(rec.windows[0].kiosk, false);
  assert.equal(rec.loaded, 'app://photobooth/index.html');
  assert.deepEqual(rec.openHandler(), { action: 'deny' });
  assert.ok(rec.psb === 'prevent-display-sleep');
  assert.ok(Object.keys(rec.ipc).length >= 10, 'ลงทะเบียน IPC แล้ว');
});

test('อาร์กิวเมนต์ --kiosk / --fullscreen / --dev', async () => {
  let rec = boot(['--kiosk']); await tick();
  assert.equal(rec.windows[0].kiosk, true); assert.equal(rec.windows[0].fullscreen, true);
  rec = boot(['--fullscreen']); await tick();
  assert.equal(rec.windows[0].kiosk, false); assert.equal(rec.windows[0].fullscreen, true);
  rec = boot(['--dev']); await tick();
  assert.equal(rec.windows[0].webPreferences.devTools, true);
});

test('อนุญาตเฉพาะสิทธิ์กล้องของหน้าแอปเอง', async () => {
  const rec = boot([]); await tick();
  const ask = (perm, url) => new Promise((res) => rec.perm.request({}, perm, res, { requestingUrl: url }));
  assert.equal(await ask('media', 'app://photobooth/index.html'), true);
  assert.equal(await ask('media', 'https://evil.example/'), false);
  assert.equal(await ask('geolocation', 'app://photobooth/index.html'), false);
  assert.equal(await ask('notifications', 'app://photobooth/index.html'), false);
  assert.equal(rec.perm.check({}, 'media', 'app://photobooth'), true);
  assert.equal(rec.perm.check({}, 'media', 'https://evil.example'), false);
  assert.equal(rec.perm.check({}, 'clipboard-read', 'app://photobooth'), false);
});

test('ไม่ยอมให้หน้าเว็บนำทางออกนอกแอป', async () => {
  const rec = boot([]); await tick();
  let prevented = 0;
  rec['wc:will-navigate']({ preventDefault: () => prevented++ }, 'https://evil.example/');
  rec['wc:will-navigate']({ preventDefault: () => prevented++ }, 'file:///etc/passwd');
  rec['wc:will-navigate']({ preventDefault: () => prevented++ }, 'app://photobooth/index.html');
  assert.equal(prevented, 2);
  // F11 สลับเต็มจอ
  let pd = 0;
  rec['wc:before-input-event']({ preventDefault: () => pd++ }, { type: 'keyDown', key: 'F11' });
  assert.equal(rec.fullscreen, true); assert.equal(pd, 1);
});

test('app:// เสิร์ฟไฟล์ในโฟลเดอร์ www พร้อม CSP และกัน path traversal', async () => {
  const rec = boot([]); await tick();
  const get = async (u) => rec.handlers.app({ url: u });
  const idx = await get('app://photobooth/index.html');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /text\/html/);
  assert.equal(idx.headers.get('content-security-policy'), csp);
  assert.match(await idx.text(), /<title>Photo Booth<\/title>/);
  assert.match((await get('app://photobooth/')).headers.get('content-type'), /text\/html/);
  assert.match((await get('app://photobooth/js/app.js')).headers.get('content-type'), /javascript/);
  assert.match((await get('app://photobooth/style.css')).headers.get('content-type'), /css/);
  assert.equal((await get('app://photobooth/nope.js')).status, 404);
  for (const bad of ['app://photobooth/../package.json', 'app://photobooth/%2e%2e/package.json', 'app://photobooth/..%2f..%2fetc/passwd', 'app://photobooth/js/../../src/main.js']) {
    const r = await get(bad);
    assert.ok(r.status === 403 || r.status === 404, bad + ' → ' + r.status);
    assert.doesNotMatch(await r.text(), /requestSingleInstanceLock|"photobooth-desktop"/);
  }
});

test('CSP ไม่เปิดช่องให้โหลดสคริปต์/เชื่อมต่อภายนอก', () => {
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval|https?:|\*/);
  assert.match(csp, /connect-src 'self' blob: data:/);
});
