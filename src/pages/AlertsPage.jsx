import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { alertService } from '../services/alertService';
import {
  BellRing,
  ShieldAlert,
  AlertTriangle,
  GitPullRequest,
  Zap,
  Activity,
  CheckCircle2,
  Clock,
  User,
  UserCheck,
  X,
  Send,
  ExternalLink,
  RefreshCw,
  Search,
  Filter,
  Check,
  Slash,
  MessageSquare,
  History,
  Info,
  ChevronRight,
  Shield
} from 'lucide-react';
import { Link } from 'react-router-dom';

const SEVERITY_COLORS = {
  CRITICAL: 'bg-rose-500/10 text-rose-400 border-rose-500/30 ring-rose-500/20',
  HIGH: 'bg-amber-500/10 text-amber-400 border-amber-500/30 ring-amber-500/20',
  MEDIUM: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30 ring-yellow-500/20',
  LOW: 'bg-blue-500/10 text-blue-400 border-blue-500/30 ring-blue-500/20',
  INFO: 'bg-zinc-800 text-zinc-400 border-zinc-700'
};

const STATUS_BADGES = {
  OPEN: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  ACKNOWLEDGED: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  RESOLVED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  DISMISSED: 'bg-zinc-800 text-zinc-400 border-zinc-700'
};

const CATEGORY_ICONS = {
  SECURITY: ShieldAlert,
  PR_RISK: GitPullRequest,
  API_RELIABILITY: Zap,
  CODE_HEALTH: Activity,
  DEPENDENCY: Shield
};

export function AlertsPage() {
  const { currentRepo, repositories, addToast } = useApp();

  const [alerts, setAlerts] = useState([]);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedRepoId, setSelectedRepoId] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Assignees
  const [assignees, setAssignees] = useState([]);

  // Selected Alert for Details Drawer
  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [activeAlertDetail, setActiveAlertDetail] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Modals & Action notes
  const [actionNote, setActionNote] = useState('');
  const [commentContent, setCommentContent] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  // Fetch assignees on mount
  useEffect(() => {
    alertService.getAssignees()
      .then(setAssignees)
      .catch((err) => console.warn('Assignees load error:', err));
  }, []);

  // Fetch alerts
  const fetchAlerts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = {};
      if (selectedRepoId !== 'ALL') params.repositoryId = selectedRepoId;
      if (selectedStatus !== 'ALL') params.status = selectedStatus;
      if (selectedSeverity !== 'ALL') params.severity = selectedSeverity;
      if (selectedCategory !== 'ALL') params.category = selectedCategory;

      const data = await alertService.getAlerts(params);
      setAlerts(data.alerts || []);
      setTotalAlerts(data.total || 0);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
      setError(err.message || 'Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [selectedRepoId, selectedStatus, selectedSeverity, selectedCategory]);

  // Load single alert detail when drawer opens
  useEffect(() => {
    if (!selectedAlertId) {
      setActiveAlertDetail(null);
      return;
    }

    setIsDetailLoading(true);
    alertService.getAlert(selectedAlertId)
      .then((detail) => {
        setActiveAlertDetail(detail);
      })
      .catch((err) => {
        console.error('Failed to fetch alert detail:', err);
        addToast(err.message || 'Could not load alert detail', 'error');
        setSelectedAlertId(null);
      })
      .finally(() => setIsDetailLoading(false));
  }, [selectedAlertId]);

  // Filtered alerts by search text
  const filteredAlerts = useMemo(() => {
    if (!searchQuery.trim()) return alerts;
    const q = searchQuery.toLowerCase();
    return alerts.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.ruleId.toLowerCase().includes(q) ||
      (a.repositoryName && a.repositoryName.toLowerCase().includes(q))
    );
  }, [alerts, searchQuery]);

  // Summary counts
  const stats = useMemo(() => {
    return {
      critical: alerts.filter(a => a.severity === 'CRITICAL' && a.status === 'OPEN').length,
      high: alerts.filter(a => a.severity === 'HIGH' && a.status === 'OPEN').length,
      open: alerts.filter(a => a.status === 'OPEN').length,
      acknowledged: alerts.filter(a => a.status === 'ACKNOWLEDGED').length,
      resolved: alerts.filter(a => a.status === 'RESOLVED').length
    };
  }, [alerts]);

  // Lifecycle Actions
  const handleAcknowledge = async (alertId) => {
    setIsSubmittingAction(true);
    try {
      const res = await alertService.acknowledgeAlert(alertId);
      addToast('Alert acknowledged', 'success');
      // Update local state
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'ACKNOWLEDGED', acknowledgedAt: res.alert.acknowledged_at } : a));
      if (activeAlertDetail && activeAlertDetail.alert.id === alertId) {
        const fresh = await alertService.getAlert(alertId);
        setActiveAlertDetail(fresh);
      }
    } catch (err) {
      addToast(err.message || 'Failed to acknowledge alert', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleResolve = async (alertId) => {
    setIsSubmittingAction(true);
    try {
      const res = await alertService.resolveAlert(alertId, actionNote);
      addToast('Alert marked as RESOLVED', 'success');
      setActionNote('');
      setIsResolving(false);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'RESOLVED', resolvedAt: res.alert.resolved_at } : a));
      if (activeAlertDetail && activeAlertDetail.alert.id === alertId) {
        const fresh = await alertService.getAlert(alertId);
        setActiveAlertDetail(fresh);
      }
    } catch (err) {
      addToast(err.message || 'Failed to resolve alert', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleDismiss = async (alertId) => {
    setIsSubmittingAction(true);
    try {
      const res = await alertService.dismissAlert(alertId, actionNote);
      addToast('Alert dismissed', 'info');
      setActionNote('');
      setIsDismissing(false);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'DISMISSED', dismissedAt: res.alert.dismissed_at } : a));
      if (activeAlertDetail && activeAlertDetail.alert.id === alertId) {
        const fresh = await alertService.getAlert(alertId);
        setActiveAlertDetail(fresh);
      }
    } catch (err) {
      addToast(err.message || 'Failed to dismiss alert', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleReopen = async (alertId) => {
    setIsSubmittingAction(true);
    try {
      const res = await alertService.reopenAlert(alertId);
      addToast('Alert reopened', 'success');
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, status: 'OPEN', resolvedAt: null, dismissedAt: null } : a));
      if (activeAlertDetail && activeAlertDetail.alert.id === alertId) {
        const fresh = await alertService.getAlert(alertId);
        setActiveAlertDetail(fresh);
      }
    } catch (err) {
      addToast(err.message || 'Failed to reopen alert', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleAssign = async (alertId, assignedUserId) => {
    setIsSubmittingAction(true);
    try {
      const res = await alertService.assignAlert(alertId, assignedUserId);
      addToast(assignedUserId ? 'Alert assigned successfully' : 'Alert unassigned', 'success');
      const assigned = assignees.find(u => u.id === assignedUserId);
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, assignedUser: assigned || null } : a));
      if (activeAlertDetail && activeAlertDetail.alert.id === alertId) {
        const fresh = await alertService.getAlert(alertId);
        setActiveAlertDetail(fresh);
      }
    } catch (err) {
      addToast(err.message || 'Failed to assign alert', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handlePostComment = async (e) => {
    e.preventDefault();
    if (!commentContent.trim() || !activeAlertDetail) return;
    setIsSubmittingAction(true);
    try {
      await alertService.addComment(activeAlertDetail.alert.id, commentContent.trim());
      setCommentContent('');
      addToast('Comment added', 'success');
      const fresh = await alertService.getAlert(activeAlertDetail.alert.id);
      setActiveAlertDetail(fresh);
    } catch (err) {
      addToast(err.message || 'Failed to post comment', 'error');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Helper to determine deep link to originating finding
  const getSourceDeepLink = (alert) => {
    if (!alert) return null;
    if (alert.category === 'SECURITY') return '/security';
    if (alert.category === 'PR_RISK') {
      return alert.pullRequestId ? `/pulls/${alert.pullRequestId}` : '/pulls';
    }
    if (alert.category === 'API_RELIABILITY') return '/api-reliability';
    if (alert.category === 'CODE_HEALTH') return '/code-health';
    return null;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header & KPI Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <BellRing size={20} className="text-cyan-400" />
            Reliability Alerts & Incident Triage
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-sans">
            Deterministic incident alerting across security vulnerabilities, PR risk gates, API contracts, and code health.
          </p>
        </div>

        <button
          onClick={fetchAlerts}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-700 bg-zinc-850 hover:bg-zinc-800 text-xs font-mono text-zinc-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin text-cyan-400' : 'text-zinc-400'} />
          <span>Refresh</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-950/10">
          <div className="text-[11px] text-rose-400 font-semibold uppercase">CRITICAL OPEN</div>
          <div className="text-2xl font-bold text-rose-300 mt-1">{stats.critical}</div>
        </div>
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-950/10">
          <div className="text-[11px] text-amber-400 font-semibold uppercase">HIGH OPEN</div>
          <div className="text-2xl font-bold text-amber-300 mt-1">{stats.high}</div>
        </div>
        <div className="p-3 rounded-lg border border-cyan-500/30 bg-cyan-950/10">
          <div className="text-[11px] text-cyan-400 font-semibold uppercase">TOTAL OPEN</div>
          <div className="text-2xl font-bold text-cyan-300 mt-1">{stats.open}</div>
        </div>
        <div className="p-3 rounded-lg border border-indigo-500/30 bg-indigo-950/10">
          <div className="text-[11px] text-indigo-400 font-semibold uppercase">ACKNOWLEDGED</div>
          <div className="text-2xl font-bold text-indigo-300 mt-1">{stats.acknowledged}</div>
        </div>
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/10">
          <div className="text-[11px] text-emerald-400 font-semibold uppercase">RESOLVED</div>
          <div className="text-2xl font-bold text-emerald-300 mt-1">{stats.resolved}</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/70 space-y-3 font-mono text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Pills */}
          <span className="text-zinc-500 text-[11px] mr-1">STATUS:</span>
          {['ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'].map((st) => (
            <button
              key={st}
              onClick={() => setSelectedStatus(st)}
              className={`px-2.5 py-1 rounded text-[11px] transition-colors border ${
                selectedStatus === st
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700 font-semibold'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 border-t border-zinc-800/60">
          {/* Search Box */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search alert title or rule..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-cyan-700 font-sans"
            />
          </div>

          {/* Severity Dropdown */}
          <div>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs focus:outline-none"
            >
              <option value="ALL">Severity: All</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </div>

          {/* Category Dropdown */}
          <div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs focus:outline-none"
            >
              <option value="ALL">Category: All</option>
              <option value="SECURITY">Security (CP9)</option>
              <option value="PR_RISK">PR Risk (CP8)</option>
              <option value="API_RELIABILITY">API Reliability (CP11)</option>
              <option value="CODE_HEALTH">Code Health (CP7/10)</option>
            </select>
          </div>

          {/* Repository Dropdown */}
          <div>
            <select
              value={selectedRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs focus:outline-none truncate"
            >
              <option value="ALL">Repository: All</option>
              {repositories.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Alerts Table / List */}
      {isLoading ? (
        <div className="py-16 text-center border border-zinc-800 rounded-lg bg-zinc-900/40">
          <RefreshCw size={24} className="animate-spin mx-auto text-cyan-400 mb-2" />
          <span className="text-xs font-mono text-zinc-400">Loading alerts from engineering intelligence engine...</span>
        </div>
      ) : error ? (
        <div className="p-6 border border-rose-500/30 rounded-lg bg-rose-950/10 text-center font-mono">
          <AlertTriangle size={24} className="mx-auto text-rose-400 mb-2" />
          <div className="text-xs text-rose-300 font-semibold">{error}</div>
          <button
            onClick={fetchAlerts}
            className="mt-3 px-3 py-1 rounded bg-rose-900/40 border border-rose-700 text-xs text-rose-200"
          >
            Retry
          </button>
        </div>
      ) : filteredAlerts.length === 0 ? (
        <div className="py-16 text-center border border-zinc-800 rounded-lg bg-zinc-900/40 font-mono">
          <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-3" />
          <div className="text-sm font-semibold text-zinc-200">No matching reliability alerts</div>
          <p className="text-xs text-zinc-500 font-sans mt-1 max-w-sm mx-auto">
            {searchQuery || selectedStatus !== 'ALL' || selectedSeverity !== 'ALL' || selectedCategory !== 'ALL'
              ? 'No alerts match your active filter criteria.'
              : 'All repository systems nominal. No deterministic reliability alerts open.'}
          </p>
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
          <div className="divide-y divide-zinc-800">
            {filteredAlerts.map((alert) => {
              const CategoryIcon = CATEGORY_ICONS[alert.category] || AlertTriangle;
              const sevClass = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.INFO;
              const statusClass = STATUS_BADGES[alert.status] || STATUS_BADGES.OPEN;

              return (
                <div
                  key={alert.id}
                  onClick={() => setSelectedAlertId(alert.id)}
                  className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-900/70 transition-colors cursor-pointer ${
                    selectedAlertId === alert.id ? 'bg-zinc-900 border-l-4 border-cyan-400' : ''
                  }`}
                >
                  {/* Alert Main Info */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-1">
                      <CategoryIcon size={18} className={alert.severity === 'CRITICAL' ? 'text-rose-400' : 'text-amber-400'} />
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Severity Badge */}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${sevClass}`}>
                          {alert.severity}
                        </span>

                        {/* Status Badge */}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${statusClass}`}>
                          {alert.status}
                        </span>

                        {/* Category */}
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">
                          {alert.category.replace('_', ' ')}
                        </span>

                        {/* Repo */}
                        <span className="text-[11px] font-mono text-cyan-400">
                          {alert.repositoryName}
                        </span>
                      </div>

                      {/* Title */}
                      <div className="text-xs font-semibold text-zinc-100 truncate sm:max-w-xl">
                        {alert.title}
                      </div>

                      {/* Description preview */}
                      <div className="text-[11px] text-zinc-400 truncate sm:max-w-2xl font-sans">
                        {alert.description}
                      </div>

                      {/* Footer info: rule + created date */}
                      <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500 pt-0.5">
                        <span>Rule: {alert.ruleId}</span>
                        <span>•</span>
                        <span>{new Date(alert.createdAt).toLocaleString()}</span>
                        {alert.assignedUser && (
                          <>
                            <span>•</span>
                            <span className="text-zinc-300 flex items-center gap-1">
                              <User size={10} className="text-cyan-400" />
                              @{alert.assignedUser.login}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Detail CTA */}
                  <div className="flex items-center gap-2 shrink-0 sm:self-center" onClick={(e) => e.stopPropagation()}>
                    {alert.status === 'OPEN' && (
                      <button
                        onClick={() => handleAcknowledge(alert.id)}
                        disabled={isSubmittingAction}
                        className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-indigo-300 border border-indigo-900/60 text-xs font-mono transition-colors"
                      >
                        Acknowledge
                      </button>
                    )}

                    <button
                      onClick={() => setSelectedAlertId(alert.id)}
                      className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition-colors"
                      title="View Details"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ALERT DETAILS SLIDE-OVER DRAWER */}
      {selectedAlertId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200 font-sans">
            {/* Drawer Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60 font-mono">
              <div className="flex items-center gap-2">
                <BellRing size={16} className="text-cyan-400" />
                <span className="text-xs font-bold text-zinc-200">Alert Incident Detail</span>
              </div>
              <button
                onClick={() => setSelectedAlertId(null)}
                className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Body */}
            {isDetailLoading || !activeAlertDetail ? (
              <div className="p-12 text-center text-xs font-mono text-zinc-400">
                <RefreshCw size={20} className="animate-spin mx-auto text-cyan-400 mb-2" />
                Loading incident record...
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {/* Title & Badges */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono">
                    <span className={`px-2.5 py-0.5 rounded text-xs font-semibold border ${SEVERITY_COLORS[activeAlertDetail.alert.severity]}`}>
                      {activeAlertDetail.alert.severity}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded text-xs border ${STATUS_BADGES[activeAlertDetail.alert.status]}`}>
                      {activeAlertDetail.alert.status}
                    </span>
                    <span className="text-xs text-zinc-400 font-mono">
                      {activeAlertDetail.alert.repositoryName}
                    </span>
                  </div>

                  <h2 className="text-base font-bold text-zinc-100 font-mono">
                    {activeAlertDetail.alert.title}
                  </h2>

                  <p className="text-xs text-zinc-300 leading-relaxed font-sans">
                    {activeAlertDetail.alert.description}
                  </p>
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs font-mono">
                  <div>
                    <span className="text-zinc-500 block text-[10px]">RULE ID</span>
                    <span className="text-zinc-200">{activeAlertDetail.alert.ruleId}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">CATEGORY</span>
                    <span className="text-zinc-200">{activeAlertDetail.alert.category}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">SOURCE TYPE</span>
                    <span className="text-zinc-200">{activeAlertDetail.alert.sourceType}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">CREATED AT</span>
                    <span className="text-zinc-200">{new Date(activeAlertDetail.alert.createdAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Originating Finding Deep Link */}
                {getSourceDeepLink(activeAlertDetail.alert) && (
                  <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-800/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ExternalLink size={14} className="text-cyan-400 shrink-0" />
                      <span className="text-xs text-cyan-200 font-sans">
                        View originating finding in {activeAlertDetail.alert.category.replace('_', ' ')} workspace
                      </span>
                    </div>
                    <Link
                      to={getSourceDeepLink(activeAlertDetail.alert)}
                      className="px-2.5 py-1 rounded bg-cyan-900/60 hover:bg-cyan-800 text-cyan-200 text-xs font-mono transition-colors"
                    >
                      Navigate
                    </Link>
                  </div>
                )}

                {/* Deterministic Evidence JSON */}
                <div className="space-y-1.5">
                  <div className="text-xs font-bold font-mono text-zinc-300">Deterministic Evidence & Metrics</div>
                  <pre className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-48">
                    {JSON.stringify(activeAlertDetail.alert.evidence, null, 2)}
                  </pre>
                </div>

                {/* Team Assignment Section */}
                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                      <UserCheck size={14} className="text-cyan-400" />
                      Assignee
                    </span>
                    <select
                      value={activeAlertDetail.alert.assignedUserId || ''}
                      onChange={(e) => handleAssign(activeAlertDetail.alert.id, e.target.value || null)}
                      disabled={isSubmittingAction}
                      className="px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs focus:outline-none"
                    >
                      <option value="">Unassigned</option>
                      {assignees.map(u => (
                        <option key={u.id} value={u.id}>@{u.login} ({u.name || 'Engineer'})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Lifecycle Actions */}
                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-3 font-mono text-xs">
                  <div className="font-semibold text-zinc-200">Incident State Transitions</div>

                  <div className="flex flex-wrap gap-2">
                    {activeAlertDetail.alert.status === 'OPEN' && (
                      <button
                        onClick={() => handleAcknowledge(activeAlertDetail.alert.id)}
                        disabled={isSubmittingAction}
                        className="px-3 py-1.5 rounded bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 transition-colors"
                      >
                        Acknowledge Alert
                      </button>
                    )}

                    {activeAlertDetail.alert.status !== 'RESOLVED' && (
                      <button
                        onClick={() => { setIsResolving(!isResolving); setIsDismissing(false); }}
                        className="px-3 py-1.5 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 transition-colors"
                      >
                        Resolve Alert...
                      </button>
                    )}

                    {activeAlertDetail.alert.status !== 'DISMISSED' && (
                      <button
                        onClick={() => { setIsDismissing(!isDismissing); setIsResolving(false); }}
                        className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors"
                      >
                        Dismiss Alert...
                      </button>
                    )}

                    {(activeAlertDetail.alert.status === 'RESOLVED' || activeAlertDetail.alert.status === 'DISMISSED') && (
                      <button
                        onClick={() => handleReopen(activeAlertDetail.alert.id)}
                        disabled={isSubmittingAction}
                        className="px-3 py-1.5 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 transition-colors"
                      >
                        Reopen Alert
                      </button>
                    )}
                  </div>

                  {/* Resolution Input Prompt */}
                  {isResolving && (
                    <div className="p-3 rounded bg-zinc-950 border border-emerald-800/60 space-y-2 mt-2">
                      <span className="text-[11px] text-emerald-400 block font-sans">
                        Provide deterministic resolution explanation or commit reference:
                      </span>
                      <input
                        type="text"
                        placeholder="e.g., Upgraded package in package.json to patched version"
                        value={actionNote}
                        onChange={(e) => setActionNote(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setIsResolving(false)}
                          className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleResolve(activeAlertDetail.alert.id)}
                          disabled={isSubmittingAction}
                          className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold text-xs"
                        >
                          Confirm Resolve
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Dismissal Input Prompt */}
                  {isDismissing && (
                    <div className="p-3 rounded bg-zinc-950 border border-zinc-700 space-y-2 mt-2">
                      <span className="text-[11px] text-zinc-400 block font-sans">
                        Provide dismissal reason (e.g. acceptable risk, dev-only mock):
                      </span>
                      <input
                        type="text"
                        placeholder="e.g., Verified not exposed to public network"
                        value={actionNote}
                        onChange={(e) => setActionNote(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setIsDismissing(false)}
                          className="px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDismiss(activeAlertDetail.alert.id)}
                          disabled={isSubmittingAction}
                          className="px-3 py-1 rounded bg-zinc-200 text-zinc-950 font-semibold text-xs hover:bg-zinc-100"
                        >
                          Confirm Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Collaboration Comments */}
                <div className="space-y-3 font-mono">
                  <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                    <MessageSquare size={14} className="text-cyan-400" />
                    Team Discussion ({activeAlertDetail.comments?.length || 0})
                  </div>

                  {/* Comments list */}
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {(!activeAlertDetail.comments || activeAlertDetail.comments.length === 0) ? (
                      <div className="text-[11px] text-zinc-500 italic font-sans py-2">
                        No comments posted yet. Add a note below.
                      </div>
                    ) : (
                      activeAlertDetail.comments.map(c => (
                        <div key={c.id} className="p-2.5 rounded bg-zinc-900 border border-zinc-800 text-xs space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-zinc-500">
                            <span className="text-cyan-400 font-semibold">@{c.user?.login || 'engineer'}</span>
                            <span>{new Date(c.createdAt).toLocaleTimeString()}</span>
                          </div>
                          <div className="text-zinc-200 font-sans">{c.content}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Comment Input */}
                  <form onSubmit={handlePostComment} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add investigation note or comment..."
                      value={commentContent}
                      onChange={(e) => setCommentContent(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-cyan-700 font-sans"
                    />
                    <button
                      type="submit"
                      disabled={!commentContent.trim() || isSubmittingAction}
                      className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-zinc-950 font-semibold text-xs transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      <Send size={12} />
                      <span>Post</span>
                    </button>
                  </form>
                </div>

                {/* Immutable Audit Activity Trail */}
                <div className="space-y-3 font-mono">
                  <div className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                    <History size={14} className="text-cyan-400" />
                    Immutable Audit Trail
                  </div>

                  <div className="border-l-2 border-zinc-800 pl-3 space-y-3">
                    {(activeAlertDetail.activities || []).map((act, i) => (
                      <div key={act.id || i} className="text-xs space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-cyan-300 text-[10px] font-bold">
                            {act.action}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(act.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-zinc-400 text-[11px] font-sans">
                          {act.note || 'System activity logged'}
                          {act.user && <span className="text-zinc-500 ml-1">by @{act.user.login}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
