# 📦 Omni-Context 自动打包脚本 (Simplified)
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Omni-Context v2.0 自动打包构建程序" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 优先尝试 ~/.cargo/bin (rustup 默认路径)；旧脚本里硬编码的中文用户名只在原始机器有效
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) {
    $env:PATH = "$cargoBin;$env:PATH"
}

# 1. 检查 Node.js
if (!(Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host "[!] 未检测到 Node.js" -ForegroundColor Red
    exit 1
}

# 2. 检查 Rust (cargo)
if (!(Get-Command "cargo" -ErrorAction SilentlyContinue)) {
    Write-Host "[!] 未检测到 Rust (cargo)" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] 环境检查正常" -ForegroundColor Green

# 3. 执行一键打包
Write-Host "`n[🚀] 开始执行全自动构建打包流水线..." -ForegroundColor Cyan

# 执行 node 构建脚本
node scripts/build-desktop-only.js

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[🎉] 打包成功！" -ForegroundColor Green
} else {
    Write-Host "`n[❌] 打包过程中出现错误。" -ForegroundColor Red
    exit 1
}
