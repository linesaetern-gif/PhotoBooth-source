const test = require('node:test');
const assert = require('node:assert/strict');
const qr = require('../app/src/main/assets/www/js/qr.js');
const I = qr._internal;

// ความจุไบต์ของ QR ระดับ M ตามมาตรฐาน (เวอร์ชัน 1–10)
const CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

test('ตารางจำนวนโค้ดเวิร์ดให้ความจุตรงตามมาตรฐาน', () => {
  CAPACITY_M.forEach((cap, i) => {
    const ver = i + 1;
    const dcw = I.numDataCodewords(ver);
    const overhead = ver < 10 ? 2 : 3;   // โหมด+ความยาว = 12 หรือ 20 บิต
    assert.equal(dcw - overhead, cap, 'version ' + ver);
  });
});

test('เลือกเวอร์ชันเล็กที่สุดที่พอดีกับขนาดข้อความ', () => {
  CAPACITY_M.forEach((cap, i) => {
    assert.equal(qr.encode('a'.repeat(cap)).version, i + 1);
    if (i < CAPACITY_M.length - 1) assert.equal(qr.encode('a'.repeat(cap + 1)).version, i + 2);
  });
  assert.throws(() => qr.encode('a'.repeat(214)));
});

test('ขนาดเมทริกซ์ = 17 + 4*เวอร์ชัน และมีลวดลายหลักครบ', () => {
  const q = qr.encode('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view');
  const n = q.size, m = q.modules;
  assert.equal(n, 17 + 4 * q.version);
  // finder 7x7: ขอบนอกดำ, วงถัดไปขาว, แกนกลาง 3x3 ดำ ที่ทั้ง 3 มุม
  [[0, 0], [n - 7, 0], [0, n - 7]].forEach(([x0, y0]) => {
    for (let d = 0; d < 7; d++) {
      assert.equal(m[y0][x0 + d], 1); assert.equal(m[y0 + 6][x0 + d], 1);
      assert.equal(m[y0 + d][x0], 1); assert.equal(m[y0 + d][x0 + 6], 1);
    }
    for (let d = 1; d < 6; d++) assert.equal(m[y0 + 1][x0 + d], 0);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) assert.equal(m[y0 + y][x0 + x], 1);
  });
  // เส้น timing สลับดำ-ขาว และโมดูลดำคงที่
  for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0 ? 1 : 0); assert.equal(m[i][6], i % 2 === 0 ? 1 : 0); }
  assert.equal(m[n - 8][8], 1);
});

test('ข้อมูลรูปแบบ (format info) ผ่าน BCH และระบุระดับ M + หมายเลขมาสก์ถูกต้อง', () => {
  ['A', 'HELLO WORLD', 'สวัสดี', 'x'.repeat(100)].forEach((t) => {
    const q = qr.encode(t), m = q.modules;
    let fb = 0;
    for (let i = 0; i <= 5; i++) fb |= m[i][8] << i;
    fb |= m[7][8] << 6; fb |= m[8][8] << 7; fb |= m[8][7] << 8;
    for (let i = 9; i < 15; i++) fb |= m[8][14 - i] << i;
    const d = (fb ^ 0x5412) >>> 10;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    assert.equal(((d << 10) | rem) ^ 0x5412, fb);
    assert.equal(d >>> 3, 0);          // ระดับ M
    assert.equal(d & 7, q.mask);
  });
});

test('Reed–Solomon: ข้อมูล+ECC หารด้วยพหุนามตัวหารลงตัว', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
  [10, 16, 18, 22, 24, 26].forEach((deg) => {
    const data = Array.from({ length: 40 }, rnd);
    const div = I.rsDivisor(deg);
    const ecc = I.rsRemainder(data, div);
    assert.equal(ecc.length, deg);
    assert.ok(I.rsRemainder(data.concat(ecc), div).every((b) => b === 0));
  });
});

test('GF(256): คูณมีสมบัติสลับที่ และมีสมาชิกเอกลักษณ์', () => {
  for (let a = 0; a < 256; a += 7) for (let b = 0; b < 256; b += 11) {
    assert.equal(I.gfMul(a, b), I.gfMul(b, a));
  }
  assert.equal(I.gfMul(173, 1), 173);
  assert.equal(I.gfMul(2, 0x80), 0x1D);   // x * x^7 = x^8 ≡ 0x1D (mod 0x11D)
});

test('UTF-8 และผลลัพธ์คงที่ทุกครั้ง', () => {
  assert.deepEqual(I.utf8Bytes('A€ก😀'), [0x41, 0xE2, 0x82, 0xAC, 0xE0, 0xB8, 0x81, 0xF0, 0x9F, 0x98, 0x80]);
  const a = qr.encode('same text'), b = qr.encode('same text');
  assert.deepEqual(a.modules, b.modules);
});
