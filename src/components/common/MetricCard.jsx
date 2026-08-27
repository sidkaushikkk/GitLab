import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

export function MetricCard({
  title,
  value,
  subtitle,
  change,
  changeDirection = 'up',
  status = 'neutral',
  icon: Icon,
  badge,
  onClick
}) {
  const statusColors = {
    emerald: 'text-emerald-400 border-emerald-900/30 bg-emerald-950/20',
    cyan: 'text-cyan-400 border-cyan-900/30 bg-cyan-950/20',
    amber: 'text-amber-400 border-amber-900/30 bg-amber-950/20',
    rose: 'text-rose-400 border-rose-900/30 bg-rose-950/20',
    neutral: 'text-zinc-300 border-zinc-800 bg-zinc-900/40'
  };

  return (
    <div
      onClick={onClick}
      className={`relative p-4 rounded-lg bg-zinc-900/70 border border-zinc-800/80 transition-all ${
        onClick ? 'cursor-pointer hover:border-zinc-700 hover:bg-zinc-900' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-zinc-400 tracking-wide">{title}</span>
        {Icon && (
          <div className="p-1.5 rounded-md bg-zinc-800/60 text-zinc-300 border border-zinc-750">
            <Icon size={14} />
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold font-mono tracking-tight text-zinc-100">{value}</span>
        {badge && (
          <span className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
            {badge}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        {subtitle && <span className="text-zinc-400">{subtitle}</span>}
        {change && (
          <span
            className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-medium ${
              changeDirection === 'up'
                ? 'text-emerald-400'
                : changeDirection === 'down'
                ? 'text-rose-400'
                : 'text-zinc-400'
            }`}
          >
            {changeDirection === 'up' && <ArrowUpRight size={12} />}
            {changeDirection === 'down' && <ArrowDownRight size={12} />}
            {changeDirection === 'neutral' && <Minus size={12} />}
            {change}
          </span>
        )}
      </div>
    </div>
  );
}

export function HealthScoreGauge({ score, size = 'md', label = 'Health Score' }) {
  const getGrade = (val) => {
    if (val >= 90) return { grade: 'A+', color: 'text-emerald-400', stroke: '#10b981' };
    if (val >= 80) return { grade: 'A', color: 'text-cyan-400', stroke: '#06b6d4' };
    if (val >= 70) return { grade: 'B', color: 'text-amber-400', stroke: '#f59e0b' };
    if (val >= 60) return { grade: 'C', color: 'text-orange-400', stroke: '#f97316' };
    return { grade: 'F', color: 'text-rose-400', stroke: '#f43f5e' };
  };

  const { grade, color, stroke } = getGrade(score);

  const radius = size === 'lg' ? 44 : size === 'sm' ? 24 : 32;
  const strokeWidth = size === 'lg' ? 6 : size === 'sm' ? 4 : 5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const svgSize = (radius + strokeWidth) * 2;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center justify-center">
        <svg width={svgSize} height={svgSize} className="transform -rotate-90">
          <circle
            cx={radius + strokeWidth}
            cy={radius + strokeWidth}
            r={radius}
            stroke="#27272a"
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          <circle
            cx={radius + strokeWidth}
            cy={radius + strokeWidth}
            r={radius}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className={`font-mono font-bold ${size === 'lg' ? 'text-lg' : 'text-xs'} ${color}`}>
            {score}
          </span>
        </div>
      </div>
      <div>
        <div className="text-xs text-zinc-400 font-medium">{label}</div>
        <div className={`font-mono font-bold text-sm ${color}`}>Grade {grade}</div>
      </div>
    </div>
  );
}
