'use strict';
// นโยบายความปลอดภัยของหน้าเว็บในแอป: โหลดได้เฉพาะไฟล์ของแอปเอง (ไม่เรียกเว็บภายนอกจากหน้าจอ — การอัปโหลดทำในโปรเซสหลัก)
module.exports = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' blob: data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ');
