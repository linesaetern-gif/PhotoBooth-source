const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const handlers = require('../src/handlers');
const capture = require('../src/capture');

const FIX = path.join(__dirname, 'fixtures');
const JPG = fs.readFileSync(path.join(FIX, 'sample.jpg'));
const B64 = JPG.toString('base64');
const OK = { senderFrame: { url: 'app://photobooth/index.html' } };

function setup(extra) {
  const pictures = fs.mkdtempSync(path.join(os.tmpdir(), 'pbpics-'));
  const chans = {};
  const ipcMain = { handle: (c, fn) => { chans[c] = fn; } };
  const calls = { quit: 0, opened: [], dialog: 0 };
  const win = { isFullScreen: () => calls.fs, setFullScreen: (v) => { calls.fs = v; }, webContents: { getPrintersAsync: async () => [{ name: 'DNP_DS620', displayName: 'DNP DS620', isDefault: true }, { name: 'PDF' }] } };
  const ctx = Object.assign({
    ipcMain,
    app: { getPath: () => pictures, getVersion: () => '1.2.3', quit: () => { calls.quit++; } },
    dialog: { showOpenDialog: async () => { calls.dialog++; return { canceled: false, filePaths: ['/chosen/dir'] }; } },
    shell: { openPath: async (p) => { calls.opened.push(p); return ''; } },
    BrowserWindow: function () { throw new Error('ไม่ควรสร้างหน้าต่างพิมพ์ในเทสต์นี้'); },
    getWindow: () => win
  }, extra || {});
  handlers.register(ctx);
  return { chans, pictures, calls, call: (c, ...a) => chans[c](OK, ...a) };
}

test('ลงทะเบียนครบทุกช่อง และปฏิเสธผู้เรียกที่ไม่ใช่หน้าของแอป', async () => {
  const h = setup();
  assert.deepEqual(Object.keys(h.chans).sort(), ['pb:fullscreen', 'pb:http', 'pb:info', 'pb:listPrinters', 'pb:openFolder', 'pb:pickFolder', 'pb:print', 'pb:quit', 'pb:saveImage', 'pb:tether']);
  for (const url of ['https://evil.example/', 'file:///etc/x.html', '', 'app://other/index.html']) {
    await assert.rejects(h.chans['pb:quit']({ senderFrame: { url } }), /ไม่ได้รับอนุญาต/);
  }
  await assert.rejects(h.chans['pb:quit']({}), /ไม่ได้รับอนุญาต/);
  assert.equal(h.calls.quit, 0);
  assert.equal(await h.call('pb:quit'), true);
  assert.equal(h.calls.quit, 1);
});

test('pb:info', async () => {
  const h = setup();
  const i = await h.call('pb:info');
  assert.equal(i.version, '1.2.3');
  assert.equal(i.defaultSaveDir, path.join(h.pictures, 'PhotoBooth'));
});

test('pb:http: ยอมเฉพาะ https://script.google.com ส่ง POST แบบ text/plain และตามรีไดเรกต์', async () => {
  const seen = [];
  const h = setup({ fetch: async (url, init) => { seen.push([url, init]); return { ok: true, status: 200, text: async () => '{"ok":true}' }; } });
  const url = 'https://script.google.com/macros/s/AKfy/exec';
  assert.equal(await h.call('pb:http', 'POST', url, '{"a":1}'), '{"ok":true}');
  assert.equal(seen[0][1].method, 'POST');
  assert.equal(seen[0][1].redirect, 'follow');
  assert.equal(seen[0][1].headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(seen[0][1].body, '{"a":1}');
  await h.call('pb:http', 'GET', url + '?token=x');
  assert.equal(seen[1][1].body, undefined);
  for (const bad of ['http://script.google.com/exec', 'https://script.google.com.evil.com/exec', 'https://evil.com/?https://script.google.com/', 'file:///etc/passwd', 'not a url', '']) {
    await assert.rejects(h.call('pb:http', 'GET', bad), /อนุญาตเฉพาะ/, bad);
  }
  await assert.rejects(h.call('pb:http', 'DELETE', url), /วิธีเรียกไม่ถูกต้อง/);
  assert.equal(seen.length, 2, 'คำขอที่ถูกปฏิเสธต้องไม่ถูกส่งออกไป');
});

test('pb:http: HTTP error และเครือข่ายล้ม', async () => {
  const url = 'https://script.google.com/macros/s/AKfy/exec';
  let h = setup({ fetch: async () => ({ ok: false, status: 500, text: async () => '' }) });
  await assert.rejects(h.call('pb:http', 'GET', url), /HTTP 500/);
  h = setup({ fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  await assert.rejects(h.call('pb:http', 'GET', url), /ENOTFOUND/);
});

test('pb:saveImage: เก็บใน รูปภาพ/PhotoBooth/<อีเวนต์>/ ชื่อไม่ซ้ำ ตัดอักขระอันตราย', async () => {
  const h = setup();
  const r = await h.call('pb:saveImage', { data: B64, name: 'photo_1.jpg', sub: 'งานแต่ง: A/B?' });
  assert.equal(r.ok, true);
  assert.equal(r.path, path.join(h.pictures, 'PhotoBooth', 'งานแต่ง AB', 'photo_1.jpg'));
  assert.ok(Buffer.compare(fs.readFileSync(r.path), JPG) === 0);
  const r2 = await h.call('pb:saveImage', { data: B64, name: 'photo_1.jpg', sub: 'งานแต่ง: A/B?' });
  assert.equal(path.basename(r2.path), 'photo_1_1.jpg');
  // พยายามหนีออกนอกโฟลเดอร์
  const r3 = await h.call('pb:saveImage', { data: B64, name: '../../evil.jpg', sub: '../../escape' });
  assert.ok(r3.path.startsWith(path.join(h.pictures, 'PhotoBooth') + path.sep), r3.path);
  assert.equal(path.basename(r3.path), 'evil.jpg');
  // โฟลเดอร์ที่ผู้ใช้เลือกเอง
  const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'pbcustom-'));
  const r4 = await h.call('pb:saveImage', { data: B64, name: 'a.jpg', sub: 'E', dir: custom });
  assert.equal(r4.path, path.join(custom, 'E', 'a.jpg'));
  await assert.rejects(h.call('pb:saveImage', { data: B64, name: 'a.jpg', dir: 'relative/dir' }), /path เต็ม/);
  await assert.rejects(h.call('pb:saveImage', { data: Buffer.from('not an image at all').toString('base64'), name: 'x.jpg' }), /ไม่ใช่รูป/);
  await assert.rejects(h.call('pb:saveImage', {}), /ไม่ถูกต้อง/);
});

test('pb:listPrinters / pickFolder / openFolder / fullscreen', async () => {
  const h = setup();
  assert.deepEqual(await h.call('pb:listPrinters'), [
    { name: 'DNP_DS620', displayName: 'DNP DS620', isDefault: true }, { name: 'PDF', displayName: 'PDF', isDefault: false }]);
  assert.equal(await h.call('pb:pickFolder'), '/chosen/dir');
  assert.deepEqual(await h.call('pb:openFolder', ''), { ok: true });
  assert.equal(h.calls.opened[0], path.join(h.pictures, 'PhotoBooth'));
  assert.deepEqual(await h.call('pb:openFolder', 'relative'), { error: 'ต้องเป็น path เต็ม' });
  assert.equal(await h.call('pb:fullscreen', true), true);
  assert.equal(await h.call('pb:fullscreen', 'toggle'), false);
  assert.equal(await h.call('pb:fullscreen', 'toggle'), true);
});

test('pb:tether: ส่งต่อไปยังตัวสั่งกล้อง และตรวจชนิดข้อมูลเข้า', async () => {
  const h = setup();
  const q = (p) => '"' + p + '"';
  const r = await h.call('pb:tether', { mode: 'command', command: `${q(process.execPath)} ${q(path.join(FIX, 'fakecam.js'))} "{out}"`, timeoutSec: 10 });
  assert.equal(r.width, 96); assert.equal(r.height, 64);
  assert.ok(Buffer.isBuffer(r.data) || r.data instanceof Uint8Array);
  await assert.rejects(h.call('pb:tether', null), /ไม่ถูกต้อง/);
  await assert.rejects(h.call('pb:tether', { mode: 'rm -rf' }), /ยังไม่ได้เปิด/);
});

test('pb:print: ส่งเข้า printing โดยตรวจว่าเป็นรูปจริง', async () => {
  const h = setup();
  await assert.rejects(h.call('pb:print', {}), /ข้อมูลพิมพ์ไม่ถูกต้อง/);
  await assert.rejects(h.call('pb:print', { data: Buffer.from('nope nope nope nope').toString('base64') }), /ไฟล์รูปที่จะพิมพ์ไม่ถูกต้อง/);
});

test('cleanSegment / isScriptUrl', () => {
  assert.equal(handlers.cleanSegment('..hidden', 'x'), 'hidden');
  assert.equal(handlers.cleanSegment('a\\b/c:d', 'x'), 'abcd');
  assert.equal(handlers.cleanSegment('   ', 'fallback'), 'fallback');
  assert.equal(handlers.cleanSegment('x'.repeat(200), 'f').length, 80);
  assert.ok(handlers.isScriptUrl('https://script.google.com/a/macros/org.com/s/ID/exec'));
  assert.ok(!handlers.isScriptUrl('https://script.google.com@evil.com/'));
});
