"use client";

import { ReactFlowProvider } from "reactflow";
import { TranslationProvider } from "@/hooks/useTranslation";
import { ToastProvider } from "@/components/Toast";
import "reactflow/dist/style.css";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TranslationProvider>
      <ToastProvider>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </ToastProvider>
    </TranslationProvider>
  );
}
