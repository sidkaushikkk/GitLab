import React from "react";
import { Sparkles, Bot, Terminal, Database } from "lucide-react";
import { WillBeIntegratedSoon } from "../components/common/WillBeIntegratedSoon";
import { useApp } from "../context/AppContext";

export function AIAssistantPage() {
  const { currentRepo, currentBranch } = useApp();

  return (
    <div className="flex flex-col h-[calc(100dvh-5.5rem)] max-w-5xl mx-auto animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-3 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <Sparkles size={20} className="text-cyan-400" />
            GitLab AI Codebase Assistant
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5 font-sans">
            Conversational engineering intelligence, architecture reasoning, impact analysis, and remediation generation.
          </p>
        </div>

        {currentRepo && (
          <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
            <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 flex items-center gap-1.5 text-zinc-300">
              <Database size={12} className="text-cyan-400" />
              {currentRepo.name}
            </span>
            <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
              {currentBranch}
            </span>
          </div>
        )}
      </div>

      {/* Main Container */}
      <div className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 p-8 sm:p-12 flex flex-col items-center justify-center text-center shadow-2xl">
        <WillBeIntegratedSoon
          title="AI Codebase Assistant will be integrated soon"
          description="LLM provider integration with vector embeddings of repository AST symbols, semantic code search, and automated patch synthesis will be available here."
          icon={Sparkles}
          className="border-none bg-transparent p-0"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mt-8 text-left font-mono text-xs w-full">
          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Bot size={14} />
              <span>Semantic Search</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Vector indexing of AST functions and dependencies for natural language codebase queries.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Sparkles size={14} />
              <span>Fix Generation</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Context-aware automated remediation patches for detected code smells and anti-patterns.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Terminal size={14} />
              <span>Architecture Chat</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Interactive impact exploration and blast radius simulation across architectural layers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
