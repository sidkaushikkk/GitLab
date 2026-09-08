import React from "react";
import { Zap, Activity, Server, Clock } from "lucide-react";
import { WillBeIntegratedSoon } from "../components/common/WillBeIntegratedSoon";
import { useApp } from "../context/AppContext";

export function ApiReliabilityPage({ headless = false }) {
  const { currentRepo } = useApp();

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
          <div>
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <Zap size={20} className="text-cyan-400" />
              API Reliability & Telemetry
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Endpoint p99 latency monitoring, error budget burn rates, breaking change alerts, and APM telemetry.
            </p>
          </div>
        </div>
      )}

      {/* Main Will Be Integrated Soon View */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 sm:p-12 text-center">
        <WillBeIntegratedSoon
          title="API Reliability & Endpoint Telemetry will be integrated soon"
          description="Continuous APM agent integration, real-time HTTP route discovery, distributed tracing correlation, and p99 latency tracking are scheduled for the next platform release."
          icon={Zap}
          className="border-none bg-transparent p-0"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto mt-8 text-left font-mono text-xs">
          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Server size={14} />
              <span>Route Mapping</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Automatic AST route extraction for Express, Flask, Fastify, and Spring controllers.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Activity size={14} />
              <span>Telemetry Streams</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              OpenTelemetry and Prometheus metric ingestion for real-time error rate calculations.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-cyan-400 font-semibold mb-1 flex items-center gap-1.5">
              <Clock size={14} />
              <span>SLA Budgets</span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans">
              Automated SLO burn rate forecasting and API regression alerts prior to deployments.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
