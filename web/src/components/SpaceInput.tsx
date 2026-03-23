'use client';

export function SpaceInput({
  label,
  spaceId,
  envId,
  onSpaceChange,
  onEnvChange,
}: {
  label: string;
  spaceId: string;
  envId: string;
  onSpaceChange: (v: string) => void;
  onEnvChange: (v: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-muted mb-1">{label}</legend>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-muted mb-1">Space ID</label>
          <input
            type="text"
            value={spaceId}
            onChange={e => onSpaceChange(e.target.value)}
            placeholder="e.g. vsw90ltyito7"
            className="w-full"
          />
        </div>
        <div className="w-40">
          <label className="block text-xs text-muted mb-1">Environment</label>
          <input
            type="text"
            value={envId}
            onChange={e => onEnvChange(e.target.value)}
            placeholder="e.g. master"
            className="w-full"
          />
        </div>
      </div>
    </fieldset>
  );
}
