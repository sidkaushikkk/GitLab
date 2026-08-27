import React from 'react';
import { Inbox, AlertCircle, RefreshCw } from 'lucide-react';

export function EmptyState({
  title = 'No items found',
  description = 'Try adjusting your search query or filter options.',
  icon: Icon = Inbox,
  actionLabel,
  onAction
}) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40">
      <div className="p-3 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 mb-3">
        <Icon size={20} />
      </div>
      <h4 className="text-sm font-semibold text-zinc-200 mb-1">{title}</h4>
      <p className="text-xs text-zinc-400 max-w-sm mb-4">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorState({ title = 'Failed to load data', error, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center rounded-lg border border-rose-900/30 bg-rose-950/10">
      <div className="p-3 rounded-full bg-rose-900/20 border border-rose-800/40 text-rose-400 mb-3">
        <AlertCircle size={20} />
      </div>
      <h4 className="text-sm font-semibold text-zinc-200 mb-1">{title}</h4>
      <p className="text-xs text-zinc-400 max-w-sm mb-4 font-mono">{error || 'An unexpected error occurred during API fetch.'}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 transition-colors"
        >
          <RefreshCw size={12} />
          Retry Request
        </button>
      )}
    </div>
  );
}

export function LoadingSkeleton({ rows = 4, height = 'h-10' }) {
  return (
    <div className="w-full space-y-2.5 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`w-full ${height} bg-zinc-900/80 rounded-md border border-zinc-800/50`} />
      ))}
    </div>
  );
}
