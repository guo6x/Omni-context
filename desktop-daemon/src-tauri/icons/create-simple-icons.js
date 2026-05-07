const fs = require('fs');
const path = require('path');

// 简单的图标生成脚本 - 创建最小的占位符
const iconSizes = [32, 128];

console.log('🎨 创建简单的占位符图标...');

for (const size of iconSizes) {
  console.log(`   - 创建 ${size}x${size}...');
  
  // 创建一个简单的黑色背景的 PNG 占位符
  // 这里我们只创建一个说明文件
  const placeholderPath = path.join(__dirname, `${size}x${size}.png.txt`);
  fs.writeFileSync(placeholderPath, 
    `# 占位符图标\n\n请替换为真实的图标文件。\n使用在线工具 https://icon.kitchen/ 或 https://convertico.com/ 来生成真实图标。\n\n源文件: icon.svg\n`);
  
  console.log(`   ✓ ${size}x${size} 占位符创建完成`);
}

// 创建简单的 README
console.log('\n📝 图标占位符创建完成！\n\n💡 下一步：\n1. 使用在线工具转换 icon.kitchen 或 convertico.com\n2. 上传 icons/icon.svg 文件\n3. 下载生成的图标文件\n4. 放到 icons/ 文件夹中\n\n⚡ 或者：\n如果你已经有了真实的图标文件，\n直接替换占位符图标即可！\n');
