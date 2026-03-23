'use client';
import { useState, useEffect, useRef } from 'react';
import { listContentTypes } from '@/lib/contentful-client';

interface ContentType {
  id: string;
  name: string;
}

export function ContentTypeSelect({
  token,
  spaceId,
  envId,
  selected,
  onChange,
  label = 'Skip Types',
}: {
  token: string;
  spaceId: string;
  envId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [types, setTypes] = useState<ContentType[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token || !spaceId || !envId) { setTypes([]); return; }
    let cancelled = false;
    setLoading(true);
    listContentTypes(token, spaceId, envId)
      .then(cts => { if (!cancelled) setTypes(cts); })
      .catch(() => { if (!cancelled) setTypes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, spaceId, envId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  const selectAll = () => onChange(filtered.map(t => t.id));
  const clearAll = () => onChange([]);

  const filtered = types.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2" ref={ref}>
      <label className="block text-sm font-semibold text-muted">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center justify-between hover:border-primary/40 transition-colors"
      >
        <span className={selected.length > 0 ? 'text-foreground' : 'text-muted'}>
          {loading ? 'Loading content types...' :
           types.length === 0 ? 'Enter space ID first' :
           selected.length === 0 ? 'None selected (traverse all)' :
           `${selected.length} type${selected.length > 1 ? 's' : ''} selected`}
        </span>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(id => {
            const ct = types.find(t => t.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 bg-primary/20 text-primary text-xs px-2 py-0.5 rounded-full">
                {ct?.name || id}
                <button onClick={() => toggle(id)} className="hover:text-error">×</button>
              </span>
            );
          })}
        </div>
      )}

      {open && types.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border flex gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search content types..."
              className="flex-1 text-xs !py-1.5 !px-2"
              autoFocus
            />
            <button onClick={selectAll} className="text-xs text-primary hover:underline whitespace-nowrap">All</button>
            <button onClick={clearAll} className="text-xs text-error hover:underline whitespace-nowrap">None</button>
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {filtered.map(ct => (
              <label
                key={ct.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-card-hover cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(ct.id)}
                  onChange={() => toggle(ct.id)}
                  className="w-3.5 h-3.5 rounded"
                />
                <span className="flex-1">{ct.name}</span>
                <span className="text-xs text-muted font-mono">{ct.id}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="text-xs text-muted p-2 text-center">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
