'use strict';
/* สั่งกล้องดิจิตอลถ่ายรูป (tethered) — ไม่ผูกกับ Electron เพื่อให้ทดสอบด้วย Node ได้
 *
 * โหมด command : รันโปรแกรมควบคุมกล้อง (digiCamControl / gPhoto2 ฯลฯ) ให้เซฟรูปลง {out}
 * โหมด folder  : (สั่งชัตเตอร์ด้วยคำสั่งที่ใส่หรือไม่ใส่ก็ได้) แล้วรอไฟล์รูปใหม่โผล่ในโฟลเดอร์ที่ตั้งไว้
 * ไม่ใช้ shell เลย (execFile) คำสั่งถูกแยกเป็นชื่อโปรแกรม + อาร์กิวเมนต์เอง จึงไม่มีปัญหาเรื่อง quote/injection
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const IMAGE_EXT = /\.(jpe?g|png)$/i;

/* ---------- แยกคำสั่ง ---------- */
// แยกสตริงเป็นโทเคน รองรับ "..." และ '...' (ไม่มี escape — ช่อง path ของ Windows ใช้ \ ได้ตรงๆ)
function tokenize(str) {
  const out = [];
  let cur = '', has = false, quote = null;
  for (const ch of String(str || '')) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) { out.push(cur); cur = ''; has = false; }
    } else { cur += ch; }
  }
  if (quote) throw new Error('คำสั่งมีเครื่องหมายคำพูด (" หรือ \') ไม่ครบคู่');
  if (has || cur) out.push(cur);
  return out;
}

function expandTokens(tokens, vars) {
  return tokens.map((t) => t.replace(/\{(out|dir|folder)\}/g, (_, k) => String(vars[k] == null ? '' : vars[k])));
}

/* ---------- ตรวจไฟล์รูป ---------- */
function imageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  return null;
}

// ไฟล์เขียนครบหรือยัง (JPEG ต้องลงท้าย FFD9 · PNG ต้องมี IEND)
function isComplete(buf) {
  const t = imageType(buf);
  if (t === 'jpeg') {
    let n = buf.length;
    while (n > 2 && buf[n - 1] === 0) n--;
    return buf[n - 2] === 0xff && buf[n - 1] === 0xd9;
  }
  if (t === 'png') return buf.length > 20 && buf.slice(buf.length - 8, buf.length - 4).toString('latin1') === 'IEND';
  return false;
}

// ขนาดภาพ (กว้าง×สูง) จาก header — ไม่ต้องถอดรหัสทั้งภาพ
function imageSize(buf) {
  const t = imageType(buf);
  if (t === 'png') return { type: t, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (t === 'jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: t, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/* ---------- ค้นหา / รอไฟล์ใหม่ ---------- */
function newestImage(dir, sinceMs) {
  let best = null;
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  for (const n of names) {
    if (!IMAGE_EXT.test(n)) continue;
    const f = path.join(dir, n);
    let st;
    try { st = fs.statSync(f); } catch (e) { continue; }
    if (!st.isFile() || st.size === 0) continue;
    const t = Math.max(st.mtimeMs, st.birthtimeMs || 0);
    if (t < sinceMs) continue;
    if (!best || t > best.t) best = { file: f, t, size: st.size };
  }
  return best;
}

// กล้องบันทึกเป็น RAW อย่างเดียว → แอปอ่านไม่ได้ ต้องแจ้งให้ตั้งเป็น JPEG
const RAW_EXT = /\.(cr2|cr3|crw|nef|nrw|arw|srf|sr2|raf|dng|orf|rw2|pef|3fr)$/i;
function recentRaw(dir, sinceMs) {
  try {
    return fs.readdirSync(dir).some((n) => {
      if (!RAW_EXT.test(n)) return false;
      try { const st = fs.statSync(path.join(dir, n)); return Math.max(st.mtimeMs, st.birthtimeMs || 0) >= sinceMs - 300; } catch (e) { return false; }
    });
  } catch (e) { return false; }
}
const RAW_MSG = 'กล้องบันทึกเป็นไฟล์ RAW — ตั้งคุณภาพรูปของกล้องเป็น JPEG (หรือ RAW+JPEG) แล้วลองใหม่';

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// รอจนมีรูปใหม่ในโฟลเดอร์ และไฟล์นิ่ง (ขนาดไม่เปลี่ยน + เขียนครบ) แล้วคืน Buffer
async function waitForImage(dir, sinceMs, timeoutMs, deps) {
  const sleep = (deps && deps.sleep) || realSleep;
  const now = (deps && deps.now) || Date.now;
  const poll = (deps && deps.pollMs) || 250;
  const deadline = now() + timeoutMs;
  let lastSig = '';
  while (now() < deadline) {
    const found = newestImage(dir, sinceMs - 300);
    if (found) {
      const sig = found.file + '|' + found.size + '|' + found.t;
      if (sig === lastSig) {
        try {
          const buf = fs.readFileSync(found.file);
          if (isComplete(buf)) return { buf, file: found.file };
        } catch (e) { /* ไฟล์ยังถูกล็อก ลองรอบหน้า */ }
      }
      lastSig = sig;
    }
    await sleep(poll);
  }
  return null;
}

/* ---------- รันโปรแกรมภายนอก ---------- */
function runProgram(file, args, opts, exec) {
  return new Promise((resolve) => {
    (exec || childProcess.execFile)(file, args, {
      timeout: opts.timeoutMs, windowsHide: true, env: opts.env, cwd: opts.cwd, maxBuffer: 4 * 1024 * 1024
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function toolEnv(platform, env) {
  const e = Object.assign({}, env || process.env);
  if (platform === 'darwin' || platform === 'linux') {
    // แอปที่เปิดจาก Finder/ไอคอนไม่ได้รับ PATH ของ Homebrew
    e.PATH = ['/opt/homebrew/bin', '/usr/local/bin', e.PATH || '/usr/bin:/bin'].join(path.delimiter);
  }
  return e;
}

function tail(s, n) { s = String(s || '').trim(); return s.length > n ? '…' + s.slice(-n) : s; }

function explainSpawnError(err, file) {
  if (err && err.code === 'ENOENT') return 'ไม่พบโปรแกรม “' + file + '” — ตรวจ path ในช่อง “คำสั่งถ่ายรูป” (ใส่ path เต็มไว้ใน “ ” ถ้ามีช่องว่าง) หรือยังไม่ได้ติดตั้ง';
  if (err && err.code === 'EACCES') return 'ไม่มีสิทธิ์รันโปรแกรม “' + file + '”';
  if (err && err.code === 'EINVAL') return '“' + file + '” รันตรงๆ ไม่ได้ (ไฟล์ .bat/.cmd ไม่รองรับ — ใช้ไฟล์ .exe)';
  if (err && (err.killed || err.signal === 'SIGTERM')) return 'โปรแกรมควบคุมกล้องไม่ตอบสนองภายในเวลาที่กำหนด (กล้องปิดอยู่หรือกำลังถูกโปรแกรมอื่นใช้?)';
  return null;
}

/* ---------- ถ่ายรูป ---------- */
let busy = false;

// config = { mode: 'command'|'folder', command, folder, timeoutSec }
// deps (ทดสอบ) = { execFile, tmpDir, now, sleep, platform, env, pollMs }
async function capture(config, deps) {
  deps = deps || {};
  config = config || {};
  const mode = config.mode;
  if (mode !== 'command' && mode !== 'folder') throw new Error('ยังไม่ได้เปิดโหมดถ่ายผ่านกล้องดิจิตอล');
  if (busy) throw new Error('กล้องกำลังทำงานอยู่ — รอสักครู่แล้วลองใหม่');
  busy = true;
  const t0 = Date.now();
  try {
    const platform = deps.platform || process.platform;
    const timeoutMs = Math.min(120, Math.max(5, Number(config.timeoutSec) || 20)) * 1000;
    const tmpDir = deps.tmpDir || path.join(os.tmpdir(), 'photobooth-tether');
    fs.mkdirSync(tmpDir, { recursive: true });
    const since = (deps.now || Date.now)();
    const out = path.join(tmpDir, 'shot_' + since + '_' + Math.floor(Math.random() * 1e6) + '.jpg');
    const folder = String(config.folder || '').trim();
    const command = String(config.command || '').trim();

    if (mode === 'folder') {
      if (!folder) throw new Error('ยังไม่ได้เลือกโฟลเดอร์ที่โปรแกรมกล้องบันทึกรูป');
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('ไม่พบโฟลเดอร์ “' + folder + '”');
    } else if (!command) {
      throw new Error('ยังไม่ได้ใส่คำสั่งถ่ายรูป (เลือกชุดคำสั่งสำเร็จรูป หรือพิมพ์เอง)');
    } else if (command.indexOf('{out}') < 0) {
      throw new Error('คำสั่งต้องมี {out} เพื่อบอกว่าให้เซฟรูปที่ไหน');
    }

    // 1) สั่งชัตเตอร์ (ไม่บังคับในโหมดโฟลเดอร์)
    let runErr = null, runOut = '', spawnMsg = null;
    if (command) {
      const tokens = expandTokens(tokenize(command), { out, dir: tmpDir, folder });
      if (!tokens.length) throw new Error('คำสั่งว่างเปล่า');
      const file = tokens[0], args = tokens.slice(1);
      if (platform === 'darwin' && path.basename(file) === 'gphoto2') {
        // macOS: PTPCamera จะแย่งกล้องไปก่อน
        await runProgram('killall', ['PTPCamera'], { timeoutMs: 3000, env: toolEnv(platform, deps.env) }, deps.execFile);
      }
      const r = await runProgram(file, args, { timeoutMs, env: toolEnv(platform, deps.env), cwd: tmpDir }, deps.execFile);
      runErr = r.err; runOut = (r.stderr || r.stdout);
      spawnMsg = explainSpawnError(runErr, file);
      // โปรแกรมไม่มี/รันไม่ได้ → ไม่ต้องรอ
      if (runErr && (runErr.code === 'ENOENT' || runErr.code === 'EACCES' || runErr.code === 'EINVAL')) throw new Error(spawnMsg);
    }

    // 2) เอาไฟล์รูป
    let got = null;
    if (mode === 'command') {
      if (fs.existsSync(out)) {
        const buf = fs.readFileSync(out);
        if (isComplete(buf)) got = { buf, file: out };
      }
      if (!got) {
        // บางโปรแกรมเติมนามสกุล/ตั้งชื่อเอง → หาไฟล์ใหม่ในโฟลเดอร์ชั่วคราว
        got = await waitForImage(tmpDir, since, runErr ? 1500 : 4000, deps);
      }
      if (!got) {
        if (recentRaw(tmpDir, since)) throw new Error(RAW_MSG);
        const why = spawnMsg || (runErr ? ('โปรแกรมแจ้งว่า: ' + (tail(runOut, 200) || runErr.message)) : 'โปรแกรมทำงานจบแล้วแต่ไม่พบไฟล์รูป');
        throw new Error('ถ่ายไม่สำเร็จ — ' + why);
      }
    } else {
      got = await waitForImage(folder, since, timeoutMs, deps);
      if (!got) {
        if (recentRaw(folder, since)) throw new Error(RAW_MSG);
        throw new Error('รอครบ ' + Math.round(timeoutMs / 1000) + ' วินาทีแล้วยังไม่มีรูปใหม่ในโฟลเดอร์' + (runErr ? ' (คำสั่งชัตเตอร์แจ้งว่า: ' + (spawnMsg || tail(runOut || runErr.message, 160)) + ')' : ''));
      }
    }

    const size = imageSize(got.buf);
    if (!size) throw new Error('ไฟล์ที่ได้ไม่ใช่รูป JPEG/PNG (ตั้งกล้องให้บันทึกเป็น JPEG ไม่ใช่ RAW)');
    if (mode === 'command') { try { fs.unlinkSync(got.file); } catch (e) { /* ignore */ } }
    return { data: got.buf, width: size.width, height: size.height, type: size.type, ms: Date.now() - t0, source: mode === 'folder' ? got.file : 'command' };
  } finally {
    busy = false;
  }
}

module.exports = { tokenize, expandTokens, imageType, isComplete, imageSize, newestImage, waitForImage, toolEnv, capture };
