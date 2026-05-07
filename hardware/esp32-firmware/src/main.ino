/*
 * Omni-Context ESP32 神经末梢固件
 * 
 * 功能:
 * - 监听3个物理按键 (沉淀/决策/重置)
 * - 通过UDP发送按键事件到桌面守护进程
 * - WiFi连接状态指示
 * - 按键防抖处理
 * - OTA无线更新支持
 * - 自动重连机制
 * - 心跳保活
 * 
 * 硬件: ESP32 DevKit V1 或兼容开发板
 * 
 * 作者: Omni-Context Team
 * 版本: 1.0.0
 */

#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoOTA.h>
#include <EEPROM.h>

#define FIRMWARE_VERSION "1.0.0"

#define EEPROM_SIZE 512
#define EEPROM_SSID_ADDR 0
#define EEPROM_PASS_ADDR 64
#define EEPROM_HOST_ADDR 128
#define EEPROM_MAGIC_ADDR 192

#define MAX_SSID_LEN 32
#define MAX_PASS_LEN 32
#define MAX_HOST_LEN 32

struct ButtonConfig {
  uint8_t pin;
  const char* name;
  const char* action;
  int ledFlashes;
  int ledDelay;
};

struct ButtonState {
  bool lastState;
  bool currentState;
  unsigned long lastDebounceTime;
  bool pressed;
};

struct Config {
  char ssid[MAX_SSID_LEN + 1];
  char password[MAX_PASS_LEN + 1];
  char udpHost[MAX_HOST_LEN + 1];
  uint16_t udpPort;
};

ButtonConfig buttons[] = {
  {14, "沉淀键", "precipitate", 3, 100},
  {27, "决策键", "decision", 2, 100},
  {26, "重置键", "reset", 1, 300}
};

const int BUTTON_COUNT = sizeof(buttons) / sizeof(buttons[0]);
const int LED_PIN = 2;

const uint16_t DEFAULT_UDP_PORT = 9090;
const unsigned long DEBOUNCE_DELAY = 50;
const unsigned long HEARTBEAT_INTERVAL = 30000;
const unsigned long RECONNECT_INTERVAL = 5000;
const unsigned long WIFI_TIMEOUT = 30000;

ButtonState buttonStates[BUTTON_COUNT];
Config config;
WiFiUDP udp;
unsigned long lastHeartbeat = 0;
unsigned long lastReconnectAttempt = 0;
bool wifiConnected = false;
bool otaEnabled = false;

enum WiFiStatus {
  WIFI_DISCONNECTED,
  WIFI_CONNECTING,
  WIFI_CONNECTED,
  WIFI_RECONNECTING
};

WiFiStatus wifiStatus = WIFI_DISCONNECTED;

void loadConfig();
void saveConfig();
void printConfig();
void initButtons();
void initWiFi();
void initOTA();
void handleWiFi();
void handleButtons();
void handleHeartbeat();
void handleOTA();
void sendUDP(const char* message);
void sendUDPWithTimestamp(const char* action);
void flashLED(int times, int delayMs);
void setLEDState(bool on);
void blinkLED(int pattern);
void printBanner();
void enterConfigMode();

void setup() {
  Serial.begin(115200);
  delay(500);
  
  printBanner();
  
  EEPROM.begin(EEPROM_SIZE);
  loadConfig();
  printConfig();
  
  initButtons();
  
  pinMode(LED_PIN, OUTPUT);
  setLEDState(false);
  
  if (strlen(config.ssid) > 0 && strlen(config.password) > 0) {
    initWiFi();
  } else {
    Serial.println("未配置WiFi，请通过串口配置");
    enterConfigMode();
  }
  
  Serial.println("系统初始化完成");
  Serial.println("=====================================");
}

void loop() {
  handleWiFi();
  
  if (wifiConnected) {
    handleOTA();
    handleButtons();
    handleHeartbeat();
  }
  
  handleSerialInput();
}

void printBanner() {
  Serial.println();
  Serial.println("=====================================");
  Serial.println("   Omni-Context ESP32 神经末梢");
  Serial.println("   Firmware Version: " FIRMWARE_VERSION);
  Serial.println("=====================================");
}

void loadConfig() {
  uint32_t magic;
  EEPROM.get(EEPROM_MAGIC_ADDR, magic);
  
  if (magic != 0xDEADBEEF) {
    Serial.println("首次运行，使用默认配置");
    strcpy(config.ssid, "");
    strcpy(config.password, "");
    strcpy(config.udpHost, "192.168.1.100");
    config.udpPort = DEFAULT_UDP_PORT;
    saveConfig();
    return;
  }
  
  EEPROM.readString(EEPROM_SSID_ADDR, config.ssid, MAX_SSID_LEN + 1);
  EEPROM.readString(EEPROM_PASS_ADDR, config.password, MAX_PASS_LEN + 1);
  EEPROM.readString(EEPROM_HOST_ADDR, config.udpHost, MAX_HOST_LEN + 1);
  config.udpPort = DEFAULT_UDP_PORT;
  
  Serial.println("配置已从EEPROM加载");
}

void saveConfig() {
  EEPROM.writeString(EEPROM_SSID_ADDR, config.ssid);
  EEPROM.writeString(EEPROM_PASS_ADDR, config.password);
  EEPROM.writeString(EEPROM_HOST_ADDR, config.udpHost);
  
  uint32_t magic = 0xDEADBEEF;
  EEPROM.put(EEPROM_MAGIC_ADDR, magic);
  
  EEPROM.commit();
  Serial.println("配置已保存到EEPROM");
}

void printConfig() {
  Serial.println("当前配置:");
  Serial.print("  SSID: ");
  Serial.println(strlen(config.ssid) > 0 ? config.ssid : "(未设置)");
  Serial.print("  密码: ");
  Serial.println(strlen(config.password) > 0 ? "********" : "(未设置)");
  Serial.print("  UDP主机: ");
  Serial.println(config.udpHost);
  Serial.print("  UDP端口: ");
  Serial.println(config.udpPort);
}

void initButtons() {
  for (int i = 0; i < BUTTON_COUNT; i++) {
    pinMode(buttons[i].pin, INPUT_PULLUP);
    buttonStates[i].lastState = HIGH;
    buttonStates[i].currentState = HIGH;
    buttonStates[i].lastDebounceTime = 0;
    buttonStates[i].pressed = false;
  }
  Serial.println("按键初始化完成");
}

void initWiFi() {
  Serial.println();
  Serial.print("连接WiFi: ");
  Serial.println(config.ssid);
  
  wifiStatus = WIFI_CONNECTING;
  WiFi.mode(WIFI_STA);
  WiFi.begin(config.ssid, config.password);
  
  unsigned long startTime = millis();
  
  while (WiFi.status() != WL_CONNECTED) {
    setLEDState((millis() / 250) % 2 == 0);
    delay(100);
    Serial.print(".");
    
    if (millis() - startTime > WIFI_TIMEOUT) {
      Serial.println();
      Serial.println("WiFi连接超时");
      wifiStatus = WIFI_DISCONNECTED;
      return;
    }
  }
  
  Serial.println();
  Serial.println("WiFi已连接");
  Serial.print("IP地址: ");
  Serial.println(WiFi.localIP());
  Serial.print("MAC地址: ");
  Serial.println(WiFi.macAddress());
  
  wifiConnected = true;
  wifiStatus = WIFI_CONNECTED;
  setLEDState(true);
  
  udp.begin(config.udpPort);
  Serial.print("UDP服务已启动，端口: ");
  Serial.println(config.udpPort);
  
  initOTA();
  
  sendUDP("device_online");
}

void initOTA() {
  ArduinoOTA.setHostname("omni-context-esp32");
  ArduinoOTA.setPassword("omni2024");
  
  ArduinoOTA.onStart([]() {
    Serial.println("OTA更新开始...");
    setLEDState(false);
  });
  
  ArduinoOTA.onEnd([]() {
    Serial.println("\nOTA更新完成");
    setLEDState(true);
  });
  
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("进度: %u%%\r", (progress / (total / 100)));
    int ledState = (progress / (total / 20)) % 2;
    setLEDState(ledState == 0);
  });
  
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA错误[%u]: ", error);
    if (error == OTA_AUTH_ERROR) Serial.println("认证失败");
    else if (error == OTA_BEGIN_ERROR) Serial.println("开始失败");
    else if (error == OTA_CONNECT_ERROR) Serial.println("连接失败");
    else if (error == OTA_RECEIVE_ERROR) Serial.println("接收失败");
    else if (error == OTA_END_ERROR) Serial.println("结束失败");
    
    flashLED(5, 100);
  });
  
  ArduinoOTA.begin();
  otaEnabled = true;
  Serial.println("OTA服务已启动");
  Serial.println("OTA主机名: omni-context-esp32");
  Serial.println("OTA密码: omni2024");
}

void handleWiFi() {
  static unsigned long lastCheck = 0;
  unsigned long now = millis();
  
  if (now - lastCheck < 1000) return;
  lastCheck = now;
  
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnected) {
      Serial.println("WiFi连接丢失");
      wifiConnected = false;
      wifiStatus = WIFI_RECONNECTING;
      setLEDState(false);
    }
    
    if (now - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = now;
      Serial.println("尝试重新连接WiFi...");
      WiFi.reconnect();
    }
  } else {
    if (!wifiConnected) {
      Serial.println("WiFi重新连接成功");
      wifiConnected = true;
      wifiStatus = WIFI_CONNECTED;
      setLEDState(true);
      sendUDP("device_reconnected");
    }
  }
}

void handleButtons() {
  unsigned long currentTime = millis();
  
  for (int i = 0; i < BUTTON_COUNT; i++) {
    bool reading = digitalRead(buttons[i].pin);
    
    if (reading != buttonStates[i].lastState) {
      buttonStates[i].lastDebounceTime = currentTime;
    }
    
    if ((currentTime - buttonStates[i].lastDebounceTime) > DEBOUNCE_DELAY) {
      if (reading != buttonStates[i].currentState) {
        buttonStates[i].currentState = reading;
        
        if (buttonStates[i].currentState == LOW) {
          buttonStates[i].pressed = true;
          Serial.print("按键按下: ");
          Serial.println(buttons[i].name);
        } else {
          if (buttonStates[i].pressed) {
            buttonStates[i].pressed = false;
            
            Serial.print("按键释放: ");
            Serial.print(buttons[i].name);
            Serial.print(" -> 发送: ");
            Serial.println(buttons[i].action);
            
            sendUDPWithTimestamp(buttons[i].action);
            flashLED(buttons[i].ledFlashes, buttons[i].ledDelay);
          }
        }
      }
    }
    
    buttonStates[i].lastState = reading;
  }
}

void handleHeartbeat() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastHeartbeat > HEARTBEAT_INTERVAL) {
    lastHeartbeat = currentTime;
    sendUDP("heartbeat");
    Serial.println("心跳发送");
  }
}

void handleOTA() {
  if (otaEnabled) {
    ArduinoOTA.handle();
  }
}

void sendUDP(const char* message) {
  if (!wifiConnected) return;
  
  udp.beginPacket(config.udpHost, config.udpPort);
  udp.write((const uint8_t*)message, strlen(message));
  udp.endPacket();
}

void sendUDPWithTimestamp(const char* action) {
  if (!wifiConnected) return;
  
  char buffer[128];
  unsigned long timestamp = millis();
  
  snprintf(buffer, sizeof(buffer), "{\"action\":\"%s\",\"timestamp\":%lu,\"device\":\"esp32\"}", 
           action, timestamp);
  
  udp.beginPacket(config.udpHost, config.udpPort);
  udp.write((const uint8_t*)buffer, strlen(buffer));
  udp.endPacket();
  
  Serial.print("UDP发送: ");
  Serial.println(buffer);
}

void flashLED(int times, int delayMs) {
  bool originalState = digitalRead(LED_PIN);
  
  for (int i = 0; i < times; i++) {
    setLEDState(false);
    delay(delayMs);
    setLEDState(true);
    if (i < times - 1) {
      delay(delayMs);
    }
  }
  
  setLEDState(originalState);
}

void setLEDState(bool on) {
  digitalWrite(LED_PIN, on ? HIGH : LOW);
}

void handleSerialInput() {
  static String inputBuffer = "";
  
  while (Serial.available()) {
    char c = Serial.read();
    
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        processSerialCommand(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
    }
  }
}

void processSerialCommand(String command) {
  command.trim();
  command.toLowerCase();
  
  Serial.print("收到命令: ");
  Serial.println(command);
  
  if (command.startsWith("ssid ")) {
    String ssid = command.substring(5);
    ssid.trim();
    ssid.toCharArray(config.ssid, MAX_SSID_LEN + 1);
    Serial.print("SSID已设置: ");
    Serial.println(config.ssid);
  }
  else if (command.startsWith("pass ")) {
    String pass = command.substring(5);
    pass.trim();
    pass.toCharArray(config.password, MAX_PASS_LEN + 1);
    Serial.println("密码已设置");
  }
  else if (command.startsWith("host ")) {
    String host = command.substring(5);
    host.trim();
    host.toCharArray(config.udpHost, MAX_HOST_LEN + 1);
    Serial.print("UDP主机已设置: ");
    Serial.println(config.udpHost);
  }
  else if (command == "save") {
    saveConfig();
    Serial.println("配置已保存，重启后生效");
  }
  else if (command == "connect") {
    if (strlen(config.ssid) > 0 && strlen(config.password) > 0) {
      initWiFi();
    } else {
      Serial.println("请先设置SSID和密码");
    }
  }
  else if (command == "config") {
    printConfig();
  }
  else if (command == "status") {
    printStatus();
  }
  else if (command == "restart" || command == "reboot") {
    Serial.println("重启中...");
    ESP.restart();
  }
  else if (command == "help") {
    printHelp();
  }
  else if (command == "test") {
    sendUDPWithTimestamp("test");
    flashLED(3, 100);
    Serial.println("测试消息已发送");
  }
  else if (command == "clear") {
    strcpy(config.ssid, "");
    strcpy(config.password, "");
    strcpy(config.udpHost, "192.168.1.100");
    saveConfig();
    Serial.println("配置已清除");
  }
  else {
    Serial.println("未知命令，输入 'help' 查看帮助");
  }
}

void printStatus() {
  Serial.println("系统状态:");
  Serial.print("  WiFi状态: ");
  switch (wifiStatus) {
    case WIFI_DISCONNECTED: Serial.println("未连接"); break;
    case WIFI_CONNECTING: Serial.println("连接中"); break;
    case WIFI_CONNECTED: Serial.println("已连接"); break;
    case WIFI_RECONNECTING: Serial.println("重连中"); break;
  }
  
  if (wifiConnected) {
    Serial.print("  IP地址: ");
    Serial.println(WiFi.localIP());
    Serial.print("  信号强度: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  }
  
  Serial.print("  运行时间: ");
  Serial.print(millis() / 1000);
  Serial.println(" 秒");
  
  Serial.print("  固件版本: ");
  Serial.println(FIRMWARE_VERSION);
  
  Serial.print("  OTA状态: ");
  Serial.println(otaEnabled ? "已启用" : "未启用");
}

void printHelp() {
  Serial.println("可用命令:");
  Serial.println("  ssid <名称>    - 设置WiFi SSID");
  Serial.println("  pass <密码>    - 设置WiFi密码");
  Serial.println("  host <IP>      - 设置UDP主机地址");
  Serial.println("  save           - 保存配置");
  Serial.println("  connect        - 连接WiFi");
  Serial.println("  config         - 显示当前配置");
  Serial.println("  status         - 显示系统状态");
  Serial.println("  test           - 发送测试消息");
  Serial.println("  restart        - 重启设备");
  Serial.println("  clear          - 清除配置");
  Serial.println("  help           - 显示此帮助");
}

void enterConfigMode() {
  Serial.println();
  Serial.println("进入配置模式");
  Serial.println("请通过串口命令配置WiFi:");
  Serial.println("  ssid <你的WiFi名称>");
  Serial.println("  pass <你的WiFi密码>");
  Serial.println("  host <桌面守护进程IP>");
  Serial.println("  save   (保存配置)");
  Serial.println("  connect (连接WiFi)");
  Serial.println();
}
