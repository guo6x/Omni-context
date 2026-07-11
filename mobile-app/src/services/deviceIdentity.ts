import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_STORAGE_KEY = 'omni-context-device-id';

function generateDeviceId(): string {
  const randomPart = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x1_0000).toString(16).padStart(4, '0')).join('');
  return `mobile-${Date.now().toString(36)}-${randomPart}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = (await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY))?.trim();
  if (existing) return existing;

  const deviceId = generateDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}
