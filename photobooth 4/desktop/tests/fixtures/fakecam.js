// กล้องจำลองสำหรับเทสต์: node fakecam.js <ไฟล์ปลายทาง> [หน่วงมิลลิวินาที] [exit code]
const fs = require('fs'), path = require('path');
const [out, delay = '0', code = '0'] = process.argv.slice(2);
setTimeout(() => {
  if (out && out !== '-') fs.copyFileSync(path.join(__dirname, 'sample.jpg'), out);
  process.stderr.write('fakecam shot ok\n');
  process.exit(Number(code));
}, Number(delay));
