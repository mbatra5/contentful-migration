'use client';
import { useEffect, useRef } from 'react';
import type { LogEntry } from '@/lib/logger';

const levelColors: Record<string, string> = {
  info: 'text-slate-300',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
};

export function ConsoleLog({
  entries,
  onDownload,
  onClear,
}: {
  entries: LogEntry[];
  onDownload: () => void;
  onClear: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  return (
    <div className="flex flex-col rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] border-b border-border">
        <span className="text-xs font-mono text-muted">Console Output</span>
        <div className="flex gap-2">
          <button
            onClick={onClear}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onDownload}
            className="text-xs text-primary hover:text-primary-hover transition-colors"
          >
            Download Log
          </button>
        </div>
      </div>
      <div className="bg-[#0d1117] p-4 h-80 overflow-y-auto font-mono text-xs leading-relaxed">
        {entries.length === 0 && (
          <span className="text-muted">Waiting for operation...</span>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={levelColors[entry.level] || 'text-slate-300'}>
            <span className="text-muted mr-2">
              {entry.timestamp.toLocaleTimeString()}
            </span>
            {entry.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
