/* ตัวสร้าง QR Code (เขียนเอง ไม่พึ่งไลบรารี) — โหมดไบต์ (UTF-8), ระดับแก้ไขข้อผิดพลาด M, เวอร์ชัน 1–10
 * รองรับข้อความได้ถึง 213 ไบต์ ซึ่งเกินพอสำหรับลิงก์ Google Drive */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PB = root.PB || {}; root.PB.qr = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // ระดับ M ต่อเวอร์ชัน
  var NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var MAX_VERSION = 10;
  var MAX_BYTES = 213;
  var FORMAT_BITS_M = 0;

  function utf8Bytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function numRawDataModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function numDataCodewords(ver) {
    return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
  }

  // ---- Reed–Solomon บน GF(256) (พหุนาม 0x11D) ----
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    var result = [], i, j;
    for (i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ result.shift();
      result.push(0);
      divisor.forEach(function (coef, i) { result[i] ^= gfMul(coef, factor); });
    });
    return result;
  }

  function countOverlapping(s, pat) {
    var n = 0, i = s.indexOf(pat);
    while (i >= 0) { n++; i = s.indexOf(pat, i + 1); }
    return n;
  }

  function penaltyScore(m, size) {
    var score = 0, x, y;
    for (var dir = 0; dir < 2; dir++) {
      for (y = 0; y < size; y++) {
        var line = '', prev = -1, run = 0;
        for (x = 0; x < size; x++) {
          var v = dir === 0 ? m[y][x] : m[x][y];
          line += v ? '1' : '0';
          if (v === prev) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
          else { prev = v; run = 1; }
        }
        score += 40 * countOverlapping(line, '10111010000') + 40 * countOverlapping(line, '00001011101');
      }
    }
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += m[y][x];
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    if (k > 0) score += k * 10;
    return score;
  }

  function encode(text) {
    var data = utf8Bytes(String(text));
    var ver = 0, dcw = 0, v;
    for (v = 1; v <= MAX_VERSION; v++) {
      var d = numDataCodewords(v);
      if (4 + (v < 10 ? 8 : 16) + data.length * 8 <= d * 8) { ver = v; dcw = d; break; }
    }
    if (!ver) throw new Error('ข้อความยาวเกินไปสำหรับ QR (สูงสุด ' + MAX_BYTES + ' ไบต์)');

    // 1) สร้างสตรีมบิต: โหมดไบต์ + ความยาว + ข้อมูล + ตัวจบ + ตัวเติม
    var bits = [], i, j;
    function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4);
    put(data.length, ver < 10 ? 8 : 16);
    data.forEach(function (b) { put(b, 8); });
    var cap = dcw * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var padByte = 0xEC; bits.length < cap; padByte ^= 0xEC ^ 0x11) put(padByte, 8);
    var dataCw = [];
    for (i = 0; i < bits.length; i += 8) {
      var byteVal = 0;
      for (j = 0; j < 8; j++) byteVal = (byteVal << 1) | bits[i + j];
      dataCw.push(byteVal);
    }

    // 2) แบ่งบล็อก + คำนวณ ECC + สลับตำแหน่ง
    var numBlocks = NUM_BLOCKS[ver], blockEccLen = ECC_PER_BLOCK[ver];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var blocks = [], divisor = rsDivisor(blockEccLen), k2 = 0;
    for (i = 0; i < numBlocks; i++) {
      var dat = dataCw.slice(k2, k2 + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k2 += dat.length;
      var ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var allCw = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (j = 0; j < blocks.length; j++) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) allCw.push(blocks[j][i]);
      }
    }
    if (allCw.length !== rawCodewords) throw new Error('QR: จำนวนโค้ดเวิร์ดไม่ตรงกัน');

    // 3) วาดลวดลายฟังก์ชัน
    var size = ver * 4 + 17;
    var m = [], isFn = [];
    for (i = 0; i < size; i++) {
      var row = [], frow = [];
      for (j = 0; j < size; j++) { row.push(0); frow.push(false); }
      m.push(row); isFn.push(frow);
    }
    function setFn(x, y, dark) {
      if (x >= 0 && x < size && y >= 0 && y < size) { m[y][x] = dark ? 1 : 0; isFn[y][x] = true; }
    }
    function bit(x, n) { return ((x >>> n) & 1) !== 0; }

    function drawFormatBits(mask) {
      var d2 = (FORMAT_BITS_M << 3) | mask, rem = d2, q;
      for (q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((d2 << 10) | rem) ^ 0x5412;
      for (q = 0; q <= 5; q++) setFn(8, q, bit(fb, q));
      setFn(8, 7, bit(fb, 6));
      setFn(8, 8, bit(fb, 7));
      setFn(7, 8, bit(fb, 8));
      for (q = 9; q < 15; q++) setFn(14 - q, 8, bit(fb, q));
      for (q = 0; q < 8; q++) setFn(size - 1 - q, 8, bit(fb, q));
      for (q = 8; q < 15; q++) setFn(8, size - 15 + q, bit(fb, q));
      setFn(8, size - 8, true);
    }
    function drawFinder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
    function drawAlignment(cx, cy) {
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    function alignPositions() {
      if (ver === 1) return [];
      var n = Math.floor(ver / 7) + 2;
      var step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
      var res = [6];
      for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
      return res;
    }

    for (i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);
    var ap = alignPositions(), na = ap.length;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
      if (!((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0))) drawAlignment(ap[i], ap[j]);
    }
    drawFormatBits(0);
    if (ver >= 7) {
      var vr = ver;
      for (i = 0; i < 12; i++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vbits = (ver << 12) | vr;
      for (i = 0; i < 18; i++) {
        var col = bit(vbits, i), a = size - 11 + i % 3, b = Math.floor(i / 3);
        setFn(a, b, col); setFn(b, a, col);
      }
    }

    // 4) วางข้อมูลแบบซิกแซก
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFn[y][x] && idx < allCw.length * 8) {
            m[y][x] = bit(allCw[idx >>> 3], 7 - (idx & 7)) ? 1 : 0;
            idx++;
          }
        }
      }
    }

    // 5) เลือกมาสก์ที่คะแนนโทษต่ำสุด
    function applyMask(mask) {
      for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
        var inv;
        switch (mask) {
          case 0: inv = (xx + yy) % 2 === 0; break;
          case 1: inv = yy % 2 === 0; break;
          case 2: inv = xx % 3 === 0; break;
          case 3: inv = (xx + yy) % 3 === 0; break;
          case 4: inv = (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0; break;
          case 5: inv = xx * yy % 2 + xx * yy % 3 === 0; break;
          case 6: inv = (xx * yy % 2 + xx * yy % 3) % 2 === 0; break;
          default: inv = ((xx + yy) % 2 + xx * yy % 3) % 2 === 0;
        }
        if (!isFn[yy][xx] && inv) m[yy][xx] ^= 1;
      }
    }
    var bestMask = 0, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask); drawFormatBits(mask);
      var sc = penaltyScore(m, size);
      if (sc < bestScore) { bestScore = sc; bestMask = mask; }
      applyMask(mask);
    }
    applyMask(bestMask); drawFormatBits(bestMask);

    return { version: ver, size: size, mask: bestMask, modules: m };
  }

  // วาดลงบน <canvas> (ขาว-ดำ มีขอบเงียบ 4 โมดูลตามมาตรฐาน)
  function draw(canvas, text, opts) {
    opts = opts || {};
    var q = encode(text);
    var quiet = opts.quiet === undefined ? 4 : opts.quiet;
    var total = q.size + quiet * 2;
    var cell = Math.max(1, Math.floor((opts.size || 512) / total));
    canvas.width = canvas.height = total * cell;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
      if (q.modules[y][x]) ctx.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
    }
    return q;
  }

  return {
    encode: encode, draw: draw, MAX_BYTES: MAX_BYTES,
    _internal: { numDataCodewords: numDataCodewords, numRawDataModules: numRawDataModules, rsDivisor: rsDivisor, rsRemainder: rsRemainder, gfMul: gfMul, utf8Bytes: utf8Bytes }
  };
});
