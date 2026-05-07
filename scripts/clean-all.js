const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('🧹 开始清理 Omni-Context 构建输出...\n');

const cleanList = [
  path.join(ROOT_DIR, 'dist'),
  path.join(ROOT_DIR, 'desktop-daemon', 'src-tauri', 'target'),
  path.join(ROOT_DIR, 'desktop-daemon', 'node_modules'),
  path.join(ROOT_DIR, 'desktop-daemon', 'brain-server'),
  path.join(ROOT_DIR, 'desktop-daemon', 'dist'),
  path.join(ROOT_DIR, 'desktop-daemon', '.next'),
  path.join(ROOT_DIR, 'brain-server', 'node_modules'),
  path.join(ROOT_DIR, 'brain-server', 'dist'),
  path.join(ROOT_DIR, 'browser-extension', 'node_modules'),
  path.join(ROOT_DIR, 'browser-extension', 'build'),
  path.join(ROOT_DIR, 'mobile-app', 'node_modules'),
  path.join(ROOT_DIR, 'mobile-app', '.expo'),
  path.join(ROOT_DIR, 'mobile-app', '.expo-shared'),
  path.join(ROOT_DIR, 'mobile-app', 'dist'),
];

let cleanedCount = 0;
cleanList.forEach((dirPath) => {
  if (fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`✅ ${dirPath}`);
      cleanedCount++;
    } catch (e) {
      console.log(`❌ ${dirPath}: ${e.message}`);
    }
  }
});

console.log(`\n🧹 清理完成！共清理了 ${cleanedCount} 个目录/文件。`);
console.log('\n📝 注意：node_modules 目录已清理，如需重新安装依赖请运行 npm install。');
