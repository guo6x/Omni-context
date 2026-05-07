import React, { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import { HUDMessage } from '@/types';

interface HUDContextType {
  messages: HUDMessage[];
  showMessage: (message: string, type?: HUDMessage['type']) => void;
  dismissMessage: (id: string) => void;
}

const HUDContext = createContext<HUDContextType | null>(null);

export function HUDProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<HUDMessage[]>([]);

  const showMessage = useCallback((message: string, type: HUDMessage['type'] = 'info') => {
    const id = Date.now().toString();
    const newMessage: HUDMessage = {
      id,
      message,
      type,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMessage]);

    setTimeout(() => {
      dismissMessage(id);
    }, 3000);
  }, []);

  const dismissMessage = useCallback((id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  return (
    <HUDContext.Provider value={{ messages, showMessage, dismissMessage }}>
      {children}
      <HUD messages={messages} onDismiss={dismissMessage} />
    </HUDContext.Provider>
  );
}

export function useHUD() {
  const context = useContext(HUDContext);
  if (!context) {
    throw new Error('useHUD must be used within HUDProvider');
  }
  return context;
}

import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { colors } from '@/utils/theme';

interface HUDProps {
  messages: HUDMessage[];
  onDismiss: (id: string) => void;
}

function HUD({ messages, onDismiss }: HUDProps) {
  if (messages.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {messages.map(msg => (
        <TouchableOpacity
          key={msg.id}
          style={[styles.message, styles[msg.type]]}
          onPress={() => onDismiss(msg.id)}
          activeOpacity={0.8}
        >
          <Text style={styles.messageText}>{msg.message}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  message: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 8,
    maxWidth: '90%',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  info: {
    backgroundColor: colors.backgroundTertiary,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  success: {
    backgroundColor: 'rgba(0, 255, 136, 0.2)',
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
  },
  warning: {
    backgroundColor: 'rgba(255, 170, 0, 0.2)',
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  error: {
    backgroundColor: 'rgba(255, 68, 68, 0.2)',
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  messageText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
});
