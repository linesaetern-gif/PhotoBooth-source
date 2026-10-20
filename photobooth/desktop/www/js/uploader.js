/* คิวอัปโหลดรูปไป Google Drive (ผ่าน Apps Script)
 * - เก็บรูปลง IndexedDB ก่อน แล้วค่อยส่ง ถ้าเน็ตหลุดจะลองใหม่เองเรื่อยๆ ไม่ทำรูปหาย
 * - ในแอป Android / Desktop ส่งผ่านโค้ดเนทีฟ (ไม่ติดเรื่อง CORS) ส่วนในเบราว์เซอร์ใช้ fetch (ดู native.js) */
(function (root) {
  'use strict';
  var PB = root.PB = root.PB || {};

  function request(method, url, body) { return PB.native.http(method, url, body); }

  function parseJson(text) {
    try { return JSON.parse(text); }
    catch (e) { throw new Error('ตอบกลับไม่ถูกต้อง — ตรวจว่า Deploy Apps Script เป็น "Anyone" แล้ว'); }
  }

  PB.createUploader = function (getSettings, hooks) {
    hooks = hooks || {};
    var running = false;
    var timer = null;

    function emit(name, rec) { try { if (hooks[name]) hooks[name](rec); } catch (e) { /* ignore */ } }

    function sendOne(rec) {
      var s = getSettings();
      return PB.lib.blobToBase64(rec.blob).then(function (data) {
        var payload = JSON.stringify({
          token: s.token, event: rec.event, name: rec.name, mime: 'image/jpeg', data: data
        });
        return request('POST', s.scriptUrl, payload);
      }).then(function (text) {
        var json = parseJson(text);
        if (!json.ok) throw new Error(json.error || 'อัปโหลดไม่สำเร็จ');
        return json;
      });
    }

    function schedule(ms) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; pump(); }, Math.max(1000, ms));
    }

    function pump() {
      if (running) return Promise.resolve();
      var s = getSettings();
      if (!s.scriptUrl) return Promise.resolve();
      running = true;
      return PB.store.queueAll().then(function (all) {
        var pending = all.filter(function (r) { return !r.done; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
        var now = Date.now();
        var due = pending.filter(function (r) { return (r.nextAt || 0) <= now; });
        var nextWake = pending.reduce(function (m, r) { return Math.min(m, r.nextAt || 0); }, Infinity);

        function step(i) {
          if (i >= due.length) return Promise.resolve();
          var rec = due[i];
          return sendOne(rec).then(function (res) {
            rec.done = true; rec.result = res; rec.blob = null; rec.lastError = null;
            return PB.store.queuePut(rec).then(function () { emit('onDone', rec); emit('onChange', rec); });
          }, function (err) {
            rec.tries = (rec.tries || 0) + 1;
            rec.nextAt = Date.now() + PB.lib.backoffMs(rec.tries);
            rec.lastError = String(err && err.message || err);
            nextWake = Math.min(nextWake, rec.nextAt);
            return PB.store.queuePut(rec).then(function () { emit('onFail', rec); emit('onChange', rec); });
          }).then(function () { return step(i + 1); });
        }
        return step(0).then(function () {
          if (isFinite(nextWake) && nextWake > Date.now()) schedule(nextWake - Date.now());
          else if (isFinite(nextWake)) schedule(1000);
        });
      }).catch(function () { schedule(15000); }).then(function () { running = false; });
    }

    // ตรวจทุก 15 วินาที และเมื่อเน็ตกลับมา
    setInterval(pump, 15000);
    root.addEventListener('online', function () { retryNow(); });

    function enqueue(blob, id, eventName) {
      var rec = {
        id: id, blob: blob, event: PB.lib.sanitizeName(eventName),
        name: PB.lib.photoName(id), createdAt: Date.now(), tries: 0, nextAt: 0, done: false
      };
      return PB.store.queuePut(rec).then(function () { emit('onChange', rec); pump(); return rec; });
    }

    function retryNow() {
      return PB.store.queueAll().then(function (all) {
        var pend = all.filter(function (r) { return !r.done; });
        return Promise.all(pend.map(function (r) { r.nextAt = 0; return PB.store.queuePut(r); }));
      }).then(function () { return pump(); });
    }

    function stats() {
      return PB.store.queueAll().then(function (all) {
        var pending = all.filter(function (r) { return !r.done; });
        return { total: all.length, pending: pending.length, done: all.length - pending.length, lastError: pending.length ? pending[0].lastError : null };
      });
    }

    function testConnection(url, token) {
      if (!PB.lib.isValidScriptUrl(url)) return Promise.reject(new Error('URL ไม่ถูกต้อง ต้องขึ้นต้น https://script.google.com/ และลงท้าย /exec'));
      var u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token || '');
      return request('GET', u).then(function (text) {
        var j = parseJson(text);
        if (!j.ok) throw new Error(j.error || 'เชื่อมต่อไม่สำเร็จ');
        return j;
      });
    }

    // ขอลิงก์โฟลเดอร์อัลบั้มของงานจาก Apps Script (สร้างโฟลเดอร์ถ้ายังไม่มี และตั้งให้ใครมีลิงก์ก็ดูได้)
    function getAlbum(url, token, eventName) {
      if (!PB.lib.isValidScriptUrl(url)) return Promise.reject(new Error('URL ไม่ถูกต้อง ต้องขึ้นต้น https://script.google.com/ และลงท้าย /exec'));
      var u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'action=album&token=' + encodeURIComponent(token || '') +
        '&event=' + encodeURIComponent(PB.lib.sanitizeName(eventName));
      return request('GET', u).then(function (text) {
        var j = parseJson(text);
        if (!j.ok) throw new Error(j.error === 'Token mismatch' ? 'รหัสผ่าน (Token) ไม่ตรงกับใน Code.gs' : (j.error || 'ขอลิงก์อัลบั้มไม่สำเร็จ'));
        if (!j.folderUrl) throw new Error('สคริปต์ใน Google ยังเป็นเวอร์ชันเก่า — วาง Code.gs ใหม่ แล้ว Deploy เป็น New version');
        return j;
      });
    }

    return { enqueue: enqueue, pump: pump, retryNow: retryNow, stats: stats, testConnection: testConnection, getAlbum: getAlbum };
  };
})(typeof self !== 'undefined' ? self : this);
