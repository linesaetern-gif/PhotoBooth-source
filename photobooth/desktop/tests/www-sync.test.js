// กันลืมซิงก์: หน้าจอใน desktop/www ต้องตรงกับต้นฉบับของโปรเจกต์ Android (ถ้ามีต้นฉบับอยู่ข้างๆ)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
const dst = path.join(__dirname, '..', 'www');

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);
}

test('desktop/www ตรงกับ app/src/main/assets/www', { skip: !fs.existsSync(src) || !fs.existsSync(dst) }, () => {
  assert.deepEqual(walk(dst).sort(), walk(src).sort());
  for (const f of walk(src)) assert.ok(Buffer.compare(fs.readFileSync(path.join(src, f)), fs.readFileSync(path.join(dst, f))) === 0, f + ' ไม่ตรงกัน — รัน npm run sync');
});

test('index.html โหลดสคริปต์ครบ และไม่มีสคริปต์/สไตล์อินไลน์ที่ติด CSP', () => {
  const html = fs.readFileSync(path.join(dst, 'index.html'), 'utf8');
  for (const f of ['lib', 'native', 'qr', 'store', 'uploader', 'frames', 'app']) assert.ok(html.includes('js/' + f + '.js'), f);
  assert.ok(html.indexOf('js/native.js') < html.indexOf('js/uploader.js'), 'native.js ต้องมาก่อน uploader.js');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'มี <script> อินไลน์');
  assert.ok(!/\son(click|load|error)=/i.test(html), 'มี event handler อินไลน์');
});
