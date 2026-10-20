'use strict';
/* ช่องทางสื่อสาร (IPC) ระหว่างหน้าจอกับโปรเซสหลัก
 * ทุกตัวตรวจว่าผู้เรียกเป็นหน้าของแอปเอง (app://photobooth/) และตรวจอาร์กิวเมนต์ก่อนทำงาน */
const fs = require('fs');
const path = require('path');
const capture = require('./capture');
const printing = require('./printing');

const ORIGIN = 'app://photobooth/';

function cleanSegment(name, fallback) {
  let out = '';
  for (const ch of String(name == null ? '' : name)) {
    out += (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.indexOf(ch) >= 0) ? '' : ch;
  }
  out = out.trim().replace(/^\.+/, '').slice(0, 80).trim();
  return out || fallback;
}

function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext);
  let p = path.join(dir, name), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, base + '_' + (i++) + ext);
  return p;
}

function isScriptUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && x.hostname === 'script.google.com';
  } catch (e) { return false; }
}

// ctx = { ipcMain, app, dialog, shell, BrowserWindow, getWindow, fetch? }
function register(ctx) {
  const { ipcMain, app, dialog, shell } = ctx;
  const doFetch = ctx.fetch || ((...a) => fetch(...a));

  function guard(fn) {
    return async (event, ...args) => {
      const url = (event && event.senderFrame && event.senderFrame.url) || '';
      if (url.indexOf(ORIGIN) !== 0) throw new Error('คำขอไม่ได้รับอนุญาต');
      return fn(...args);
    };
  }
  const handle = (channel, fn) => ipcMain.handle(channel, guard(fn));

  const picturesBase = () => path.join(app.getPath('pictures'), 'PhotoBooth');

  handle('pb:info', async () => ({
    platform: process.platform, arch: process.arch, version: app.getVersion(), defaultSaveDir: picturesBase()
  }));

  // ส่งคำขอไป Apps Script (จำกัดเฉพาะ script.google.com)
  handle('pb:http', async (method, url, body) => {
    if (method !== 'GET' && method !== 'POST') throw new Error('วิธีเรียกไม่ถูกต้อง');
    if (!isScriptUrl(url)) throw new Error('อนุญาตเฉพาะ https://script.google.com');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const init = { method, redirect: 'follow', signal: ctrl.signal };
      if (method === 'POST') { init.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; init.body = String(body || ''); }
      const res = await doFetch(String(url), init);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('หมดเวลารอการตอบกลับ');
      throw e;
    } finally { clearTimeout(timer); }
  });

  handle('pb:print', async (req) => {
    if (!req || typeof req.data !== 'string') throw new Error('ข้อมูลพิมพ์ไม่ถูกต้อง');
    return printing.printImage(req, { BrowserWindow: ctx.BrowserWindow });
  });

  handle('pb:listPrinters', async () => {
    const win = ctx.getWindow && ctx.getWindow();
    if (!win) return [];
    const list = await win.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
  });

  handle('pb:saveImage', async (req) => {
    if (!req || typeof req.data !== 'string') throw new Error('ข้อมูลรูปไม่ถูกต้อง');
    const buf = Buffer.from(req.data, 'base64');
    if (!capture.imageType(buf)) throw new Error('ไฟล์ไม่ใช่รูป JPEG/PNG');
    let base = String(req.dir || '').trim();
    if (base && !path.isAbsolute(base)) throw new Error('ต้องระบุโฟลเดอร์เป็น path เต็ม');
    if (!base) base = picturesBase();
    const dir = path.join(base, cleanSegment(req.sub, 'Event'));
    fs.mkdirSync(dir, { recursive: true });
    const file = uniquePath(dir, cleanSegment(path.basename(String(req.name || '')), 'photo.jpg'));
    fs.writeFileSync(file, buf);
    return { ok: true, path: file };
  });

  handle('pb:pickFolder', async () => {
    const win = ctx.getWindow && ctx.getWindow();
    const r = await dialog.showOpenDialog(win || undefined, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths || !r.filePaths.length ? '' : r.filePaths[0];
  });

  handle('pb:openFolder', async (dir) => {
    let d = String(dir || '').trim() || picturesBase();
    if (!path.isAbsolute(d)) return { error: 'ต้องเป็น path เต็ม' };
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* ignore */ }
    const err = await shell.openPath(d);
    return err ? { error: err } : { ok: true };
  });

  handle('pb:tether', async (config) => {
    if (!config || typeof config !== 'object') throw new Error('ตั้งค่ากล้องไม่ถูกต้อง');
    const r = await capture.capture({
      mode: config.mode, command: String(config.command || ''), folder: String(config.folder || ''), timeoutSec: Number(config.timeoutSec)
    });
    return { data: r.data, width: r.width, height: r.height, type: r.type, ms: r.ms };
  });

  handle('pb:fullscreen', async (value) => {
    const win = ctx.getWindow && ctx.getWindow();
    if (!win) return false;
    const want = value === 'toggle' ? !win.isFullScreen() : !!value;
    win.setFullScreen(want);
    return want;
  });

  handle('pb:quit', async () => { app.quit(); return true; });
}

module.exports = { register, ORIGIN, isScriptUrl, cleanSegment };
