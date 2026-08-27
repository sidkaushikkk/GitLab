import React, { useState } from 'react';
import { Copy, Check, FileCode, ShieldAlert, AlertTriangle, Info, Terminal } from 'lucide-react';

export function CodeViewer({ fileData, onLineClick, highlightedLine }) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (!fileData) return null;

  const lines = (fileData.content || '').split('\n');
  const issues = fileData.issues || [];

  const handleCopy = () => {
    navigator.clipboard.writeText(fileData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getIssueForLine = (lineNum) => {
    return issues.find(i => i.line === lineNum);
  };

  return (
    <div className="flex flex-col h-full rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900/90 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2 font-mono text-zinc-300 truncate">
          <FileCode size={14} className="text-cyan-400 shrink-0" />
          <span className="truncate">{fileData.path}</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 uppercase">
            {fileData.language || 'typescript'}
          </span>
          <span className="text-[11px] text-zinc-500 font-sans hidden sm:inline">
            {lines.length} lines
          </span>
        </div>

        <div className="flex items-center gap-2">
          {issues.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60">
              <ShieldAlert size={12} />
              {issues.length} {issues.length === 1 ? 'diagnostic' : 'diagnostics'}
            </span>
          )}

          <button
            onClick={() => setShowRaw(!showRaw)}
            className="hidden sm:inline-block px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors font-mono"
          >
            {showRaw ? 'Formatted' : 'Raw'}
          </button>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors font-mono"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Code Body */}
      <div className="flex-1 overflow-auto font-mono text-xs leading-relaxed divide-y divide-transparent">
        {showRaw ? (
          <pre className="p-4 text-zinc-300 font-mono whitespace-pre-wrap">{fileData.content}</pre>
        ) : (
          <div className="min-w-full">
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const issue = getIssueForLine(lineNum);
              const isHighlighted = highlightedLine === lineNum;

              return (
                <React.Fragment key={lineNum}>
                  <div
                    onClick={() => onLineClick && onLineClick(lineNum)}
                    className={`flex items-start group hover:bg-zinc-900/60 transition-colors ${
                      isHighlighted ? 'bg-cyan-950/40 border-l-2 border-cyan-400' : ''
                    } ${issue ? 'bg-rose-950/20' : ''}`}
                  >
                    {/* Line number */}
                    <span className="w-12 py-0.5 pr-3 text-right text-zinc-600 select-none group-hover:text-zinc-400 font-mono text-[11px] shrink-0">
                      {lineNum}
                    </span>

                    {/* Diagnostic Icon */}
                    <span className="w-5 py-0.5 flex items-center justify-center shrink-0">
                      {issue && (
                        <ShieldAlert
                          size={12}
                          className={
                            issue.severity === 'CRITICAL' || issue.severity === 'HIGH'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                          }
                        />
                      )}
                    </span>

                    {/* Code text */}
                    <pre className="flex-1 py-0.5 pr-4 text-zinc-200 overflow-x-auto whitespace-pre font-mono">
                      {renderSyntaxHighlight(line)}
                    </pre>
                  </div>

                  {/* Inline Diagnostic Banner */}
                  {issue && (
                    <div className="flex items-start gap-2 py-1.5 px-3 my-0.5 mx-12 rounded bg-zinc-900/90 border border-rose-900/40 text-xs font-sans">
                      <ShieldAlert size={14} className="text-rose-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold text-rose-300 text-[11px]">
                            [{issue.severity}] {issue.type}
                          </span>
                          <span className="text-zinc-400 text-[10px] font-mono">Line {lineNum}</span>
                        </div>
                        <p className="text-zinc-300 text-xs mt-0.5">{issue.message}</p>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Lightweight syntax token colorizer for JavaScript/TypeScript/JSON
function renderSyntaxHighlight(line) {
  if (!line) return <span> </span>;

  // Comments
  if (line.trim().startsWith('//')) {
    return <span className="text-zinc-500 italic">{line}</span>;
  }

  // Keywords
  const keywords = ['import', 'export', 'from', 'class', 'const', 'let', 'var', 'async', 'await', 'function', 'return', 'if', 'else', 'try', 'catch', 'public', 'private', 'new', 'interface', 'type'];
  const regex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');

  const parts = line.split(regex);
  return (
    <span>
      {parts.map((part, i) => {
        if (keywords.includes(part)) {
          return <span key={i} className="text-cyan-400 font-semibold">{part}</span>;
        }
        if (part.includes("'") || part.includes('"') || part.includes('`')) {
          return <span key={i} className="text-emerald-300/90">{part}</span>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

export function CodeDiff({ diffText, filename }) {
  const lines = (diffText || '').split('\n');

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden font-mono text-xs">
      {filename && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-[11px] text-zinc-300">
          <span className="font-medium">{filename}</span>
          <span className="text-zinc-500">Unified Diff</span>
        </div>
      )}

      <div className="overflow-x-auto divide-y divide-zinc-900/50 leading-relaxed">
        {lines.map((line, idx) => {
          const isAdd = line.startsWith('+') && !line.startsWith('+++');
          const isDel = line.startsWith('-') && !line.startsWith('---');
          const isHeader = line.startsWith('@@');

          return (
            <div
              key={idx}
              className={`flex items-start px-2 py-0.5 ${
                isAdd
                  ? 'bg-emerald-950/30 text-emerald-300 border-l-2 border-emerald-500'
                  : isDel
                  ? 'bg-rose-950/30 text-rose-300 border-l-2 border-rose-500'
                  : isHeader
                  ? 'bg-zinc-900 text-cyan-400/80 font-bold'
                  : 'text-zinc-300'
              }`}
            >
              <span className="w-8 select-none text-zinc-600 text-[10px] pr-2 text-right">
                {idx + 1}
              </span>
              <pre className="flex-1 whitespace-pre font-mono">{line}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
