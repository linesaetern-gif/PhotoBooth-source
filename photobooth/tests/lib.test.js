const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../app/src/main/assets/www/js/lib.js');

test('coverRect ครอบตัดให้ได้สัดส่วนปลายทางและอยู่กึ่งกลาง', () => {
  const a = lib.coverRect(1920, 1080, 1200, 1800);
  assert.equal(Math.round(a.h), 1080);
  assert.ok(Math.abs(a.w / a.h - 2 / 3) < 1e-9);
  assert.ok(Math.abs(a.x - (1920 - a.w) / 2) < 1e-9);
  const b = lib.coverRect(1080, 1920, 1800, 1200);
  assert.equal(Math.round(b.w), 1080);
  assert.ok(Math.abs(b.w / b.h - 3 / 2) < 1e-9);
  const c = lib.coverRect(1200, 1800, 1200, 1800);
  assert.deepEqual([c.x, c.y, c.w, c.h], [0, 0, 1200, 1800]);
});

test('zoomRect ซูมเข้าตรงกลาง รักษาสัดส่วน และไม่ซูมออกต่ำกว่า 1x', () => {
  const r = { x: 100, y: 50, w: 800, h: 1200 };
  const z2 = lib.zoomRect(r, 2);
  assert.deepEqual([z2.w, z2.h], [400, 600]);
  assert.equal(z2.x + z2.w / 2, r.x + r.w / 2);
  assert.equal(z2.y + z2.h / 2, r.y + r.h / 2);
  assert.ok(Math.abs(z2.w / z2.h - r.w / r.h) < 1e-12);
  assert.deepEqual(lib.zoomRect(r, 1), r);
  assert.deepEqual(lib.zoomRect(r, 0.5), r);
  assert.deepEqual(lib.zoomRect(r, NaN), r);
});

test('outputSize: ด้านยาว = ขนาดที่เลือก อีกด้านตามสัดส่วน (เลขคู่)', () => {
  assert.deepEqual(lib.outputSize('2:3', 1800), { w: 1200, h: 1800, ar: 2 / 3 });
  assert.deepEqual(lib.outputSize('2:3', 1800, 0, 'portrait'), { w: 1200, h: 1800, ar: 2 / 3 });
  // แนวนอน: สลับด้านกว้าง/ยาว ด้านยาวยังเท่าขนาดที่เลือก
  assert.deepEqual(lib.outputSize('2:3', 1800, 0, 'landscape'), { w: 1800, h: 1200, ar: 1.5 });
  assert.deepEqual(lib.outputSize('3:4', 2400, 0, 'landscape'), { w: 2400, h: 1800, ar: 4 / 3 });
  const sq = lib.outputSize('1:1', 2400, 0, 'landscape'); assert.deepEqual([sq.w, sq.h], [2400, 2400]);
  const wide = lib.outputSize('9:16', 1800, 0, 'landscape'); assert.equal(wide.w, 1800); assert.ok(wide.h < wide.w);
  assert.deepEqual([lib.outputSize('1:1', 2400).w, lib.outputSize('1:1', 2400).h], [2400, 2400]);
  assert.deepEqual([lib.outputSize('3:4', 2400).w, lib.outputSize('3:4', 2400).h], [1800, 2400]);
  const s = lib.outputSize('9:16', 1800);
  assert.equal(s.h, 1800); assert.equal(s.w % 2, 0); assert.ok(Math.abs(s.w / s.h - 9 / 16) < 0.001);
  // ตามกล้อง: ใช้สัดส่วนจริงของวิดีโอ ไม่ครอป
  const a = lib.outputSize('auto', 1800, 1920 / 1440);
  assert.deepEqual([a.w, a.h], [1800, 1350]);
  const p = lib.outputSize('auto', 1800, 1440 / 1920);
  assert.deepEqual([p.w, p.h], [1350, 1800]);
  assert.deepEqual([lib.outputSize('auto', 1800).w, lib.outputSize('auto', 1800).h], [1800, 1350]);
});

test('sizePx / ASPECTS / SIZES / TONES / TIMERS ถูกต้องและ id ไม่ซ้ำ', () => {
  assert.equal(lib.sizePx('S'), 1200);
  assert.equal(lib.sizePx('M'), 1800);
  assert.equal(lib.sizePx('L'), 2400);
  assert.equal(lib.sizePx('???'), 1800);
  for (const list of [lib.ASPECTS, lib.SIZES, lib.TONES, lib.CAM_MODES]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(lib.toneCss('none'), 'none');
  assert.match(lib.toneCss('bw'), /grayscale\(1\)/);
  assert.equal(lib.toneCss('nope'), 'none');
  assert.ok(lib.TONES.every((t) => t.css === 'none' || /^([a-z-]+\(-?[0-9.]+(deg)?\)\s?)+$/.test(t.css)));
  assert.ok(lib.TONES.length >= 15);
  assert.ok(lib.TONES.every((t) => /^#[0-9a-f]{6}$/i.test(t.sw)), 'ทุกโทนมีสีตัวอย่าง');
  assert.ok(['fresh', 'warm', 'cool', 'cinema', 'pastel', 'noir'].every((id) => lib.TONES.some((t) => t.id === id)));
  assert.deepEqual(lib.ORIENTS.map((o) => o.id), ['landscape', 'portrait']);
  assert.deepEqual(lib.COLLAGES.map((c) => c.n), [1, 2, 3, 3, 4, 4]);
  assert.ok(lib.COLLAGES.every((c) => c.n >= 1 && c.n <= 4));
  assert.deepEqual(lib.TIMERS, [0, 3, 5, 10]);
  assert.ok(lib.ASPECTS.every((a) => a.id === 'auto' || lib.aspectValue(a.id) > 0));
});

test('normalizeSettings ใส่ค่าเริ่มต้นและกันค่าเพี้ยน', () => {
  const d = lib.normalizeSettings({});
  assert.equal(d.aspect, '2:3');
  assert.equal(d.size, 'M');
  assert.equal(d.tone, 'none');
  assert.equal(d.orient, 'landscape');
  assert.equal(d.collage, '1');
  assert.equal(d.viewFit, false);
  assert.equal(d.camMode, '4:3');
  assert.equal(d.countdown, 3);
  const s = lib.normalizeSettings({
    countdown: 99, idleSeconds: -5, aspect: 'diagonal', size: 'XL', tone: 'xxx', facing: 'x', camMode: '5:4',
    eventName: '   ', scriptUrl: '  https://a/exec  ', showDate: 'yes', albumUrl: 'javascript:alert(1)'
  });
  assert.equal(s.countdown, 10);
  assert.equal(s.idleSeconds, 0);
  assert.equal(s.aspect, '2:3');
  assert.equal(s.size, 'M');
  assert.equal(s.tone, 'none');
  assert.equal(s.facing, 'user');
  assert.equal(s.camMode, '4:3');
  assert.equal(s.eventName, 'Photo Booth');
  assert.equal(s.scriptUrl, 'https://a/exec');
  assert.equal(s.showDate, true);
  assert.equal(s.albumUrl, '');
  assert.equal(lib.normalizeSettings({ countdown: '' }).countdown, 3);
  assert.equal(lib.normalizeSettings(null).frame, 'polaroid');
  assert.equal(lib.normalizeSettings({ albumUrl: 'https://drive.google.com/drive/folders/abc?usp=sharing' }).albumUrl,
    'https://drive.google.com/drive/folders/abc?usp=sharing');
});

test('ย้ายค่า orientation จากแอปเวอร์ชันก่อนหน้า', () => {
  let n = lib.normalizeSettings({ orientation: 'landscape' });
  assert.deepEqual([n.aspect, n.orient], ['2:3', 'landscape']);
  n = lib.normalizeSettings({ orientation: 'portrait' });
  assert.deepEqual([n.aspect, n.orient], ['2:3', 'portrait']);
  n = lib.normalizeSettings({ orientation: 'landscape', aspect: '1:1' });
  assert.deepEqual([n.aspect, n.orient], ['1:1', 'landscape']);
  // อัตราส่วนแบบเก่า (แนวนอน) แปลงเป็นอัตราส่วน + แนว
  for (const [old, asp] of [['4:3', '3:4'], ['3:2', '2:3'], ['16:9', '9:16']]) {
    n = lib.normalizeSettings({ aspect: old });
    assert.deepEqual([n.aspect, n.orient], [asp, 'landscape'], old);
  }
  n = lib.normalizeSettings({ aspect: '3:4', orient: 'portrait' });
  assert.deepEqual([n.aspect, n.orient], ['3:4', 'portrait']);
  assert.equal(lib.normalizeSettings({ orient: 'x', collage: 'zz', viewFit: 'yes' }).collage, '1');
  assert.equal(lib.normalizeSettings({ orient: 'x' }).orient, 'landscape');
  assert.equal(lib.normalizeSettings({ collage: '4s' }).collage, '4s');
  const old = lib.normalizeSettings({ qrLink: 'download', scriptUrl: 'https://script.google.com/macros/s/X/exec', token: 'abc' });
  assert.equal(old.token, 'abc');
  assert.equal('qrLink' in old, false);
  assert.equal('orientation' in old, false);
});

test('cameraConstraints ขอแนวนอนเสมอ และโหมด 4:3 เป็นค่าเริ่มต้น', () => {
  const c = lib.cameraConstraints('4:3', 'user');
  assert.equal(c.audio, false);
  assert.deepEqual(c.video.facingMode, { ideal: 'user' });
  assert.ok(c.video.width.ideal > c.video.height.ideal);
  assert.ok(Math.abs(c.video.width.ideal / c.video.height.ideal - 4 / 3) < 1e-9);
  const w = lib.cameraConstraints('16:9', 'environment');
  assert.deepEqual(w.video.facingMode, { ideal: 'environment' });
  assert.ok(Math.abs(w.video.width.ideal / w.video.height.ideal - 16 / 9) < 1e-3);
  const a = lib.cameraConstraints('auto', 'bogus');
  assert.equal(a.video.height, undefined);
  assert.deepEqual(a.video.facingMode, { ideal: 'user' });
});

test('clamp', () => {
  assert.equal(lib.clamp(5, 1, 3), 3);
  assert.equal(lib.clamp(0, 1, 3), 1);
  assert.equal(lib.clamp(2, 1, 3), 2);
});

test('backoffMs เพิ่มขึ้นแล้วหยุดที่ 60 วินาที', () => {
  assert.equal(lib.backoffMs(0), 3000);
  assert.equal(lib.backoffMs(1), 6000);
  assert.equal(lib.backoffMs(4), 48000);
  assert.equal(lib.backoffMs(5), 60000);
  assert.equal(lib.backoffMs(50), 60000);
});

test('sanitizeName ตัดอักขระต้องห้ามของชื่อโฟลเดอร์', () => {
  assert.equal(lib.sanitizeName('งานแต่ง: A/B?'), 'งานแต่ง AB');
  assert.equal(lib.sanitizeName('   '), 'Event');
  assert.equal(lib.sanitizeName(null), 'Event');
  assert.equal(lib.sanitizeName('x'.repeat(100)).length, 60);
});

test('isValidScriptUrl', () => {
  assert.ok(lib.isValidScriptUrl('https://script.google.com/macros/s/AKfycbxABC_-123/exec'));
  assert.ok(lib.isValidScriptUrl('https://script.google.com/a/macros/example.com/s/AKfy123/exec'));
  assert.ok(!lib.isValidScriptUrl('https://script.google.com/macros/s/AKfy123/dev'));
  assert.ok(!lib.isValidScriptUrl('http://script.google.com/macros/s/AKfy123/exec'));
  assert.ok(!lib.isValidScriptUrl('https://evil.example.com/macros/s/AKfy123/exec'));
  assert.ok(!lib.isValidScriptUrl(''));
});

test('thaiDate / stamp / makeId / photoName', () => {
  const d = new Date(2026, 9, 14, 8, 5, 9);
  assert.equal(lib.thaiDate(d), '14 ต.ค. 2569');
  assert.equal(lib.stamp(d), '20261014_080509');
  assert.equal(lib.makeId(0, 0), '000'.slice(0, 1) + '00');
  assert.match(lib.makeId(1700000000000, 0.5), /^[0-9a-z]+$/);
  assert.equal(lib.photoName('abc', d), 'photo_20261014_080509_abc.jpg');
});

test('ตั้งค่าเวอร์ชันคอมพิวเตอร์: ค่าเริ่มต้นและการกรองค่าที่ผิด', () => {
  const d = lib.normalizeSettings({});
  assert.deepEqual([d.cameraId, d.tether, d.printMode, d.paper, d.copies, d.autoPrint, d.tetherTimeout, d.startFullscreen],
    ['', 'off', 'dialog', 'driver', 1, false, 20, false]);
  const s = lib.normalizeSettings({ tether: 'rm -rf', printMode: 'x', paper: '9x9', copies: 99, tetherTimeout: 1, autoPrint: 'yes', cameraId: 'abc', saveDir: '  D:\\Booth  ' });
  assert.deepEqual([s.tether, s.printMode, s.paper, s.copies, s.tetherTimeout, s.autoPrint, s.cameraId, s.saveDir],
    ['off', 'dialog', 'driver', 10, 5, false, 'abc', 'D:\\Booth']);
  const ok = lib.normalizeSettings({ tether: 'folder', printMode: 'silent', paper: '4x6', copies: 3, tetherTimeout: 45, autoPrint: true });
  assert.deepEqual([ok.tether, ok.printMode, ok.paper, ok.copies, ok.tetherTimeout, ok.autoPrint], ['folder', 'silent', '4x6', 3, 45, true]);
  // ค่าที่ยาวเกินถูกตัด
  assert.equal(lib.normalizeSettings({ tetherCommand: 'x'.repeat(2000) }).tetherCommand.length, 600);
});

test('cameraConstraints: เลือกกล้องด้วย deviceId (คอมพิวเตอร์) แทนกล้องหน้า/หลัง และโหมด 4K', () => {
  const a = lib.cameraConstraints('16:9', 'user', 'DEV1').video;
  assert.deepEqual(a.deviceId, { exact: 'DEV1' });
  assert.equal(a.facingMode, undefined);
  assert.deepEqual([a.width.ideal, a.height.ideal], [1920, 1080]);
  const b = lib.cameraConstraints('4k', 'user').video;
  assert.deepEqual([b.width.ideal, b.height.ideal], [3840, 2160]);
  assert.deepEqual(b.facingMode, { ideal: 'user' });
  assert.deepEqual(lib.cameraConstraints('4:3', 'environment').video.facingMode, { ideal: 'environment' });
  assert.equal(lib.normalizeSettings({ camMode: '4k' }).camMode, '4k');
});

test('ชุดคำสั่งสำเร็จรูปของกล้องดิจิตอล: มี {out} และ id ไม่ซ้ำ', () => {
  const ids = lib.TETHER_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of lib.TETHER_PRESETS) if (p.command) { assert.ok(p.command.includes('{out}')); assert.equal(p.mode, 'command'); }
  for (const list of [lib.TETHER_MODES, lib.PRINT_MODES, lib.PAPERS]) {
    const i = list.map((x) => x.id);
    assert.equal(new Set(i).size, i.length);
  }
  assert.deepEqual(lib.PAPERS.map((p) => p.id), ['driver', '4x6', '5x7', '6x8', 'A4']);
});

test('collageCells: ช่องไม่ทับกัน อยู่ในภาพ และจำนวนตรงกับ n', () => {
  for (const c of lib.COLLAGES) {
    for (const [W, H] of [[1200, 1800], [1800, 1200], [1800, 1800]]) {
      const cells = lib.collageCells(c.id, W, H, 24);
      assert.equal(cells.length, c.n, c.id);
      for (const r of cells) {
        assert.ok(r.w > 0 && r.h > 0, c.id + ' ขนาดต้องเป็นบวก');
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 0.001 && r.y + r.h <= H + 0.001, c.id + ' ต้องอยู่ในภาพ');
      }
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        const overlap = a.x < b.x + b.w - 0.001 && b.x < a.x + a.w - 0.001 && a.y < b.y + b.h - 0.001 && b.y < a.y + a.h - 0.001;
        assert.equal(overlap, false, c.id + ' ช่อง ' + i + '/' + j + ' ทับกัน');
      }
    }
  }
  assert.equal(lib.collageCells('nope', 100, 100, 0).length, 1);
  const one = lib.collageCells('1', 1200, 1800, 24)[0];
  assert.deepEqual([one.x, one.y, one.w, one.h], [0, 0, 1200, 1800]);
});

test('fitScale: ย่อภาพให้เห็นทั้งหมดในช่อง ไม่ขยายเกิน 1', () => {
  assert.equal(lib.fitScale(1, 1), 1);
  assert.ok(Math.abs(lib.fitScale(2 / 3, 4 / 3) - 0.5) < 1e-9);   // ช่องตั้ง 2:3 ใส่กล้อง 4:3 → เห็น 50%
  assert.ok(Math.abs(lib.fitScale(1.5, 4 / 3) - (4 / 3) / 1.5) < 1e-9 || lib.fitScale(1.5, 4 / 3) <= 1);
  assert.ok(lib.fitScale(0.3, 3) > 0 && lib.fitScale(0.3, 3) <= 1);
  assert.equal(lib.fitScale(0, 1) > 0, true);
});
