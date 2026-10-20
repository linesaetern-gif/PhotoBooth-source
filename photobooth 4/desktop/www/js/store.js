/* ที่เก็บข้อมูลในเครื่อง: ตั้งค่า (localStorage) + คิวอัปโหลด/กรอบรูป (IndexedDB) */
(function (root) {
  'use strict';
  var PB = root.PB = root.PB || {};
  var dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req = indexedDB.open('photobooth', 1);
        req.onupgradeneeded = function () {
          var d = req.result;
          if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function run(storeName, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(storeName, mode);
        var out;
        var req = fn(tx.objectStore(storeName));
        if (req) req.onsuccess = function () { out = req.result; };
        tx.oncomplete = function () { resolve(out); };
        tx.onerror = tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function loadSettings() {
    try { return PB.lib.normalizeSettings(JSON.parse(localStorage.getItem('pb.settings') || '{}')); }
    catch (e) { return PB.lib.normalizeSettings({}); }
  }
  function saveSettings(s) {
    var clean = PB.lib.normalizeSettings(s);
    try { localStorage.setItem('pb.settings', JSON.stringify(clean)); } catch (e) { /* ignore */ }
    return clean;
  }

  PB.store = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    queuePut: function (rec) { return run('queue', 'readwrite', function (o) { return o.put(rec); }); },
    queueDel: function (id) { return run('queue', 'readwrite', function (o) { return o.delete(id); }); },
    queueAll: function () { return run('queue', 'readonly', function (o) { return o.getAll(); }).then(function (r) { return r || []; }); },
    putAsset: function (key, blob) { return run('assets', 'readwrite', function (o) { return o.put(blob, key); }); },
    getAsset: function (key) { return run('assets', 'readonly', function (o) { return o.get(key); }); }
  };
})(typeof self !== 'undefined' ? self : this);
