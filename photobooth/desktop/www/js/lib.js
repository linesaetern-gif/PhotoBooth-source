/* Photo Booth — ฟังก์ชันช่วยเหลือแบบ "ล้วน" (ใช้ได้ทั้งในแอปและใน Node สำหรับเทสต์) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PB = root.PB || {}; root.PB.lib = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- ตัวเลือกที่แสดงในหน้ากล้อง ---------- */
  // สัดส่วนเป็นแบบ "แนวตั้ง" (กว้าง < สูง) แล้วใช้ตัวเลือกแนวภาพ (ORIENTS) สลับเป็นแนวนอนอีกที
  var ASPECTS = [
    { id: '2:3', label: '2:3', hint: '4×6 นิ้ว' },
    { id: '3:4', label: '3:4', hint: 'มาตรฐาน' },
    { id: '1:1', label: '1:1', hint: 'จัตุรัส' },
    { id: '9:16', label: '9:16', hint: 'เต็มจอมือถือ' },
    { id: 'auto', label: 'ตามกล้อง', hint: 'ไม่ครอป' }
  ];

  var ORIENTS = [
    { id: 'landscape', label: 'แนวนอน' },
    { id: 'portrait', label: 'แนวตั้ง' }
  ];

  // คอลลาจ: ถ่ายหลายภาพ (ไม่เกิน 4) ต่อกันเป็นรูปเดียว
  var COLLAGES = [
    { id: '1', n: 1, label: 'ภาพเดียว' },
    { id: '2', n: 2, label: '2 ภาพ' },
    { id: '3', n: 3, label: '3 ภาพเรียง' },
    { id: '3g', n: 3, label: '3 ภาพ ใหญ่+เล็ก' },
    { id: '4', n: 4, label: '4 ภาพ ตาราง' },
    { id: '4s', n: 4, label: '4 ภาพ แถบยาว' }
  ];

  var SIZES = [
    { id: 'S', label: 'เล็ก', px: 1200, hint: '1200 px' },
    { id: 'M', label: 'มาตรฐาน', px: 1800, hint: '4×6 นิ้ว' },
    { id: 'L', label: 'ใหญ่', px: 2400, hint: '6×8 นิ้ว' }
  ];

  // css ชุดเดียวกันใช้ทั้งพรีวิว (video.style.filter) และตอนบันทึก (ctx.filter) · sw = สีตัวอย่างในปุ่ม
  var TONES = [
    { id: 'none', label: 'ปกติ', css: 'none', sw: '#d9d6e6' },
    { id: 'fresh', label: 'สดชื่น', css: 'saturate(1.25) brightness(1.08) contrast(1.04) hue-rotate(6deg)', sw: '#7be0b5' },
    { id: 'vivid', label: 'สดใส', css: 'saturate(1.4) contrast(1.08)', sw: '#ff6b9d' },
    { id: 'warm', label: 'อบอุ่น', css: 'sepia(0.25) saturate(1.2) brightness(1.03)', sw: '#ffb366' },
    { id: 'golden', label: 'ทองอร่าม', css: 'sepia(0.45) saturate(1.5) brightness(1.05) contrast(1.05)', sw: '#f2b31d' },
    { id: 'rose', label: 'ชมพูหวาน', css: 'sepia(0.2) hue-rotate(-18deg) saturate(1.3) brightness(1.06)', sw: '#ff9db8' },
    { id: 'pastel', label: 'พาสเทล', css: 'brightness(1.12) contrast(0.85) saturate(0.9)', sw: '#cfe3ff' },
    { id: 'soft', label: 'นุ่มสว่าง', css: 'brightness(1.08) contrast(0.92) saturate(1.05)', sw: '#fff1dc' },
    { id: 'cool', label: 'เย็นสบาย', css: 'hue-rotate(-10deg) saturate(1.05) brightness(1.04)', sw: '#86b9ff' },
    { id: 'cinema', label: 'ซีนีม่า', css: 'contrast(1.2) saturate(0.85) brightness(0.96) hue-rotate(-6deg)', sw: '#2f6f7e' },
    { id: 'drama', label: 'เข้มดราม่า', css: 'contrast(1.35) saturate(1.15) brightness(0.95)', sw: '#5b2a86' },
    { id: 'neon', label: 'นีออน', css: 'saturate(1.9) contrast(1.15) hue-rotate(-10deg)', sw: '#b24bff' },
    { id: 'film', label: 'ฟิล์มจาง', css: 'contrast(0.9) saturate(0.85) brightness(1.06) sepia(0.12)', sw: '#c9c1a8' },
    { id: 'vintage', label: 'วินเทจ', css: 'sepia(0.5) contrast(0.9) brightness(1.05) saturate(0.8)', sw: '#b58b5a' },
    { id: 'sepia', label: 'ซีเปีย', css: 'sepia(0.85) contrast(1.05) saturate(1.1)', sw: '#8c5a2b' },
    { id: 'bw', label: 'ขาวดำ', css: 'grayscale(1) contrast(1.1)', sw: '#888888' },
    { id: 'noir', label: 'ขาวดำเข้ม', css: 'grayscale(1) contrast(1.5) brightness(0.95)', sw: '#222222' }
  ];

  var TIMERS = [0, 3, 5, 10];

  // โหมดของกล้อง: 4:3 ให้มุมมองกว้างเต็มเซนเซอร์ (แก้อาการภาพซูมใกล้เกินไป)
  var CAM_MODES = [
    { id: '4:3', label: '4:3 มุมกว้าง (แนะนำ)' },
    { id: '16:9', label: '16:9 จอกว้าง' },
    { id: '4k', label: '4K 16:9 (กล้องที่รองรับ)' },
    { id: 'auto', label: 'ให้เครื่องเลือกเอง' }
  ];

  // ตัวเลือกสำหรับเวอร์ชันคอมพิวเตอร์
  var TETHER_MODES = [
    { id: 'off', label: 'ปิด — ใช้ภาพจากกล้องพรีวิว (เว็บแคม / HDMI)' },
    { id: 'command', label: 'สั่งถ่ายผ่านโปรแกรมควบคุมกล้อง (digiCamControl / gPhoto2)' },
    { id: 'folder', label: 'รอรูปใหม่จากโฟลเดอร์ (Hot folder จากโปรแกรมของยี่ห้อกล้อง)' }
  ];
  // {out} = ไฟล์ปลายทางที่แอปกำหนดให้ · {folder} = โฟลเดอร์ที่ตั้งไว้ · ใส่ path ที่มีช่องว่างไว้ในเครื่องหมาย " "
  var TETHER_PRESETS = [
    { id: 'custom', label: 'กำหนดเอง', mode: '', command: '' },
    { id: 'digicam', label: 'digiCamControl (Windows)', mode: 'command',
      command: '"C:\\Program Files (x86)\\digiCamControl\\CameraControlCmd.exe" /filename "{out}" /capture' },
    { id: 'gphoto2', label: 'gPhoto2 (Mac / Linux)', mode: 'command',
      command: 'gphoto2 --capture-image-and-download --force-overwrite --filename "{out}"' }
  ];
  var PRINT_MODES = [
    { id: 'dialog', label: 'ขึ้นหน้าต่างให้เลือกเครื่องพิมพ์ทุกครั้ง' },
    { id: 'silent', label: 'พิมพ์เงียบ (ส่งเข้าเครื่องพิมพ์ทันที)' }
  ];
  var PAPERS = [
    { id: 'driver', label: 'ตามที่ตั้งไว้ในไดรเวอร์เครื่องพิมพ์' },
    { id: '4x6', label: '4×6 นิ้ว (10×15 ซม.)' },
    { id: '5x7', label: '5×7 นิ้ว' },
    { id: '6x8', label: '6×8 นิ้ว' },
    { id: 'A4', label: 'A4' }
  ];

  function ids(list) { return list.map(function (x) { return x.id; }); }

  var DEFAULTS = {
    eventName: 'Photo Booth',
    showDate: true,
    frame: 'polaroid',
    aspect: '2:3',
    orient: 'landscape',       // landscape = แนวนอน (ภาพกว้างตรงกับกล้อง ไม่ถูกครอปด้านข้าง) · portrait = แนวตั้ง
    collage: '1',              // 1 = ภาพเดียว · 2/3/3g/4/4s = ถ่ายหลายภาพต่อกัน
    viewFit: false,            // true = เห็นภาพกล้องทั้งหมด (ไม่ครอป) เติมขอบด้วยภาพเบลอ
    size: 'M',
    tone: 'none',
    countdown: 3,
    facing: 'user',            // user = กล้องหน้า, environment = กล้องหลัง
    camMode: '4:3',
    mirrorPreview: true,       // พรีวิวกลับด้านเหมือนส่องกระจก
    mirrorSaved: false,        // รูปที่บันทึกกลับด้านด้วยไหม
    idleSeconds: 90,           // กลับหน้าแรกอัตโนมัติ (0 = ปิด)
    saveLocalCopy: true,       // เก็บสำเนาไว้ในแกลเลอรีของเครื่อง
    scriptUrl: '',             // URL ของ Google Apps Script (ลงท้าย /exec)
    token: 'change-me',        // รหัสร่วมกับ Apps Script
    albumUrl: '',              // ลิงก์ที่ QR อัลบั้มพาไป (โฟลเดอร์งานใน Drive)
    albumEvent: '',            // ชื่ออีเวนต์ตอนที่สร้าง QR (ไว้เตือนถ้าเปลี่ยนชื่อภายหลัง)
    customFrameVersion: 0,
    // --- เฉพาะเวอร์ชันคอมพิวเตอร์ ---
    cameraId: '',              // deviceId ของกล้อง/การ์ดแคปเจอร์ที่เลือก ('' = กล้องเริ่มต้น)
    cameraLabel: '',
    tether: 'off',             // off | command | folder
    tetherCommand: '',
    tetherFolder: '',
    tetherTimeout: 20,         // วินาที
    printMode: 'dialog',       // dialog | silent
    printer: '',               // '' = เครื่องพิมพ์เริ่มต้นของระบบ
    paper: 'driver',
    copies: 1,
    autoPrint: false,          // พิมพ์ทันทีหลังถ่าย (ใช้กับพิมพ์เงียบ)
    saveDir: '',               // '' = โฟลเดอร์ รูปภาพ/PhotoBooth
    startFullscreen: false
  };

  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function pick(v, allowed, d) { return allowed.indexOf(v) >= 0 ? v : d; }
  function str(v, d, max) { return typeof v === 'string' ? v.trim().slice(0, max) : d; }
  function num(v, lo, hi, d) {
    var n = Number(v);
    if (v === '' || v === null || !isFinite(n)) return d;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function normalizeSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var s = {};
    for (var k in DEFAULTS) s[k] = DEFAULTS[k];
    s.eventName = str(raw.eventName, DEFAULTS.eventName, 40) || DEFAULTS.eventName;
    s.showDate = bool(raw.showDate, DEFAULTS.showDate);
    s.frame = str(raw.frame, DEFAULTS.frame, 20) || DEFAULTS.frame;
    // ย้ายค่าจากเวอร์ชันเก่า: สัดส่วนแนวนอน (4:3, 3:2, 16:9) และ orientation เดิม → สัดส่วนแนวตั้ง + แนวภาพ
    var legacyMap = { '4:3': ['3:4', 'landscape'], '3:2': ['2:3', 'landscape'], '16:9': ['9:16', 'landscape'] };
    var asp = raw.aspect, orient = raw.orient;
    if (legacyMap[asp]) { if (!orient) orient = legacyMap[asp][1]; asp = legacyMap[asp][0]; }
    if (!orient && (raw.orientation === 'landscape' || raw.orientation === 'portrait')) orient = raw.orientation;
    s.aspect = pick(asp, ids(ASPECTS), DEFAULTS.aspect);
    s.orient = pick(orient, ids(ORIENTS), DEFAULTS.orient);
    s.collage = pick(raw.collage, ids(COLLAGES), DEFAULTS.collage);
    s.viewFit = bool(raw.viewFit, DEFAULTS.viewFit);
    s.size = pick(raw.size, ids(SIZES), DEFAULTS.size);
    s.tone = pick(raw.tone, ids(TONES), DEFAULTS.tone);
    s.countdown = num(raw.countdown, 0, 10, DEFAULTS.countdown);
    s.facing = pick(raw.facing, ['user', 'environment'], DEFAULTS.facing);
    s.camMode = pick(raw.camMode, ids(CAM_MODES), DEFAULTS.camMode);
    s.mirrorPreview = bool(raw.mirrorPreview, DEFAULTS.mirrorPreview);
    s.mirrorSaved = bool(raw.mirrorSaved, DEFAULTS.mirrorSaved);
    s.idleSeconds = num(raw.idleSeconds, 0, 600, DEFAULTS.idleSeconds);
    s.saveLocalCopy = bool(raw.saveLocalCopy, DEFAULTS.saveLocalCopy);
    s.scriptUrl = str(raw.scriptUrl, DEFAULTS.scriptUrl, 300);
    s.token = str(raw.token, DEFAULTS.token, 60);
    var album = str(raw.albumUrl, '', 300);
    s.albumUrl = /^https?:\/\//i.test(album) ? album : '';
    s.albumEvent = str(raw.albumEvent, '', 60);
    s.customFrameVersion = num(raw.customFrameVersion, 0, 1e9, 0);
    s.cameraId = str(raw.cameraId, '', 300);
    s.cameraLabel = str(raw.cameraLabel, '', 120);
    s.tether = pick(raw.tether, ids(TETHER_MODES), DEFAULTS.tether);
    s.tetherCommand = str(raw.tetherCommand, '', 600);
    s.tetherFolder = str(raw.tetherFolder, '', 400);
    s.tetherTimeout = num(raw.tetherTimeout, 5, 120, DEFAULTS.tetherTimeout);
    s.printMode = pick(raw.printMode, ids(PRINT_MODES), DEFAULTS.printMode);
    s.printer = str(raw.printer, '', 200);
    s.paper = pick(raw.paper, ids(PAPERS), DEFAULTS.paper);
    s.copies = num(raw.copies, 1, 10, DEFAULTS.copies);
    s.autoPrint = bool(raw.autoPrint, DEFAULTS.autoPrint);
    s.saveDir = str(raw.saveDir, '', 400);
    s.startFullscreen = bool(raw.startFullscreen, DEFAULTS.startFullscreen);
    return s;
  }

  /* ---------- ขนาด / สัดส่วนภาพ ---------- */
  // orient = 'portrait' | 'landscape' (ไม่ใส่ = ใช้ตามสัดส่วนที่ให้มา) · 'auto' ใช้สัดส่วนจริงของกล้องเสมอ
  function aspectValue(aspect, camAspect, orient) {
    if (aspect === 'auto') return camAspect > 0 ? camAspect : 4 / 3;
    var p = String(aspect).split(':');
    var v = Number(p[0]) / Number(p[1]);
    if (!isFinite(v) || v <= 0) v = 2 / 3;
    if (orient === 'landscape' && v < 1) v = 1 / v;
    else if (orient === 'portrait' && v > 1) v = 1 / v;
    return v;
  }
  function even(n) { return Math.max(2, Math.round(n / 2) * 2); }
  function sizePx(sizeId) {
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === sizeId) return SIZES[i].px;
    return 1800;
  }
  // ขนาดรูปผลลัพธ์: ด้านยาวเท่ากับ longEdge พิกเซล ส่วนอีกด้านตามสัดส่วน
  function outputSize(aspect, longEdge, camAspect, orient) {
    var ar = aspectValue(aspect, camAspect, orient), w, h;
    if (ar >= 1) { w = longEdge; h = longEdge / ar; } else { h = longEdge; w = longEdge * ar; }
    return { w: even(w), h: even(h), ar: ar };
  }

  /* ---------- คอลลาจ ---------- */
  // แบ่งพื้นที่ w×h เป็นช่องตามรูปแบบ (พิกัดสัมพัทธ์กับมุมซ้ายบน) · ช่องห่างกัน gap พิกเซล
  function collageCells(id, w, h, gap) {
    gap = gap == null ? Math.round(Math.min(w, h) * 0.02) : gap;
    var tall = h >= w;
    function r(x, y, cw, ch) { return { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) }; }
    function split(n) {
      var out = [], i;
      for (i = 0; i < n; i++) {
        if (tall) { var ch = (h - gap * (n - 1)) / n; out.push(r(0, i * (ch + gap), w, ch)); }
        else { var cw = (w - gap * (n - 1)) / n; out.push(r(i * (cw + gap), 0, cw, h)); }
      }
      return out;
    }
    if (id === '2') return split(2);
    if (id === '3') return split(3);
    if (id === '4s') return split(4);
    if (id === '4') {
      var hw = (w - gap) / 2, hh = (h - gap) / 2;
      return [r(0, 0, hw, hh), r(hw + gap, 0, hw, hh), r(0, hh + gap, hw, hh), r(hw + gap, hh + gap, hw, hh)];
    }
    if (id === '3g') {
      if (tall) {
        var bh = (h - gap) * 0.56, sh = h - gap - bh, sw = (w - gap) / 2;
        return [r(0, 0, w, bh), r(0, bh + gap, sw, sh), r(sw + gap, bh + gap, sw, sh)];
      }
      var bw = (w - gap) * 0.56, sw2 = w - gap - bw, sh2 = (h - gap) / 2;
      return [r(0, 0, bw, h), r(bw + gap, 0, sw2, sh2), r(bw + gap, sh2 + gap, sw2, sh2)];
    }
    return [r(0, 0, w, h)];
  }

  // ถ้าต้องการเห็นภาพกล้องทั้งหมดในช่อง (ไม่ครอป) ต้องย่อภาพลงเท่าไร (≤ 1) เทียบกับโหมดเต็มช่อง (cover)
  function fitScale(boxAspect, srcAspect) {
    if (!(boxAspect > 0) || !(srcAspect > 0)) return 1;
    return Math.min(boxAspect / srcAspect, srcAspect / boxAspect, 1);
  }

  // หาช่วงที่ต้องตัดจากวิดีโอ (เหมือน object-fit: cover) ให้ได้สัดส่วนปลายทาง
  function coverRect(sw, sh, dw, dh) {
    var sr = sw / sh, dr = dw / dh, w, h;
    if (sr > dr) { h = sh; w = sh * dr; } else { w = sw; h = sw / dr; }
    return { x: (sw - w) / 2, y: (sh - h) / 2, w: w, h: h };
  }
  // ซูมเข้าตรงกลางของช่วงที่ตัดแล้ว (z >= 1)
  function zoomRect(r, z) {
    z = z > 1 ? z : 1;
    var w = r.w / z, h = r.h / z;
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w: w, h: h };
  }

  function toneCss(id) {
    for (var i = 0; i < TONES.length; i++) if (TONES[i].id === id) return TONES[i].css;
    return 'none';
  }

  // constraints ของ getUserMedia — ขอขนาดแนวนอนเสมอ (โหมดเซนเซอร์เป็นแนวนอน) เพื่อให้ได้มุมมองเต็ม
  // ถ้าระบุ deviceId (คอมพิวเตอร์) จะเลือกกล้องตัวนั้นแทนการเลือกกล้องหน้า/หลัง
  function cameraConstraints(mode, facing, deviceId) {
    var v = {};
    if (deviceId) v.deviceId = { exact: String(deviceId) };
    else v.facingMode = { ideal: facing === 'environment' ? 'environment' : 'user' };
    if (mode === '16:9') { v.width = { ideal: 1920 }; v.height = { ideal: 1080 }; }
    else if (mode === '4k') { v.width = { ideal: 3840 }; v.height = { ideal: 2160 }; }
    else if (mode === 'auto') { v.width = { ideal: 1920 }; }
    else { v.width = { ideal: 1920 }; v.height = { ideal: 1440 }; }
    return { audio: false, video: v };
  }

  /* ---------- อื่นๆ ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }
  function makeId(now, rnd) {
    now = now === undefined ? Date.now() : now;
    rnd = rnd === undefined ? Math.random() : rnd;
    return now.toString(36) + Math.floor(rnd * 1296).toString(36).padStart(2, '0');
  }
  function photoName(id, d) { return 'photo_' + stamp(d) + '_' + id + '.jpg'; }

  // เวลารอก่อนลองอัปโหลดใหม่ (มิลลิวินาที): 3s, 6s, 12s, 24s, 48s, 60s...
  function backoffMs(tries) {
    return Math.min(60000, 3000 * Math.pow(2, Math.min(Math.max(tries, 0), 5)));
  }

  function sanitizeName(s) {
    var t = String(s == null ? '' : s).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '').trim().slice(0, 60);
    return t || 'Event';
  }

  function isValidScriptUrl(u) {
    return /^https:\/\/script\.google\.com\/(a\/macros\/[^\/\s]+\/|macros\/)s\/[^\/\s]+\/exec(\?\S*)?$/.test(String(u || ''));
  }

  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function thaiDate(d) {
    d = d || new Date();
    return d.getDate() + ' ' + TH_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { var s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = function () { reject(fr.error || new Error('อ่านไฟล์ไม่ได้')); };
      fr.readAsDataURL(blob);
    });
  }

  return {
    ASPECTS: ASPECTS, ORIENTS: ORIENTS, COLLAGES: COLLAGES, collageCells: collageCells, fitScale: fitScale, SIZES: SIZES, TONES: TONES, TIMERS: TIMERS, CAM_MODES: CAM_MODES, DEFAULTS: DEFAULTS,
    TETHER_MODES: TETHER_MODES, TETHER_PRESETS: TETHER_PRESETS, PRINT_MODES: PRINT_MODES, PAPERS: PAPERS,
    normalizeSettings: normalizeSettings,
    aspectValue: aspectValue,
    sizePx: sizePx,
    outputSize: outputSize,
    coverRect: coverRect,
    zoomRect: zoomRect,
    clamp: clamp,
    toneCss: toneCss,
    cameraConstraints: cameraConstraints,
    stamp: stamp,
    makeId: makeId,
    photoName: photoName,
    backoffMs: backoffMs,
    sanitizeName: sanitizeName,
    isValidScriptUrl: isValidScriptUrl,
    thaiDate: thaiDate,
    blobToBase64: blobToBase64
  };
});
