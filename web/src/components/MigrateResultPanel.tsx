'use client';
import type { MigrateResult } from '@/lib/operations';

export function MigrateResultPanel({ result }: { result: MigrateResult }) {
  return (
    <div className="bg-card p-6 rounded-xl border border-border space-y-4">
      <h2 className="font-semibold">Migration Complete</h2>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="Created" value={result.created} color="text-success" />
        <Stat label="Skipped" value={result.skipped} color="text-warning" />
        <Stat label="Failed" value={result.failed} color="text-error" />
      </div>
      {Object.keys(result.remap).length > 0 && (
        <details>
          <summary className="text-sm text-muted cursor-pointer hover:text-foreground">
            ID Mapping ({Object.keys(result.remap).length} entries)
          </summary>
          <div className="mt-2 bg-background rounded-lg p-3 text-xs font-mono max-h-48 overflow-y-auto space-y-1">
            {Object.entries(result.remap).map(([src, tgt]) => (
              <div key={src}><span className="text-muted">{src}</span> → <span className="text-success">{tgt}</span></div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-background rounded-lg p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-muted text-xs">{label}</div>
    </div>
  );
}
