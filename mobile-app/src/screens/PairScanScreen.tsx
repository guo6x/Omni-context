import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { useNavigation } from '@react-navigation/native';
import { useSettings } from '@/hooks/useSettings';
import { useHUD } from '@/components/HUD';
import { api } from '@/services/api';
import { useSync } from '@/hooks/useSync';
import Svg, { Path } from 'react-native-svg';

export function PairScanScreen() {
  const navigation = useNavigation<any>();
  const { showMessage } = useHUD();
  const { setServerUrl, setAuthToken } = useSettings();
  const { fullSync } = useSync();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;

    // 配对二维码：omni://pair?host=<lan_ip>&port=<port>&code=<配对码>
    const match = data.match(/^omni:\/\/pair\?host=([^&]+)&port=([^&]+)&code=(.+)$/);
    if (!match) {
      showMessage('无效的配对二维码', 'warning');
      return;
    }

    setScanned(true);
    const host = match[1];
    const port = match[2];
    const code = match[3];
    const baseUrl = `http://${host}:${port}`;

    try {
      setServerUrl(baseUrl);
      setAuthToken(code);
      api.configure({ baseUrl, authToken: code });
      showMessage('配对成功', 'success');

      // 触发一次同步
      fullSync().catch((err) => {
        console.warn('[PairScan] 自动同步失败:', err);
      });

      navigation.goBack();
    } catch (err) {
      setScanned(false);
      showMessage('配对失败，请重试', 'error');
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

  return (
    <View className="flex-1 bg-black">
      <BarCodeScanner
        onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
      />
      
      {/* 遮罩覆盖层，做出中间镂空发光的效果 */}
      <View className="absolute inset-0 justify-between">
        {/* 上半部半透明遮罩 */}
        <View className="bg-black/60 flex-1 justify-center items-center pt-20">
          <Text className="text-gray-300 text-base font-medium">请对准桌面端配对二维码</Text>
        </View>

        {/* 中间行：左遮罩 + 镂空扫描框 + 右遮罩 */}
        <View className="flex-row h-72">
          <View className="bg-black/60 flex-1" />
          <View className="w-72 border-2 border-cyan-400/30 relative justify-center items-center">
            {/* 四个发光角 */}
            <View className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-cyan-400" />
            <View className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-cyan-400" />
            <View className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-cyan-400" />
            <View className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-cyan-400" />
          </View>
          <View className="bg-black/60 flex-1" />
        </View>

        {/* 下半部半透明遮罩 */}
        <View className="bg-black/60 flex-1 items-center justify-between pb-16 pt-5">
          <Text className="text-gray-400 text-xs text-center px-8 leading-5">
            注意：您的手机与运行 Omni-Context 的电脑必须处于同一局域网（Wifi）下。
          </Text>
        </View>
      </View>

      {/* 悬浮后退按钮 */}
      <TouchableOpacity
        className="absolute top-12 left-5 w-12 h-12 rounded-full bg-black/50 border border-white/10 items-center justify-center"
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
