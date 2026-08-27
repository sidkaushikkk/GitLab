import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { pullRequestService } from '../services/pullRequestService';
import {
  GitPullRequest,
  GitBranch,
  ShieldAlert,
  Sparkles,
  AlertTriangle,
  FileCode,
  CheckCircle2,
  Layers,
  Zap,
  Boxes,
  ArrowLeft,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react';
import { RiskBadge } from '../components/common/RiskBadge';
import { CodeDiff } from '../components/code/CodeViewer';

export function PullRequestDetailPage() {
  const { id } = useParams();
  const [pr, setPr] = useState(null);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copiedFixId, setCopiedFixId] = useState(null);

  useEffect(() => {
    async function load() {
      if (id) {
        const data = await pullRequestService.getPullRequestById(id);
        setPr(data);
      }
    }
    load();
  }, [id]);

  if (!pr) return null;

  const handleCopyFix = (text, fixId) => {
    navigator.clipboard.writeText(text);
    setCopiedFixId(fixId);
    setTimeout(() => setCopiedFixId(null), 2000);
  };

  const selectedFile = pr.changedFiles[activeFileIndex] || pr.changedFiles[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Back to Pull Requests */}
      <Link
        to="/pulls"
        className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-cyan-300 transition-colors"
      >
        <ArrowLeft size={13} />
        <span>Back to Pull Requests</span>
      </Link>

      {/* PR Header Banner */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/80">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-bold font-mono text-cyan-400">PR #{pr.number}</span>
            <h1 className="text-lg font-bold text-zinc-100">{pr.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-400">Risk Assessment:</span>
            <RiskBadge level={pr.riskLevel} size="md" />
          </div>
        </div>

        <p className="text-xs text-zinc-300 font-sans leading-relaxed">
          {pr.summary}
        </p>

        {/* Branches & Author */}
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-zinc-800/80 font-mono text-xs text-zinc-400">
          <div className="flex items-center gap-1 text-zinc-300">
            <GitBranch size={13} className="text-cyan-400" />
            <span className="text-cyan-300">{pr.sourceBranch}</span>
            <span>into</span>
            <span className="text-zinc-200 font-bold">{pr.targetBranch}</span>
          </div>
          <span>-</span>
          <div className="flex items-center gap-1.5">
            <img
              src={pr.author.avatar}
              alt={pr.author.name}
              className="w-4 h-4 rounded-full"
            />
            <span>{pr.author.name} ({pr.author.handle})</span>
          </div>
          <span>-</span>
          <span>Updated {new Date(pr.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        {/* High-level metrics strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-3 border-t border-zinc-800/80 font-mono text-xs">
          <div>
            <span className="text-zinc-500 text-[10px] block uppercase">Files Changed</span>
            <span className="text-base font-bold text-zinc-200">{pr.metrics.filesChanged}</span>
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] block uppercase">Lines Added</span>
            <span className="text-base font-bold text-emerald-400">+{pr.metrics.linesAdded}</span>
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] block uppercase">Lines Removed</span>
            <span className="text-base font-bold text-rose-400">-{pr.metrics.linesRemoved}</span>
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] block uppercase">APIs Affected</span>
            <span className="text-base font-bold text-amber-400">{pr.metrics.apisAffected} routes</span>
          </div>
          <div>
            <span className="text-zinc-500 text-[10px] block uppercase">Risk Score</span>
            <span className="text-base font-bold text-rose-300">{pr.riskScore} / 100</span>
          </div>
        </div>
      </div>

      {/* AI Automated Code Review */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-cyan-950 text-cyan-400 border border-cyan-800">
              <Sparkles size={15} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 font-mono">GitLab AI Code Review</h3>
              <p className="text-[11px] text-zinc-400 font-sans">
                Automated AST semantics, security heuristics, and race condition detection.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60">
            {pr.aiReview.verdict}
          </span>
        </div>

        <p className="text-xs text-zinc-300 font-sans leading-relaxed mb-4">
          {pr.aiReview.summary}
        </p>

        {/* AI Findings List */}
        <div className="space-y-3">
          {pr.aiReview.findings.map((f) => (
            <div
              key={f.id}
              className="p-4 rounded-lg bg-zinc-950 border border-rose-900/40 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono">
                  <ShieldAlert size={14} className="text-rose-400 shrink-0" />
                  <span className="font-bold text-rose-300">[{f.type}]</span>
                  <span className="text-zinc-200 font-semibold">{f.title}</span>
                </div>
                <RiskBadge level={f.severity} size="sm" />
              </div>

              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                <FileCode size={12} className="text-cyan-400" />
                <span>{f.file}:Line {f.line}</span>
              </div>

              <p className="text-zinc-300 font-sans leading-relaxed">
                {f.explanation}
              </p>

              <div className="pt-2 border-t border-zinc-900 flex items-center justify-between bg-zinc-900/60 p-2.5 rounded text-zinc-300">
                <div>
                  <span className="font-mono text-[10px] text-emerald-400 block font-semibold uppercase">Suggested Fix:</span>
                  <span className="text-xs font-sans text-emerald-200/90">{f.suggestedFix}</span>
                </div>
                <button
                  onClick={() => handleCopyFix(f.suggestedFix, f.id)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-200 text-xs font-mono transition-colors shrink-0 ml-2"
                >
                  {copiedFixId === f.id ? <Check size={12} className="text-emerald-400 inline mr-1" /> : null}
                  {copiedFixId === f.id ? 'Copied' : 'Copy Fix'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Changed Files & Code Diff Viewer */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <h3 className="text-sm font-semibold text-zinc-100 font-mono mb-3 flex items-center gap-2">
          <FileCode size={16} className="text-cyan-400" />
          Changed Files ({pr.changedFiles.length})
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* File Selector Sidebar */}
          <div className="lg:col-span-1 space-y-1">
            {pr.changedFiles.map((file, idx) => {
              const isSelected = idx === activeFileIndex;
              return (
                <button
                  key={idx}
                  onClick={() => setActiveFileIndex(idx)}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-mono transition-colors flex items-center justify-between ${
                    isSelected
                      ? 'bg-cyan-950/60 text-cyan-300 border border-cyan-800/80 font-semibold'
                      : 'bg-zinc-950 text-zinc-400 border border-zinc-850 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <span className="truncate">{file.path.split('/').pop()}</span>
                  <div className="flex items-center gap-1.5 text-[10px] shrink-0 font-mono">
                    <span className="text-emerald-400">+{file.additions}</span>
                    <span className="text-rose-400">-{file.deletions}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Unified Code Diff Viewer */}
          <div className="lg:col-span-3">
            {selectedFile ? (
              <CodeDiff
                diffText={selectedFile.diff}
                filename={selectedFile.path}
              />
            ) : (
              <div className="p-8 text-center text-xs text-zinc-500 font-mono">
                No diff available for this file
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Impact Analysis Breakdown */}
      <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <h3 className="text-sm font-semibold text-zinc-100 font-mono mb-4 flex items-center gap-2">
          <Layers size={16} className="text-cyan-400" />
          Impact Analysis & Downstream Blast Radius
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          {/* Affected Modules */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-400 font-semibold block mb-2 text-[11px] uppercase tracking-wider">
              Affected Modules
            </span>
            <div className="space-y-2">
              {pr.impactAnalysis.affectedModules.map((m, i) => (
                <div key={i} className="p-2 rounded bg-zinc-900 border border-zinc-850">
                  <div className="font-bold text-zinc-200">{m.name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{m.path}</div>
                  <div className="text-[10px] text-cyan-400 mt-1 font-sans">{m.impact}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Affected APIs */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-400 font-semibold block mb-2 text-[11px] uppercase tracking-wider">
              Affected API Contracts
            </span>
            <div className="space-y-2">
              {pr.impactAnalysis.affectedApis.map((api, i) => (
                <div key={i} className="p-2 rounded bg-zinc-900 border border-zinc-850 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-zinc-200">
                      <span className="text-cyan-400 mr-1.5">{api.method}</span>
                      {api.path}
                    </div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-300">
                    {api.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Affected Dependencies */}
          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-400 font-semibold block mb-2 text-[11px] uppercase tracking-wider">
              Affected Packages
            </span>
            <div className="space-y-2">
              {pr.impactAnalysis.affectedDependencies.map((dep, i) => (
                <div key={i} className="p-2 rounded bg-zinc-900 border border-zinc-850">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">{dep.name}</span>
                    <span className="text-[10px] text-zinc-400">{dep.current}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1 font-sans">{dep.status}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
