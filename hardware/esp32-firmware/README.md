# Omni-Context ESP32 神经末梢固件

ESP32 微控制器作为 Omni-Context 系统的物理神经末梢，通过 WiFi UDP 协议发送按键事件到桌面守护进程。

## 功能特性

- **三键触发**: 沉淀键、决策键、重置键
- **WiFi 连接**: 自动连接、断线重连
- **UDP 通信**: 低延迟事件传输
- **OTA 更新**: 无线固件更新支持
- **状态指示**: LED 状态灯显示连接状态
- **按键防抖**: 50ms 防抖延迟
- **心跳保活**: 30秒心跳检测
- **串口配置**: 通过串口命令配置参数
- **EEPROM 存储**: 配置持久化保存

## 硬件要求

| 组件 | 规格 | 数量 |
|------|------|------|
| ESP32 开发板 | DevKit V1 或兼容 | 1 |
| 按键开关 | 12mm 触感开关 | 3 |
| 面包板 | 830点 | 1 |
| 跳线 | 公对公/公对母 | 若干 |
| USB 数据线 | Micro USB | 1 |
| 可选: 外壳 | 3D 打印 | 1 |

## 引脚定义

| 功能 | GPIO | 说明 |
|------|------|------|
| 沉淀键 | 14 | 内部上拉，低电平触发 |
| 决策键 | 27 | 内部上拉，低电平触发 |
| 重置键 | 26 | 内部上拉，低电平触发 |
| 状态 LED | 2 | 板载 LED，高电平亮 |

## 快速开始

### 方法一: PlatformIO (推荐)

1. **安装 PlatformIO**
   ```bash
   # VS Code 扩展
   # 搜索并安装 "PlatformIO IDE"
   
   # 或命令行安装
   pip install platformio
   ```

2. **克隆项目**
   ```bash
   cd hardware/esp32-firmware
   ```

3. **编译固件**
   ```bash
   pio run
   ```

4. **上传固件**
   ```bash
   pio run --target upload
   ```

5. **串口监控**
   ```bash
   pio device monitor
   ```

### 方法二: Arduino IDE

1. **安装 Arduino IDE**
   - 下载: https://www.arduino.cc/en/software

2. **添加 ESP32 开发板支持**
   - 打开 Arduino IDE
   - 文件 → 首选项
   - 附加开发板管理器网址添加:
     ```
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - 工具 → 开发板 → 开发板管理器
   - 搜索 "esp32" 并安装

3. **选择开发板**
   - 工具 → 开发板 → ESP32 Arduino → ESP32 Dev Module

4. **打开固件**
   - 文件 → 打开
   - 选择 `src/main.ino`

5. **上传**
   - 选择正确的端口 (工具 → 端口)
   - 点击上传按钮

## 配置

### 首次配置 (串口命令)

连接串口监视器 (115200 波特率)，输入以下命令:

```
ssid YourWiFiName        # 设置 WiFi 名称
pass YourWiFiPassword    # 设置 WiFi 密码
host 192.168.1.100       # 设置桌面守护进程 IP
save                     # 保存配置
connect                  # 连接 WiFi
```

### 串口命令列表

| 命令 | 说明 |
|------|------|
| `ssid <名称>` | 设置 WiFi SSID |
| `pass <密码>` | 设置 WiFi 密码 |
| `host <IP>` | 设置 UDP 主机地址 |
| `save` | 保存配置到 EEPROM |
| `connect` | 连接 WiFi |
| `config` | 显示当前配置 |
| `status` | 显示系统状态 |
| `test` | 发送测试消息 |
| `restart` | 重启设备 |
| `clear` | 清除所有配置 |
| `help` | 显示帮助信息 |

## LED 状态指示

| 状态 | LED 表现 |
|------|----------|
| 启动中 | 熄灭 |
| WiFi 连接中 | 快速闪烁 (250ms) |
| WiFi 已连接 | 常亮 |
| WiFi 断开 | 熄灭 |
| 按键触发 | 闪烁 (次数对应按键) |
| OTA 更新中 | 快速闪烁 |

## UDP 消息格式

按键事件发送 JSON 格式消息:

```json
{
  "action": "precipitate",
  "timestamp": 12345678,
  "device": "esp32"
}
```

### 支持的动作

| 动作 | 说明 |
|------|------|
| `precipitate` | 沉淀键触发 |
| `decision` | 决策键触发 |
| `reset` | 重置键触发 |
| `device_online` | 设备上线 |
| `device_reconnected` | 设备重连 |
| `heartbeat` | 心跳保活 |

## OTA 无线更新

### 配置 OTA

1. 确保设备已连接 WiFi
2. 获取设备 IP 地址 (通过串口 `status` 命令)

### 使用 PlatformIO OTA 上传

编辑 `platformio.ini`:

```ini
[env:esp32dev]
upload_protocol = espota
upload_port = 192.168.1.xxx  ; ESP32 的 IP
upload_flags = 
    --port=3232
    --auth=omni2024
```

然后执行:
```bash
pio run --target upload
```

### 使用 Arduino IDE OTA 上传

1. 工具 → 端口 → 网络端口
2. 选择 `omni-context-esp32 at 192.168.1.xxx`
3. 点击上传

### OTA 认证

- 主机名: `omni-context-esp32`
- 密码: `omni2024`
- 端口: `3232`

## 故障排除

### WiFi 连接失败

1. 检查 SSID 和密码是否正确
2. 确认 WiFi 为 2.4GHz (ESP32 不支持 5GHz)
3. 检查路由器是否允许新设备连接
4. 尝试重启路由器和 ESP32

### 按键无响应

1. 检查按键接线是否正确
2. 确认按键连接到 GND 和对应 GPIO
3. 检查串口输出是否有按键事件

### UDP 消息未收到

1. 确认桌面守护进程正在运行
2. 检查 IP 地址是否正确
3. 确认防火墙允许 UDP 9090 端口
4. 使用 `test` 命令发送测试消息

### OTA 更新失败

1. 确认设备 WiFi 连接正常
2. 检查电脑和设备在同一网络
3. 确认 OTA 密码正确
4. 尝试重启设备后再次 OTA

## 开发指南

### 项目结构

```
esp32-firmware/
├── src/
│   └── main.ino      # 主固件代码
├── platformio.ini    # PlatformIO 配置
└── README.md         # 本文件
```

### 修改按键引脚

在 `main.ino` 中修改 `buttons` 数组:

```cpp
ButtonConfig buttons[] = {
  {14, "沉淀键", "precipitate", 3, 100},  // GPIO, 名称, 动作, LED次数, LED延迟
  {27, "决策键", "decision", 2, 100},
  {26, "重置键", "reset", 1, 300}
};
```

### 修改 UDP 端口

修改 `DEFAULT_UDP_PORT` 常量:

```cpp
const uint16_t DEFAULT_UDP_PORT = 9090;
```

### 修改心跳间隔

修改 `HEARTBEAT_INTERVAL` 常量 (毫秒):

```cpp
const unsigned long HEARTBEAT_INTERVAL = 30000;  // 30秒
```

## 相关文档

- [电路连接图](wiring_diagram.md)
- [物料清单](../BOM.md)
- [组装指南](../ASSEMBLY.md)
- [硬件总体说明](../README.md)

## 许可证

MIT License
