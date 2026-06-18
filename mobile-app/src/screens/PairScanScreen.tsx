import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { useNavigation } from '@react-navigation/native';
import { useSettings } from '@/hooks/useSettings';
import { useHUD } from '@/components/HUD';
import { api } from '@/services/api';
import { useSync } from '@/hooks/useSync';
import Svg, { Path } from 'react-native-svg';
import * as Linking from 'expo-linking';

export function PairScanScreen() {
  const navigation = useNavigation<any>();
  const { showMessage } = useHUD();
  const { setServerUrl, setAuthToken, setSyncEnabled } = useSettings();
  const { fullSync } = useSync();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = async ({ data }: { type: string; data: string }) => {
    if (scanned) return;

    const parsed = Linking.parse(data);
    const host = typeof parsed.queryParams?.host === 'string' ? parsed.queryParams.host.trim() : '';
    const port = typeof parsed.queryParams?.port === 'string' ? parsed.queryParams.port.trim() : '';
    const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code.trim() : '';
    const validPort = Number(port) >= 1 && Number(port) <= 65535;

    if (parsed.scheme !== 'omni' || parsed.hostname !== 'pair' || !host || !validPort || !code) {
      showMessage('无效的配对二维码', 'warning');
      return;
    }

    setScanned(true);
    const baseUrl = `http://${host}:${port}`;

    try {
      // 临时配置 api client 进行连通性校验
      api.configure({ baseUrl, authToken: code });
      showMessage('正在测试连接...', 'info');

      const isConnected = await api.healthCheck();
      if (!isConnected) {
        setScanned(false);
        if (host.startsWith('198.18.') || host.startsWith('198.19.')) {
          showMessage('连通失败。扫码IP为代理虚拟网卡，请在电脑端关闭TUN/代理模式，或在设置中手动配置物理IP', 'error');
        } else {
          showMessage('连通性测试失败，请确认局域网与防火墙设置', 'error');
        }
        return;
      }

      // 连接成功，保存配置到设置中
      setServerUrl(baseUrl);
      setAuthToken(code);
      setSyncEnabled(true);
      showMessage('配对成功', 'success');

      // 触发一次同步
      fullSync().catch((err) => {
        console.warn('[PairScan] 自动同步失败:', err);
      });

      navigation.goBack();
    } catch (err) {
      setScanned(false);
      showMessage(`配对连接异常: ${(err as Error).message}`, 'error');
    }
  };

  if (hasPermission === null) {
    return (
      <View className="flex-1 bg-[#0a0b12] justify-center items-center">
        <Text className="text-gray-400 text-base">正在请求相机权限...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View className="flex-1 bg-[#0a0b12] justify-center items-center p-5">
        <Text className="text-gray-200 text-lg font-bold mb-2">无法访问相机</Text>
        <Text className="text-gray-400 text-center mb-6">扫码配对需要相机权限，请在系统设置中允许 Omni-Context 访问您的相机。</Text>
        <TouchableOpacity 
          className="bg-cyan-400 px-6 py-3 rounded-xl"
          onPress={async () => {
            const { status } = await BarCodeScanner.requestPermissionsAsync();
            setHasPermission(status === 'granted');
          }}
        >
          <Text className="text-[#0a0b12] text-base font-bold">授予权限</Text>
        </TouchableOpacity>
      </View>
    );
  }

    const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
    const SCAN_BOX_SIZE = 280;
    const topHeight = (screenHeight - SCAN_BOX_SIZE) / 2;
    const leftWidth = (screenWidth - SCAN_BOX_SIZE) / 2;

    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <BarCodeScanner
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
          style={{ position: 'absolute', width: screenWidth, height: screenHeight }}
        />
        
        {/* 遮罩层 - 上 */}
        <View style={[styles.mask, { top: 0, left: 0, right: 0, height: topHeight, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 30 }]}>
          <Text style={styles.promptText}>请对准桌面端配对二维码</Text>
        </View>

        {/* 遮罩层 - 下 */}
        <View style={[styles.mask, { top: topHeight + SCAN_BOX_SIZE, bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 30 }]}>
          <Text style={styles.infoText}>
            注意：您的手机与运行 Omni-Context 的电脑必须处于同一局域网（Wifi）下。
          </Text>
        </View>

        {/* 遮罩层 - 左 */}
        <View style={[styles.mask, { top: topHeight, left: 0, width: leftWidth, height: SCAN_BOX_SIZE }]} />

        {/* 遮罩层 - 右 */}
        <View style={[styles.mask, { top: topHeight, left: leftWidth + SCAN_BOX_SIZE, right: 0, height: SCAN_BOX_SIZE }]} />

        {/* 扫描框层 */}
        <View style={[styles.scanBox, { top: topHeight, left: leftWidth }]}>
          {/* 四个发光角 */}
          <View style={[styles.corner, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 }]} />
          <View style={[styles.corner, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 }]} />
          <View style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 }]} />
          <View style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 }]} />
        </View>

        {/* 悬浮后退按钮 */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <Path d="M15 19L8 12L15 5" stroke="#e8e8e8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>
      </View>
    );
  }

  const styles = StyleSheet.create({
    mask: {
      position: 'absolute',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
    },
    promptText: {
      color: '#e8e8e8',
      fontSize: 16,
      fontWeight: '600',
    },
    infoText: {
      color: '#9ca3af',
      fontSize: 12,
      textAlign: 'center',
      paddingHorizontal: 32,
      lineHeight: 20,
    },
    scanBox: {
      position: 'absolute',
      width: 280,
      height: 280,
      borderWidth: 1,
      borderColor: 'rgba(34, 211, 238, 0.2)',
    },
    corner: {
      position: 'absolute',
      width: 20,
      height: 20,
      borderColor: '#22d3ee', // cyan-400
    },
    backButton: {
      position: 'absolute',
      top: 50,
      left: 20,
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.1)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
