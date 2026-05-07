# 📦 Omni-Context 自动打包脚本 (Windows)
# 此脚本将自动检查并安装缺失的构建依赖（Rust, Node.js），然后打包出 .exe / .msi 安装包

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Omni-Context v2.0 自动打包构建程序" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. 检查 Node.js
if (!(Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host "[!] 未检测到 Node.js，请先前往 https://nodejs.org 下载并安装 Node.js" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js 已安装" -ForegroundColor Green

# 2. 检查 Rust (cargo)
$cargoInstalled = Get-Command "cargo" -ErrorAction SilentlyContinue
if (!$cargoInstalled) {
    Write-Host "[!] 未检测到 Rust (cargo)。正在下载并安装 Rust..." -ForegroundColor Yellow
    
    # 下载 rustup-init
    Invoke-WebRequest "https://win.rustup.rs" -OutFile "rustup-init.exe"
    
    Write-Host "[*] 启动 Rust 安装程序，请在弹出的窗口中按回车键选择默认安装 (1)..." -ForegroundColor Yellow
    # 运行安装程序
    Start-Process -Wait -FilePath ".\rustup-init.exe" -ArgumentList "-y"
    
    # 清理安装程序
    Remove-Item "rustup-init.exe"
    
    # 刷新环境变量
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    
    if (!(Get-Command "cargo" -ErrorAction SilentlyContinue)) {
        Write-Host "[!] Rust 安装可能需要重启终端才能生效。请重启终端后再次运行此脚本。" -ForegroundColor Red
        exit 1
    }
}
Write-Host "[OK] Rust (cargo) 环境正常" -ForegroundColor Green

# 3. 检查 C++ Build Tools (简单检查 cl.exe 或是依靠 tauri build 报错)
Write-Host "[*] 注意: Tauri 打包在 Windows 上需要 Microsoft C++ Build Tools" -ForegroundColor Yellow
Write-Host "[*] 如果构建失败，请确保您已安装 'C++ 桌面开发' 工作负载" -ForegroundColor Yellow

# 4. 执行一键打包
Write-Host "`n[🚀] 开始执行全自动构建打包流水线..." -ForegroundColor Cyan

# 执行 node 构建脚本
node scripts/build-desktop-only.js

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[🎉] 打包成功！安装包已生成在以下位置：" -ForegroundColor Green
    Write-Host "desktop-daemon\src-tauri\target\release\bundle\msi\" -ForegroundColor Cyan
    Write-Host "desktop-daemon\src-tauri\target\release\bundle\nsis\" -ForegroundColor Cyan
} else {
    Write-Host "`n[❌] 打包过程中出现错误，请检查上面的日志。" -ForegroundColor Red
}

Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
