"use client";

import { Clock3, Library, MessageCircle, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

export type WorkspaceSection = "ask" | "journey" | "library" | "advanced";

interface WorkspaceNavigationProps {
  activeSection: WorkspaceSection;
  onNavigate: (section: WorkspaceSection) => void;
}

const sections: Array<{ id: WorkspaceSection; icon: typeof MessageCircle }> = [
  { id: "ask", icon: MessageCircle },
  { id: "journey", icon: Clock3 },
  { id: "library", icon: Library },
  { id: "advanced", icon: ShieldCheck },
];

export default function WorkspaceNavigation({ activeSection, onNavigate }: WorkspaceNavigationProps) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("nav.workspace")} data-testid="workspace-navigation" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-[#0b0d12] px-4 py-2 sm:px-6">
      {sections.map(({ id, icon: Icon }) => {
        const active = activeSection === id;
        return (
          <button
            key={id}
            type="button"
            data-testid={"workspace-nav-" + id}
            aria-current={active ? "page" : undefined}
            title={id === "advanced" ? t("nav.advanced_hint") : undefined}
            onClick={() => onNavigate(id)}
            className={"flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 " + (active ? "border-cyan-400/25 bg-cyan-400/[0.08] text-cyan-200" : "border-transparent text-gray-400 hover:border-white/10 hover:bg-white/[0.035] hover:text-gray-100")}
          >
            <Icon aria-hidden="true" className={"h-4 w-4 " + (active ? "text-cyan-300" : "text-gray-500")} />
            <span>{t("nav." + id)}</span>
            {id === "advanced" && <span className="sr-only">{t("nav.advanced_hint")}</span>}
          </button>
        );
      })}
      <p className="ml-auto hidden min-w-0 truncate pr-1 text-xs text-gray-500 lg:block">{t("nav.ask_context_hint")}</p>
    </nav>
  );
}
