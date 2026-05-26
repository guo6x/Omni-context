# Omni-Context Mobile App

Omni-Context 移动端 —— 只读搜索 + 快速捕获客户端，通过 LAN 与桌面端 brain-server 配对使用。

## 前置条件

- Node.js >= 18
- npm >= 9
- Expo Go app（iOS/Android）或 Android Studio / Xcode 模拟器

## 快速开始

```bash
cd mobile-app
npm install
npx expo start
```

启动后会显示 QR 码，用 Expo Go 扫码即可在真机上打开。

## 真机调试

### 方式一：Expo Go（推荐）

1. 手机上安装 **Expo Go**（App Store / Google Play）
2. 确保手机和桌面端在**同一局域网**
3. `npx expo start` 启动后，手机扫终端里的 QR 码
4. 进入 App 后在设置 → 配对该桌面端的配对码

### 方式二：Android 真机（USB 调试）

1. 开启手机开发者选项 → USB 调试
2. USB 连接电脑，运行 `adb devices` 确认设备在线
3. `npx expo start --android`（或扫码用 Expo Go）

### 方式三：iOS 模拟器

```bash
npx expo start --ios
```

前提：macOS + Xcode 已安装。

## 配对桌面应用

1. 启动桌面端 Omni-Context（确保 brain-server 运行在 3001 端口）
2. 桌面端设置 → 数据 → 查看**配对码**和 LAN IP
3. 移动端设置 → 配对 → 输入主机 IP、端口（默认 3001）、6 位配对码
4. 点击"连接"完成配对
5. 之后所有请求自动携带配对码鉴权

## 项目结构

```
mobile-app/
├── src/
│   ├── screens/        # 页面组件
│   ├── components/     # 可复用组件
│   ├── services/       # API 客户端
│   ├── hooks/          # Zustand / React hooks
│   ├── locales/        # i18n（zh / en）
│   └── types/          # TypeScript 类型
├── App.tsx             # 入口
├── package.json
└── app.json            # Expo 配置
```

## 常见问题

**Q: 扫码后一直 loading？**
确认手机和电脑在同一 WiFi，且桌面端 brain-server 已启动（端口 3001）。

**Q: 配对后搜索报错？**
检查桌面端防火墙是否允许 3001 端口的入站连接。

**Q: 配对码过期？**
桌面端重新生成配对码后，旧码立即失效。移动端需要重新配对。
