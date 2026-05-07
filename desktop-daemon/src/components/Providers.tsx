"use client";

import { ReactFlowProvider } from "reactflow";
import { TranslationProvider } from "@/hooks/useTranslation";
import "reactflow/dist/style.css";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TranslationProvider>
      <ReactFlowProvider>{children}</ReactFlowProvider>
    </TranslationProvider>
  );
}
