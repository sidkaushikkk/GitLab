import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  AlertCircle
} from 'lucide-react';

export function FileTreeNode({ node, activePath, onSelectFile, level = 0 }) {
  const [isOpen, setIsOpen] = useState(true);
  const isDirectory = node.type === 'directory';
  const isSelected = node.path === activePath;

  const handleClick = () => {
    if (isDirectory) {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        className={`flex items-center justify-between py-1.5 pr-2 rounded cursor-pointer text-xs font-mono select-none transition-colors group ${
          isSelected
            ? 'bg-cyan-950/60 text-cyan-300 font-semibold'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isDirectory ? (
            <>
              {isOpen ? (
                <ChevronDown size={13} className="text-zinc-500 shrink-0" />
              ) : (
                <ChevronRight size={13} className="text-zinc-500 shrink-0" />
              )}
              {isOpen ? (
                <FolderOpen size={14} className="text-cyan-400/80 shrink-0" />
              ) : (
                <Folder size={14} className="text-cyan-400/80 shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-3.5" />
              <FileCode size={14} className={isSelected ? 'text-cyan-400' : 'text-zinc-500 group-hover:text-zinc-400'} />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </div>

        {/* Issue / Security Indicators */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {node.hasSecurityIssue && (
            <ShieldAlert size={12} className="text-rose-400" title="Security finding inside" />
          )}
          {node.issuesCount > 0 && !node.hasSecurityIssue && (
            <span className="text-[10px] px-1 py-0.2 rounded bg-zinc-800 text-zinc-400 font-mono">
              {node.issuesCount}
            </span>
          )}
        </div>
      </div>

      {isDirectory && isOpen && node.children && (
        <div className="space-y-0.5">
          {node.children.map((child, i) => (
            <FileTreeNode
              key={child.path || i}
              node={child}
              activePath={activePath}
              onSelectFile={onSelectFile}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ tree, activePath, onSelectFile }) {
  return (
    <div className="w-full h-full overflow-y-auto p-1.5 space-y-0.5 divide-y divide-transparent">
      {tree.map((node, idx) => (
        <FileTreeNode
          key={node.path || idx}
          node={node}
          activePath={activePath}
          onSelectFile={onSelectFile}
          level={0}
        />
      ))}
    </div>
  );
}
