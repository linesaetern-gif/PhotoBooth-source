'use strict';
/* พิมพ์รูปจากโปรเซสหลักของ Electron — พิมพ์เงียบได้ เลือกเครื่องพิมพ์/ขนาดกระดาษ/จำนวนได้ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { imageSize } = require('./capture');

const IN = 25400; // 1 นิ้ว = 25400 ไมครอน
// ขนาดกระดาษแนวตั้ง (กว้าง × ยาว) หน่วยไมครอน
const PAPERS = {
  '4x6': { width: 4 * IN, height: 6 * IN },
  '5x7': { width: 5 * IN, height: 7 * IN },
  '6x8': { width: 6 * IN, height: 8 * IN },
  A4: { width: 210000, height: 297000 }
};

function buildHtml(imgName) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{margin:0}html,body{margin:0;padding:0;width:100%;height:100%;background:#fff}' +
    'img{display:block;width:100%;height:100%;object-fit:contain}' +
    '</style></head><body><img src="' + imgName + '"></body></html>';
}

// สร้างตัวเลือกให้ webContents.print()
function buildPrintOptions(req, dims) {
  const o = {
    silent: !!req.silent,
    printBackground: true,
    margins: { marginType: 'none' },
    copies: Math.min(10, Math.max(1, Math.round(Number(req.copies) || 1)))
  };
  if (req.printer) o.deviceName = String(req.printer);
  const paper = PAPERS[req.paper];
  if (paper) {
    o.pageSize = { width: paper.width, height: paper.height };   // แนวตั้งเสมอ แล้วใช้ landscape พลิกให้ภาพแนวนอน
    if (dims && dims.width > dims.height) o.landscape = true;
  }
  return o;
}

// deps = { BrowserWindow, tmpDir? }
async function printImage(req, deps) {
  const buf = Buffer.from(String(req.data || ''), 'base64');
  const dims = imageSize(buf);
  if (!dims) throw new Error('ไฟล์รูปที่จะพิมพ์ไม่ถูกต้อง');
  const dir = (deps && deps.tmpDir) || path.join(os.tmpdir(), 'photobooth-print');
  fs.mkdirSync(dir, { recursive: true });
  const base = 'print_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  const imgFile = path.join(dir, base + (dims.type === 'png' ? '.png' : '.jpg'));
  const htmlFile = path.join(dir, base + '.html');
  fs.writeFileSync(imgFile, buf);
  fs.writeFileSync(htmlFile, buildHtml(path.basename(imgFile)));

  const win = new deps.BrowserWindow({
    show: false, width: 900, height: 1300,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
  });
  const cleanup = () => {
    try { if (!win.isDestroyed()) win.destroy(); } catch (e) { /* ignore */ }
    for (const f of [imgFile, htmlFile]) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  };
  try {
    await win.loadFile(htmlFile);
    const options = buildPrintOptions(req, dims);
    await new Promise((resolve, reject) => {
      win.webContents.print(options, (ok, reason) => {
        if (ok) resolve(); else reject(new Error(reason && reason !== 'cancelled' ? 'พิมพ์ไม่สำเร็จ: ' + reason : (reason === 'cancelled' ? 'ยกเลิกการพิมพ์' : 'พิมพ์ไม่สำเร็จ')));
      });
    });
  } finally {
    // เผื่อเวลาให้ตัวจัดคิวพิมพ์อ่านไฟล์เสร็จก่อนลบ
    const t = setTimeout(cleanup, 15000);
    if (t.unref) t.unref();
  }
}

module.exports = { PAPERS, buildHtml, buildPrintOptions, printImage };
