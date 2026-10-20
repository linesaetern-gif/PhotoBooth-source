'use strict';
// คัดลอกหน้าจอ (HTML/JS/CSS) จากโปรเจกต์ Android ที่เป็นต้นฉบับเดียวกัน มาไว้ที่ desktop/www
// แอปมือถือกับแอปคอมพิวเตอร์จึงใช้โค้ดหน้าจอชุดเดียวกัน แก้ที่เดียวได้ทั้งสองแบบ
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
const dst = path.join(__dirname, '..', 'www');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  if (fs.existsSync(path.join(dst, 'index.html'))) {
    console.log('[sync] ไม่พบโปรเจกต์ Android ข้างๆ — ใช้โฟลเดอร์ www ที่มีอยู่แล้ว');
    process.exit(0);
  }
  console.error('[sync] ไม่พบต้นฉบับหน้าจอที่ ' + src + '\n       ให้วางโฟลเดอร์ desktop ไว้ข้างๆ โฟลเดอร์ app ของโปรเจกต์ Photo Booth');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('[sync] คัดลอกหน้าจอแล้ว → ' + dst);
