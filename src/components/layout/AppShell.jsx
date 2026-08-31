import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { AIChatPanel } from '../ai/AIChat';
import { GlobalSearchModal } from './GlobalSearchModal';
import { ToastContainer } from '../common/ToastContainer';
import { useApp } from '../../context/AppContext';
import { ErrorBoundary } from '../common/ErrorBoundary';

export function AppShell() {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { isAiPanelOpen } = useApp();

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-zinc-100 flex flex-col antialiased">
      <GlobalSearchModal />
      <ToastContainer />

      <div className="flex flex-1 min-h-[100dvh]">
        {/* Responsive Sidebar */}
        <Sidebar
          isMobileOpen={isMobileSidebarOpen}
          onMobileClose={() => setIsMobileSidebarOpen(false)}
        />

        {/* Main Application Column */}
        <div className="flex flex-col flex-1 min-w-0">
          <TopBar
            onMobileMenuToggle={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          />

          {/* Main Content Area with adaptive margin when AI panel is open */}
          <main className={`flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto transition-all ${
            isAiPanelOpen ? 'xl:mr-[420px]' : ''
          }`}>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>

        {/* Persistent Right Side AI Drawer */}
        <AIChatPanel />
      </div>
    </div>
  );
}
