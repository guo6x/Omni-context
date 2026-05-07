const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const iconSizes = [16, 24, 32, 48, 64, 72, 96, 128, 256, 512];
const svgPath = path.join(__dirname, 'icon.svg');
const outputDir = __dirname;

async function generateIcons() {
  console.log('开始生成应用图标...');
  
  // 加载 SVG
  const svg = fs.readFileSync(svgPath, 'utf8');
  
  for (const size of iconSizes) {
    console.log(`正在生成 ${size}x${size} 图标...`);
    
    // 创建画布
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // 由于 canvas 不直接支持 SVG，我们创建一个简单的渐变背景
    // 在实际项目中，可以使用专门的 SVG 渲染库
    
    // 绘制简单版本的图标
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#0a0b12');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    
    // 绘制外层六边形
    const hexRadius = size * 0.4;
    drawHexagon(ctx, size/2, size/2, hexRadius, '#06b6d4', 8);
    
    // 绘制内层六边形
    drawHexagon(ctx, size/2, size/2, hexRadius * 0.8, '#8b5cf6', 4, 0.8);
    
    // 绘制中心圆
    ctx.beginPath();
    ctx.arc(size/2, size/2, hexRadius * 0.2, 0, Math.PI * 2);
    const centerGradient = ctx.createLinearGradient(0, 0, size, size);
    centerGradient.addColorStop(0, '#06b6d4');
    centerGradient.addColorStop(1, '#22d3ee');
    ctx.fillStyle = centerGradient;
    ctx.fill();
    
    // 保存为 PNG
    const buffer = canvas.toBuffer('image/png');
    const outputPath = path.join(outputDir, `${size}x${size}.png`);
    fs.writeFileSync(outputPath, buffer);
    
    // 生成不带扩展名的版本（Tauri 需要）
    const outputPathNoExt = path.join(outputDir, `${size}x${size}`);
    fs.writeFileSync(outputPathNoExt, buffer);
    
    console.log(`✓ 生成完成: ${size}x${size}.png`);
  }
  
  // 创建占位符的 ICO 文件（Tauri 会自动处理）
  fs.copyFileSync(path.join(outputDir, '32x32.png'), path.join(outputDir, 'icon.ico'));
  fs.copyFileSync(path.join(outputDir, '128x128.png'), path.join(outputDir, 'icon.icns'));
  
  console.log('\n✓ 所有图标生成完成！');
}

function drawHexagon(ctx, x, y, radius, color, lineWidth, opacity = 1) {
  const angle = Math.PI / 3;
  
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const px = x + radius * Math.cos(i * angle - Math.PI / 2);
    const py = y + radius * Math.sin(i * angle - Math.PI / 2);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.stroke();
  
  ctx.restore();
}

// 如果没有 canvas 库，我们创建简单的占位符
try {
  require.resolve('canvas');
} catch (e) {
  console.log('⚠️ canvas 库未安装，创建简单的占位符图标...');
  
  // 创建简单的黑色占位符文件
  for (const size of iconSizes) {
    // 在实际项目中，这里可以用其他方式处理
    // 暂时只创建目录说明
  }
  
  console.log('💡 提示: 请安装 canvas 库以生成高质量图标');
  console.log('   npm install canvas');
  process.exit(0);
}

generateIcons().catch(console.error);
