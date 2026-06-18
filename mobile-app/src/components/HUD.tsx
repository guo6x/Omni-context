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

import { View, Text, TouchableOpacity } from 'react-native';

interface HUDProps {
  messages: HUDMessage[];
  onDismiss: (id: string) => void;
}

export function HUD({ messages, onDismiss }: HUDProps) {
  if (messages.length === 0) return null;

  const getTypeStyles = (type: HUDMessage['type']) => {
    switch (type) {
      case 'info':
        return 'bg-black/80 border-l-4 border-cyan-400';
      case 'success':
        return 'bg-[#00ff88]/20 border-l-4 border-[#00ff88]';
      case 'warning':
        return 'bg-[#ffaa00]/20 border-l-4 border-[#ffaa00]';
      case 'error':
        return 'bg-red-500/20 border-l-4 border-red-500';
      default:
        return 'bg-black/80 border-l-4 border-cyan-400';
    }
  };

  return (
    <View className="absolute top-12 left-0 right-0 items-center z-50" pointerEvents="box-none">
      {messages.map(msg => (
        <TouchableOpacity
          key={msg.id}
          className={`px-4 py-3 rounded-lg mb-2 max-w-[90%] shadow-[0_0_15px_rgba(34,211,238,0.5)] ${getTypeStyles(msg.type)}`}
          onPress={() => onDismiss(msg.id)}
          activeOpacity={0.8}
        >
          <Text className="text-[#e8e8e8] text-sm font-medium">{msg.message}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
