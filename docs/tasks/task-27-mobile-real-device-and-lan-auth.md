# Task 27: 移动端真机配套 + LAN 鉴权（配对码）

## 背景

[[task-19-mobile-readonly-search]] 把移动端从占位升级到了"只读搜索 MVP"，**typecheck 通过但没真机/模拟器测试**。同时 LAN 同步没有任何鉴权，局域网里任何人扫到 brain-server 都能查图谱——本地优先的产品定位下这是个明显的隐私漏洞。

用户暂时没安卓/iOS 设备做真机测试，所以本任务要做的是：

1. **代码层把真机能跑这条路走通** —— 修任何 expo / native-stack / 依赖问题，让 `npx expo start` 能起来
2. **加 LAN 鉴权** —— 配对码模型，桌面 App 生成 6 位数字码，移动端首次连接时输入

成功后用户找别人在真机测试就行。

## 目标

### A. 移动端真机能跑

- 检查 `mobile-app/package.json` 依赖完整（特别是 `@react-navigation/native-stack`——task-19 报告里提到可能未装）
- `npx expo doctor` 跑过
- `npx expo prebuild` 能产出 native 项目
- 写一份 `mobile-app/README.md` 教别人怎么跑：扫码 QR / 装 dev build / 真机调试

### B. LAN 鉴权（配对码）

设计：

1. 桌面 App 启动 brain-server 时自动生成一个 6 位数字配对码（存在 `%LOCALAPPDATA%\omni-context\pair-code.txt`，每次启动覆盖）
2. 桌面 App 设置面板加"配对码"区块，显示当前码 + "重新生成"按钮 + QR 码（QR 编码 `omni://pair?host=<lan-ip>&port=3001&code=<6-digit>`）
3. brain-server 加全局 middleware：
   - 检查 `Authorization: Bearer <code>` header
   - 来源 `127.0.0.1` 的请求**白名单放行**（桌面 App UI 自己用）
   - 其他来源必须带正确的 pair code，否则 401
4. 移动端 SettingsScreen：
   - 加"扫描配对码" 按钮（用 expo-camera + `expo-barcode-scanner`）OR 手动输入码 + IP
   - 配对成功后把 `{ host, port, code }` 存到 AsyncStorage
   - 之后所有请求自动带 `Authorization: Bearer <code>`
5. 桌面 App **重新生成码后**：移动端会 401 → 提示用户重新配对

## 涉及文件

- `mobile-app/package.json` —— 补缺失依赖
- `mobile-app/src/screens/SettingsScreen.tsx` —— 扫码 / 手动输入 / 存 token
- `mobile-app/src/services/api.ts` —— 自动加 Authorization header
- `mobile-app/README.md`（新建）—— 真机调试指南
- `brain-server/src/api/routes.ts` —— 加 auth middleware
- `desktop-daemon/src-tauri/src/brain_server.rs` —— 启动时生成 pair-code.txt + 把 code 通过 env 传给 brain-server
- `brain-server/src/mcp-server.ts` / `api-server.ts` —— 读取 PAIR_CODE 环境变量
- `desktop-daemon/src/components/SettingsPanel.tsx` —— "配对码"区块 + QR 显示（用 `qrcode.react` 库）
- `desktop-daemon/src/locales/zh.ts` + `en.ts` —— i18n key

## 约束

- **127.0.0.1 一律免鉴权** —— 桌面 App UI 自己用 fetch 不要受影响
- **mcp-proxy 走 127.0.0.1 也免鉴权** —— Claude Desktop 等 MCP 客户端不需要配置 code
- 配对码用 `crypto.randomBytes(3).readUInt16BE() % 1000000` 凑 6 位数字，padStart 补零
- 移动端 6 位数字输入框要够大，老人也能看清
- QR 码用 `qrcode.react`（5KB），不引入大库
- LAN IP 在桌面侧用 Tauri `tauri::api::os::hostname` + `local_ip_address` 之类 crate 取（如果没有就让用户手动看 ipconfig 抄）
- **不要做"信任过的设备列表"** —— 配对码就是 token，重新生成就让所有客户端失效
- 不存配对码到 Tauri secure storage / keychain —— 本地文件 + LOCALAPPDATA 已经够

## 验收标准

1. ✅ `mobile-app` 跑 `npx expo doctor` 全绿
2. ✅ `npx expo start` 在桌面机能起，扫 QR 用真机或模拟器能加载到 App
3. ✅ 移动端首次启动看到"请配对 Omni-Context 桌面应用"引导
4. ✅ 桌面端设置面板能看到当前配对码 + QR
5. ✅ 移动端扫 QR → 自动配对成功 → 搜索能用
6. ✅ 故意改桌面端配对码 → 移动端下次请求 401 → 提示"配对失效请重新配对"
7. ✅ 不带 Authorization 直接 curl `http://<lan-ip>:3001/api/entities/search` → 401
8. ✅ curl `http://127.0.0.1:3001/api/entities/search` → 200（本机免鉴权）
9. ✅ MCP 客户端（Claude Desktop）通过 mcp-proxy 访问仍正常工作（走 127.0.0.1）
10. ✅ 写一份 `mobile-app/README.md` 教真机调试步骤
11. ✅ `cd mobile-app && npx tsc --noEmit` 通过
12. ✅ `cd brain-server && npx tsc --noEmit` 通过

## 进度文档

`docs/progress/2026-05-26-task-27-mobile-real-device-and-lan-auth.md`

包含：
- mobile-app 缺什么依赖 / 补了什么
- LAN 鉴权架构图 + 配对码生命周期
- 测试方法（如何用 Android emulator / iOS simulator 跑过最少一遍）
- 遗留：真机实测留给用户找设备验证

## 不要做的事

- 不要做账号系统 / 注册登录 —— 配对码就够
- 不要做云端中继 —— LAN 优先
- 不要做多设备配对码同时有效（重新生成就让所有失效）
- 不要在移动端加截屏沉淀能力 —— 移动端定位为只读
- 不要做"扫不到 brain-server" 的自动发现 —— 配对 QR 里已经带 IP + port
