import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { codeService } from '../services/codeService';
import {
  Code2,
  FolderTree,
  Search,
  FileCode,
  ShieldAlert,
  ChevronRight,
  Sparkles,
  Copy,
  ExternalLink
} from 'lucide-react';
import { FileTree } from '../components/code/FileTree';
import { CodeViewer } from '../components/code/CodeViewer';

export function CodeExplorerPage() {
  const { currentRepo, toggleAiPanel } = useApp();
  const [fileTree, setFileTree] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState('src/auth/AuthService.ts');
  const [fileContentData, setFileContentData] = useState(null);
  const [searchTree, setSearchTree] = useState('');
  const [highlightedLine, setHighlightedLine] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadTree() {
      setIsLoading(true);
      const tree = await codeService.getFileTree();
      setFileTree(tree);
      const content = await codeService.getFileContent(activeFilePath);
      setFileContentData(content);
      setIsLoading(false);
    }
    loadTree();
  }, [currentRepo.id]);

  const handleSelectFile = async (path) => {
    setActiveFilePath(path);
    setHighlightedLine(null);
    const content = await codeService.getFileContent(path);
    setFileContentData(content);
  };

  // Breadcrumbs parsing
  const pathParts = activeFilePath.split('/');

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
            <Code2 size={20} className="text-cyan-400" />
            Code Explorer & Static Analysis
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5 font-sans">
            Syntax-highlighted repository browser with inline diagnostic annotations, CWE alerts, and complexity markers.
          </p>
        </div>

        {/* Ask AI about this file CTA */}
        <button
          onClick={toggleAiPanel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-950/60 border border-cyan-800 text-cyan-300 hover:bg-cyan-900/60 text-xs font-mono transition-colors"
        >
          <Sparkles size={13} className="text-cyan-400" />
          <span>Ask AI about this file</span>
        </button>
      </div>

      {/* Explorer Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 h-[680px]">
        {/* Left: File Tree Explorer (1 column) */}
        <div className="md:col-span-1 rounded-xl border border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden">
          <div className="p-2.5 border-b border-zinc-800 bg-zinc-900/70 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-zinc-200">
              <FolderTree size={14} className="text-cyan-400" />
              <span>Files</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500">{currentRepo.name}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <FileTree
              tree={fileTree}
              activePath={activeFilePath}
              onSelectFile={handleSelectFile}
            />
          </div>
        </div>

        {/* Right: Code Viewer (3 columns) */}
        <div className="md:col-span-3 flex flex-col h-full">
          {/* Breadcrumb path bar */}
          <div className="flex items-center gap-1.5 mb-2 font-mono text-xs text-zinc-400 bg-zinc-900/60 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-cyan-400 font-semibold">{currentRepo.name}</span>
            {pathParts.map((part, idx) => (
              <React.Fragment key={idx}>
                <ChevronRight size={12} className="text-zinc-600" />
                <span className={idx === pathParts.length - 1 ? 'text-zinc-100 font-bold' : 'text-zinc-400'}>
                  {part}
                </span>
              </React.Fragment>
            ))}
          </div>

          {/* Code Viewer Panel */}
          <div className="flex-1 overflow-hidden">
            <CodeViewer
              fileData={fileContentData}
              highlightedLine={highlightedLine}
              onLineClick={(lineNum) => setHighlightedLine(lineNum)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
