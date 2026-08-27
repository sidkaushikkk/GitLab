import React from 'react';

export function RiskBadge({ level, size = 'md' }) {
  const normalized = (level || 'LOW').toUpperCase();

  const styles = {
    CRITICAL: 'bg-rose-950/60 text-rose-300 border-rose-800/60 font-semibold',
    HIGH: 'bg-orange-950/60 text-orange-300 border-orange-800/60 font-semibold',
    MEDIUM: 'bg-amber-950/60 text-amber-300 border-amber-800/60 font-medium',
    LOW: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60 font-medium'
  };

  const sizeClasses = {
    sm: 'text-[11px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
    lg: 'text-xs px-2.5 py-1'
  };

  const activeStyle = styles[normalized] || styles.LOW;
  const activeSize = sizeClasses[size] || sizeClasses.md;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded border font-mono uppercase tracking-wider ${activeSize} ${activeStyle}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {normalized}
    </span>
  );
}

export function SeverityBadge({ severity, size = 'md' }) {
  return <RiskBadge level={severity} size={size} />;
}
