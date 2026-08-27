import React, { useState } from 'react';
import {
  X,
  ShieldAlert,
  FileCode,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import { SeverityBadge } from '../common/RiskBadge';

export function FindingDrawer({ finding, onClose, onNavigateToFile }) {
  const [copied, setCopied] = useState(false);

  if (!finding) return null;

  const handleCopyPatch = () => {
    navigator.clipboard.writeText(finding.suggestedRemediation || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Container */}
      <div className="relative w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 h-full shadow-2xl overflow-y-auto flex flex-col animate-in slide-in-from-right duration-200 z-10">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity} size="md" />
            <span className="text-xs font-mono font-bold text-zinc-300">{finding.id}</span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 text-xs text-zinc-300 flex-1">
          {/* Title & File Locator */}
          <div>
            <h3 className="text-base font-bold text-zinc-100 leading-snug">
              {finding.title}
            </h3>
            <div className="flex items-center gap-2 mt-2 font-mono text-xs">
              <span className="text-zinc-500">{finding.category}</span>
            </div>

            <div
              onClick={() => onNavigateToFile && onNavigateToFile(finding.file)}
              className="mt-3 flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-2 font-mono text-zinc-200">
                <FileCode size={14} className="text-cyan-400" />
                <span>{finding.file}</span>
                <span className="text-zinc-500">:Line {finding.line}</span>
              </div>
              <span className="text-[11px] font-mono text-cyan-400 group-hover:underline inline-flex items-center gap-1">
                Open in Explorer <ArrowRight size={12} />
              </span>
            </div>
          </div>

          {/* Section: Why it matters */}
          <div>
            <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Why It Matters
            </h4>
            <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 leading-relaxed text-zinc-300 font-sans">
              {finding.whyItMatters}
            </div>
          </div>

          {/* Section: Affected Code */}
          <div>
            <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Affected Code Context
            </h4>
            <div className="rounded-lg border border-rose-900/40 bg-zinc-950 overflow-hidden font-mono text-xs">
              <div className="px-3 py-1.5 bg-rose-950/20 border-b border-rose-900/30 text-rose-300 text-[11px] flex items-center justify-between">
                <span>Vulnerable snippet ({finding.file} - line {finding.line})</span>
                <ShieldAlert size={12} />
              </div>
              <pre className="p-3.5 text-zinc-200 overflow-x-auto whitespace-pre leading-relaxed">
                {finding.affectedCode}
              </pre>
            </div>
          </div>

          {/* Section: Potential Impact */}
          <div>
            <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Potential Impact
            </h4>
            <div className="p-3.5 rounded-lg bg-rose-950/20 border border-rose-900/30 text-rose-200/90 leading-relaxed font-sans">
              {finding.potentialImpact}
            </div>
          </div>

          {/* Section: Suggested Remediation */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider">
                Suggested Remediation
              </h4>
              <button
                onClick={handleCopyPatch}
                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                <span>{copied ? 'Copied Patch' : 'Copy Patch'}</span>
              </button>
            </div>
            <div className="rounded-lg border border-emerald-900/40 bg-zinc-950 overflow-hidden font-mono text-xs">
              <div className="px-3 py-1.5 bg-emerald-950/20 border-b border-emerald-900/30 text-emerald-300 text-[11px] flex items-center justify-between">
                <span>Recommended secure patch</span>
                <CheckCircle2 size={12} />
              </div>
              <pre className="p-3.5 text-emerald-200/90 overflow-x-auto whitespace-pre leading-relaxed">
                {finding.suggestedRemediation}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-500">Finding ID: {finding.id}</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-750 text-zinc-200 font-medium transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
