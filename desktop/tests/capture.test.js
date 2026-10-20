const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cap = require('../src/capture');

const FIX = path.join(__dirname, 'fixtures');
const JPG = fs.readFileSync(path.join(FIX, 'sample.jpg'));
const FAKECAM = path.join(FIX, 'fakecam.js');
const FAKEFAIL = path.join(FIX, 'fakecam_fail.js');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));
const q = (p) => '"' + p + '"';

test('tokenize: ช่องว่าง เครื่องหมายคำพูด และ path แบบ Windows', () => {
  assert.deepEqual(cap.tokenize('gphoto2 --capture-image-and-download --filename "{out}"'), ['gphoto2', '--capture-image-and-download', '--filename', '{out}']);
  assert.deepEqual(cap.tokenize('"C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe" /filename "{out}" /capture'),
    ['C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe', '/filename', '{out}', '/capture']);
  assert.deepEqual(cap.tokenize("a   'b c'   d"), ['a', 'b c', 'd']);
  assert.deepEqual(cap.tokenize('x ""'), ['x', '']);
  assert.deepEqual(cap.tokenize('   '), []);
  assert.throws(() => cap.tokenize('a "b'), /ไม่ครบคู่/);
});

test('expandTokens: แทน {out} {dir} {folder} ทั้งใน token ที่มีข้อความอื่นปนอยู่', () => {
  const t = cap.expandTokens(['--f={out}', '{dir}/x', '{folder}', 'keep{unknown}'], { out: '/a b/o.jpg', dir: '/d', folder: '/f' });
  assert.deepEqual(t, ['--f=/a b/o.jpg', '/d/x', '/f', 'keep{unknown}']);
});

test('ตรวจชนิด ความสมบูรณ์ และขนาดของ JPEG/PNG', () => {
  assert.equal(cap.imageType(JPG), 'jpeg');
  assert.deepEqual(cap.imageSize(JPG), { type: 'jpeg', width: 96, height: 64 });
  assert.ok(cap.isComplete(JPG));
  assert.ok(!cap.isComplete(JPG.slice(0, JPG.length - 40)), 'ไฟล์ที่เขียนไม่ครบต้องไม่ผ่าน');
  const PNG = fs.readFileSync(path.join(FIX, 'sample.png'));
  assert.equal(cap.imageType(PNG), 'png');
  assert.deepEqual(cap.imageSize(PNG), { type: 'png', width: 96, height: 64 });
  assert.ok(cap.isComplete(PNG));
  assert.equal(cap.imageType(Buffer.from('hello world, not an image')), null);
  assert.equal(cap.imageSize(Buffer.from('hello world, not an image')), null);
  // JPEG ที่มีศูนย์ต่อท้าย (บางกล้อง) ยังนับว่าครบ
  assert.ok(cap.isComplete(Buffer.concat([JPG, Buffer.alloc(8)])));
});

test('โหมดคำสั่ง: รันโปรแกรมจริง (path มีช่องว่าง) ได้รูปกลับมาและลบไฟล์ชั่วคราว', async () => {
  const dir = tmp('pb tether ');
  const r = await cap.capture({ mode: 'command', command: `${q(process.execPath)} ${q(FAKECAM)} "{out}" 150`, timeoutSec: 10 }, { tmpDir: dir });
  assert.equal(r.width, 96); assert.equal(r.height, 64); assert.equal(r.type, 'jpeg');
  assert.ok(Buffer.compare(r.data, JPG) === 0);
  assert.deepEqual(fs.readdirSync(dir), [], 'ไฟล์ชั่วคราวต้องถูกลบ');
});

test('โหมดคำสั่ง: โปรแกรมคืนค่า ≠ 0 แต่มีรูปออกมาแล้ว ก็ถือว่าสำเร็จ', async () => {
  const dir = tmp('pbt-');
  const r = await cap.capture({ mode: 'command', command: `${q(process.execPath)} ${q(FAKECAM)} "{out}" 0 3` }, { tmpDir: dir });
  assert.equal(r.width, 96);
});

test('โหมดคำสั่ง: โปรแกรมล้มเหลวและไม่มีรูป → แจ้งข้อความจากโปรแกรม', async () => {
  const dir = tmp('pbt-');
  await assert.rejects(
    cap.capture({ mode: 'command', command: `${q(process.execPath)} ${q(FAKEFAIL)} "{out}"` }, { tmpDir: dir }),
    /No camera found/);
});

test('โหมดคำสั่ง: ไม่พบโปรแกรม / ไม่มี {out} / ไม่ได้ใส่คำสั่ง', async () => {
  const dir = tmp('pbt-');
  await assert.rejects(cap.capture({ mode: 'command', command: '/no/such/program-xyz "{out}"' }, { tmpDir: dir }), /ไม่พบโปรแกรม/);
  await assert.rejects(cap.capture({ mode: 'command', command: 'gphoto2 --capture-image' }, { tmpDir: dir }), /\{out\}/);
  await assert.rejects(cap.capture({ mode: 'command', command: '   ' }, { tmpDir: dir }), /ยังไม่ได้ใส่คำสั่ง/);
  await assert.rejects(cap.capture({ mode: 'off' }, { tmpDir: dir }), /ยังไม่ได้เปิด/);
  await assert.rejects(cap.capture({ mode: 'command', command: 'a "b {out}' }, { tmpDir: dir }), /ไม่ครบคู่/);
});

test('โหมดคำสั่ง: ไฟล์ที่ได้ไม่ใช่รูป / กล้องเซฟเป็น RAW → แจ้งให้ตั้งเป็น JPEG', async () => {
  const dir = tmp('pbt-');
  const fake = (file, args, opts, cb) => {
    const out = args[args.indexOf('--filename') + 1];
    fs.writeFileSync(out.replace(/\.jpg$/, '.cr2'), Buffer.alloc(5000, 7));
    cb(null, '', '');
  };
  await assert.rejects(cap.capture({ mode: 'command', command: 'tool --filename "{out}"' }, { tmpDir: dir, execFile: fake }), /RAW/);
  const notImage = (file, args, opts, cb) => { fs.writeFileSync(args[1], 'plain text pretending to be a jpg'); cb(null, '', ''); };
  await assert.rejects(cap.capture({ mode: 'command', command: 'tool --filename "{out}"' }, { tmpDir: dir, execFile: notImage }), /ไม่พบไฟล์รูป/);
});

test('โหมดคำสั่ง: เครื่องเป็น macOS + gphoto2 → ปิด PTPCamera ก่อน และเพิ่ม PATH ของ Homebrew', async () => {
  const dir = tmp('pbt-');
  const calls = [];
  const fake = (file, args, opts, cb) => {
    calls.push({ file, args, env: opts.env });
    if (file === 'gphoto2') fs.copyFileSync(path.join(FIX, 'sample.jpg'), args[args.indexOf('--filename') + 1]);
    cb(null, 'ok', '');
  };
  const r = await cap.capture({ mode: 'command', command: 'gphoto2 --capture-image-and-download --force-overwrite --filename "{out}"' },
    { tmpDir: dir, execFile: fake, platform: 'darwin', env: { PATH: '/usr/bin' } });
  assert.equal(r.width, 96);
  assert.equal(calls[0].file, 'killall'); assert.deepEqual(calls[0].args, ['PTPCamera']);
  assert.equal(calls[1].file, 'gphoto2');
  assert.match(calls[1].env.PATH, /^\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin$/);
  assert.ok(calls[1].args.includes('--force-overwrite'));
});

test('โหมดโฟลเดอร์: ข้ามรูปเก่า รอจนไฟล์ใหม่เขียนครบ แล้วไม่ลบต้นฉบับ', async () => {
  const folder = tmp('pb folder ');
  const old = path.join(folder, 'old.jpg');
  fs.writeFileSync(old, JPG);
  const past = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(old, past, past);
  await new Promise((r) => setTimeout(r, 500)); // ให้รูปเก่า "เก่า" กว่าเวลาที่สั่งถ่ายเกินช่วงเผื่อ 300 ms
  const target = path.join(folder, 'IMG_0001.JPG');
  // จำลองกล้องที่ทยอยเขียนไฟล์: ครึ่งแรกก่อน แล้วค่อยเขียนครบ
  setTimeout(() => fs.writeFileSync(target, JPG.slice(0, 500)), 300);
  setTimeout(() => fs.writeFileSync(target, JPG), 1100);
  const r = await cap.capture({ mode: 'folder', folder, timeoutSec: 10 }, { tmpDir: tmp('pbt-'), pollMs: 100 });
  assert.equal(r.width, 96);
  assert.ok(Buffer.compare(r.data, JPG) === 0, 'ต้องได้ไฟล์ที่เขียนครบ ไม่ใช่ครึ่งไฟล์หรือรูปเก่า');
  assert.ok(fs.existsSync(target), 'ต้นฉบับยังอยู่ในโฟลเดอร์');
});

test('โหมดโฟลเดอร์ + คำสั่งสั่งชัตเตอร์: ใช้ {folder} ได้', async () => {
  const folder = tmp('pbf-');
  const r = await cap.capture({ mode: 'folder', folder, command: `${q(process.execPath)} ${q(FAKECAM)} "{folder}/shot.jpg" 100`, timeoutSec: 10 }, { tmpDir: tmp('pbt-'), pollMs: 100 });
  assert.equal(r.height, 64);
  assert.ok(fs.existsSync(path.join(folder, 'shot.jpg')));
});

test('โหมดโฟลเดอร์: หมดเวลา / โฟลเดอร์ไม่มี / ยังไม่เลือกโฟลเดอร์ (ใช้นาฬิกาจำลอง ไม่ต้องรอจริง)', async () => {
  const folder = tmp('pbf-');
  let t = Date.now() + 10000;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  await assert.rejects(cap.capture({ mode: 'folder', folder, timeoutSec: 8 }, Object.assign({ tmpDir: tmp('pbt-') }, clock)), /รอครบ 8 วินาที/);
  await assert.rejects(cap.capture({ mode: 'folder', folder: path.join(folder, 'nope') }, { tmpDir: tmp('pbt-') }), /ไม่พบโฟลเดอร์/);
  await assert.rejects(cap.capture({ mode: 'folder', folder: '' }, { tmpDir: tmp('pbt-') }), /ยังไม่ได้เลือกโฟลเดอร์/);
  // RAW ในโฟลเดอร์ → แจ้งให้ตั้งเป็น JPEG
  fs.writeFileSync(path.join(folder, 'IMG_1.CR3'), Buffer.alloc(4000, 1));
  t = Date.now() - 5; // since ก่อนเวลาไฟล์
  await assert.rejects(cap.capture({ mode: 'folder', folder, timeoutSec: 5 }, Object.assign({ tmpDir: tmp('pbt-') }, clock)), /RAW/);
});

test('สั่งซ้อนกันไม่ได้: ครั้งที่สองถูกปฏิเสธ แล้วครั้งถัดไปใช้ได้ปกติ', async () => {
  const dir = tmp('pbt-');
  const cfg = { mode: 'command', command: `${q(process.execPath)} ${q(FAKECAM)} "{out}" 400` };
  const first = cap.capture(cfg, { tmpDir: dir });
  await assert.rejects(cap.capture(cfg, { tmpDir: dir }), /กำลังทำงาน/);
  assert.equal((await first).width, 96);
  assert.equal((await cap.capture(cfg, { tmpDir: dir })).width, 96);
});
