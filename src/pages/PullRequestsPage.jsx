import React from "react";
import { GitPullRequest, GitCommit, ShieldAlert, Sparkles } from "lucide-react";
import { WillBeIntegratedSoon } from "../components/common/WillBeIntegratedSoon";
import { useApp } from "../context/AppContext";

export function PullRequestsPage({ headless = false }) {
  const { currentRepo } = useApp();

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <GitPullRequest size={20} className="text-cyan-400" />
              Pull Request Intelligence
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              AI risk classification, automated code reviews, diff inspections, and architectural blast radius maps.
            </p>
          </div>
        </div>
      )}

      {/* Main Will Be Integrated Soon View */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 sm:p-12 text-center">
        <WillBeIntegratedSoon
          title="Pull Request Intelligence will be integrated soon"
          description="Automated GitHub/GitLab webhook integration for incoming PRs, predictive risk scoring, and architectural blast radius diff analysis will be integrated here."
          icon={GitPullRequest}
          className="border-none bg-transparent p-0"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mt-8 text-left font-mono text-xs">
          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Sparkles size={14} />
              <span>Predictive Risk Model</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              ML-driven defect probability estimation trained on historical merge outcomes.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <GitCommit size={14} />
              <span>Diff Impact Analysis</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Automated evaluation of changed functions, dependency shifts, and blast radius.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <ShieldAlert size={14} />
              <span>CI/CD Quality Gates</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Automated PR blocking when critical code smells or architectural cycles are introduced.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
