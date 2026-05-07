import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QuickCapture } from '@/components/QuickCapture';

export function QuickCaptureScreen() {
  return (
    <SafeAreaView className="flex-1 bg-[#0a0b12]" edges={['top']}>
      <QuickCapture />
    </SafeAreaView>
  );
}
