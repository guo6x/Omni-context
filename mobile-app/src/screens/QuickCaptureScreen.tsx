import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QuickCapture } from '@/components/QuickCapture';
import { colors } from '@/utils/theme';

export function QuickCaptureScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <QuickCapture />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
