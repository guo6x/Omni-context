const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = __dirname;
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
  
  // 构建 Tauri 应用
  execSync('cd desktop-daemon && npm run tauri build', { stdio: 'inherit' });
  
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
console.log('\n📦 3. 打包浏览器插件...');
try {
  execSync('cd browser-extension && npm run build:chrome', { stdio: 'inherit' });
  execSync('cd browser-extension && npm run build:firefox', { stdio: 'inherit' });
  
  const browserDir = path.join(DIST_DIR, 'browser-extension');
  if (!fs.existsSync(browserDir)) fs.mkdirSync(browserDir, { recursive: true });
  
  const chromeBuild = path.join(ROOT_DIR, 'browser-extension', 'build', 'chrome-mv3-prod');
  if (fs.existsSync(chromeBuild)) {
    copyDir(chromeBuild, path.join(browserDir, 'chrome'));
  }
  
  const firefoxBuild = path.join(ROOT_DIR, 'browser-extension', 'build', 'firefox-mv2-prod');
  if (fs.existsSync(firefoxBuild)) {
    copyDir(firefoxBuild, path.join(browserDir, 'firefox'));
  }
  
  console.log('✅ 浏览器插件打包完成');
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

## 📦 包含的组件

### 桌面应用
- **Windows**: .msi 安装包
- **macOS**: .dmg 或 .app
- **Linux**: .AppImage, .deb 或 .rpm

### 浏览器插件
- **Chrome/Edge**: Chrome 浏览器插件
- **Firefox**: Firefox 浏览器插件

### 移动端
- **Android**: .apk 或 .aab (需要签名)
- **iOS**: .ipa (需要开发者账号)

### 硬件
- ESP32 固件和文档

## 🚀 安装说明

### 桌面应用
1. Windows: 双击 .msi 安装包
2. macOS: 双击 .dmg，拖拽到 Applications
3. Linux: chmod +x .AppImage 然后运行

### 浏览器插件
1. Chrome/Edge: 打开 chrome://extensions，开启开发者模式，加载解压的插件
2. Firefox: 打开 about:debugging，加载临时附加组件

### 移动端
1. Android: 直接安装 .apk
2. iOS: 通过 TestFlight 或 Xcode 安装

## 📝 更多信息
请查看各个目录下的 README.md 了解详细说明。

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
