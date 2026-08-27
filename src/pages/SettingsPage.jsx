import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Settings,
  Sliders,
  Shield,
  Sparkles,
  Webhook,
  Bell,
  Save,
  Check,
  ToggleLeft,
  ToggleRight,
  Database,
  Key
} from 'lucide-react';
import { Tabs } from '../components/common/Tabs';

export function SettingsPage() {
  const { currentRepo, addToast } = useApp();
  const [activeTab, setActiveTab] = useState('general');

  // Realistic mock state for settings
  const [generalSettings, setGeneralSettings] = useState({
    platformName: 'GitLab Intelligence Hub',
    orgName: 'HitachiSystems',
    defaultTheme: 'Dark (Developer Cockpit)',
    retentionDays: '90'
  });

  const [analysisSettings, setAnalysisSettings] = useState({
    autoAnalyzePRs: true,
    blockPrOnCritical: true,
    cyclomaticThreshold: 15,
    testCoverageMin: 75,
    enableSemgrepSAST: true,
    enableSecretScanner: true
  });

  const [aiSettings, setAiSettings] = useState({
    modelProvider: 'Anthropic Claude 3.7 Sonnet / Gemini 2.0 Flash',
    enableInlineDiffReview: true,
    enableBlastRadiusSim: true,
    temperature: 0.2
  });

  const [webhookSettings, setWebhookSettings] = useState({
    slackWebhook: 'https://hooks.slack.com/services/T00/B00/XXXXX',
    notifyOnCritical: true,
    notifyOnPrReview: true
  });

  const handleSave = () => {
    addToast('Platform settings saved successfully', 'success');
  };

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'repository', label: 'Repository', icon: Database },
    { id: 'analysis', label: 'Analysis Rules', icon: Sliders },
    { id: 'ai', label: 'AI Configuration', icon: Sparkles },
    { id: 'integrations', label: 'Integrations & Webhooks', icon: Webhook },
    { id: 'notifications', label: 'Notifications', icon: Bell }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <Settings size={20} className="text-cyan-400" />
            Platform & Analysis Settings
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Configure automated CI/CD intelligence pipelines, AST threshold rules, and AI model parameters.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold font-mono text-xs transition-colors shadow-sm"
        >
          <Save size={14} />
          <span>Save Changes</span>
        </button>
      </div>

      {/* Settings Tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Tab: General */}
      {activeTab === 'general' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-5 text-xs font-mono">
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">PLATFORM INSTANCE NAME</label>
            <input
              type="text"
              value={generalSettings.platformName}
              onChange={(e) => setGeneralSettings({ ...generalSettings, platformName: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-semibold mb-1">ORGANIZATION</label>
            <input
              type="text"
              value={generalSettings.orgName}
              disabled
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-400 opacity-70"
            />
            <span className="text-[10px] text-zinc-500 font-sans mt-1 block">
              Managed via SSO SAML federation.
            </span>
          </div>

          <div>
            <label className="block text-zinc-300 font-semibold mb-1">DATA RETENTION PERIOD</label>
            <select
              value={generalSettings.retentionDays}
              onChange={(e) => setGeneralSettings({ ...generalSettings, retentionDays: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-200 focus:outline-none"
            >
              <option value="30">30 Days</option>
              <option value="90">90 Days (Recommended)</option>
              <option value="180">180 Days</option>
              <option value="365">1 Year (Compliance Audit)</option>
            </select>
          </div>
        </div>
      )}

      {/* Tab: Repository */}
      {activeTab === 'repository' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-5 text-xs font-mono">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <div className="text-sm font-bold text-zinc-100">{currentRepo.name}</div>
              <div className="text-zinc-400 font-sans mt-0.5">{currentRepo.description}</div>
            </div>
            <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
              Active
            </span>
          </div>

          <div>
            <label className="block text-zinc-300 font-semibold mb-1">DEFAULT BRANCH TO INDEX</label>
            <input
              type="text"
              value={currentRepo.defaultBranch}
              disabled
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-300 opacity-80"
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-semibold mb-1">IGNORED PATHS (.gitignore rules)</label>
            <textarea
              defaultValue={`node_modules/\ndist/\nbuild/\ncoverage/\n*.min.js`}
              rows={4}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-300 font-mono focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Tab: Analysis Rules */}
      {activeTab === 'analysis' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-6 text-xs font-mono">
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div>
              <span className="font-semibold text-zinc-100 block">Automatic PR Scanning</span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Trigger GitLab intelligence AST scan on every pull request opened or synchronized.
              </span>
            </div>
            <input
              type="checkbox"
              checked={analysisSettings.autoAnalyzePRs}
              onChange={(e) => setAnalysisSettings({ ...analysisSettings, autoAnalyzePRs: e.target.checked })}
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-cyan-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div>
              <span className="font-semibold text-zinc-100 block">Block Merges on Critical Security Findings</span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Emit failure status check to GitHub branch protection if critical vulnerability is introduced.
              </span>
            </div>
            <input
              type="checkbox"
              checked={analysisSettings.blockPrOnCritical}
              onChange={(e) => setAnalysisSettings({ ...analysisSettings, blockPrOnCritical: e.target.checked })}
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-cyan-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-zinc-300">MAXIMUM ALLOWED CYCLOMATIC COMPLEXITY</span>
              <span className="font-bold text-cyan-400">{analysisSettings.cyclomaticThreshold}</span>
            </div>
            <input
              type="range"
              min="5"
              max="30"
              value={analysisSettings.cyclomaticThreshold}
              onChange={(e) => setAnalysisSettings({ ...analysisSettings, cyclomaticThreshold: parseInt(e.target.value) })}
              className="w-full accent-cyan-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>5 (Strict)</span>
              <span>15 (Standard)</span>
              <span>30 (Permissive)</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-zinc-300">MINIMUM REQUIRED TEST COVERAGE</span>
              <span className="font-bold text-emerald-400">{analysisSettings.testCoverageMin}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="95"
              value={analysisSettings.testCoverageMin}
              onChange={(e) => setAnalysisSettings({ ...analysisSettings, testCoverageMin: parseInt(e.target.value) })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Tab: AI Configuration */}
      {activeTab === 'ai' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-5 text-xs font-mono">
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">AI MODEL ENGINE</label>
            <select
              value={aiSettings.modelProvider}
              onChange={(e) => setAiSettings({ ...aiSettings, modelProvider: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-200 focus:outline-none"
            >
              <option value="Anthropic Claude 3.7 Sonnet / Gemini 2.0 Flash">
                Anthropic Claude 3.7 Sonnet / Gemini 2.0 Flash (Hybrid Engine)
              </option>
              <option value="Self-Hosted Llama 3 70B">Self-Hosted Llama 3 70B (VPC Isolated)</option>
              <option value="OpenAI GPT-4o">OpenAI GPT-4o</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div>
              <span className="font-semibold text-zinc-100 block">Inline Diff AI Code Reviews</span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Generate automatic inline suggestions for race conditions, memory leaks, and missing validations.
              </span>
            </div>
            <input
              type="checkbox"
              checked={aiSettings.enableInlineDiffReview}
              onChange={(e) => setAiSettings({ ...aiSettings, enableInlineDiffReview: e.target.checked })}
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-cyan-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div>
              <span className="font-semibold text-zinc-100 block">Downstream Blast Radius Simulation</span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Simulate potential breaking changes on upstream consumers and external API contracts.
              </span>
            </div>
            <input
              type="checkbox"
              checked={aiSettings.enableBlastRadiusSim}
              onChange={(e) => setAiSettings({ ...aiSettings, enableBlastRadiusSim: e.target.checked })}
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-cyan-500"
            />
          </div>
        </div>
      )}

      {/* Tab: Integrations & Webhooks */}
      {activeTab === 'integrations' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-5 text-xs font-mono">
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">SLACK / TEAMS WEBHOOK URL</label>
            <input
              type="text"
              value={webhookSettings.slackWebhook}
              onChange={(e) => setWebhookSettings({ ...webhookSettings, slackWebhook: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-zinc-100 focus:outline-none"
            />
            <span className="text-[10px] text-zinc-500 font-sans mt-1 block">
              Posts critical security advisories and automated PR review summaries to your engineering channel.
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between">
            <div>
              <span className="font-semibold text-zinc-100 block">Datadog & Sentry Integration</span>
              <span className="text-[10px] text-zinc-400 font-sans">Connected to Hitachi Datadog APM stream</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              Connected
            </span>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between">
            <div>
              <span className="font-semibold text-zinc-100 block">Jira Software Cloud Sync</span>
              <span className="text-[10px] text-zinc-400 font-sans">Auto-create technical debt backlog issues</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
              Disabled
            </span>
          </div>
        </div>
      )}

      {/* Tab: Notifications */}
      {activeTab === 'notifications' && (
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-4 text-xs font-mono">
          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div>
              <span className="font-semibold text-zinc-100 block">Email Alerts on Critical Vulnerabilities</span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Immediate email notifications dispatched to tech lead and security team.
              </span>
            </div>
            <input
              type="checkbox"
              defaultChecked
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-cyan-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-950 border border-zinc-800">
            <div>
              <span className="font-semibold text-zinc-100 block">Weekly Engineering Intelligence Digest</span>
              <span className="text-[11px] text-zinc-400 font-sans">
                Summary of repository health score trends, technical debt reduction, and open PR bottlenecks.
              </span>
            </div>
            <input
              type="checkbox"
              defaultChecked
              className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-cyan-500"
            />
          </div>
        </div>
      )}
    </div>
  );
}
