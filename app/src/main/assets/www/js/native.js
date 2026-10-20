/* สะพานเชื่อมกับระบบที่แอปรันอยู่ — ให้โค้ดส่วนอื่นเรียกแบบเดียวกันทุกแพลตฟอร์ม
 *   android : WebView + AndroidBridge (MainActivity.java)
 *   desktop : Electron + PBDesktop (desktop/src/preload.js)
 *   web     : เปิดในเบราว์เซอร์ธรรมดา (ใช้ทดสอบ)
 */
(function (root) {
  'use strict';
  var PB = root.PB = root.PB || {};

  var android = root.AndroidBridge || null;
  var desk = root.PBDesktop || null;
  var kind = desk ? 'desktop' : (android ? 'android' : 'web');

  /* ---------- HTTP (อัปโหลดขึ้น Apps Script) ---------- */
  var seq = 0;
  var waiting = {};

  // โค้ด Android เรียกกลับมาที่ฟังก์ชันนี้เมื่อได้ผลลัพธ์
  root.__pbNative = function (id, ok, text) {
    var w = waiting[id];
    if (!w) return;
    delete waiting[id];
    clearTimeout(w.timer);
    if (ok) w.resolve(text); else w.reject(new Error(text));
  };

  function androidHttp(method, url, body) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++seq);
      var timer = setTimeout(function () { delete waiting[id]; reject(new Error('หมดเวลารอการตอบกลับ')); }, 120000);
      waiting[id] = { resolve: resolve, reject: reject, timer: timer };
      android.httpRequest(id, method, url, body || '');
    });
  }

  function webHttp(method, url, body) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);
    var opts = { method: method, redirect: 'follow' };
    if (ctrl) opts.signal = ctrl.signal;
    if (method === 'POST') { opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' }; opts.body = body; }
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) { clearTimeout(timer); return t; }, function (e) { clearTimeout(timer); throw e; });
  }

  function http(method, url, body) {
    if (desk) return desk.http(method, url, body || '');
    if (android && typeof android.httpRequest === 'function') return androidHttp(method, url, body);
    return webHttp(method, url, body);
  }

  /* ---------- บันทึกรูปลงเครื่อง ---------- */
  var canAutoSave = !!(desk || (android && typeof android.saveImage === 'function'));

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // opts: { dir, sub } ใช้เฉพาะคอมพิวเตอร์ · คืน { ok, path? }
  function saveImage(blob, name, opts) {
    opts = opts || {};
    if (desk) {
      return PB.lib.blobToBase64(blob).then(function (b64) {
        return desk.saveImage({ data: b64, name: name, dir: opts.dir || '', sub: opts.sub || '' });
      });
    }
    if (android && typeof android.saveImage === 'function') {
      return PB.lib.blobToBase64(blob).then(function (b64) { return { ok: !!android.saveImage(b64, name) }; });
    }
    downloadBlob(blob, name);
    return Promise.resolve({ ok: true });
  }

  /* ---------- พิมพ์ ---------- */
  function webPrint(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(f);
      var d = f.contentDocument;
      d.open();
      d.write('<!doctype html><html><head><style>@page{margin:0}html,body{margin:0}img{width:100%;height:auto;display:block}</style></head><body><img src="' + url + '"></body></html>');
      d.close();
      var img = d.querySelector('img');
      img.onload = function () {
        f.contentWindow.focus(); f.contentWindow.print();
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); URL.revokeObjectURL(url); resolve(); }, 3000);
      };
    });
  }

  // opts: { silent, printer, paper, copies } ใช้เฉพาะคอมพิวเตอร์
  function print(blob, jobName, opts) {
    opts = opts || {};
    if (desk) {
      return PB.lib.blobToBase64(blob).then(function (b64) {
        return desk.print({
          data: b64, jobName: jobName || 'Photo Booth', silent: !!opts.silent,
          printer: opts.printer || '', paper: opts.paper || 'driver', copies: opts.copies || 1
        });
      });
    }
    if (android && typeof android.printImage === 'function') {
      return PB.lib.blobToBase64(blob).then(function (b64) { android.printImage(b64, jobName || 'Photo Booth'); });
    }
    return webPrint(blob);
  }

  PB.native = {
    kind: kind,
    isDesktop: kind === 'desktop',
    isAndroid: kind === 'android',
    desktop: desk,           // ฟังก์ชันเฉพาะคอมพิวเตอร์ (null ถ้าไม่ใช่)
    canAutoSave: canAutoSave,
    http: http,
    saveImage: saveImage,
    print: print
  };

  if (kind === 'desktop' && root.document) {
    var mark = function () { root.document.documentElement.classList.add('is-desktop'); };
    if (root.document.documentElement) mark();
  }
})(typeof self !== 'undefined' ? self : this);
