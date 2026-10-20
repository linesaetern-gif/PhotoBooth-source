// ทดสอบ apps-script/Code.gs กับตัวจำลอง DriveApp / LockService / ContentService
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function makeEnv() {
  const store = { created: 0, shared: [] };
  const mkFolder = (name) => {
    const files = {};
    const folder = {
      name, files, subs: {}, id: 'FOLDER_' + name,
      getId() { return this.id; },
      getName() { return this.name; },
      setSharing(a, p) { store.shared.push([this.name, a, p]); },
      getFoldersByName(n) { const f = this.subs[n]; return { hasNext: () => !!f, next: () => f }; },
      createFolder(n) { store.created++; return (this.subs[n] = mkFolder(n)); },
      getFilesByName(n) { const f = files[n]; return { hasNext: () => !!f, next: () => f }; },
      createFile(blob) {
        const f = { id: 'ID' + Object.keys(files).length + blob.name, blob, setSharing() { }, getId() { return this.id; } };
        files[blob.name] = f; return f;
      }
    };
    return folder;
  };
  const root = mkFolder('root');
  const env = {
    DriveApp: { getRootFolder: () => root, Access: { ANYONE_WITH_LINK: 'LINK' }, Permission: { VIEW: 'VIEW' } },
    LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
    Utilities: { base64Decode: (s) => Buffer.from(s, 'base64'), newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    JSON, String, Date, Object
  };
  vm.createContext(env);
  vm.runInContext(src, env);
  return { env, root, store };
}
const call = (env, fn, arg) => JSON.parse(vm.runInContext(fn + '(' + JSON.stringify(arg) + ')', env).text);
const post = (env, o) => call(env, 'doPost', { postData: { contents: JSON.stringify(o) } });
const b64 = Buffer.from('fakejpeg').toString('base64');

test('ไฟล์ Code.gs ไม่ใช้คอมเมนต์บล็อก regex หรืออักขระนอก ASCII (กันปัญหาตอนก๊อปวาง)', () => {
  assert.ok(!src.includes('/*'));
  assert.ok(!/\.replace\(\//.test(src));
  assert.ok(!/[^\x00-\x7f]/.test(src));
});

test('doGet: ทดสอบการเชื่อมต่อและตรวจ Token', () => {
  const { env } = makeEnv();
  assert.deepEqual(call(env, 'doGet', { parameter: { token: 'change-me' } }), { ok: true, msg: 'Photo Booth endpoint is ready', tokenOk: true });
  assert.equal(call(env, 'doGet', { parameter: { token: 'nope' } }).tokenOk, false);
  assert.equal(call(env, 'doGet', {}).tokenOk, false);
  assert.equal(call(env, 'doGet', undefined === 0 ? 0 : {}).ok, true);
});

test('doGet action=album: คืนลิงก์โฟลเดอร์งาน ตั้งแชร์ และไม่สร้างซ้ำ', () => {
  const { env, root, store } = makeEnv();
  const r = call(env, 'doGet', { parameter: { action: 'album', token: 'change-me', event: 'งานแต่ง: A/B?' } });
  assert.equal(r.ok, true);
  assert.equal(r.name, 'งานแต่ง AB');
  assert.equal(r.folderUrl, 'https://drive.google.com/drive/folders/FOLDER_งานแต่ง AB?usp=sharing');
  assert.deepEqual(store.shared[0], ['งานแต่ง AB', 'LINK', 'VIEW']);
  assert.ok(root.subs.PhotoBooth.subs['งานแต่ง AB']);
  const created = store.created;
  const r2 = call(env, 'doGet', { parameter: { action: 'album', token: 'change-me', event: 'งานแต่ง: A/B?' } });
  assert.equal(r2.folderId, r.folderId);
  assert.equal(store.created, created);
  // Token ผิด
  const bad = call(env, 'doGet', { parameter: { action: 'album', token: 'x', event: 'A' } });
  assert.deepEqual(bad, { ok: false, error: 'Token mismatch' });
  // ไม่ใส่ event -> โฟลเดอร์ Event
  assert.equal(call(env, 'doGet', { parameter: { action: 'album', token: 'change-me' } }).name, 'Event');
});

test('doPost: Token ผิด / ไม่มีข้อมูล / ไม่ใช่ JSON', () => {
  const { env } = makeEnv();
  assert.equal(post(env, { token: 'bad', data: b64 }).ok, false);
  assert.equal(post(env, { token: 'change-me' }).ok, false);
  assert.equal(call(env, 'doPost', { postData: { contents: 'not json' } }).ok, false);
});

test('doPost: อัปโหลดรูป คืนลิงก์ไฟล์และโฟลเดอร์ ส่งซ้ำไม่เกิดไฟล์ซ้ำ', () => {
  const { env, root, store } = makeEnv();
  const r = post(env, { token: 'change-me', event: 'งานแต่ง: A/B?', name: 'photo_1.jpg', mime: 'image/jpeg', data: b64 });
  assert.equal(r.ok, true);
  assert.match(r.viewUrl, /^https:\/\/drive\.google\.com\/file\/d\/.+\/view$/);
  assert.match(r.downloadUrl, /^https:\/\/drive\.google\.com\/uc\?export=download&id=.+$/);
  assert.match(r.folderUrl, /^https:\/\/drive\.google\.com\/drive\/folders\/FOLDER_.+\?usp=sharing$/);
  const ev = root.subs.PhotoBooth.subs['งานแต่ง AB'];
  assert.equal(Buffer.from(ev.files['photo_1.jpg'].blob.bytes).toString(), 'fakejpeg');
  const created = store.created;
  const r2 = post(env, { token: 'change-me', event: 'งานแต่ง: A/B?', name: 'photo_1.jpg', data: b64 });
  assert.equal(r2.id, r.id);
  assert.equal(Object.keys(ev.files).length, 1);
  assert.equal(store.created, created);
});

test('doPost: ชื่อไฟล์และชื่องานที่มีอักขระต้องห้าม', () => {
  const { env, root } = makeEnv();
  const r = post(env, { token: 'change-me', event: '   ', name: 'a/b\\c:d.jpg', data: b64 });
  assert.equal(r.ok, true);
  assert.ok(root.subs.PhotoBooth.subs.Event.files['a_b_c_d.jpg']);
});
