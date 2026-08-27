import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { OverviewPage } from '../pages/OverviewPage';
import { RepositoriesPage } from '../pages/RepositoriesPage';
import { RepositoryDetailPage } from '../pages/RepositoryDetailPage';
import { ConnectPage } from '../pages/ConnectPage';
import { PullRequestsPage } from '../pages/PullRequestsPage';
import { PullRequestDetailPage } from '../pages/PullRequestDetailPage';
import { CodeHealthPage } from '../pages/CodeHealthPage';
import { SecurityPage } from '../pages/SecurityPage';
import { ApiReliabilityPage } from '../pages/ApiReliabilityPage';
import { DependenciesPage } from '../pages/DependenciesPage';
import { CodeGraphPage } from '../pages/CodeGraphPage';
import { CodeExplorerPage } from '../pages/CodeExplorerPage';
import { AIAssistantPage } from '../pages/AIAssistantPage';
import { SettingsPage } from '../pages/SettingsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/repositories" element={<RepositoriesPage />} />
        <Route path="/repository/:id" element={<RepositoryDetailPage />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/repository/select" element={<Navigate to="/connect" replace />} />
        <Route path="/repository/analyzing" element={<Navigate to="/connect" replace />} />
        <Route path="/pulls" element={<PullRequestsPage />} />
        <Route path="/pulls/:id" element={<PullRequestDetailPage />} />
        <Route path="/code-health" element={<CodeHealthPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/api-reliability" element={<ApiReliabilityPage />} />
        <Route path="/dependencies" element={<DependenciesPage />} />
        <Route path="/code-graph" element={<CodeGraphPage />} />
        <Route path="/code" element={<CodeExplorerPage />} />
        <Route path="/ai" element={<AIAssistantPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
