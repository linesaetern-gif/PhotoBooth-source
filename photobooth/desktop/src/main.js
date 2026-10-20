'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, protocol, session, dialog, shell, Menu, powerSaveBlocker } = require('electron');
const CSP = require('./csp');
const handlers = require('./handlers');

// อาร์กิวเมนต์: --kiosk (เต็มจอล็อก) · --fullscreen · --dev (เปิด DevTools ด้วย Ctrl+Shift+I)
const argv = process.argv.slice(1);
const KIOSK = argv.includes('--kiosk');
const FULLSCREEN = KIOSK || argv.includes('--fullscreen');
const DEV = argv.includes('--dev');

// โฟลเดอร์หน้าจอ: ตอนพัฒนาอยู่ที่ desktop/www (คัดลอกจากโปรเจกต์ Android ด้วย npm run sync)
const WWW = path.join(__dirname, '..', 'www');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

function serveFile(request) {
  const url = new URL(request.url);
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(WWW, p));
  if (file !== WWW && file.indexOf(WWW + path.sep) !== 0) return new Response('Forbidden', { status: 403 });
  let data;
  try { data = fs.readFileSync(file); } catch (e) { return new Response('Not found', { status: 404 }); }
  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'no-store'
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#f5f3fc', title: 'Photo Booth',
    autoHideMenuBar: true, fullscreen: FULLSCREEN, kiosk: KIOSK,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: DEV
    }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (url.indexOf(handlers.ORIGIN) !== 0) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (DEV && input.control && input.shift && input.key.toLowerCase() === 'i') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('closed', () => { win = null; });
  win.loadURL(handlers.ORIGIN + 'index.html');
}

app.whenReady().then(() => {
  if (!gotLock) return;
  if (!fs.existsSync(path.join(WWW, 'index.html'))) {
    dialog.showErrorBox('Photo Booth', 'ไม่พบโฟลเดอร์ www — รัน “npm run sync” ก่อนเปิดโปรแกรม\n' + WWW);
    app.quit(); return;
  }
  protocol.handle('app', serveFile);

  // อนุญาตเฉพาะกล้อง (media) และเฉพาะหน้าของแอปเอง
  const ours = (u) => { const s = String(u || ''); return s === 'app://photobooth' || s.indexOf(handlers.ORIGIN) === 0; };
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(permission === 'media' && ours(details && details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === 'media' && ours(origin));

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  handlers.register({ ipcMain, app, dialog, shell, BrowserWindow, getWindow: () => win });
  powerSaveBlocker.start('prevent-display-sleep');
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
