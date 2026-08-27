import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { analysisService } from '../services/analysisService';
import {
  Activity,
  ShieldCheck,
  Code2,
  Clock,
  Zap,
  RefreshCw,
  GitBranch,
  ExternalLink,
  ShieldAlert,
  AlertTriangle,
  FileCode,
  ArrowRight,
  TrendingUp,
  Cpu,
  Layers,
  Boxes
} from 'lucide-react';
import { MetricCard } from '../components/common/MetricCard';
import { RiskBadge, SeverityBadge } from '../components/common/RiskBadge';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { Link, useNavigate } from 'react-router-dom';

export function OverviewPage() {
  const { currentRepo, currentBranch, isAnalyzing, triggerAnalyze } = useApp();
  const [trends, setTrends] = useState([]);
  const [hotspots, setHotspots] = useState([]);
  const [activities, setActivities] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [trendData, hotspotData, activityData] = await Promise.all([
          analysisService.getHealthTrends(currentRepo.id),
          analysisService.getRiskHotspots(currentRepo.id),
          analysisService.getRecentActivities(currentRepo.id)
        ]);
        setTrends(trendData);
        setHotspots(hotspotData);
        setActivities(activityData);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [currentRepo.id]);

  const metrics = currentRepo.metrics;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold font-mono text-zinc-100">{currentRepo.name}</h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-850 text-zinc-300 border border-zinc-750">
              {currentRepo.organization}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 flex items-center gap-1">
              <GitBranch size={12} />
              {currentBranch}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            {currentRepo.description} - Analyzed {currentRepo.lastAnalyzed}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={triggerAnalyze}
            disabled={isAnalyzing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={13} className={isAnalyzing ? 'animate-spin' : ''} />
            <span>{isAnalyzing ? 'Running Scan...' : 'Analyze Again'}</span>
          </button>
          <button
            onClick={() => navigate('/code')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-zinc-200 font-mono text-xs border border-zinc-750 transition-colors"
          >
            <Code2 size={13} />
            <span>Explore Code</span>
          </button>
        </div>
      </div>

      {/* High-Level Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <MetricCard
          title="Repository Health"
          value={`${metrics.healthScore} / 100`}
          subtitle="Composite Engineering Score"
          change="+4.2% vs last month"
          changeDirection="up"
          status="cyan"
          icon={Activity}
          onClick={() => navigate('/code-health')}
        />
        <MetricCard
          title="Security Score"
          value={`${metrics.securityScore} / 100`}
          subtitle={`${currentRepo.riskSummary.critical} critical findings`}
          change="+2.0% improved"
          changeDirection="up"
          status="emerald"
          icon={ShieldCheck}
          onClick={() => navigate('/security')}
        />
        <MetricCard
          title="Code Quality"
          value={`${metrics.codeQualityScore} / 100`}
          subtitle={`${metrics.testCoverage}% test coverage`}
          change="-1.5% in recent PRs"
          changeDirection="down"
          status="amber"
          icon={Code2}
          onClick={() => navigate('/code-health')}
        />
        <MetricCard
          title="Technical Debt"
          value={metrics.technicalDebt}
          subtitle={`${metrics.duplicatedLines}% duplicated lines`}
          change="Calculated debt"
          changeDirection="neutral"
          status="neutral"
          icon={Clock}
          onClick={() => navigate('/code-health')}
        />
        <MetricCard
          title="API Reliability"
          value={`${metrics.apiReliabilityScore} / 100`}
          subtitle={`${metrics.apisDetectedCount} endpoints detected`}
          change="+1.8% uptime"
          changeDirection="up"
          status="cyan"
          icon={Zap}
          onClick={() => navigate('/api-reliability')}
        />
      </div>

      {/* Health Over Time Chart + Risk Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Line Chart: Health Over Time */}
        <div className="lg:col-span-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <TrendingUp size={16} className="text-cyan-400" />
                Health Over Time
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Historical composite health, quality, security, and reliability trajectory.
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono">
              <span className="flex items-center gap-1 text-cyan-400">
                <span className="w-2 h-2 rounded-full bg-cyan-400" /> Health
              </span>
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Security
              </span>
              <span className="flex items-center gap-1 text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400" /> Quality
              </span>
            </div>
          </div>

          <div className="h-60 w-full font-mono text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" stroke="#71717a" tickLine={false} />
                <YAxis domain={[50, 100]} stroke="#71717a" tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    borderColor: '#27272a',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace'
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="health"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  dot={{ fill: '#06b6d4', r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="security"
                  stroke="#10b981"
                  strokeWidth={1.75}
                  dot={{ fill: '#10b981', r: 2.5 }}
                />
                <Line
                  type="monotone"
                  dataKey="quality"
                  stroke="#f59e0b"
                  strokeWidth={1.75}
                  dot={{ fill: '#f59e0b', r: 2.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Risk Overview Breakdown */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
              <ShieldAlert size={16} className="text-rose-400" />
              Risk Overview
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Active engineering issues classified by severity level.
            </p>

            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/40">
                <span className="text-[10px] font-mono uppercase text-rose-400 block font-semibold">Critical</span>
                <span className="text-2xl font-bold font-mono text-rose-300">{currentRepo.riskSummary.critical}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Requires immediate remediation</span>
              </div>
              <div className="p-3 rounded-lg bg-orange-950/30 border border-orange-900/40">
                <span className="text-[10px] font-mono uppercase text-orange-400 block font-semibold">High</span>
                <span className="text-2xl font-bold font-mono text-orange-300">{currentRepo.riskSummary.high}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Vulnerabilities & debt</span>
              </div>
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/40">
                <span className="text-[10px] font-mono uppercase text-amber-400 block font-semibold">Medium</span>
                <span className="text-2xl font-bold font-mono text-amber-300">{currentRepo.riskSummary.medium}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Performance & complexity</span>
              </div>
              <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-900/40">
                <span className="text-[10px] font-mono uppercase text-emerald-400 block font-semibold">Low</span>
                <span className="text-2xl font-bold font-mono text-emerald-300">{currentRepo.riskSummary.low}</span>
                <span className="text-[10px] text-zinc-400 block mt-1">Informational suggestions</span>
              </div>
            </div>
          </div>

          <Link
            to="/security"
            className="mt-3 flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-cyan-400 hover:border-zinc-700 transition-colors"
          >
            <span>Inspect All Security Findings</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* Codebase Summary Strip */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
        <h3 className="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2">
          <Layers size={16} className="text-cyan-400" />
          Codebase Summary
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 font-mono text-xs divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
          <div className="pt-2 sm:pt-0 sm:px-3 first:pl-0">
            <span className="text-zinc-500 text-[10px] block uppercase">Total Files</span>
            <span className="text-lg font-bold text-zinc-200">{metrics.totalFiles}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Lines of Code</span>
            <span className="text-lg font-bold text-zinc-200">{metrics.linesOfCode.toLocaleString()}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Primary Language</span>
            <span className="text-lg font-bold text-cyan-300">{currentRepo.primaryLanguage}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Functions</span>
            <span className="text-lg font-bold text-zinc-200">{metrics.functionsCount}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Classes / Types</span>
            <span className="text-lg font-bold text-zinc-200">{metrics.classesCount}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">Dependencies</span>
            <span className="text-lg font-bold text-zinc-200">{metrics.dependenciesCount}</span>
          </div>
          <div className="pt-2 sm:pt-0 sm:px-3">
            <span className="text-zinc-500 text-[10px] block uppercase">APIs Detected</span>
            <span className="text-lg font-bold text-emerald-400">{metrics.apisDetectedCount}</span>
          </div>
        </div>

        {/* Language distribution bar */}
        <div className="mt-4 pt-3 border-t border-zinc-800">
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 mb-1.5">
            <span>Language Distribution</span>
            <span>100% indexed</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden flex bg-zinc-800">
            {metrics.languages.map((lang, idx) => (
              <div
                key={idx}
                style={{ width: `${lang.percentage}%`, backgroundColor: lang.color }}
                title={`${lang.name}: ${lang.percentage}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-4 mt-2 font-mono text-[11px] text-zinc-400">
            {metrics.languages.map((lang, idx) => (
              <span key={idx} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: lang.color }} />
                <span>{lang.name} ({lang.percentage}%)</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Risk Hotspots + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Risk Hotspots */}
        <div className="lg:col-span-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                <AlertTriangle size={16} className="text-orange-400" />
                Risk Hotspots
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Highest risk modules by cyclomatic complexity, security alerts, and blast radius.
              </p>
            </div>
            <Link to="/code-health" className="text-xs font-mono text-cyan-400 hover:underline">
              View All Files
            </Link>
          </div>

          <div className="space-y-2.5">
            {hotspots.map((item) => (
              <div
                key={item.id}
                onClick={() => navigate('/code')}
                className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileCode size={14} className="text-cyan-400 shrink-0" />
                      <span className="font-mono text-xs font-semibold text-zinc-200 group-hover:text-cyan-300 transition-colors truncate">
                        {item.file}
                      </span>
                      <RiskBadge level={item.riskLevel} size="sm" />
                    </div>
                    <p className="text-xs text-zinc-400 mt-1 font-sans leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-2.5 pt-2 border-t border-zinc-850/80 text-[11px] font-mono text-zinc-400">
                  <span>{item.complexity}</span>
                  <span>-</span>
                  <span>{item.issuesCount} findings</span>
                  <span>-</span>
                  <span className="text-zinc-400">{item.category}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity Feed */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2">
              <Clock size={16} className="text-cyan-400" />
              Recent Activity
            </h3>

            <div className="space-y-3 font-sans text-xs">
              {activities.map((act) => (
                <div key={act.id} className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-850">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-zinc-400">{act.time}</span>
                    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-zinc-850 border border-zinc-750 ${
                      act.badgeVariant === 'rose' ? 'text-rose-400' : act.badgeVariant === 'emerald' ? 'text-emerald-400' : 'text-cyan-400'
                    }`}>
                      {act.badge}
                    </span>
                  </div>
                  <div className="text-zinc-200 font-medium leading-tight">{act.title}</div>
                  <div className="text-[11px] text-zinc-400 font-mono mt-1">{act.author}</div>
                </div>
              ))}
            </div>
          </div>

          <Link
            to="/pulls"
            className="mt-3 flex items-center justify-between p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-cyan-400 hover:border-zinc-700 transition-colors"
          >
            <span>Inspect Pull Requests</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
