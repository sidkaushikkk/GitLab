import React from "react";
import { useParams, Link } from "react-router-dom";
import { GitPullRequest, ArrowLeft } from "lucide-react";
import { WillBeIntegratedSoon } from "../components/common/WillBeIntegratedSoon";

export function PullRequestDetailPage() {
  const { id } = useParams();

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <Link
        to="/pulls"
        className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-cyan-300 transition-colors"
      >
        <ArrowLeft size={13} />
        <span>Back to Pull Requests</span>
      </Link>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 sm:p-12 text-center">
        <WillBeIntegratedSoon
          title="Pull Request Detail & Diff Intelligence will be integrated soon"
          description={`Deep diff inspection, predictive risk scoring, and automated code review suggestions for PR ${id || ""} are scheduled for integration with live repository webhooks.`}
          icon={GitPullRequest}
          className="border-none bg-transparent p-0"
        />
      </div>
    </div>
  );
}
