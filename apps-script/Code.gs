// Photo Booth -> Google Drive receiver (Google Apps Script)
//
// SETUP (once):
// 1. script.google.com -> New project -> select ALL existing code (Ctrl+A) and delete it -> paste this whole file
// 2. Change TOKEN below to your own secret (type the same value in the app: Settings -> Token)
// 3. Deploy -> New deployment -> type: Web app
//      Execute as: Me
//      Who has access: Anyone
// 4. Authorize Drive access, then copy the Web app URL (ends with /exec) into the app
//
// After editing this file you must: Deploy -> Manage deployments -> Edit -> Version: New version -> Deploy

var TOKEN = 'change-me';          // must equal the Token typed in the app
var ROOT_FOLDER = 'PhotoBooth';   // folder in My Drive; each event gets a sub-folder

// GET ...?token=xxx                        -> connection test (used by the app's test button)
// GET ...?action=album&token=xxx&event=yy  -> returns the share link of the event folder (used for the album QR code)
function doGet(e) {
  var p = (e && e.parameter) || {};
  var tokenOk = p.token === TOKEN;

  if (p.action === 'album') {
    if (!tokenOk) return json_({ ok: false, error: 'Token mismatch' });
    try {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      var folder;
      try {
        folder = eventFolder_(p.event);
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } finally {
        lock.releaseLock();
      }
      return json_({ ok: true, folderId: folder.getId(), folderUrl: folderUrl_(folder), name: folder.getName() });
    } catch (err) {
      return json_({ ok: false, error: String((err && err.message) || err) });
    }
  }

  return json_({ ok: true, msg: 'Photo Booth endpoint is ready', tokenOk: tokenOk });
}

// Receives a photo: body is JSON {token, event, name, mime, data(base64)}
function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) return json_({ ok: false, error: 'Token mismatch' });
    if (!req.data) return json_({ ok: false, error: 'No image data' });

    var name = clean_(req.name, 120, '_') || ('photo_' + Date.now() + '.jpg');

    var lock = LockService.getScriptLock();   // avoid duplicate folders when photos arrive together
    lock.waitLock(30000);
    var file, folder;
    try {
      folder = eventFolder_(req.event);
      var existing = folder.getFilesByName(name);
      if (existing.hasNext()) {
        file = existing.next();               // retry of an upload that already succeeded: reuse the file
      } else {
        var bytes = Utilities.base64Decode(req.data);
        file = folder.createFile(Utilities.newBlob(bytes, req.mime || 'image/jpeg', name));
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }
    } finally {
      lock.releaseLock();
    }

    var id = file.getId();
    return json_({
      ok: true,
      id: id,
      viewUrl: 'https://drive.google.com/file/d/' + id + '/view',
      downloadUrl: 'https://drive.google.com/uc?export=download&id=' + id,
      folderUrl: folderUrl_(folder)
    });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// Removes characters that are not allowed in file names (no regular expressions on purpose)
function clean_(value, max, replacement) {
  var bad = '\\/:*?"<>|';
  var s = String(value === null || value === undefined ? '' : value);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (s.charCodeAt(i) < 32 || bad.indexOf(ch) >= 0) out += (replacement || '');
    else out += ch;
  }
  return out.trim().slice(0, max);
}

function eventFolder_(eventName) {
  var safe = clean_(eventName, 60, '') || 'Event';
  return getOrCreateFolder_(getOrCreateFolder_(DriveApp.getRootFolder(), ROOT_FOLDER), safe);
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function folderUrl_(folder) {
  return 'https://drive.google.com/drive/folders/' + folder.getId() + '?usp=sharing';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
