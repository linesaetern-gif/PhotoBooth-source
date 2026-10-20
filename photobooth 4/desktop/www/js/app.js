/* Photo Booth — ตัวควบคุมหน้าจอ
 * หน้าแรก → (แตะ) → หน้ากล้อง: ดูภาพสด เลือกกรอบ/โทนสี/สัดส่วน/ขนาด/นับถอยหลัง/ซูม → กดปุ่มถ่าย → นับถอยหลัง → ถ่าย
 * → หน้าผลลัพธ์ (พิมพ์ / ถ่ายใหม่ / เสร็จสิ้น) โดยรูปถูกอัปโหลดขึ้น Drive อยู่เบื้องหลัง
 * QR Code ไม่แสดงตอนถ่าย — สร้างครั้งเดียวในหน้าตั้งค่า แล้วพิมพ์ไปติดหน้าบูธ */
(function () {
  'use strict';
  var PB = window.PB;
  var N = PB.native;
  var $ = function (id) { return document.getElementById(id); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var FONT = '"Noto Sans Thai","Sarabun","Leelawadee UI","Thonburi",system-ui,sans-serif';

  var settings = PB.store.loadSettings();
  var state = {
    screen: 'home', stream: null, streamFacing: null, streamMode: null, streamDevice: '', devices: [], facing: settings.facing,
    session: 0, camToken: 0, current: null, idleTimer: null, toastTimer: null,
    zoom: 1, hwZoom: null, camInfo: null, counting: false, sheet: null, layoutSeq: 0,
    pv: null, shots: [], shotIndex: 0, cell: null
  };

  var uploader = PB.createUploader(function () { return settings; }, {
    onChange: refreshPending, onDone: onUploadDone, onFail: onUploadFail
  });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }
  function fmtZoom(z) { return (Math.round(z * 10) / 10).toFixed(1) + '×'; }
  function shortName(n) { return String(n || '').split(' (')[0]; }
  function errText(e) { return String((e && e.message) || e || ''); }

  /* ---------- ทั่วไป ---------- */
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  }

  function showScreen(name) {
    ['home', 'camera', 'result'].forEach(function (n) { $('screen-' + n).classList.toggle('active', n === name); });
    state.screen = name;
    stopIdle();
    $('toast').classList.add('hidden');
    if (name === 'camera') fitStage();
  }

  function videoAspect() {
    var v = $('video');
    return v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 4 / 3;
  }
  function currentOut() {
    return PB.lib.outputSize(settings.aspect, PB.lib.sizePx(settings.size), videoAspect(), settings.orient);
  }
  function collageDef() { return find(PB.lib.COLLAGES, settings.collage) || PB.lib.COLLAGES[0]; }

  // ช่องของภาพแต่ละใบ (พิกเซลของรูปผลลัพธ์ W×H) — ถ้าเป็นคอลลาจจะวางภายในช่องโปร่งใสของกรอบ
  function cellsAt(W, H) {
    var def = collageDef();
    if (def.n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
    var fr = (state.pv && state.pv.win) || { x: 0, y: 0, w: 1, h: 1 };
    var win = { x: Math.round(fr.x * W), y: Math.round(fr.y * H), w: Math.round(fr.w * W), h: Math.round(fr.h * H) };
    var gap = Math.round(Math.min(win.w, win.h) * 0.022);
    return PB.lib.collageCells(def.id, win.w, win.h, gap).map(function (c) { return { x: win.x + c.x, y: win.y + c.y, w: c.w, h: c.h }; });
  }

  function fitStage() {
    var wrap = $('stage-wrap'), out = currentOut(), ar = out.w / out.h;
    var cw = wrap.clientWidth - 20, ch = wrap.clientHeight - 16;
    if (cw <= 0 || ch <= 0) return;
    var w = cw, h = cw / ar;
    if (h > ch) { h = ch; w = ch * ar; }
    var st = $('stage');
    st.style.width = Math.floor(w) + 'px';
    st.style.height = Math.floor(h) + 'px';
  }
  window.addEventListener('resize', function () { if (state.screen === 'camera') fitStage(); });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { if (state.screen === 'camera') fitStage(); }).observe($('stage-wrap'));
  }
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function startIdle() {
    stopIdle();
    if (settings.idleSeconds > 0 && (state.screen === 'result' || state.screen === 'camera') && !state.counting) {
      state.idleTimer = setTimeout(goHome, settings.idleSeconds * 1000);
    }
  }
  function stopIdle() { if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; } }
  document.addEventListener('pointerdown', function () {
    if (state.screen === 'result' || state.screen === 'camera') startIdle();
  }, true);

  function keepAwake() {
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () { }); } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') keepAwake(); });

  /* ---------- กรอบรูป / โทนสี / ซูม บนพรีวิว ---------- */
  function frameOpts() {
    return {
      title: settings.eventName,
      dateText: settings.showDate ? PB.lib.thaiDate(new Date()) : '',
      customVersion: settings.customFrameVersion
    };
  }

  // จัดขนาดช่องดูภาพให้ตรงสัดส่วนรูปที่จะบันทึก แล้ววาดกรอบ (และช่องคอลลาจ) ทับ
  function applyLayout() {
    var seq = ++state.layoutSeq;
    fitStage();
    var out = currentOut();
    var k = Math.min(1, 900 / Math.max(out.w, out.h));
    var pw = Math.max(2, Math.round(out.w * k)), ph = Math.max(2, Math.round(out.h * k));
    return PB.frames.render(settings.frame, pw, ph, frameOpts()).then(function (c) {
      if (seq !== state.layoutSeq) return;
      state.pv = { pw: pw, ph: ph, frame: c, win: collageDef().n > 1 ? PB.frames.windowRect(c) : null };
      var o = $('frame-overlay');
      o.width = pw; o.height = ph;
      if (!state.counting) { state.shots = []; state.shotIndex = 0; }
      drawOverlay();
      positionCell();
    }).catch(function () { });
  }

  // ชั้นที่วาดทับภาพสด: พื้นขาวของคอลลาจ + ภาพที่ถ่ายแล้ว + ช่องที่กำลังถ่าย (เจาะโปร่ง) + กรอบ
  function drawOverlay() {
    var pv = state.pv;
    if (!pv) return;
    var o = $('frame-overlay'), ctx = o.getContext('2d'), pw = pv.pw, ph = pv.ph;
    ctx.clearRect(0, 0, pw, ph);
    var def = collageDef();
    $('stage').classList.toggle('collage', def.n > 1);
    if (def.n > 1 && pv.win) {
      var cells = cellsAt(pw, ph);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(pv.win.x * pw), Math.round(pv.win.y * ph), Math.round(pv.win.w * pw), Math.round(pv.win.h * ph));
      cells.forEach(function (c, i) {
        if (i < state.shots.length) {
          ctx.drawImage(state.shots[i], c.x, c.y, c.w, c.h);
        } else if (i === state.shotIndex) {
          ctx.clearRect(c.x, c.y, c.w, c.h);
        } else {
          ctx.fillStyle = '#efeaff'; ctx.fillRect(c.x, c.y, c.w, c.h);
          ctx.fillStyle = '#c4b9f0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = '800 ' + Math.round(Math.min(c.w, c.h) * 0.42) + 'px ' + FONT;
          ctx.fillText(String(i + 1), c.x + c.w / 2, c.y + c.h / 2);
        }
      });
    }
    ctx.drawImage(pv.frame, 0, 0);
  }

  // วางกล่องภาพสดให้ตรงกับช่องที่กำลังจะถ่าย (ภาพเดียว = เต็มกรอบ)
  function positionCell() {
    var out = currentOut(), cells = cellsAt(out.w, out.h);
    var c = cells[Math.min(state.shotIndex, cells.length - 1)];
    var b = $('cellbox');
    b.style.left = (c.x / out.w * 100) + '%'; b.style.top = (c.y / out.h * 100) + '%';
    b.style.width = (c.w / out.w * 100) + '%'; b.style.height = (c.h / out.h * 100) + '%';
    state.cell = { w: c.w, h: c.h };
    applyVideoTransform();
  }

  function resetShots() {
    state.shots = []; state.shotIndex = 0;
    $('shot-label').classList.add('hidden');
    if (state.pv) { drawOverlay(); positionCell(); }
  }

  function applyTone() {
    var css = PB.lib.toneCss(settings.tone);
    $('video').style.filter = css;
    $('video-bg').style.filter = (css === 'none' ? '' : css + ' ') + 'blur(18px)';
  }

  // กล้องที่เลือกเองบนคอมพิวเตอร์ถือเป็นกล้องที่หันหาผู้ถ่าย (ส่องกระจกได้) ส่วนบนมือถือดูจากกล้องหน้า
  function isSelfie() { return state.streamDevice ? true : state.streamFacing === 'user'; }

  function cellAspect() { return state.cell ? state.cell.w / state.cell.h : currentOut().ar; }

  // สเกลของภาพกล้องในช่อง: ซูมด้วยซอฟต์แวร์ × (ย่อให้เห็นทั้งภาพ ถ้าเปิด “เห็นภาพกล้องทั้งหมด”)
  function viewScale(boxAr, srcAr, still) {
    var soft = (still || !state.hwZoom) ? state.zoom : 1;
    var fit = settings.viewFit ? PB.lib.fitScale(boxAr, srcAr) : 1;
    return soft * fit;
  }

  function applyVideoTransform() {
    var mirror = isSelfie() && settings.mirrorPreview;
    var s = viewScale(cellAspect(), videoAspect(), false);
    $('video').style.transform = 'scale(' + (mirror ? -s : s) + ',' + s + ')';
    var bg = $('video-bg'), need = s < 0.999 && !!state.stream;
    bg.classList.toggle('hidden', !need);
    if (need) {
      if (bg.srcObject !== state.stream) { bg.srcObject = state.stream; bg.play().catch(function () { }); }
      bg.style.transform = 'scale(' + (mirror ? -1.25 : 1.25) + ',1.25)';
    }
    updateCropHint();
  }

  // บอกผู้ใช้เมื่อภาพถูกครอปมาก (ต้นเหตุที่ภาพดูซูมใกล้): กล้องส่งภาพแนวนอน แต่กรอบเป็นแนวตั้ง
  function updateCropHint() {
    var h = $('crop-hint'), hide = function () { h.classList.add('hidden'); };
    if (state.screen !== 'camera' || state.counting || !state.stream || settings.viewFit || (!state.hwZoom && state.zoom > 1.01)) return hide();
    var box = cellAspect(), src = videoAspect();
    var lost = box < src ? 1 - box / src : 1 - src / box;
    if (lost < 0.2) return hide();
    h.textContent = 'ภาพถูกตัด' + (box < src ? 'ด้านข้าง ' : 'บน-ล่าง ') + Math.round(lost * 100) + '% · แตะเพื่อเห็นภาพกล้องทั้งหมด';
    h.classList.remove('hidden');
  }

  function videoTrack() { return state.stream ? state.stream.getVideoTracks()[0] : null; }

  function setupZoom() {
    state.hwZoom = null; state.zoom = 1;
    try {
      var track = videoTrack();
      var caps = track && track.getCapabilities ? track.getCapabilities() : {};
      if (caps.zoom && typeof caps.zoom.min === 'number' && caps.zoom.max > caps.zoom.min) {
        state.hwZoom = { min: caps.zoom.min, max: Math.min(caps.zoom.max, 5), step: caps.zoom.step || 0.1 };
        state.zoom = PB.lib.clamp(1, state.hwZoom.min, state.hwZoom.max);
        track.applyConstraints({ advanced: [{ zoom: state.zoom }] }).catch(function () { state.hwZoom = null; state.zoom = 1; applyVideoTransform(); });
      }
    } catch (e) { state.hwZoom = null; state.zoom = 1; }
    var v = $('video');
    state.camInfo = { w: v.videoWidth, h: v.videoHeight };
  }

  function setZoom(z) {
    var min = state.hwZoom ? state.hwZoom.min : 1, max = state.hwZoom ? state.hwZoom.max : 3;
    state.zoom = PB.lib.clamp(Number(z) || 1, min, max);
    if (state.hwZoom) {
      try { videoTrack().applyConstraints({ advanced: [{ zoom: state.zoom }] }).catch(function () { }); } catch (e) { /* ignore */ }
    }
    applyVideoTransform();
    updateToolbar();
  }

  /* ---------- กล้อง ---------- */
  function closeCamera() {
    if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); }
    state.stream = null; state.streamFacing = null; state.streamMode = null; state.streamDevice = ''; state.hwZoom = null;
    var v = $('video'); v.srcObject = null;
  }

  function waitForVideo(v) {
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function check() {
        if (v.videoWidth > 0) return resolve();
        if (++tries > 80) return reject(new Error('กล้องไม่ส่งภาพ'));
        setTimeout(check, 100);
      })();
    });
  }

  async function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('อุปกรณ์นี้ไม่รองรับการเปิดกล้อง');
    var my = ++state.camToken;
    closeCamera();
    var stream, deviceId = N.isDesktop ? settings.cameraId : '';
    try {
      stream = await navigator.mediaDevices.getUserMedia(PB.lib.cameraConstraints(settings.camMode, state.facing, deviceId));
    } catch (e) {
      var name = e && e.name;
      if (deviceId && (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError' || name === 'NotFoundError')) {
        // กล้องที่เลือกไว้ไม่อยู่แล้ว (ถอดสาย/เปลี่ยนพอร์ต) → ใช้กล้องเริ่มต้นแทน
        deviceId = '';
        toast('ไม่พบกล้องที่เลือกไว้ ใช้กล้องเริ่มต้นแทน — เลือกใหม่ได้ในหน้าตั้งค่า', 4000);
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: state.facing } }, audio: false });
      } else { throw e; }
    }
    if (my !== state.camToken) { stream.getTracks().forEach(function (t) { t.stop(); }); throw new Error('cancelled'); }
    state.stream = stream; state.streamFacing = state.facing; state.streamMode = settings.camMode; state.streamDevice = deviceId;
    var v = $('video');
    v.srcObject = stream;
    await v.play();
    await waitForVideo(v);
    setupZoom();
    applyVideoTransform();
    applyTone();
  }

  function ensureCamera() {
    var t = videoTrack();
    var wantDevice = N.isDesktop ? settings.cameraId : '';
    if (t && t.readyState === 'live' && state.streamFacing === state.facing && state.streamMode === settings.camMode && state.streamDevice === wantDevice) return Promise.resolve();
    return openCamera();
  }

  function showCamError(e) {
    if (e && e.message === 'cancelled') return;
    var msg;
    if (e && e.name === 'NotAllowedError') msg = N.isDesktop
      ? 'ระบบไม่อนุญาตให้ใช้กล้อง\nWindows: ตั้งค่า → ความเป็นส่วนตัว → กล้อง → เปิด “อนุญาตให้แอปบนเดสก์ท็อปเข้าถึงกล้อง”\nMac: การตั้งค่าระบบ → ความเป็นส่วนตัวและความปลอดภัย → กล้อง → เปิด Photo Booth\nแล้วกด “ลองอีกครั้ง”'
      : 'แอปยังไม่ได้รับอนุญาตให้ใช้กล้อง\nไปที่ ตั้งค่าเครื่อง → แอป → Photo Booth → สิทธิ์ → กล้อง แล้วกด “ลองอีกครั้ง”';
    else if (e && e.name === 'NotFoundError') msg = N.isDesktop ? 'ไม่พบกล้อง\nตรวจสายเชื่อมต่อ/การ์ดแคปเจอร์ หรือเลือกกล้องใหม่ในหน้าตั้งค่า' : 'ไม่พบกล้องบนเครื่องนี้';
    else if (e && e.name === 'NotReadableError') msg = 'กล้องกำลังถูกใช้งานโดยแอปอื่น\nปิดแอปอื่น (เช่น Zoom, โปรแกรมควบคุมกล้อง) แล้วลองอีกครั้ง';
    else msg = 'เปิดกล้องไม่สำเร็จ: ' + errText(e);
    $('cam-error-text').textContent = msg;
    $('cam-error').classList.remove('hidden');
    $('countdown').classList.add('hidden');
  }

  function setShutter(counting) {
    $('btn-shutter').classList.toggle('cancel', counting);
    $('shutter-label').textContent = counting ? 'ยกเลิก' : 'ถ่ายรูป';
    document.querySelector('.shutter-ico').textContent = counting ? '✕' : '📸';
    $('toolbar').style.opacity = counting ? '0.4' : '';
    $('toolbar').style.pointerEvents = counting ? 'none' : '';
    $('btn-flip').disabled = counting;
    $('btn-orient').disabled = counting;
    if (counting) $('crop-hint').classList.add('hidden');
  }

  // เข้าหน้ากล้อง: เปิดกล้อง แสดงภาพสด แล้ว "รอ" ให้กดปุ่มถ่าย (ยังไม่นับถอยหลัง)
  async function enterCamera() {
    var token = ++state.session;
    state.counting = false;
    try {
      showScreen('camera');
      closeSheet();
      resetShots();
      setShutter(false);
      $('cam-error').classList.add('hidden');
      $('countdown').classList.add('hidden');
      updateToolbar();
      await ensureCamera();
      if (token !== state.session) return;
      updateFlipVisibility();
      await applyLayout();
      updateToolbar();
      startIdle();
    } catch (e) {
      if (token === state.session) showCamError(e);
    }
  }

  async function runCountdown(token, shotNo) {
    var el = $('countdown');
    if (settings.countdown === 0 && shotNo > 0) { await sleep(900); return token === state.session; }   // คอลลาจ: เว้นจังหวะให้เปลี่ยนท่า
    for (var i = settings.countdown; i > 0; i--) {
      if (token !== state.session) return false;
      el.textContent = String(i);
      el.classList.remove('hidden', 'pop');
      void el.offsetWidth;
      el.classList.add('pop');
      await sleep(1000);
    }
    el.classList.add('hidden');
    return token === state.session;
  }

  function flash() {
    var f = $('flash');
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  // src = { img: วิดีโอ/ภาพ, w, h, still } — still = true เมื่อเป็นรูปที่ได้จากกล้องดิจิตอลจริง
  function videoSource() {
    var v = $('video');
    if (!v.videoWidth) return null;
    return { img: v, w: v.videoWidth, h: v.videoHeight, still: false };
  }

  // ตัดภาพจากกล้องให้พอดีช่อง cw×ch (ซูม / ย้อนแสง / โทนสี / กลับด้าน ตามที่ตั้งไว้)
  function buildCell(src, cw, ch) {
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var ctx = c.getContext('2d');
    var cover = PB.lib.coverRect(src.w, src.h, cw, ch);
    var s = viewScale(cw / ch, src.w / src.h, src.still);
    var css = PB.lib.toneCss(settings.tone), can = 'filter' in ctx;
    ctx.save();
    if (isSelfie() && settings.mirrorSaved) { ctx.translate(cw, 0); ctx.scale(-1, 1); }
    if (s >= 1) {
      if (can) ctx.filter = css;
      var r = PB.lib.zoomRect(cover, s);
      ctx.drawImage(src.img, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
    } else {
      // เห็นภาพทั้งหมด: พื้นหลังเป็นภาพเบลอขยายเต็มช่อง แล้ววางภาพจริงที่ย่อแล้วไว้ตรงกลาง
      var bgr = PB.lib.zoomRect(cover, 1.25);
      if (can) ctx.filter = (css === 'none' ? '' : css + ' ') + 'blur(' + Math.round(Math.max(cw, ch) * 0.025) + 'px)';
      ctx.drawImage(src.img, bgr.x, bgr.y, bgr.w, bgr.h, 0, 0, cw, ch);
      if (can) ctx.filter = css;
      var dw = cw * s, dh = ch * s;
      ctx.drawImage(src.img, cover.x, cover.y, cover.w, cover.h, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }
    ctx.restore();
    return c;
  }

  // รวมภาพที่ถ่าย (1–4 ใบ) + กรอบ เป็นรูปเดียว
  function assemble(shots, out) {
    return PB.frames.render(settings.frame, out.w, out.h, frameOpts()).then(function (frame) {
      var c;
      if (collageDef().n <= 1) {
        c = shots[0];
      } else {
        c = document.createElement('canvas');
        c.width = out.w; c.height = out.h;
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, out.w, out.h);
        var cells = cellsAt(out.w, out.h);
        shots.forEach(function (sc, i) { g.drawImage(sc, cells[i].x, cells[i].y, cells[i].w, cells[i].h); });
      }
      c.getContext('2d').drawImage(frame, 0, 0, out.w, out.h);
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('สร้างรูปไม่สำเร็จ')); }, 'image/jpeg', 0.92);
      });
    });
  }

  function grabFromVideo(cell) {
    var src = videoSource();
    if (!src) return Promise.reject(new Error('กล้องยังไม่พร้อม'));
    return Promise.resolve(buildCell(src, cell.w, cell.h));
  }

  /* ---------- ถ่ายผ่านกล้องดิจิตอล (DSLR / Mirrorless) ---------- */
  function tetherOn() {
    return !!(N.isDesktop && N.desktop && settings.tether !== 'off');
  }

  function tetherConfig() {
    return { mode: settings.tether, command: settings.tetherCommand, folder: settings.tetherFolder, timeoutSec: settings.tetherTimeout };
  }

  function decodeStill(bytes) {
    var blob = new Blob([bytes], { type: 'image/jpeg' });
    var p = typeof createImageBitmap === 'function'
      ? createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(blob); })
      : Promise.reject(new Error('createImageBitmap'));
    return p.then(function (bmp) {
      return { img: bmp, w: bmp.width, h: bmp.height, still: true, close: function () { if (bmp.close) bmp.close(); } };
    }, function () {
      return new Promise(function (resolve, reject) {
        var im = new Image(), u = URL.createObjectURL(blob);
        im.onload = function () { URL.revokeObjectURL(u); resolve({ img: im, w: im.naturalWidth, h: im.naturalHeight, still: true, close: function () { } }); };
        im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('อ่านรูปจากกล้องไม่ได้')); };
        im.src = u;
      });
    });
  }

  // สั่งกล้องดิจิตอลถ่ายจริง แล้วตัดเป็นช่อง — ถ้าล้มเหลวจะใช้ภาพจากพรีวิวแทน เพื่อไม่ให้คิวแขกค้าง
  function grabFromCamera(token, cell) {
    var cd = $('countdown');
    cd.textContent = '📸'; cd.classList.remove('hidden', 'pop');
    $('btn-shutter').disabled = true;
    var t0 = Date.now();
    return N.desktop.tetherCapture(tetherConfig()).then(function (res) { return decodeStill(res.data); }).then(function (still) {
      var c;
      try { c = buildCell(still, cell.w, cell.h); } finally { still.close(); }
      state.lastTetherMs = Date.now() - t0;
      return c;
    }, function (e) {
      if (token === state.session) toast('ถ่ายจากกล้องดิจิตอลไม่สำเร็จ จึงใช้ภาพจากพรีวิวแทน — ' + errText(e), 5000);
      return grabFromVideo(cell);
    }).then(function (c) {
      cd.classList.add('hidden'); $('btn-shutter').disabled = false;
      return c;
    }, function (e) {
      cd.classList.add('hidden'); $('btn-shutter').disabled = false;
      throw e;
    });
  }

  function cancelShot() {
    state.session++;
    state.counting = false;
    $('countdown').classList.add('hidden');
    $('btn-shutter').disabled = false;
    setShutter(false);
    resetShots();
    updateCropHint();
    startIdle();
  }

  // กดปุ่มถ่าย → (นับถอยหลัง → ถ่าย) ซ้ำตามจำนวนภาพของคอลลาจ → รวมภาพ (กดซ้ำระหว่างนับ = ยกเลิกทั้งหมด)
  async function shoot() {
    if (state.counting) { cancelShot(); return; }
    if (state.screen !== 'camera' || !videoTrack() || !$('cam-error').classList.contains('hidden')) return;
    var token = ++state.session;
    state.counting = true;
    closeSheet(); stopIdle(); setShutter(true);
    try {
      var out = currentOut(), n = collageDef().n, label = $('shot-label');
      state.shots = []; state.shotIndex = 0;
      for (var i = 0; i < n; i++) {
        state.shotIndex = i;
        drawOverlay(); positionCell();
        if (n > 1) { label.textContent = 'ภาพที่ ' + (i + 1) + ' / ' + n; label.classList.remove('hidden'); }
        if (!(await runCountdown(token, i))) return;
        flash();
        var cell = cellsAt(out.w, out.h)[i];
        var canvas = await (tetherOn() ? grabFromCamera(token, cell) : grabFromVideo(cell));
        if (token !== state.session) return;
        state.shots.push(canvas);
        if (i < n - 1) { drawOverlay(); await sleep(750); if (token !== state.session) return; }
      }
      var blob = await assemble(state.shots, out);
      if (token !== state.session) return;
      state.counting = false; setShutter(false);
      $('shot-label').classList.add('hidden');
      await showResult(blob);
    } catch (e) {
      if (token === state.session) {
        state.counting = false; setShutter(false); resetShots(); startIdle();
        toast('ถ่ายรูปไม่สำเร็จ: ' + errText(e), 4000);
      }
    }
  }

  function goHome() {
    state.session++; state.camToken++;
    state.counting = false;
    closeCamera();
    closeSheet();
    setShutter(false);
    resetShots();
    $('countdown').classList.add('hidden');
    if (state.current && state.current.url) URL.revokeObjectURL(state.current.url);
    state.current = null;
    showScreen('home');
    refreshPending();
  }

  /* ---------- ผลลัพธ์ (ไม่มี QR — แค่แสดงสถานะอัปโหลดเล็กๆ) ---------- */
  function setChip(kind, text) {
    var c = $('upload-chip');
    if (!kind) { c.classList.add('hidden'); return; }
    c.className = 'chip' + (kind === 'ok' ? ' ok' : kind === 'warn' ? ' warn' : '');
    c.textContent = text;
  }

  async function showResult(blob) {
    if (state.current && state.current.url) URL.revokeObjectURL(state.current.url);
    var id = PB.lib.makeId();
    var url = URL.createObjectURL(blob);
    state.current = { id: id, blob: blob, url: url };
    $('result-img').src = url;
    showScreen('result');
    startIdle();
    saveLocal(blob, PB.lib.photoName(id));
    if (settings.autoPrint && N.isDesktop && settings.printMode === 'silent') printCurrent();

    if (!settings.scriptUrl) { setChip(null); return; }
    setChip('wait', '☁ กำลังอัปโหลดขึ้น Google Drive…');
    try { await uploader.enqueue(blob, id, settings.eventName); }
    catch (e) { setChip('warn', '⚠ บันทึกคิวอัปโหลดไม่สำเร็จ'); }
  }

  function onUploadDone(rec) {
    refreshPending();
    if (state.current && state.current.id === rec.id) setChip('ok', '☁ อัปโหลดขึ้น Google Drive แล้ว ✓');
  }
  function onUploadFail(rec) {
    refreshPending();
    if (state.current && state.current.id === rec.id) setChip('warn', '⚠ ยังส่งขึ้น Drive ไม่สำเร็จ ระบบจะลองใหม่ให้เอง');
  }

  function refreshPending() {
    uploader.stats().then(function (st) {
      var pill = $('pending-pill');
      if (st.pending > 0) { pill.textContent = 'รออัปโหลด ' + st.pending + ' รูป'; pill.classList.remove('hidden'); }
      else pill.classList.add('hidden');
    }).catch(function () { });
  }

  /* ---------- บันทึกในเครื่อง / พิมพ์ ---------- */
  function saveLocal(blob, name) {
    if (!settings.saveLocalCopy || !N.canAutoSave) return;
    N.saveImage(blob, name, { dir: settings.saveDir, sub: settings.eventName }).catch(function () { });
  }

  function printOpts(copies) {
    return {
      silent: N.isDesktop && settings.printMode === 'silent',
      printer: settings.printer, paper: settings.paper,
      copies: copies || settings.copies
    };
  }

  function printBlob(blob, jobName, copies) {
    return N.print(blob, jobName, printOpts(copies));
  }

  function printCurrent() {
    if (!state.current) return;
    startIdle();
    var silent = printOpts().silent;
    printBlob(state.current.blob, settings.eventName).then(function () {
      if (silent) toast('ส่งไปเครื่องพิมพ์แล้ว (' + settings.copies + ' ชุด)');
    }).catch(function (e) { toast('พิมพ์ไม่สำเร็จ: ' + errText(e), 4000); });
  }

  /* ---------- แถบเครื่องมือ + แผงตัวเลือกในหน้ากล้อง ---------- */
  function frameName(id) {
    var f = find(PB.frames.list(true), id);
    return f ? f.name : '';
  }

  function updateToolbar() {
    $('val-frame').textContent = shortName(frameName(settings.frame));
    var tone = find(PB.lib.TONES, settings.tone);
    $('val-tone').textContent = tone ? tone.label : '';
    var asp = find(PB.lib.ASPECTS, settings.aspect), ori = find(PB.lib.ORIENTS, settings.orient);
    $('val-ratio').textContent = (asp ? asp.label : '') + (settings.aspect !== 'auto' && ori ? ' · ' + ori.label : '');
    $('val-collage').textContent = collageDef().label;
    $('btn-orient').textContent = (settings.orient === 'landscape' ? '↔ แนวนอน' : '↕ แนวตั้ง');
    var sz = find(PB.lib.SIZES, settings.size);
    $('val-size').textContent = sz ? sz.label : '';
    $('val-timer').textContent = settings.countdown > 0 ? settings.countdown + ' วิ' : 'ไม่นับ';
    $('val-zoom').textContent = fmtZoom(state.zoom);
  }

  var SHEET_TITLES = {
    frame: 'เลือกกรอบ', tone: 'โทนสี', ratio: 'สัดส่วนภาพ', size: 'ขนาดภาพ',
    timer: 'นับถอยหลังก่อนถ่าย', zoom: 'ซูม / มุมมอง', collage: 'ถ่ายหลายภาพต่อกัน (คอลลาจ)'
  };

  function markTools() {
    var tools = document.querySelectorAll('#toolbar .tool');
    for (var i = 0; i < tools.length; i++) tools[i].classList.toggle('on', tools[i].getAttribute('data-sheet') === state.sheet);
  }
  function markOn(body, id) {
    var btns = body.querySelectorAll('[data-id]');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-id') === String(id));
  }

  function closeSheet() {
    state.sheet = null;
    $('sheet').classList.add('hidden');
    markTools();
  }

  function openSheet(name) {
    if (state.counting || state.screen !== 'camera') return;
    if (state.sheet === name) { closeSheet(); return; }
    state.sheet = name;
    $('sheet-title').textContent = SHEET_TITLES[name];
    var body = $('sheet-body');
    body.innerHTML = '';
    ({ frame: buildFrameSheet, tone: buildToneSheet, ratio: buildRatioSheet, size: buildSizeSheet, timer: buildTimerSheet, zoom: buildZoomSheet, collage: buildCollageSheet })[name](body);
    $('sheet').classList.remove('hidden');
    markTools();
  }

  function optionButton(id, current, onPick, body) {
    var b = el('button', 'opt' + (String(current) === String(id) ? ' on' : ''));
    b.type = 'button';
    b.setAttribute('data-id', id);
    b.addEventListener('click', function () { onPick(id); markOn(body, id); });
    body.appendChild(b);
    return b;
  }

  // ปุ่มสลับ 2 ตัวเลือก (เช่น แนวตั้ง / แนวนอน) เต็มแถว
  function segmented(body, list, current, onPick) {
    var row = el('div', 'seg');
    list.forEach(function (it) {
      var b = el('button', 'seg-btn' + (it.id === current ? ' on' : ''), it.label);
      b.type = 'button'; b.setAttribute('data-orient', it.id);
      b.addEventListener('click', function () {
        onPick(it.id);
        var all = row.querySelectorAll('.seg-btn');
        for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === b);
      });
      row.appendChild(b);
    });
    body.appendChild(row);
  }

  function orientSeg(body) {
    segmented(body, PB.lib.ORIENTS, settings.orient, function (id) { commit({ orient: id }); rebuildSheet(); });
  }

  function rebuildSheet() {
    var name = state.sheet;
    if (!name) return;
    state.sheet = null;
    openSheet(name);
  }

  function buildFrameSheet(body) {
    orientSeg(body);
    PB.store.getAsset('customFrame').catch(function () { return null; }).then(function (blob) {
      if (state.sheet !== 'frame') return;
      var out = currentOut(), tw = 160, th = Math.max(2, Math.round(tw / (out.w / out.h)));
      if (th > 240) { th = 240; tw = Math.round(th * (out.w / out.h)); }
      PB.frames.list(!!blob).forEach(function (f) {
        var b = optionButton(f.id, settings.frame, function (id) { commit({ frame: id }); }, body);
        b.className += ' thumb';
        var c = document.createElement('canvas');
        c.width = tw; c.height = th;
        b.appendChild(c);
        b.appendChild(el('span', null, shortName(f.name)));
        PB.frames.render(f.id, tw, th, frameOpts()).then(function (fc) {
          var ctx = c.getContext('2d');
          var g = ctx.createLinearGradient(0, 0, tw, th);
          g.addColorStop(0, '#6fa8ff'); g.addColorStop(1, '#ffb86f');
          ctx.fillStyle = g; ctx.fillRect(0, 0, tw, th);
          ctx.drawImage(fc, 0, 0);
        }).catch(function () { });
      });
    });
  }

  function buildToneSheet(body) {
    PB.lib.TONES.forEach(function (t) {
      var b = optionButton(t.id, settings.tone, function (id) { commit({ tone: id }); }, body);
      var dot = el('i', 'dot');
      dot.style.background = t.sw;
      b.appendChild(dot);
      b.appendChild(el('span', null, t.label));
    });
  }

  function buildRatioSheet(body) {
    orientSeg(body);
    PB.lib.ASPECTS.forEach(function (a) {
      var b = optionButton(a.id, settings.aspect, function (id) { commit({ aspect: id }); }, body);
      if (a.id !== 'auto') {
        var r = PB.lib.aspectValue(a.id, 0, settings.orient), box = el('i', 'arbox');
        box.style.width = Math.round(r >= 1 ? 24 : 24 * r) + 'px';
        box.style.height = Math.round(r >= 1 ? 24 / r : 24) + 'px';
        b.appendChild(box);
      }
      b.appendChild(el('span', null, a.label));
      b.appendChild(el('small', null, a.hint));
    });
  }

  // ไอคอนเล็กแสดงการจัดวางภาพของแต่ละแบบคอลลาจ ตามแนวภาพที่เลือกอยู่
  function collageIcon(id) {
    var ar = PB.lib.aspectValue(settings.aspect, videoAspect(), settings.orient);
    var w = ar >= 1 ? 46 : Math.round(46 * ar), h = ar >= 1 ? Math.round(46 / ar) : 46;
    var c = document.createElement('canvas');
    c.width = w * 2; c.height = h * 2;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    var g = c.getContext('2d');
    g.fillStyle = 'rgba(108,76,255,0.14)'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#6c4cff';
    PB.lib.collageCells(id, c.width - 8, c.height - 8, 4).forEach(function (cl) { g.fillRect(cl.x + 4, cl.y + 4, cl.w, cl.h); });
    return c;
  }

  function buildCollageSheet(body) {
    PB.lib.COLLAGES.forEach(function (cg) {
      var b = optionButton(cg.id, settings.collage, function (id) { commit({ collage: id }); }, body);
      b.className += ' thumb';
      b.appendChild(collageIcon(cg.id));
      b.appendChild(el('span', null, cg.label));
    });
    body.appendChild(el('p', 'sheet-note', 'กดถ่ายครั้งเดียว ระบบจะนับถอยหลังและถ่ายต่อเนื่องจนครบทุกช่อง แล้วรวมเป็นรูปเดียวใส่กรอบให้ · กดปุ่มยกเลิกเพื่อเริ่มใหม่'));
  }

  function buildSizeSheet(body) {
    PB.lib.SIZES.forEach(function (s) {
      var b = optionButton(s.id, settings.size, function (id) { commit({ size: id }); }, body);
      b.appendChild(el('span', null, s.label));
      b.appendChild(el('small', null, s.hint));
    });
  }

  function buildTimerSheet(body) {
    PB.lib.TIMERS.forEach(function (n) {
      var b = optionButton(n, settings.countdown, function (id) { commit({ countdown: Number(id) }); }, body);
      b.appendChild(el('span', null, n > 0 ? n + ' วินาที' : 'ไม่นับ (ถ่ายทันที)'));
    });
  }

  function buildZoomSheet(body) {
    var hw = state.hwZoom, min = hw ? hw.min : 1, max = hw ? hw.max : 3, step = hw ? hw.step : 0.1;
    var row = el('div', 'zoom-row');
    var slider = document.createElement('input');
    slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = state.zoom;
    var read = el('span', 'zoom-read', fmtZoom(state.zoom));
    slider.addEventListener('input', function () { setZoom(Number(slider.value)); read.textContent = fmtZoom(state.zoom); });
    row.appendChild(slider); row.appendChild(read);
    body.appendChild(row);
    var reset = el('button', 'opt', 'รีเซ็ตซูม 1×');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      setZoom(PB.lib.clamp(1, min, max)); slider.value = state.zoom; read.textContent = fmtZoom(state.zoom);
    });
    body.appendChild(reset);
    var fit = el('button', 'opt fit-btn' + (settings.viewFit ? ' on' : ''), '👁 เห็นภาพกล้องทั้งหมด (ไม่ครอป)');
    fit.type = 'button';
    fit.addEventListener('click', function () { commit({ viewFit: !settings.viewFit }); fit.classList.toggle('on', settings.viewFit); });
    body.appendChild(fit);
    var info = state.camInfo ? 'กล้องส่งภาพ ' + state.camInfo.w + '×' + state.camInfo.h + ' · ' : '';
    body.appendChild(el('p', 'sheet-note', info + (hw ? 'ซูมด้วยกล้องจริง · ' : 'ซูมโดยครอปภาพ · ') +
      'ถ้าภาพดูซูมใกล้เกินไป: เปลี่ยนเป็น “แนวนอน” (ปุ่มด้านบน) หรือเปิด “เห็นภาพกล้องทั้งหมด” ซึ่งจะแสดงภาพเต็มเฟรมโดยเติมขอบด้วยภาพเบลอ'));
  }

  /* ---------- ตั้งค่า ---------- */
  function setInfo(text, cls) { var i = $('s-info'); i.className = 'info' + (cls ? ' ' + cls : ''); i.textContent = text; }
  function setAlbumNote(text, cls) { var i = $('s-album-note'); i.className = 'info' + (cls ? ' ' + cls : ''); i.textContent = text; }

  function updateInfo() {
    uploader.stats().then(function (st) {
      var lines = ['ถ่ายไปแล้ว ' + st.total + ' รูป · อัปโหลดแล้ว ' + st.done + ' · ค้างส่ง ' + st.pending];
      if (settings.scriptUrl && !PB.lib.isValidScriptUrl(settings.scriptUrl)) {
        lines.push('⚠ URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://script.google.com/ และลงท้ายด้วย /exec');
      }
      if (st.lastError) lines.push('ข้อผิดพลาดล่าสุด: ' + String(st.lastError).slice(0, 120));
      if (state.camInfo) lines.push('กล้องล่าสุดส่งภาพ ' + state.camInfo.w + '×' + state.camInfo.h);
      setInfo(lines.join('\n'));
    }).catch(function () { });
  }

  function albumValid() { return /^https?:\/\//i.test(settings.albumUrl); }

  function drawAlbumPreview() {
    var c = $('s-qr-canvas');
    if (!albumValid()) {
      c.classList.add('hidden');
      setAlbumNote('ยังไม่มี QR — กด “สร้าง QR จาก Drive” หรือวางลิงก์ในช่องด้านบน');
      return;
    }
    try {
      PB.qr.draw(c, settings.albumUrl, { size: 480 });
      c.classList.remove('hidden');
      if (settings.albumEvent && settings.albumEvent !== settings.eventName) {
        setAlbumNote('⚠ ชื่ออีเวนต์เปลี่ยนไปจากตอนสร้าง QR (“' + settings.albumEvent + '”) รูปใหม่จะไปอยู่โฟลเดอร์ใหม่ ถ้าต้องการให้ QR พาไปโฟลเดอร์ใหม่ ให้กด “สร้าง QR จาก Drive” อีกครั้ง', 'err');
      } else {
        setAlbumNote('ลองสแกนด้วยมือถือเพื่อทดสอบ แล้วกด “พิมพ์ใบ QR” ไปติดหน้าบูธ');
      }
    } catch (e) {
      c.classList.add('hidden');
      setAlbumNote('สร้าง QR ไม่ได้: ' + errText(e), 'err');
    }
  }

  function fillSettings() {
    $('s-event').value = settings.eventName;
    $('s-showdate').checked = settings.showDate;
    $('s-facing').value = settings.facing;
    $('s-cammode').value = settings.camMode;
    $('s-mirror-preview').checked = settings.mirrorPreview;
    $('s-mirror-saved').checked = settings.mirrorSaved;
    $('s-idle').value = settings.idleSeconds;
    $('s-savelocal').checked = settings.saveLocalCopy;
    $('s-script').value = settings.scriptUrl;
    $('s-token').value = settings.token;
    $('s-album').value = settings.albumUrl;
    $('s-tether').value = settings.tether;
    $('s-tether-cmd').value = settings.tetherCommand;
    $('s-tether-folder').value = settings.tetherFolder;
    $('s-tether-timeout').value = settings.tetherTimeout;
    $('s-printmode').value = settings.printMode;
    $('s-paper').value = settings.paper;
    $('s-copies').value = settings.copies;
    $('s-autoprint').checked = settings.autoPrint;
    $('s-savedir').value = settings.saveDir;
    $('s-fullscreen').checked = settings.startFullscreen;
    renderCameraSelect();
    renderPrinterSelect();
    updateTetherUi();
    drawAlbumPreview();
  }

  /* ---------- เวอร์ชันคอมพิวเตอร์: กล้อง เครื่องพิมพ์ กล้องดิจิตอล ---------- */
  function fillOptions(sel, list) {
    sel.innerHTML = '';
    list.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.id; o.textContent = it.label;
      sel.appendChild(o);
    });
  }

  function populateStaticSelects() {
    fillOptions($('s-tether'), PB.lib.TETHER_MODES);
    fillOptions($('s-tether-preset'), PB.lib.TETHER_PRESETS);
    fillOptions($('s-printmode'), PB.lib.PRINT_MODES);
    fillOptions($('s-paper'), PB.lib.PAPERS);
  }

  function listCameras(askPermission) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    function pull() {
      return navigator.mediaDevices.enumerateDevices().then(function (all) {
        return all.filter(function (d) { return d.kind === 'videoinput'; });
      });
    }
    return pull().then(function (list) {
      // ยังไม่เคยขออนุญาตกล้อง ชื่อกล้องจะว่าง — เปิดแว้บเดียวเพื่อให้เห็นชื่อ
      if (askPermission && list.length && !state.stream && list.some(function (d) { return !d.label; })) {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then(function (st) {
          st.getTracks().forEach(function (t) { t.stop(); });
          return pull();
        }, function () { return list; });
      }
      return list;
    }).then(function (list) {
      state.devices = list;
      // deviceId เปลี่ยนไปแต่ชื่อเดิมยังอยู่ → ใช้ตัวเดิมต่อ
      if (settings.cameraId && settings.cameraLabel && !list.some(function (d) { return d.deviceId === settings.cameraId; })) {
        for (var i = 0; i < list.length; i++) {
          if (list[i].label === settings.cameraLabel) { settings = PB.store.saveSettings(Object.assign({}, settings, { cameraId: list[i].deviceId })); break; }
        }
      }
      return list;
    }).catch(function () { return []; });
  }

  function renderCameraSelect() {
    var sel = $('s-camera');
    sel.innerHTML = '';
    var add = function (v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('', 'กล้องเริ่มต้นของระบบ');
    var found = false;
    state.devices.forEach(function (d, i) {
      add(d.deviceId, d.label || ('กล้อง ' + (i + 1)));
      if (d.deviceId === settings.cameraId) found = true;
    });
    if (settings.cameraId && !found) add(settings.cameraId, (settings.cameraLabel || 'กล้องที่เลือกไว้') + ' (ไม่พบ — ยังไม่ได้เชื่อมต่อ)');
    sel.value = settings.cameraId;
  }

  function updateFlipVisibility() {
    if (!N.isDesktop) return;
    listCameras(false).then(function (l) { $('btn-flip').classList.toggle('hidden', l.length < 2); });
  }

  // บนคอมพิวเตอร์ปุ่ม “สลับกล้อง” วนไปยังกล้องตัวถัดไป
  function cycleCamera() {
    return listCameras(false).then(function (list) {
      if (list.length < 2) { toast('พบกล้องเพียงตัวเดียว'); return false; }
      var t = videoTrack(), cur = t && t.getSettings ? t.getSettings().deviceId : '';
      var idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].deviceId === (cur || settings.cameraId)) idx = i;
      var next = list[(idx + 1) % list.length];
      commit({ cameraId: next.deviceId, cameraLabel: next.label || '' });
      return true;
    });
  }

  function renderPrinterSelect() {
    var sel = $('s-printer');
    sel.innerHTML = '';
    var add = function (v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('', 'เครื่องพิมพ์เริ่มต้นของระบบ');
    var found = false;
    (state.printers || []).forEach(function (p) {
      add(p.name, (p.displayName || p.name) + (p.isDefault ? ' (ค่าเริ่มต้น)' : ''));
      if (p.name === settings.printer) found = true;
    });
    if (settings.printer && !found) add(settings.printer, settings.printer + ' (ไม่พบ)');
    sel.value = settings.printer;
  }

  function refreshPrinters() {
    if (!N.isDesktop || !N.desktop.listPrinters) return;
    N.desktop.listPrinters().then(function (list) { state.printers = list || []; renderPrinterSelect(); }).catch(function () { });
  }

  function updateTetherUi() {
    var mode = settings.tether;
    $('tether-command-box').style.display = mode === 'off' ? 'none' : '';
    $('tether-folder-box').style.display = mode === 'folder' ? '' : 'none';
    $('tether-timeout-box').style.display = mode === 'off' ? 'none' : '';
    $('tether-test-box').style.display = mode === 'off' ? 'none' : '';
    var preset = 'custom';
    PB.lib.TETHER_PRESETS.forEach(function (p) { if (p.command && p.command === settings.tetherCommand) preset = p.id; });
    $('s-tether-preset').value = preset;
  }

  function testTether() {
    var info = $('s-tether-info'), img = $('s-tether-preview');
    info.className = 'info'; info.textContent = 'กำลังสั่งกล้องถ่าย… (อย่าเพิ่งกดอะไร)';
    img.classList.add('hidden');
    var t0 = Date.now();
    N.desktop.tetherCapture(tetherConfig()).then(function (res) {
      var blob = new Blob([res.data], { type: 'image/jpeg' });
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      img.dataset.url = URL.createObjectURL(blob);
      img.src = img.dataset.url; img.classList.remove('hidden');
      info.className = 'info ok';
      info.textContent = 'ถ่ายสำเร็จ ✓ ' + res.width + '×' + res.height + ' px · ' + Math.round(res.data.length / 1024) + ' KB · ใช้เวลา ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วินาที';
    }).catch(function (e) {
      info.className = 'info err'; info.textContent = 'ไม่สำเร็จ: ' + errText(e);
    });
  }

  function testPrintBlob() {
    var W = 1200, H = 1800, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#6fa8ff'); g.addColorStop(1, '#ffb86f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, H); ctx.moveTo(W, 0); ctx.lineTo(0, H); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 110px ' + FONT; ctx.fillText('ทดสอบการพิมพ์', W / 2, 560);
    ctx.font = '500 56px ' + FONT;
    var paper = find(PB.lib.PAPERS, settings.paper);
    ctx.fillText(settings.eventName, W / 2, 700);
    ctx.fillText('กระดาษ: ' + (paper ? paper.label : ''), W / 2, 790);
    ctx.fillText(PB.lib.thaiDate(new Date()), W / 2, 880);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('สร้างหน้าทดสอบไม่สำเร็จ')); }, 'image/jpeg', 0.92);
    });
  }

  // บันทึกค่าใหม่ แล้วอัปเดตทุกอย่างที่เกี่ยวข้อง (หน้าตั้งค่า แถบเครื่องมือ พรีวิวกล้อง)
  function commit(patch) {
    settings = PB.store.saveSettings(Object.assign({}, settings, patch));
    if ('startFullscreen' in patch && N.isDesktop) N.desktop.setFullscreen(settings.startFullscreen);
    if ('facing' in patch) state.facing = settings.facing;
    $('home-title').textContent = settings.eventName;
    fillSettings();
    updateToolbar();
    updateInfo();
    if (state.screen === 'camera') {
      if ('tone' in patch) applyTone();
      if ('mirrorPreview' in patch || 'viewFit' in patch) applyVideoTransform();
      ['frame', 'aspect', 'size', 'eventName', 'showDate', 'customFrameVersion', 'orient', 'collage'].forEach(function (k) {
        if (k in patch) applyLayout();
      });
    }
    uploader.pump();
  }

  function bindSettings() {
    [
      ['s-event', 'eventName', 'v'], ['s-showdate', 'showDate', 'c'], ['s-facing', 'facing', 'v'], ['s-cammode', 'camMode', 'v'],
      ['s-mirror-preview', 'mirrorPreview', 'c'], ['s-mirror-saved', 'mirrorSaved', 'c'], ['s-idle', 'idleSeconds', 'v'],
      ['s-savelocal', 'saveLocalCopy', 'c'], ['s-script', 'scriptUrl', 'v'], ['s-token', 'token', 'v'], ['s-album', 'albumUrl', 'v'],
      ['s-tether', 'tether', 'v'], ['s-tether-cmd', 'tetherCommand', 'v'], ['s-tether-folder', 'tetherFolder', 'v'],
      ['s-tether-timeout', 'tetherTimeout', 'v'], ['s-printmode', 'printMode', 'v'], ['s-printer', 'printer', 'v'],
      ['s-paper', 'paper', 'v'], ['s-copies', 'copies', 'v'], ['s-autoprint', 'autoPrint', 'c'],
      ['s-savedir', 'saveDir', 'v'], ['s-fullscreen', 'startFullscreen', 'c']
    ].forEach(function (m) {
      var elx = $(m[0]);
      elx.addEventListener('change', function () {
        var patch = {};
        patch[m[1]] = m[2] === 'c' ? elx.checked : elx.value;
        if (m[1] === 'albumUrl') patch.albumEvent = settings.eventName;
        commit(patch);
      });
    });

    $('s-frame-file').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      PB.store.putAsset('customFrame', file).then(function () {
        commit({ frame: 'custom', customFrameVersion: settings.customFrameVersion + 1 });
        toast('บันทึกกรอบของคุณแล้ว — เลือกใช้ได้ในหน้ากล้อง');
      }).catch(function () { toast('บันทึกกรอบไม่สำเร็จ'); });
      e.target.value = '';
    });

    $('btn-test').addEventListener('click', function () {
      setInfo('กำลังทดสอบการเชื่อมต่อ…');
      uploader.testConnection(settings.scriptUrl, settings.token).then(function (j) {
        if (j.tokenOk === false) setInfo('เชื่อมต่อได้ แต่รหัสผ่าน (Token) ไม่ตรงกับที่ตั้งไว้ใน Code.gs', 'err');
        else setInfo('เชื่อมต่อสำเร็จ ✓ พร้อมอัปโหลดรูป', 'ok');
      }).catch(function (e) { setInfo('เชื่อมต่อไม่สำเร็จ: ' + errText(e), 'err'); });
    });

    $('btn-retry-all').addEventListener('click', function () {
      uploader.retryNow().then(function () { toast('สั่งส่งรูปที่ค้างอีกครั้งแล้ว'); updateInfo(); });
    });

    $('btn-album-gen').addEventListener('click', function () {
      setAlbumNote('กำลังขอลิงก์อัลบั้มจาก Drive…');
      uploader.getAlbum(settings.scriptUrl, settings.token, settings.eventName).then(function (j) {
        commit({ albumUrl: j.folderUrl, albumEvent: settings.eventName });
        setAlbumNote('สร้าง QR สำเร็จ ✓ ใครสแกนจะเห็นรูปทั้งหมดในอัลบั้มของงานนี้ — กด “พิมพ์ใบ QR” เพื่อไปติดหน้าบูธ', 'ok');
      }).catch(function (e) { setAlbumNote('สร้างไม่สำเร็จ: ' + errText(e), 'err'); });
    });

    $('btn-qr-print').addEventListener('click', function () {
      qrCardBlob().then(function (b) { return printBlob(b, 'QR ' + settings.eventName, 1); })
        .catch(function (e) { toast(errText(e), 4000); });
    });

    $('btn-qr-save').addEventListener('click', function () {
      qrCardBlob().then(function (b) {
        return N.saveImage(b, 'PhotoBooth_QR_' + PB.lib.stamp() + '.jpg', { dir: settings.saveDir, sub: settings.eventName }).then(function (r) {
          if (N.isDesktop) toast(r && r.ok ? 'บันทึกใบ QR แล้วที่ ' + r.path : 'บันทึกไม่สำเร็จ', 4500);
          else if (N.isAndroid) toast(r && r.ok ? 'บันทึกใบ QR ไว้ที่แกลเลอรี (Pictures/PhotoBooth) แล้ว' : 'บันทึกไม่ได้ (ต้องใช้ Android 10 ขึ้นไป)', 3500);
        });
      }).catch(function (e) { toast(errText(e), 4000); });
    });

    $('btn-settings-close').addEventListener('click', closeSettings);

    if (!N.isDesktop) return;
    var D = N.desktop;
    $('s-camera').addEventListener('change', function () {
      var sel = $('s-camera'), opt = sel.options[sel.selectedIndex];
      commit({ cameraId: sel.value, cameraLabel: sel.value && opt ? opt.textContent : '' });
    });
    $('btn-cam-refresh').addEventListener('click', function () {
      listCameras(true).then(function (l) { renderCameraSelect(); toast('พบกล้อง ' + l.length + ' ตัว'); });
    });
    $('s-tether-preset').addEventListener('change', function () {
      var p = find(PB.lib.TETHER_PRESETS, $('s-tether-preset').value);
      if (p && p.command) commit({ tetherCommand: p.command, tether: p.mode || settings.tether });
    });
    $('btn-tether-folder').addEventListener('click', function () {
      D.pickFolder().then(function (p) { if (p) commit({ tetherFolder: p }); });
    });
    $('btn-tether-test').addEventListener('click', testTether);
    $('btn-printer-refresh').addEventListener('click', function () { refreshPrinters(); toast('ค้นหาเครื่องพิมพ์แล้ว'); });
    $('btn-print-test').addEventListener('click', function () {
      testPrintBlob().then(function (b) { return printBlob(b, 'ทดสอบการพิมพ์', 1); })
        .then(function () { toast('ส่งหน้าทดสอบไปเครื่องพิมพ์แล้ว'); })
        .catch(function (e) { toast('พิมพ์ไม่สำเร็จ: ' + errText(e), 4500); });
    });
    $('btn-savedir-pick').addEventListener('click', function () {
      D.pickFolder().then(function (p) { if (p) commit({ saveDir: p }); });
    });
    $('btn-savedir-open').addEventListener('click', function () {
      D.openFolder(settings.saveDir).then(function (r) { if (r && r.error) toast('เปิดโฟลเดอร์ไม่ได้: ' + r.error, 4000); });
    });
    $('btn-fs').addEventListener('click', function () { D.toggleFullscreen(); });
    $('btn-quit').addEventListener('click', function () {
      if (window.confirm('ปิดโปรแกรม Photo Booth ใช่ไหม?')) D.quit();
    });
  }

  /* ---------- ใบ QR สำหรับพิมพ์ ---------- */
  function renderQrCard() {
    if (!albumValid()) throw new Error('ยังไม่มีลิงก์สำหรับสร้าง QR');
    var W = 1200, H = 1800;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    var qc = document.createElement('canvas');
    PB.qr.draw(qc, settings.albumUrl, { size: 900 });

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var size = 100;
    ctx.font = '800 ' + size + 'px ' + FONT;
    while (ctx.measureText(settings.eventName).width > W - 160 && size > 40) { size -= 4; ctx.font = '800 ' + size + 'px ' + FONT; }
    ctx.fillStyle = '#1b1340';
    ctx.fillText(settings.eventName, W / 2, 230);

    ctx.font = '500 58px ' + FONT;
    ctx.fillStyle = '#4a4470';
    ctx.fillText('สแกนเพื่อดูและโหลดรูปของคุณ', W / 2, 350);

    var qy = 450;
    ctx.drawImage(qc, Math.round((W - qc.width) / 2), qy);

    ctx.font = '500 48px ' + FONT;
    ctx.fillStyle = '#4a4470';
    ctx.fillText('เปิดกล้องมือถือแล้วสแกนได้เลย', W / 2, qy + qc.height + 110);
    return c;
  }

  function qrCardBlob() {
    return new Promise(function (resolve, reject) {
      var c;
      try { c = renderQrCard(); } catch (e) { reject(e); return; }
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('สร้างใบ QR ไม่สำเร็จ')); }, 'image/jpeg', 0.95);
    });
  }

  function openSettings() {
    fillSettings(); updateInfo();
    if (N.isDesktop) { listCameras(true).then(renderCameraSelect); refreshPrinters(); }
    $('modal-settings').classList.remove('hidden');
  }
  function closeSettings() { $('modal-settings').classList.add('hidden'); refreshPending(); }

  /* ---------- ปุ่มต่างๆ ---------- */
  function bindButtons() {
    $('btn-start').addEventListener('click', function () { if (state.screen === 'home') enterCamera(); });
    $('btn-cam-back').addEventListener('click', goHome);
    $('btn-cam-retry').addEventListener('click', enterCamera);
    $('btn-flip').addEventListener('click', function () {
      if (state.counting) return;
      if (N.isDesktop) { cycleCamera().then(function (ok) { if (ok) enterCamera(); }); return; }
      state.facing = state.facing === 'user' ? 'environment' : 'user';
      enterCamera();
    });
    $('btn-shutter').addEventListener('click', shoot);
    $('btn-orient').addEventListener('click', function () {
      if (state.counting) return;
      commit({ orient: settings.orient === 'landscape' ? 'portrait' : 'landscape' });
      if (state.sheet) rebuildSheet();
    });
    $('crop-hint').addEventListener('click', function () { commit({ viewFit: true }); });
    $('btn-retake').addEventListener('click', function () { if (state.screen === 'result') enterCamera(); });
    $('btn-print').addEventListener('click', printCurrent);
    $('btn-done').addEventListener('click', goHome);
    $('sheet-close').addEventListener('click', closeSheet);

    var tools = document.querySelectorAll('#toolbar .tool');
    for (var i = 0; i < tools.length; i++) {
      (function (t) { t.addEventListener('click', function () { openSheet(t.getAttribute('data-sheet')); }); })(tools[i]);
    }

    // แตะที่ ⚙ มุมขวาบนของหน้าแรกเพื่อเข้าตั้งค่า
    $('btn-gear').addEventListener('click', openSettings);
  }

  // ปุ่ม Back ของ Android เรียกมาที่นี่ (หน้าแรกจะไม่ทำอะไร กันแขกเผลอออกจากแอป)
  window.__pbBack = function () {
    if (!$('modal-settings').classList.contains('hidden')) { closeSettings(); return true; }
    if (state.sheet) { closeSheet(); return true; }
    if (state.counting) { cancelShot(); return true; }
    if (state.screen !== 'home') { goHome(); return true; }
    return false;
  };

  /* ---------- ปุ่มลัดบนคีย์บอร์ด / รีโมตพรีเซนต์ / แป้นเหยียบ ---------- */
  var KEY_GO = { ' ': 1, 'Enter': 1, 'PageDown': 1, 'ArrowRight': 1 };
  var handledKey = null;

  function onKeyDown(e) {
    if (e.defaultPrevented || e.isComposing) return;
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && k === ',') {
      if (state.screen === 'home' && $('modal-settings').classList.contains('hidden')) openSettings();
      e.preventDefault(); return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
    if (!$('modal-settings').classList.contains('hidden')) {
      if (k === 'Escape') { closeSettings(); e.preventDefault(); }
      return;
    }
    var did = false, low = String(k).toLowerCase();
    if (state.screen === 'home') {
      if (KEY_GO[k]) { if (!e.repeat) enterCamera(); did = true; }
    } else if (state.screen === 'camera') {
      if (KEY_GO[k]) { if (!e.repeat) shoot(); did = true; }
      else if (k === 'Escape') { window.__pbBack(); did = true; }
    } else if (state.screen === 'result') {
      if (low === 'p') { if (!e.repeat) printCurrent(); did = true; }
      else if (low === 'r') { if (!e.repeat) enterCamera(); did = true; }
      else if (k === 'Escape' || k === 'Backspace') { goHome(); did = true; }
    }
    if (did) {
      e.preventDefault();
      handledKey = k;
      if (state.screen !== 'home' || KEY_GO[k]) startIdle();
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    }
  }
  // กันปุ่มที่โฟกัสอยู่ทำงานซ้ำตอนปล่อยปุ่ม Space/Enter
  function onKeyUp(e) {
    if (handledKey !== null && e.key === handledKey) { e.preventDefault(); handledKey = null; }
  }

  function init() {
    $('home-title').textContent = settings.eventName;
    populateStaticSelects();
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    if (N.isDesktop && settings.startFullscreen) N.desktop.setFullscreen(true);
    bindButtons();
    bindSettings();
    fillSettings();
    updateToolbar();
    refreshPending();
    keepAwake();
    uploader.pump();
  }
  init();
})();
