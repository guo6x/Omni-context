import type { Metadata } from "next";
import "../styles/globals.css";
import { Providers } from "@/components/Providers";
import "reactflow/dist/style.css";

export const metadata: Metadata = {
  title: "Omni-Context - 全域物理级 AI 记忆操作系统",
  description: "OS 级别的常驻 AI 记忆中枢",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
