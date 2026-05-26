const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'desktop-only');

console.log('🚀 开始快速打包桌面应用（含 Brain Server 集成）...\n');
console.log('ROOT_DIR:', ROOT_DIR);

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// 步骤 1: 检查依赖
console.log('\n📦 1. 检查并安装依赖...');
// 始终跑 npm install：package.json 变更（新增格式解析库等）需要触发更新。
// npm 会根据 lockfile 决定是否真的下载，命中缓存时接近 no-op。
try {
  console.log('   同步桌面应用依赖...');
  execSync('npm install', { cwd: path.join(ROOT_DIR, 'desktop-daemon'), stdio: 'inherit' });
  console.log('   同步 Brain Server 依赖...');
  execSync('npm install', { cwd: path.join(ROOT_DIR, 'brain-server'), stdio: 'inherit' });
  console.log('✅ 依赖检查完成');
} catch (e) {
  console.log('❌ 依赖安装失败');
  process.exit(1);
}

// 步骤 2: 构建 Brain Server
console.log('\n📦 2. 构建 Brain Server...');
try {
  execSync('npm run build', { cwd: path.join(ROOT_DIR, 'brain-server'), stdio: 'inherit' });
  
  // Tauri 的 resources glob `brain-server/**/*` 是相对 src-tauri/ 解析的，
  // 必须把 brain-server 落到 src-tauri/brain-server/，否则 Tauri 根本不会打包它。
  const brainServerInTauri = path.join(ROOT_DIR, 'desktop-daemon', 'src-tauri', 'brain-server');
  // 保留 models/（tessdata + Xenova embedding 模型，28MB 左右），避免每次重打都得重新下载
  if (fs.existsSync(brainServerInTauri)) {
    for (const name of fs.readdirSync(brainServerInTauri)) {
      if (name === 'models') continue;
      fs.rmSync(path.join(brainServerInTauri, name), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(brainServerInTauri, { recursive: true });
  
  // 复制 Brain Server 到 Tauri 应用的资源目录
  // 必须保留 dist/ 子目录：embedding/service.ts 和 ocr/pipeline.ts 用 `../../models`
  // 相对寻址 models，依赖 dist/embedding/ → ../../models 解析到 brain-server/models/。
  // 如果把 dist 平铺到 brain-server/ 根，路径会多向上一级，加载 Xenova 模型和 tessdata 都会失败。
  copyDir(path.join(ROOT_DIR, 'brain-server', 'dist'), path.join(brainServerInTauri, 'dist'));
  copyFile(path.join(ROOT_DIR, 'brain-server', 'package.json'), path.join(brainServerInTauri, 'package.json'));
  const lockPath = path.join(ROOT_DIR, 'brain-server', 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    copyFile(lockPath, path.join(brainServerInTauri, 'package-lock.json'));
  }

  // 装生产依赖（不带 dev），确保安装包能离线运行
  console.log('   安装 Brain Server 生产依赖（这一步比较慢，但只跑一次）...');
  execSync('npm install --omit=dev --no-audit --no-fund', {
    cwd: brainServerInTauri,
    stdio: 'inherit',
  });

  // 内嵌 node 可执行文件，让没装 Node 的用户机器也能跑
  const nodeBinaryName = process.platform === 'win32' ? 'node.exe' : 'node';
  const bundledNodePath = path.join(brainServerInTauri, nodeBinaryName);
  const systemNode = process.execPath; // 当前跑脚本的 node 本身
  if (systemNode && fs.existsSync(systemNode)) {
    copyFile(systemNode, bundledNodePath);
    // 确保 macOS/Linux 上可执行
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(bundledNodePath, 0o755);
      } catch (_) { /* best-effort */ }
    }
    console.log(`   已内嵌 ${nodeBinaryName}: ${systemNode}`);
  } else {
    console.warn(`   ⚠️ 未找到合适的 ${nodeBinaryName}（process.execPath=${systemNode}），安装包将依赖用户机器的系统 Node`);
  }
  console.log('✅ Brain Server 构建完成');
} catch (e) {
  console.log('❌ Brain Server 构建失败');
  console.error(e);
  process.exit(1);
}

// 步骤 3: 构建前端
console.log('\n📦 3. 构建前端...');
try {
  execSync('npm run build', { cwd: path.join(ROOT_DIR, 'desktop-daemon'), stdio: 'inherit' });
  console.log('✅ 前端构建完成');
} catch (e) {
  console.log('❌ 前端构建失败');
  console.error(e);
  process.exit(1);
}

// 步骤 4: 打包 Tauri 应用
console.log('\n📦 4. 打包 Tauri 桌面应用...');
try {
  console.log('   这可能需要几分钟...');
  console.log('   ⚠️ 注意：首次打包可能需要下载系统依赖');
  console.log('   ⚠️ Linux 用户需要安装系统依赖');
  console.log('');
  
  execSync('npm run tauri:build', { cwd: path.join(ROOT_DIR, 'desktop-daemon'), stdio: 'inherit' });
  
  const tauriBundle = path.join(ROOT_DIR, 'desktop-daemon', 'src-tauri', 'target', 'release', 'bundle');
  if (fs.existsSync(tauriBundle)) {
    copyDir(tauriBundle, DIST_DIR);
  }
  
  console.log('');
  console.log('✅ 桌面应用打包完成！');
  console.log('');
  console.log('📦 输出位置:');
  console.log('   - Windows: src-tauri/target/release/bundle/msi/*.msi');
  console.log('   - Windows: src-tauri/target/release/bundle/nsis/*.exe');
  console.log('   - macOS:   src-tauri/target/release/bundle/macos/*.dmg');
  console.log('   - Linux:   src-tauri/target/release/bundle/appimage/*.AppImage');
  
  console.log('');
  console.log('🚀 使用说明:');
  console.log('   1. Windows: 直接双击 .msi 或 .exe 安装');
  console.log('   2. macOS: 双击 .dmg，拖拽到 Applications');
  console.log('   3. Linux: chmod +x .AppImage 然后双击运行');
  
  console.log('');
  console.log('📖 更多信息请查看 BUILDING.md');
} catch (e) {
  console.log('');
  console.log('❌ 桌面应用打包失败');
  console.log('');
  console.log('💡 常见问题:');
  console.log('   1. Linux 系统依赖缺失');
  console.log('      运行: sudo apt install libwebkit2gtk-4.0-dev build-essential libssl-dev');
  console.log('   2. Node.js 版本不匹配');
  console.log('      需要 Node.js 18+，运行: node -v 检查版本');
  console.log('   3. Rust 未安装或版本太低');
  console.log('      需要 Rust 1.75+，运行: rustc -V 检查版本');
  
  console.log('');
  console.error(e);
  process.exit(1);
}

console.log('\n🎉 桌面应用打包成功！');

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
