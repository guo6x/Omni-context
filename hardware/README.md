# Omni-Context 硬件神经末梢

ESP32 微控制器作为 Omni-Context 系统的物理神经末梢，提供实体按键交互体验。

## 概述

硬件神经末梢是 Omni-Context 生态系统的可选组件，通过物理按键提供触感反馈，实现"一键沉淀"、"一键决策"等快捷操作。

### 核心功能

- **沉淀键**: 一键捕获屏幕内容并提取知识
- **决策键**: 快速触发 AI 辅助决策
- **重置键**: 重置当前状态

### 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Omni-Context 系统                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐      WiFi/UDP       ┌─────────────────┐   │
│   │   ESP32     │ ──────────────────► │  桌面守护进程   │   │
│   │  神经末梢   │    UDP:9090         │  (Desktop App)  │   │
│   └─────────────┘                     └─────────────────┘   │
│         │                                      │            │
│    物理按键                              知识图谱处理        │
│         │                                      │            │
│    ┌────┴────┐                                 ▼            │
│    │ 沉淀键  │                           Brain Server       │
│    │ 决策键  │                                                 │
│    │ 重置键  │                                                 │
│    └─────────┘                                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
hardware/
├── README.md              # 本文件 - 硬件总体说明
├── BOM.md                 # 物料清单
├── ASSEMBLY.md            # 组装指南
└── esp32-firmware/        # ESP32 固件
    ├── README.md          # 固件详细说明
    ├── platformio.ini     # PlatformIO 配置
    ├── wiring_diagram.md  # 电路连接图
    └── src/
        └── main.ino       # 主固件代码
```

## 硬件要求

### 必需组件

| 组件 | 规格 | 说明 |
|------|------|------|
| ESP32 开发板 | DevKit V1 | 或 ESP32-S3 等兼容板 |
| 按键开关 | 12mm 触感开关 | x3 |
| 面包板 | 830点 | 或定制 PCB |
| 跳线 | 公对公/公对母 | 若干 |
| USB 数据线 | Micro USB | 供电和编程 |

### 可选组件

| 组件 | 用途 |
|------|------|
| 3D 打印外壳 | 保护设备 |
| WS2812B RGB LED | 状态指示 |
| 蜂鸣器 | 声音反馈 |
| 定制 PCB | 更专业的成品 |

## 快速开始

### 1. 准备硬件

参考 [BOM.md](BOM.md) 购买所需组件。

### 2. 组装电路

参考 [ASSEMBLY.md](ASSEMBLY.md) 进行组装。

### 3. 烧录固件

参考 [esp32-firmware/README.md](esp32-firmware/README.md) 烧录固件。

### 4. 配置连接

通过串口配置 WiFi 和目标 IP:

```
ssid YourWiFiName
pass YourWiFiPassword  
host 192.168.1.100
save
connect
```

### 5. 开始使用

- 启动 Omni-Context 桌面应用
- 按下按键触发对应功能

## 电路连接

| 按键功能 | ESP32 引脚 | 连接方式 |
|---------|-----------|---------|
| 沉淀键 | GPIO 14 | 接 GND，使用内部上拉 |
| 决策键 | GPIO 27 | 接 GND，使用内部上拉 |
| 重置键 | GPIO 26 | 接 GND，使用内部上拉 |
| LED 状态灯 | GPIO 2 | 板载 LED |

详细电路图请参考 [wiring_diagram.md](esp32-firmware/wiring_diagram.md)。

## 固件特性

### 核心功能

- ✅ 三键监听和防抖处理
- ✅ WiFi 自动连接和断线重连
- ✅ UDP 低延迟事件传输
- ✅ JSON 格式消息
- ✅ OTA 无线固件更新
- ✅ EEPROM 配置持久化
- ✅ 串口命令行配置
- ✅ 心跳保活机制

### LED 状态指示

| 状态 | LED 表现 |
|------|----------|
| WiFi 连接中 | 快速闪烁 |
| WiFi 已连接 | 常亮 |
| WiFi 断开 | 熄灭 |
| 按键触发 | 闪烁反馈 |

## UDP 协议

### 消息格式

```json
{
  "version": 1,
  "device_id": "esp32-001122aabbcc",
  "action": "precipitate",
  "timestamp": 1783785600,
  "nonce": "00112233445566778899aabbccddeeff",
  "signature": "HMAC-SHA256 hex"
}
```

完整的签名、配对、防重放和模拟器约定见 [`PROTOCOL.md`](PROTOCOL.md)。

### 支持的动作

| 动作 | 触发 | 说明 |
|------|------|------|
| `precipitate` | 沉淀键 | 捕获屏幕并提取知识 |
| `decision` | 决策键 | 触发决策功能 |
| `reset` | 重置键 | 重置当前状态 |
| `device_online` | 启动时 | 设备上线通知 |
| `heartbeat` | 每30秒 | 心跳保活 |

## 桌面守护进程配置

确保桌面守护进程的 UDP 服务已启动并监听 9090 端口。

> ⚠️ **远程硬件必读**: v3.0+ 桌面端默认仅在 `127.0.0.1:9090` 监听，
> 同网段的 ESP32 设备无法直接送达。要让物理按钮 / ESP32 触发：
>
> 启动桌面端前设置环境变量：
> ```bash
> # Windows PowerShell
> $env:OMNI_UDP_BIND="0.0.0.0:9090"
>
> # Linux/macOS
> export OMNI_UDP_BIND=0.0.0.0:9090
> ```
>
> 仅本机调试请保留默认值，避免 LAN 上任意进程都能触发屏幕截图 / 剪贴板读取。

### 检查 UDP 服务

```bash
# Linux/macOS
netstat -an | grep 9090

# Windows
netstat -an | findstr 9090
```

### 防火墙配置

如果开启了 `OMNI_UDP_BIND=0.0.0.0:9090`，确保防火墙允许 UDP 9090 端口的入站连接。

```bash
# Linux (ufw)
sudo ufw allow 9090/udp

# Windows
# 控制面板 → Windows Defender 防火墙 → 高级设置
# 新建入站规则 → 端口 → UDP → 9090 → 允许连接
```

## 故障排除

### WiFi 连接问题

1. 确认 WiFi 为 2.4GHz (ESP32 不支持 5GHz)
2. 检查 SSID 和密码是否正确
3. 尝试靠近路由器

### 按键无响应

1. 检查接线是否正确
2. 确认按钮连接到 GND
3. 查看串口输出

### UDP 消息未收到

1. 确认桌面应用正在运行
2. 检查 IP 地址是否正确
3. 检查防火墙设置

## 开发资源

### 相关文档

- [物料清单](BOM.md)
- [组装指南](ASSEMBLY.md)
- [固件说明](esp32-firmware/README.md)
- [电路连接图](esp32-firmware/wiring_diagram.md)

### 外部资源

- [ESP32 官方文档](https://docs.espressif.com/projects/esp-idf/zh_CN/latest/esp32/)
- [Arduino ESP32](https://github.com/espressif/arduino-esp32)
- [PlatformIO ESP32](https://docs.platformio.org/en/latest/platforms/espressif32.html)

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2024-01 | 初始版本 |

## 许可证

MIT License
