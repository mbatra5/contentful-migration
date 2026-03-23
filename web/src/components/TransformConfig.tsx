'use client';

export type TransformPreset = 'fix-broken-assets' | 'custom-rule';

export interface TransformState {
  preset: TransformPreset;
  contentType: string;
  draftOnly: boolean;
  publishedOnly: boolean;
  updatedByMe: boolean;
  nameContains: string;
  replacementEntryId: string;
  rule: 'set' | 'copy' | 'delete' | 'modify';
  field: string;
  targetLocale: string;
  sourceLocale: string;
  value: string;
  isJsonValue: boolean;
}

export function TransformConfig({
  state,
  onChange,
}: {
  state: TransformState;
  onChange: (s: TransformState) => void;
}) {
  const update = <K extends keyof TransformState>(key: K, val: TransformState[K]) =>
    onChange({ ...state, [key]: val });

  return (
    <div className="space-y-5">
      {/* Filters */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">Filters</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={state.draftOnly}
              onChange={e => onChange({ ...state, draftOnly: e.target.checked, publishedOnly: false })} className="w-4 h-4 rounded" />
            Draft only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={state.publishedOnly}
              onChange={e => onChange({ ...state, publishedOnly: e.target.checked, draftOnly: false })} className="w-4 h-4 rounded" />
            Published only
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={state.updatedByMe}
              onChange={e => update('updatedByMe', e.target.checked)} className="w-4 h-4 rounded" />
            Updated by me
          </label>
        </div>
        <div className="mt-3">
          <label className="block text-xs text-muted mb-1">Name contains <span className="text-muted/60">(optional)</span></label>
          <input type="text" value={state.nameContains} onChange={e => update('nameContains', e.target.value)}
            placeholder="e.g. QA — only entries whose name includes this text" className="w-full" />
        </div>
      </fieldset>

      {/* Preset selector */}
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">Action</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PresetCard
            active={state.preset === 'fix-broken-assets'}
            onClick={() => update('preset', 'fix-broken-assets')}
            title="Fix Broken Assets"
            desc="Check for broken/missing asset or entry references and replace them with a working entry."
          />
          <PresetCard
            active={state.preset === 'custom-rule'}
            onClick={() => update('preset', 'custom-rule')}
            title="Custom Rule"
            desc="Set, copy, delete, or modify field values across entries."
          />
        </div>
      </fieldset>

      {/* Fix Broken Assets config */}
      {state.preset === 'fix-broken-assets' && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted">Replacement Entry ID</label>
          <input type="text" value={state.replacementEntryId} onChange={e => update('replacementEntryId', e.target.value)}
            placeholder="e.g. 7GgQy8BHWnwSPt1ADlLBTx" className="w-full" />
          <p className="text-xs text-muted">
            Each entry&apos;s linked assets and entries will be checked. Broken references (404, empty, no URL) get replaced with this entry.
          </p>
        </div>
      )}

      {/* Custom Rule config */}
      {state.preset === 'custom-rule' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['set', 'copy', 'delete', 'modify'] as const).map(r => (
              <button key={r} onClick={() => update('rule', r)}
                className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  state.rule === r ? 'bg-primary text-white border-primary' : 'bg-background border-border text-muted hover:text-foreground'
                }`}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-xs text-muted">Field (leave empty for all)</label>
              <input type="text" value={state.field} onChange={e => update('field', e.target.value)}
                placeholder="e.g. image" className="w-full" />
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-muted">Target Locale</label>
              <input type="text" value={state.targetLocale} onChange={e => update('targetLocale', e.target.value)} className="w-full" />
            </div>
            {state.rule === 'copy' && (
              <div className="space-y-2">
                <label className="block text-xs text-muted">Source Locale</label>
                <input type="text" value={state.sourceLocale} onChange={e => update('sourceLocale', e.target.value)} className="w-full" />
              </div>
            )}
            {(state.rule === 'set' || state.rule === 'modify') && (
              <div className="space-y-2 col-span-full">
                <div className="flex items-center justify-between">
                  <label className="block text-xs text-muted">Value</label>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={state.isJsonValue}
                      onChange={e => update('isJsonValue', e.target.checked)} className="w-3 h-3 rounded" />
                    JSON
                  </label>
                </div>
                <textarea value={state.value} onChange={e => update('value', e.target.value)}
                  rows={state.isJsonValue ? 4 : 1}
                  placeholder={state.isJsonValue ? '{"sys": {"type": "Link", "linkType": "Asset", "id": "..."}}' : 'Plain text value'}
                  className="w-full font-mono text-xs" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PresetCard({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button onClick={onClick}
      className={`text-left p-4 rounded-lg border transition-all ${
        active
          ? 'bg-primary/10 border-primary'
          : 'bg-background border-border hover:border-primary/30'
      }`}>
      <div className={`text-sm font-semibold mb-1 ${active ? 'text-primary' : 'text-foreground'}`}>{title}</div>
      <div className="text-xs text-muted leading-relaxed">{desc}</div>
    </button>
  );
}
