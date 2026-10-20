/* กรอบรูป: วาดด้วย canvas (พื้นโปร่งใสตรงช่องใส่รูป) + รองรับกรอบ PNG ที่อัปโหลดเอง */
(function (root) {
  'use strict';
  var PB = root.PB = root.PB || {};
  var FONT = '"Noto Sans Thai","Sarabun","Leelawadee UI","Thonburi",system-ui,sans-serif';
  var cache = {};

  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ระบายสีเฉพาะ "ขอบ" ส่วนช่องรูปด้านในปล่อยโปร่งใส
  function border(ctx, w, h, l, t, r, b, radius) {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    rr(ctx, l, t, w - l - r, h - t - b, radius || 0);
    ctx.fill('evenodd');
  }

  function fitText(ctx, text, maxW, size, weight) {
    var s = size;
    ctx.font = weight + ' ' + s + 'px ' + FONT;
    while (ctx.measureText(text).width > maxW && s > 12) { s -= 2; ctx.font = weight + ' ' + s + 'px ' + FONT; }
    return s;
  }

  function caption(ctx, cx, cy, maxW, title, dateText, c1, c2, u) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (title && dateText) {
      fitText(ctx, title, maxW, u * 0.058, '700');
      ctx.fillStyle = c1; ctx.fillText(title, cx, cy - u * 0.02);
      ctx.font = '400 ' + (u * 0.03) + 'px ' + FONT;
      ctx.fillStyle = c2; ctx.fillText(dateText, cx, cy + u * 0.04);
    } else if (title) {
      fitText(ctx, title, maxW, u * 0.06, '700');
      ctx.fillStyle = c1; ctx.fillText(title, cx, cy);
    } else if (dateText) {
      ctx.font = '400 ' + (u * 0.034) + 'px ' + FONT;
      ctx.fillStyle = c2; ctx.fillText(dateText, cx, cy);
    }
  }

  var BUILTIN = [
    { id: 'none', name: 'ไม่มีกรอบ', draw: function () { } },

    {
      id: 'polaroid', name: 'โพลารอยด์ (ขาวคลาสสิก)',
      draw: function (ctx, w, h, o) {
        var u = Math.min(w, h), m = u * 0.045, bot = u * (o.hasCaption ? 0.2 : 0.07);
        ctx.fillStyle = '#fbfaf6';
        border(ctx, w, h, m, m, m, bot, u * 0.012);
        ctx.strokeStyle = 'rgba(0,0,0,0.14)'; ctx.lineWidth = u * 0.003;
        ctx.beginPath(); rr(ctx, m, m, w - 2 * m, h - m - bot, u * 0.012); ctx.stroke();
        caption(ctx, w / 2, h - bot / 2, w - 2 * m, o.title, o.dateText, '#2d2a26', '#7a746b', u);
      }
    },

    {
      id: 'gold', name: 'ทองหรู (ดำ-ทอง)',
      draw: function (ctx, w, h, o) {
        var u = Math.min(w, h), band = u * 0.05, bot = u * (o.hasCaption ? 0.17 : 0.07);
        var g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#8a6a1e'); g.addColorStop(0.25, '#f6e08a'); g.addColorStop(0.5, '#b8892b');
        g.addColorStop(0.75, '#f9ec9c'); g.addColorStop(1, '#8a6a1e');
        ctx.fillStyle = '#14110c';
        border(ctx, w, h, band, band, band, bot, 0);
        ctx.strokeStyle = g;
        ctx.lineWidth = u * 0.006;
        ctx.strokeRect(band * 0.4, band * 0.4, w - band * 0.8, h - band * 0.8);
        ctx.lineWidth = u * 0.009;
        ctx.strokeRect(band, band, w - 2 * band, h - band - bot);
        var s = u * 0.022;
        [[band, band], [w - band, band], [band, h - bot], [w - band, h - bot]].forEach(function (p) {
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(Math.PI / 4); ctx.fillStyle = g;
          ctx.fillRect(-s, -s, 2 * s, 2 * s); ctx.restore();
        });
        caption(ctx, w / 2, h - bot / 2, w - 2 * band, o.title, o.dateText, '#f3dc8a', '#c9a64f', u);
      }
    },

    {
      id: 'sweet', name: 'ชมพูหวาน (จุดขาว)',
      draw: function (ctx, w, h, o) {
        var u = Math.min(w, h), band = u * 0.06, bot = u * (o.hasCaption ? 0.18 : 0.075);
        ctx.fillStyle = '#ff8fb8';
        border(ctx, w, h, band, band, band, bot, u * 0.03);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        var step = u * 0.06, r = u * 0.013, x, y;
        for (x = band; x < w - band / 2; x += step) { ctx.beginPath(); ctx.arc(x, band / 2, r, 0, 6.2832); ctx.fill(); }
        for (x = band; x < w - band / 2; x += step) { ctx.beginPath(); ctx.arc(x, h - band / 2, r, 0, 6.2832); ctx.fill(); }
        for (y = band + step; y < h - bot; y += step) {
          ctx.beginPath(); ctx.arc(band / 2, y, r, 0, 6.2832); ctx.fill();
          ctx.beginPath(); ctx.arc(w - band / 2, y, r, 0, 6.2832); ctx.fill();
        }
        if (o.hasCaption) {
          ctx.save(); ctx.shadowColor = 'rgba(160,30,90,0.55)'; ctx.shadowBlur = u * 0.01;
          caption(ctx, w / 2, h - bot / 2 + band * 0.2, w - 2 * band, o.title, o.dateText, '#ffffff', '#fff4fa', u);
          ctx.restore();
        }
      }
    },

    {
      id: 'film', name: 'ฟิล์มหนัง (ขอบเจาะรู)',
      draw: function (ctx, w, h, o) {
        var u = Math.min(w, h), side = u * 0.09, tb = u * 0.035, bot = tb + (o.hasCaption ? u * 0.075 : 0);
        ctx.fillStyle = '#0c0c0e';
        border(ctx, w, h, side, tb, side, bot, u * 0.01);
        var hw = side * 0.42, hh = side * 0.56, step = hh * 1.9, y;
        ctx.fillStyle = '#f1eee4';
        for (y = step / 2; y < h - hh; y += step) {
          ctx.beginPath(); rr(ctx, (side - hw) / 2, y, hw, hh, hw * 0.25); ctx.fill();
          ctx.beginPath(); rr(ctx, w - side + (side - hw) / 2, y, hw, hh, hw * 0.25); ctx.fill();
        }
        if (o.hasCaption) {
          var t = o.title && o.dateText ? o.title + '  ·  ' + o.dateText : (o.title || o.dateText);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f1eee4';
          fitText(ctx, t, w - 2 * side, u * 0.04, '600');
          ctx.fillText(t, w / 2, h - bot + (bot - tb) / 2 + tb * 0.2);
        }
      }
    }
  ];

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์กรอบไม่ได้')); };
      img.src = url;
    });
  }

  function renderCustom(w, h) {
    return PB.store.getAsset('customFrame').then(function (blob) {
      var c = mk(w, h);
      if (!blob) return c;
      return loadImage(blob).then(function (img) {
        var r = PB.lib.coverRect(img.naturalWidth, img.naturalHeight, w, h);
        c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h);
        return c;
      });
    });
  }

  PB.frames = {
    list: function (hasCustom) {
      var out = BUILTIN.map(function (f) { return { id: f.id, name: f.name }; });
      if (hasCustom) out.push({ id: 'custom', name: 'กรอบของคุณเอง (ที่อัปโหลด)' });
      return out;
    },
    // หาช่องโปร่งใสตรงกลางของกรอบ (ไว้วางภาพคอลลาจ) คืนค่าเป็นสัดส่วน 0–1 ของภาพ {x,y,w,h}
    windowRect: function (c) {
      var full = { x: 0, y: 0, w: 1, h: 1 };
      try {
        var k = Math.min(1, 200 / Math.max(c.width, c.height));
        var sw = Math.max(4, Math.round(c.width * k)), sh = Math.max(4, Math.round(c.height * k));
        var t = mk(sw, sh), tc = t.getContext('2d');
        tc.drawImage(c, 0, 0, sw, sh);
        var d = tc.getImageData(0, 0, sw, sh).data;
        var A = function (x, y) { return d[(y * sw + x) * 4 + 3]; };
        var cx = sw >> 1, cy = sh >> 1, TH = 40;
        if (A(cx, cy) > TH) return full;               // กรอบทับกลางภาพ (ไม่มีช่อง) → ใช้ทั้งภาพ
        var l = cx, r = cx, u = cy, b = cy;
        while (l > 0 && A(l - 1, cy) <= TH) l--;
        while (r < sw - 1 && A(r + 1, cy) <= TH) r++;
        while (u > 0 && A(cx, u - 1) <= TH) u--;
        while (b < sh - 1 && A(cx, b + 1) <= TH) b++;
        var pad = 1;                                    // ถอยเข้า 1 พิกเซลกันขอบกรอบทับ
        l = l === 0 ? 0 : l + pad; u = u === 0 ? 0 : u + pad;
        r = r === sw - 1 ? sw - 1 : r - pad; b = b === sh - 1 ? sh - 1 : b - pad;
        if (r <= l || b <= u) return full;
        return { x: l / sw, y: u / sh, w: (r - l + 1) / sw, h: (b - u + 1) / sh };
      } catch (e) { return full; }
    },
    // คืน canvas ขนาด w×h ที่มีเฉพาะกรอบ (ช่องรูปโปร่งใส)
    render: function (id, w, h, o) {
      o = o || {};
      var title = (o.title || '').trim(), dateText = o.dateText || '';
      var key = [id, w, h, title, dateText, o.customVersion || 0].join('|');
      if (cache[key]) return Promise.resolve(cache[key]);
      var done = function (c) { cache = {}; cache[key] = c; return c; };   // เก็บแค่รายการล่าสุด
      if (id === 'custom') return renderCustom(w, h).then(done);
      var def = BUILTIN.filter(function (f) { return f.id === id; })[0] || BUILTIN[0];
      var c = mk(w, h), ctx = c.getContext('2d');
      def.draw(ctx, w, h, { title: title, dateText: dateText, hasCaption: !!(title || dateText) });
      return Promise.resolve(done(c));
    }
  };
})(typeof self !== 'undefined' ? self : this);
