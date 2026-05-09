// 从 icon.svg 生成所有平台所需的 PNG 图标。
// 依赖：@resvg/resvg-js（纯 JS，跨平台无需 native 编译），png-to-ico。
// 用法：在本目录下 `node generate-icons.js`
//
// 覆盖：
//   - desktop-daemon/src-tauri/icons/ 全部尺寸 + ICO
//   - browser-extension/icons/ icon16/48/128.png
//   - mobile-app/assets/ icon.png / adaptive-icon.png / favicon.png
//
// splash.png 不在生成范围（需要带文字与版式，开屏单独处理）。

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico').default;

const ICON_DIR = __dirname;
const REPO_ROOT = path.resolve(ICON_DIR, '..', '..', '..');
const SVG_PATH = path.join(ICON_DIR, 'icon.svg');
const SPLASH_SVG_PATH = path.join(ICON_DIR, 'splash.svg');

const svg = fs.readFileSync(SVG_PATH);
const splashSvg = fs.existsSync(SPLASH_SVG_PATH) ? fs.readFileSync(SPLASH_SVG_PATH) : null;

function render(size) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}

function renderSplash(width) {
  if (!splashSvg) return null;
  const r = new Resvg(splashSvg, {
    fitTo: { mode: 'width', value: width },
    background: '#0a0e1f',
    font: { loadSystemFonts: true },
  });
  return r.render().asPng();
}

function writePng(file, size) {
  fs.writeFileSync(file, render(size));
  console.log(`  ${path.relative(REPO_ROOT, file)}  (${size}x${size})`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  console.log('1) Tauri / Windows / macOS icons');
  const tauriSizes = [
    ['32x32.png', 32],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
    ['icon.png', 512],
    ['Square30x30Logo.png', 30],
    ['Square44x44Logo.png', 44],
    ['Square71x71Logo.png', 71],
    ['Square89x89Logo.png', 89],
    ['Square107x107Logo.png', 107],
    ['Square142x142Logo.png', 142],
    ['Square150x150Logo.png', 150],
    ['Square284x284Logo.png', 284],
    ['Square310x310Logo.png', 310],
    ['StoreLogo.png', 50],
  ];
  for (const [name, size] of tauriSizes) writePng(path.join(ICON_DIR, name), size);

  console.log('\n2) Windows .ico (multi-resolution)');
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBuffers = icoSizes.map((s) => render(s));
  const icoTmpFiles = [];
  for (let i = 0; i < icoSizes.length; i++) {
    const tmp = path.join(ICON_DIR, `__ico_${icoSizes[i]}.png`);
    fs.writeFileSync(tmp, icoBuffers[i]);
    icoTmpFiles.push(tmp);
  }
  const icoBuf = await pngToIco(icoTmpFiles);
  fs.writeFileSync(path.join(ICON_DIR, 'icon.ico'), icoBuf);
  console.log(`  ${path.relative(REPO_ROOT, path.join(ICON_DIR, 'icon.ico'))}  (multi-res)`);
  for (const f of icoTmpFiles) fs.unlinkSync(f);

  console.log('\n3) macOS .icns placeholder');
  // 真正的 .icns 多尺寸格式需要 iconutil 或 png2icns；这里写一个 1024px 的 PNG
  // 占位（命名为 .icns），Tauri/macOS 在缺失时会回退。如需正式 .icns 在 macOS 上
  // 用 `iconutil -c icns Omni.iconset` 生成。
  fs.writeFileSync(path.join(ICON_DIR, 'icon.icns'), render(1024));
  console.log(`  ${path.relative(REPO_ROOT, path.join(ICON_DIR, 'icon.icns'))}  (1024 placeholder)`);

  console.log('\n4) Browser extension icons');
  const extDir = path.join(REPO_ROOT, 'browser-extension', 'icons');
  ensureDir(extDir);
  for (const s of [16, 48, 128]) {
    writePng(path.join(extDir, `icon${s}.png`), s);
  }

  console.log('\n5) Mobile (Expo) icons');
  const mobDir = path.join(REPO_ROOT, 'mobile-app', 'assets');
  ensureDir(mobDir);
  writePng(path.join(mobDir, 'icon.png'), 1024);
  writePng(path.join(mobDir, 'adaptive-icon.png'), 1024);
  writePng(path.join(mobDir, 'favicon.png'), 48);

  console.log('\n6) Mobile splash screen');
  const splashBuf = renderSplash(1284);
  if (splashBuf) {
    const splashOut = path.join(mobDir, 'splash.png');
    fs.writeFileSync(splashOut, splashBuf);
    console.log(`  ${path.relative(REPO_ROOT, splashOut)}  (1284x2778)`);
  } else {
    console.log('  (skipped — splash.svg not found)');
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
