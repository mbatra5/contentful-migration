'use client';
import type { AnalysisResult } from '@/lib/operations';

export function AnalysisPanel({
  analysis,
  onProceed,
  proceedLabel,
  busy,
  hideButton,
}: {
  analysis: AnalysisResult;
  onProceed?: () => void;
  proceedLabel?: string;
  busy?: boolean;
  hideButton?: boolean;
}) {
  return (
    <div className="bg-card p-5 rounded-xl border border-border space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tree: {analysis.rootTitle}</h3>
        <span className="text-xs px-2 py-0.5 bg-warning/20 text-warning rounded-full">
          {analysis.totalEntries} entries &middot; {analysis.totalAssets} assets
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Object.entries(analysis.contentTypeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <div key={type} className="flex justify-between bg-background rounded px-3 py-1.5 text-xs">
              <span className="font-mono truncate mr-2">{type}</span>
              <span className="font-bold text-primary">{count}</span>
            </div>
          ))}
      </div>

      <details>
        <summary className="text-xs text-muted cursor-pointer hover:text-foreground">
          Entry tree ({analysis.entries.length} nodes, depth {analysis.maxDepthReached})
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto bg-background rounded-lg p-3 text-xs font-mono space-y-0.5">
          {analysis.entries.map(e => (
            <div key={e.id} style={{ paddingLeft: e.depth * 16 }} className="flex gap-2">
              <span className="text-muted">{e.depth > 0 ? '└─' : '●'}</span>
              <span className="text-primary">{e.contentType}</span>
              <span className="text-foreground truncate">{e.title || e.id}</span>
              {e.refCount > 0 && <span className="text-muted">({e.refCount} refs)</span>}
              {e.assetCount > 0 && <span className="text-warning">({e.assetCount} assets)</span>}
            </div>
          ))}
        </div>
      </details>

      {!hideButton && proceedLabel && onProceed && (
        <button
          onClick={onProceed}
          disabled={busy}
          className="w-full px-4 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
        >
          {proceedLabel}
        </button>
      )}
    </div>
  );
}
