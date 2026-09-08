import React, { useState, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { codeService } from "../services/codeService";
import {
  Code2,
  FolderTree,
  FileCode,
  ChevronRight,
  FolderGit2
} from "lucide-react";
import { FileTree } from "../components/code/FileTree";
import { CodeViewer } from "../components/code/CodeViewer";
import { EmptyState } from "../components/common/EmptyState";
import { useLocation, useNavigate } from "react-router-dom";

export function CodeExplorerPage({ headless = false, repoId = null }) {
  const { currentRepo } = useApp();
  const targetRepoId = repoId || currentRepo?.id;
  const location = useLocation();
  const navigate = useNavigate();
  const [fileTree, setFileTree] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [fileContentData, setFileContentData] = useState(null);
  const [highlightedLine, setHighlightedLine] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadTree() {
      if (!targetRepoId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const tree = await codeService.getFileTree(targetRepoId);
      setFileTree(tree || []);

      const searchParams = new URLSearchParams(location.search);
      const queryFile = searchParams.get("file");
      const queryLine = searchParams.get("line") ? parseInt(searchParams.get("line"), 10) : null;

      // Find first file in tree if available
      const firstFilePath = tree && tree.length > 0
        ? (tree[0].type === "file" ? tree[0].path : tree[0].children?.[0]?.path)
        : null;
      const targetFile = location.state?.file || queryFile || firstFilePath;
      const targetLine = location.state?.line || queryLine || null;

      setActiveFilePath(targetFile);
      setHighlightedLine(targetLine);

      if (targetFile) {
        const content = await codeService.getFileContent(targetFile, targetRepoId);
        setFileContentData(content);
      } else {
        setFileContentData(null);
      }
      setIsLoading(false);
    }
    loadTree();
  }, [targetRepoId, location.state, location.search]);

  const handleSelectFile = async (path) => {
    setActiveFilePath(path);
    setHighlightedLine(null);
    const content = await codeService.getFileContent(path, targetRepoId);
    setFileContentData(content);
  };

  if (!currentRepo && !targetRepoId) {
    return (
      <div className="py-12">
        <EmptyState
          icon={FolderGit2}
          title="No repository selected"
          description="Select or connect a repository to explore repository source files and AST line diagnostics."
          actionLabel="Connect Repository"
          onAction={() => navigate("/connect")}
        />
      </div>
    );
  }

  const repoName = currentRepo?.name || "Repository";
  const pathParts = activeFilePath ? activeFilePath.split("/") : [];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Header Bar — hidden when embedded inside RepositoryDetailPage */}
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h1 className="text-xl font-bold font-mono text-zinc-100 flex items-center gap-2.5">
              <Code2 size={20} className="text-cyan-400" />
              Code Explorer & Static Analysis
            </h1>
            <p className="text-xs text-zinc-400 mt-0.5 font-sans">
              Snapshot repository browser with inline AST diagnostic annotations, CWE alerts, and complexity markers.
            </p>
          </div>
        </div>
      )}

      {/* Explorer Grid */}
      {fileTree.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 h-[680px]">
          {/* Left: File Tree Explorer (1 column) */}
          <div className="md:col-span-1 rounded-xl border border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden">
            <div className="p-2.5 border-b border-zinc-800 bg-zinc-900/70 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-zinc-200">
                <FolderTree size={14} className="text-cyan-400" />
                <span>Files</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[120px]">{repoName}</span>
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
            {activeFilePath && (
              <div className="flex items-center gap-1.5 mb-2 font-mono text-xs text-zinc-400 bg-zinc-900/60 px-3 py-1.5 rounded-lg border border-zinc-800">
                <span className="text-cyan-400 font-semibold">{repoName}</span>
                {pathParts.map((part, idx) => (
                  <React.Fragment key={idx}>
                    <ChevronRight size={12} className="text-zinc-600" />
                    <span className={idx === pathParts.length - 1 ? "text-zinc-100 font-bold" : "text-zinc-400"}>
                      {part}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}

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
      ) : (
        <div className="p-12 text-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50">
          <FileCode size={32} className="mx-auto text-zinc-600 mb-3" />
          <h4 className="text-sm font-bold font-mono text-zinc-200 mb-1">
            No source files available in snapshot
          </h4>
          <p className="text-xs text-zinc-400 max-w-md mx-auto font-sans leading-relaxed">
            Ingest or upload a snapshot for this repository to browse source files and inspect diagnostic line markers.
          </p>
        </div>
      )}
    </div>
  );
}
