import React from 'react';
import { Search, X } from 'lucide-react';

export function SearchBar({ value, onChange, placeholder = 'Search...', className = '' }) {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search size={14} className="absolute left-3 text-zinc-500 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-500 text-xs rounded-md pl-8 pr-8 py-2 focus:outline-none focus:border-cyan-500/80 transition-colors font-mono"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 p-0.5"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function FilterPills({ options, selected, onSelect }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1">
      {options.map((opt) => {
        const isSelected = selected === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors whitespace-nowrap font-mono ${
              isSelected
                ? 'bg-zinc-100 text-zinc-900 font-semibold'
                : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200 hover:bg-zinc-850'
            }`}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={`ml-1.5 text-[10px] px-1 py-0.2 rounded ${isSelected ? 'bg-zinc-300 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
