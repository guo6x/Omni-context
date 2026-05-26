# Task 27 进度: 移动端真机配套 + LAN 鉴权（配对码）

## 完成内容

### 1. LAN 鉴权（配对码模型）

**脑服务器 auth middleware** (`brain-server/src/api/routes.ts`)
- `isAuthorized()` middleware：127.0.0.1/::1/localhost 白名单放行，其他来源检查 `Authorization: Bearer <code>`
- 未设置 PAIR_CODE 环境变量时允许所有请求（向后兼容）
- `/health` 端点始终免鉴权

**Rust 端配对码生成** (`desktop-daemon/src-tauri/src/brain_server.rs`)
- `ensure_pair_code()`：启动时检查已有配对码文件，不存在则生成新的
- `generate_pair_code()`：使用 `std::hash::RandomState` 生成 6 位数字码
- `get_lan_ip()`：通过 `local-ip-address` crate 获取局域网 IP
- 配对码存于 `%LOCALAPPDATA%/omni-context/pair-code.txt`，每次启动覆盖
- 启动 brain-server 时通过环境变量传入 PAIR_CODE + LAN_IP

**Tauri commands** (`desktop-daemon/src-tauri/src/commands.rs`)
- `get_pair_code()`：返回当前配对码、LAN IP、端口
- `regenerate_pair_code()`：重新生成配对码（使所有旧客户端失效）

**桌面端设置面板** (`desktop-daemon/src/components/SettingsPanel.tsx`)
- 数据标签页显示配对码区块
- QR 码（`QRCodeSVG` from qrcode.react）编码 `omni://pair?host=<ip>&port=<port>&code=<code>`
- 配对码明文显示 + 重新生成按钮
- i18n 键已补全（zh.ts + en.ts）

### 2. 移动端配对

**API 客户端** (`mobile-app/src/services/api.ts`)
- `ApiConfig.authToken` 可选字段
- `configure()` 自动设置 `Authorization: Bearer <token>`
- 401 响应拦截返回 `PAIR_CODE_EXPIRED` 错误
- `setAuthToken()` / `clearAuthToken()` 方法

**设置 Store** (`mobile-app/src/hooks/useSettings.ts`)
- `AppSettings` 新增 `pairCode`, `pairHost`, `pairPort`
- `setPairConfig(host, port, code)` 存储配对信息
- `clearPairConfig()` 清除配对
- Zustand persist 到 AsyncStorage

**设置页面** (`mobile-app/src/screens/SettingsScreen.tsx`)
- 配对区域：已配对时显示状态 + 清除按钮，未配对时显示设置入口
- 配对模态框：主机地址、端口（默认 3001）、6 位数字配对码（大字居中）输入框
- `handlePair()`：输入校验 → 配置 API client → 存储配对
- `handleClearPair()`：清除配对 + 清除 auth token
- 6 位码输入只允许数字，maxLength=6

**i18n** (`mobile-app/src/locales/zh.ts` + `en.ts`)
- 配对相关 10 个 key 已添加
- `sync.serverSaved` 已添加

### 3. 依赖修复

- `@types/react-native` 已移除（react-native 自带类型）
- `react-native` 从 0.72.6 → 0.72.10（通过 `expo install --fix`）

### 4. 文档

- `mobile-app/README.md`：真机调试指南（Expo Go / USB / 模拟器）、配对步骤、项目结构

## 架构：配对码生命周期

```
桌面启动 → Rust 生成 6 位码 → 存文件 + 设环境变量
  → brain-server 读取 PAIR_CODE → middleware 鉴权
  → 桌面设置面板显示 QR + 明文码

移动端 → 手动输入 host/port/code（或扫 QR）
  → 存入 AsyncStorage → 后续请求自动带 Authorization: Bearer <code>

桌面重新生成 → 旧码立刻失效
  → 移动端下次请求 401 → 提示重新配对
```

## 构建结果

| 项目 | 结果 |
|------|------|
| brain-server `npm run build` | ✅ |
| desktop-daemon `npx tsc --noEmit` | ✅ |
| desktop-daemon `npm run build` | ✅ |
| mobile-app `npx tsc --noEmit` | ✅ |

## 测试方法

1. 启动桌面端 → 设置 → 数据 → 查看配对码
2. 移动端扫码/手动输入配对码
3. 搜索功能应正常工作
4. 验证鉴权：`curl http://<lan-ip>:3001/api/entities/search` → 401
5. 验证本机免鉴权：`curl http://127.0.0.1:3001/api/entities/search` → 200
6. 桌面端重新生成配对码 → 移动端下次请求应报 401

## 遗留

- 真机实测留给用户在有设备的条件下验证
- PDF 功能（expo-print）未引入——移动端定位为只读
- 扫码配对（expo-camera + barcode-scanner）未引入——手动输入已够用，QR 码为将来扫码预留
