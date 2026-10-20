const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const printing = require('../src/printing');

const JPG = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.jpg')); // 96x64 แนวนอน
const B64 = JPG.toString('base64');

function fakeWindowClass(log, outcome) {
  return function FakeWindow(opts) {
    log.opts = opts;
    this.webContents = { print: (o, cb) => { log.print = o; setImmediate(() => cb(outcome.ok, outcome.reason)); } };
    this.loadFile = async (f) => { log.file = f; log.html = fs.readFileSync(f, 'utf8'); log.imgExists = fs.existsSync(path.join(path.dirname(f), /src="([^"]+)"/.exec(log.html)[1])); };
    this.isDestroyed = () => false;
    this.destroy = () => { log.destroyed = true; };
  };
}

test('buildPrintOptions: พิมพ์เงียบ เครื่องพิมพ์ จำนวน กระดาษ 4x6 และพลิกแนวนอน', () => {
  const o = printing.buildPrintOptions({ silent: true, printer: 'DNP_DS620', paper: '4x6', copies: 3 }, { width: 1800, height: 1200 });
  assert.equal(o.silent, true); assert.equal(o.deviceName, 'DNP_DS620'); assert.equal(o.copies, 3);
  assert.deepEqual(o.pageSize, { width: 101600, height: 152400 });
  assert.equal(o.landscape, true);
  assert.deepEqual(o.margins, { marginType: 'none' });
  const p = printing.buildPrintOptions({ silent: false, paper: '4x6' }, { width: 1200, height: 1800 });
  assert.equal(p.landscape, undefined); assert.equal(p.deviceName, undefined); assert.equal(p.copies, 1);
  const d = printing.buildPrintOptions({ paper: 'driver', copies: 99 }, { width: 1, height: 2 });
  assert.equal(d.pageSize, undefined); assert.equal(d.copies, 10);
  assert.deepEqual(printing.buildPrintOptions({ paper: 'A4' }, { width: 1, height: 2 }).pageSize, { width: 210000, height: 297000 });
  assert.deepEqual(printing.buildPrintOptions({ paper: '5x7' }, { width: 1, height: 2 }).pageSize, { width: 127000, height: 177800 });
  assert.deepEqual(printing.buildPrintOptions({ paper: '6x8' }, { width: 1, height: 2 }).pageSize, { width: 152400, height: 203200 });
});

test('printImage: เขียนไฟล์ชั่วคราว โหลดหน้าพิมพ์แบบไม่รันสคริปต์ แล้วสั่ง print ตามตัวเลือก', async () => {
  const log = {};
  await printing.printImage({ data: B64, silent: true, printer: 'P1', paper: '4x6', copies: 2 },
    { BrowserWindow: fakeWindowClass(log, { ok: true }), tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pbprint-')) });
  assert.equal(log.opts.show, false);
  assert.equal(log.opts.webPreferences.sandbox, true);
  assert.equal(log.opts.webPreferences.nodeIntegration, false);
  assert.equal(log.opts.webPreferences.javascript, false);
  assert.ok(log.imgExists, 'รูปต้องอยู่ข้างไฟล์ HTML');
  assert.match(log.html, /@page\{margin:0\}/);
  assert.equal(log.print.silent, true); assert.equal(log.print.deviceName, 'P1'); assert.equal(log.print.copies, 2);
  assert.equal(log.print.landscape, true); // 96x64 เป็นภาพแนวนอน
});

test('printImage: ยกเลิก / ล้มเหลว / รูปเสีย', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbprint-'));
  await assert.rejects(printing.printImage({ data: B64 }, { BrowserWindow: fakeWindowClass({}, { ok: false, reason: 'cancelled' }), tmpDir: dir }), /ยกเลิกการพิมพ์/);
  await assert.rejects(printing.printImage({ data: B64 }, { BrowserWindow: fakeWindowClass({}, { ok: false, reason: 'Invalid deviceName provided' }), tmpDir: dir }), /Invalid deviceName/);
  await assert.rejects(printing.printImage({ data: 'AAAA' }, { BrowserWindow: fakeWindowClass({}, { ok: true }), tmpDir: dir }), /ไม่ถูกต้อง/);
});
