import React from "react";
import { useApp } from "../../context/AppContext";
import { Sparkles, Bot, X } from "lucide-react";
import { WillBeIntegratedSoon } from "../common/WillBeIntegratedSoon";

export function AIChat({ isEmbedded = false }) {
  const { currentRepo } = useApp();

  return (
    <div className="flex flex-col h-full items-center justify-center p-6 text-center bg-zinc-950 font-sans">
      <WillBeIntegratedSoon
        title="GitLab Copilot AI will be integrated soon"
        description="Conversational codebase reasoning, vector semantic indexing, and automated remediation generation are scheduled for integration."
        icon={Sparkles}
        className="max-w-md border-none bg-transparent"
      />

      <div className="mt-4 p-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-left font-mono text-xs max-w-sm w-full space-y-1 text-zinc-400">
        <div className="text-zinc-300 font-semibold flex items-center gap-1.5">
          <Bot size={13} className="text-cyan-400" />
          <span>Integration Roadmap</span>
        </div>
        <p className="text-[11px] text-zinc-500 font-sans leading-relaxed">
          LLM connectivity, AST semantic grounding, and inline patch suggestions will be active once inference backend is enabled.
        </p>
      </div>
    </div>
  );
}

export function AIChatPanel() {
  const { isAiPanelOpen, toggleAiPanel, currentRepo } = useApp();

  if (!isAiPanelOpen) return null;

  return (
    <aside className="fixed top-14 right-0 bottom-0 z-40 w-full sm:w-[380px] md:w-[420px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800 bg-zinc-900/70">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-cyan-950 text-cyan-400 border border-cyan-800">
            <Sparkles size={14} />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-100 font-mono">GitLab Copilot AI</div>
            <div className="text-[10px] text-zinc-400 font-mono truncate">{currentRepo?.name ?? "No repo"}</div>
          </div>
        </div>

        <button
          onClick={toggleAiPanel}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          aria-label="Close panel"
        >
          <X size={15} />
        </button>
      </div>

      {/* Chat Body */}
      <div className="flex-1 overflow-hidden">
        <AIChat isEmbedded={true} />
      </div>
    </aside>
  );
}
