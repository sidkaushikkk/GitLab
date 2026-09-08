import React from "react";
import { Clock, Sparkles, Layers } from "lucide-react";

export function WillBeIntegratedSoon({
  title = "Will be integrated soon",
  description = "This analysis is not available yet.",
  icon: Icon = Clock,
  compact = false,
  className = ""
}) {
  if (compact) {
    return (
      <div className={`flex items-center gap-2.5 p-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 text-xs text-zinc-400 font-mono ${className}`}>
        <div className="p-1.5 rounded bg-zinc-850 text-cyan-400 shrink-0 border border-zinc-750">
          <Icon size={14} />
        </div>
        <div className="min-w-0">
          <div className="text-zinc-200 font-semibold truncate">{title}</div>
          {description && <div className="text-[11px] text-zinc-500 truncate">{description}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 ${className}`}>
      <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-cyan-400 mb-3 shadow-inner">
        <Icon size={22} />
      </div>
      <h4 className="text-sm font-bold font-mono text-zinc-200 mb-1.5 flex items-center gap-2">
        <span>{title}</span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-400 border border-cyan-800/60 uppercase tracking-wider">
          Roadmap
        </span>
      </h4>
      <p className="text-xs text-zinc-400 max-w-md leading-relaxed font-sans">
        {description}
      </p>
    </div>
  );
}

export function FeatureRoadmapBadge({ label = "Will be integrated soon" }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px] bg-zinc-900 text-cyan-300 border border-zinc-750">
      <Clock size={11} className="text-cyan-400" />
      <span>{label}</span>
    </span>
  );
}
