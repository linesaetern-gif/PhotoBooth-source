'use strict';
// สะพานแคบๆ ระหว่างหน้าจอ (ที่ปิดสิทธิ์ Node) กับโปรเซสหลัก
const { contextBridge, ipcRenderer } = require('electron');

function call(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((e) => {
    // ตัดข้อความนำหน้า "Error invoking remote method ..." ออกให้อ่านง่าย
    const msg = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
    throw new Error(msg);
  });
}

contextBridge.exposeInMainWorld('PBDesktop', {
  info: () => call('pb:info'),
  http: (method, url, body) => call('pb:http', method, url, body),
  print: (req) => call('pb:print', req),
  listPrinters: () => call('pb:listPrinters'),
  saveImage: (req) => call('pb:saveImage', req),
  pickFolder: () => call('pb:pickFolder'),
  openFolder: (dir) => call('pb:openFolder', dir),
  tetherCapture: (config) => call('pb:tether', config),
  setFullscreen: (on) => call('pb:fullscreen', !!on),
  toggleFullscreen: () => call('pb:fullscreen', 'toggle'),
  quit: () => call('pb:quit')
});
