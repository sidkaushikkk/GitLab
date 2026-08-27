import React from 'react';
import {
  X,
  Zap,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Server,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { RiskBadge } from '../common/RiskBadge';

export function EndpointDrawer({ endpoint, onClose }) {
  if (!endpoint) return null;

  const methodColors = {
    GET: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80',
    POST: 'bg-blue-950/80 text-blue-300 border-blue-800/80',
    PUT: 'bg-amber-950/80 text-amber-300 border-amber-800/80',
    DELETE: 'bg-rose-950/80 text-rose-300 border-rose-800/80'
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
            <span
              className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                methodColors[endpoint.method] || 'bg-zinc-800 text-zinc-300'
              }`}
            >
              {endpoint.method}
            </span>
            <RiskBadge level={endpoint.risk} size="md" />
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-xs text-zinc-300 flex-1">
          <div>
            <h3 className="text-base font-mono font-bold text-zinc-100 break-all">
              {endpoint.endpoint}
            </h3>
            <p className="text-zinc-400 mt-1 font-sans">{endpoint.description}</p>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 font-mono">
            <div>
              <span className="text-zinc-500 text-[10px] block">RELIABILITY</span>
              <span className="text-lg font-bold text-zinc-100">{endpoint.reliability}%</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">P99 LATENCY</span>
              <span className="text-lg font-bold text-cyan-300">{endpoint.p99Latency}</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">THROUGHPUT</span>
              <span className="text-lg font-bold text-zinc-100">{endpoint.rps} rps</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">SUCCESS RATE</span>
              <span className="text-lg font-bold text-emerald-400">{endpoint.successRate}%</span>
            </div>
          </div>

          {/* Section: Error Handling Quality */}
          <div>
            <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Error Handling Assessment
            </h4>
            <div className="p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 font-sans leading-relaxed text-zinc-200">
              {endpoint.errorHandling}
            </div>
          </div>

          {/* Section: Upstream & Downstream Callers */}
          <div>
            <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
              Identified Consumers & Callers
            </h4>
            <div className="flex flex-wrap gap-2">
              {endpoint.callers.map((caller, i) => (
                <span
                  key={i}
                  className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 font-mono text-zinc-300 text-xs flex items-center gap-1.5"
                >
                  <Server size={12} className="text-cyan-400" />
                  {caller}
                </span>
              ))}
            </div>
          </div>

          {/* Section: Recent Errors */}
          {endpoint.recentErrors && endpoint.recentErrors.length > 0 && (
            <div>
              <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                Recent Error Exceptions
              </h4>
              <div className="space-y-2">
                {endpoint.recentErrors.map((err, i) => (
                  <div key={i} className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/40 text-xs font-mono">
                    <div className="flex items-center justify-between text-[11px] text-rose-300 mb-1">
                      <span className="flex items-center gap-1">
                        <Clock size={11} /> {err.timestamp}
                      </span>
                      <span className="bg-rose-900/60 px-1.5 py-0.2 rounded text-rose-200">
                        {err.count} occurrences
                      </span>
                    </div>
                    <div className="text-zinc-300 break-all">{err.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section: AI Recommendations */}
          {endpoint.recommendations && endpoint.recommendations.length > 0 && (
            <div>
              <h4 className="text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                Engineering Recommendations
              </h4>
              <ul className="space-y-2">
                {endpoint.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2 p-2.5 rounded bg-zinc-900/60 border border-zinc-800 font-sans text-zinc-300">
                    <CheckCircle2 size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-750 text-zinc-200 font-medium font-mono text-xs transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
