import React from 'react';
import { useApp } from '../context/AppContext';
import { Sparkles, Bot, Terminal, ShieldCheck, Database, GitBranch } from 'lucide-react';
import { AIChat } from '../components/ai/AIChat';

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

        <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
          <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 flex items-center gap-1.5 text-zinc-300">
            <Database size={12} className="text-cyan-400" />
            {currentRepo.name}
          </span>
          <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
            {currentBranch}
          </span>
        </div>
      </div>

      {/* Main Full-Height Chat Component */}
      <div className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-2xl flex flex-col">
        <AIChat isEmbedded={false} />
      </div>
    </div>
  );
}
