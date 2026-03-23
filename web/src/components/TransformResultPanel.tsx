'use client';
import type { TransformResult } from '@/lib/operations';

export function TransformResultPanel({ result }: { result: TransformResult }) {
  return (
    <div className="bg-card p-6 rounded-xl border border-border">
      <h2 className="font-semibold mb-3">Transform Complete</h2>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="Updated" value={result.updated} color="text-success" />
        <Stat label="Skipped" value={result.skipped} color="text-warning" />
        <Stat label="Failed" value={result.failed} color="text-error" />
      </div>
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
