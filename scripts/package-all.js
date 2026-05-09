const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('🚀 开始打包 Omni-Context 所有组件...\n');

// 创建输出目录
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// 清理旧的输出
console.log('🧹 清理旧的输出...');
const cleanScripts = [
  'cd desktop-daemon && rm -rf src-tauri/target/release/bundle',
  'cd browser-extension && rm -rf build',
  'cd brain-server && rm -rf dist',
  'cd mobile-app && rm -rf .expo-shared dist'
];

cleanScripts.forEach(script => {
  try {
    execSync(script, { stdio: 'ignore' });
  } catch (e) {
    // 忽略错误
  }
});

// 步骤 1: 构建 Brain Server
console.log('\n📦 1. 构建 Brain Server...');
try {
  execSync('cd brain-server && npm run build', { stdio: 'inherit' });
  const brainServerDir = path.join(DIST_DIR, 'brain-server');
  if (!fs.existsSync(brainServerDir)) fs.mkdirSync(brainServerDir, { recursive: true });
  copyDir(path.join(ROOT_DIR, 'brain-server', 'dist'), brainServerDir);
  copyFile(path.join(ROOT_DIR, 'brain-server', 'package.json'), path.join(brainServerDir, 'package.json'));
  console.log('✅ Brain Server 构建完成');
} catch (e) {
  console.log('❌ Brain Server 构建失败');
  console.error(e);
}

// 步骤 2: 打包桌面应用
console.log('\n📦 2. 打包桌面应用...');
try {
  // 首先构建 Brain Server，确保它被包含在 Tauri 应用中
  const brainServerInTauri = path.join(ROOT_DIR, 'desktop-daemon', 'brain-server');
  if (fs.existsSync(brainServerInTauri)) {
    fs.rmSync(brainServerInTauri, { recursive: true });
  }
  fs.mkdirSync(brainServerInTauri, { recursive: true });
  copyDir(path.join(ROOT_DIR, 'brain-server', 'dist'), brainServerInTauri);
  
  // 构建 Tauri 应用（使用 tauri.prod.conf.json：去掉 unsafe-eval、收紧 connect-src）
  execSync('cd desktop-daemon && npm run tauri:build', { stdio: 'inherit' });
  
  const desktopDir = path.join(DIST_DIR, 'desktop-app');
  if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });
  
  const tauriBundle = path.join(ROOT_DIR, 'desktop-daemon', 'src-tauri', 'target', 'release', 'bundle');
  if (fs.existsSync(tauriBundle)) {
    copyDir(tauriBundle, desktopDir);
  }
  
  console.log('✅ 桌面应用打包完成');
} catch (e) {
  console.log('❌ 桌面应用打包失败');
  console.error(e);
}

// 步骤 3: 打包浏览器插件
// 现在的扩展是手写的 manifest v3 静态文件（不是 Plasmo / webpack），
// 因此只跑 tailwind build 编 css，再把发布所需的文件复制 + zip 即可。
console.log('\n📦 3. 打包浏览器插件...');
try {
  execSync('cd browser-extension && npm run build', { stdio: 'inherit' });

  const browserDir = path.join(DIST_DIR, 'browser-extension');
  const unpackedDir = path.join(browserDir, 'unpacked');
  if (fs.existsSync(unpackedDir)) fs.rmSync(unpackedDir, { recursive: true });
  fs.mkdirSync(unpackedDir, { recursive: true });

  // 打包名单：发布需要的文件 / 目录；不包含 node_modules、src、tailwind config 等
  const extRoot = path.join(ROOT_DIR, 'browser-extension');
  const include = [
    'manifest.json',
    'background.js',
    'content.js',
    'content.css',
    'popup.html',
    'popup.js',
    'icons',
  ];
  for (const name of include) {
    const src = path.join(extRoot, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(unpackedDir, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest);
    else copyFile(src, dest);
  }

  // 用 PowerShell 自带的 Compress-Archive 打 zip（Windows 必有，免依赖）
  const zipPath = path.join(browserDir, 'omni-context-extension.zip');
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${unpackedDir}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' }
  );

  console.log('✅ 浏览器插件打包完成 (unpacked + zip，Chrome/Edge/Firefox 109+ 通用)');
} catch (e) {
  console.log('❌ 浏览器插件打包失败');
  console.error(e);
}

// 步骤 4: 构建移动端（EAS Build 预览模式）
console.log('\n📦 4. 构建移动端应用（预览模式）...');
console.log('⚠️ 注意：完整的 iOS/Android 打包需要 EAS 服务和签名证书');
console.log('📝 已生成 package.json 和 build 配置，请参考 mobile-app/README.md');
try {
  const mobileDir = path.join(DIST_DIR, 'mobile-app');
  if (!fs.existsSync(mobileDir)) fs.mkdirSync(mobileDir, { recursive: true });
  copyFile(path.join(ROOT_DIR, 'mobile-app', 'app.json'), path.join(mobileDir, 'app.json'));
  copyFile(path.join(ROOT_DIR, 'mobile-app', 'package.json'), path.join(mobileDir, 'package.json'));
  console.log('✅ 移动端配置文件已生成');
} catch (e) {
  console.log('❌ 移动端构建失败');
  console.error(e);
}

// 步骤 5: 复制硬件文档
console.log('\n📦 5. 复制硬件文档...');
try {
  const hardwareDir = path.join(DIST_DIR, 'hardware');
  if (!fs.existsSync(hardwareDir)) fs.mkdirSync(hardwareDir, { recursive: true });
  copyDir(path.join(ROOT_DIR, 'hardware'), hardwareDir);
  console.log('✅ 硬件文档已复制');
} catch (e) {
  console.log('❌ 硬件文档复制失败');
  console.error(e);
}

// 生成 README
console.log('\n📖 生成说明文档...');
const readmeContent = `# Omni-Context 打包输出

## 实际产物

### \`desktop-app/\` —— 桌面应用（仅当前打包平台）
- Windows: \`msi/Omni-Context_*.msi\` 与 \`nsis/Omni-Context_*-setup.exe\`
- macOS: \`macos/*.dmg\`（仅在 macOS 上跑 \`npm run package\` 才会产出）
- Linux: \`appimage/*.AppImage\`、\`deb/*.deb\`（仅在 Linux 上）

### \`browser-extension/\` —— 浏览器扩展
- \`unpacked/\`：解压目录，Chrome/Edge 可"加载已解压的扩展"直接调试
- \`omni-context-extension.zip\`：上架商店或分发用的 zip 包
- 同一份产物兼容 Chrome / Edge / Firefox 109+（manifest v3）

### \`mobile-app/\` —— 移动端
- 当前只复制了 \`app.json\` 与 \`package.json\`
- 真正的 .apk / .aab / .ipa 需要走 \`eas build\`，参考 \`mobile-app/README.md\`

### \`brain-server/\` —— 单跑后端的产物
- 编译后的 \`dist/\`，可独立 \`node mcp-server.js\` 启动
- 桌面应用安装包已经把它打进去了，**普通用户不需要单独装这个**

### \`hardware/\` —— ESP32 固件源码与说明
- 不是二进制，需要用 PlatformIO / Arduino IDE 烧录

## 安装说明

- **桌面 (Windows)**: 双击 \`desktop-app/msi/*.msi\` 或 \`nsis/*-setup.exe\` 二选一
- **浏览器扩展**: \`chrome://extensions\` → 开发者模式 → "加载已解压的扩展" → 选 \`browser-extension/unpacked/\`
- **移动端 / 硬件**: 需自己走 EAS / PlatformIO，详见各自子项目 README

---
Omni-Context v${require('../package.json').version}
`;
fs.writeFileSync(path.join(DIST_DIR, 'README.md'), readmeContent);

console.log('\n🎉 所有组件打包完成！');
console.log(`📂 输出目录: ${DIST_DIR}`);
console.log('\n📖 查看 dist/README.md 了解安装说明');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}
