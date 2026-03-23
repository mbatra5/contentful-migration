'use client';
import { useState, useEffect, useRef } from 'react';
import { listContentTypes } from '@/lib/contentful-client';

interface ContentType {
  id: string;
  name: string;
}

export function ContentTypePicker({
  token,
  spaceId,
  envId,
  value,
  onChange,
  label = 'Content Type',
}: {
  token: string;
  spaceId: string;
  envId: string;
  value: string;
  onChange: (id: string) => void;
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

  const selected = types.find(t => t.id === value);

  const filtered = types.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-1.5" ref={ref}>
      <label className="block text-xs font-semibold text-muted">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center justify-between hover:border-primary/40 transition-colors"
      >
        <span className={value ? 'text-foreground' : 'text-muted'}>
          {loading ? 'Loading...' :
           types.length === 0 ? 'Enter space ID first' :
           selected ? `${selected.name} (${selected.id})` :
           value || 'Select content type'}
        </span>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && types.length > 0 && (
        <div className="bg-card border border-border rounded-lg shadow-lg overflow-hidden z-10 relative">
          <div className="p-2 border-b border-border">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search content types..."
              className="w-full text-xs !py-1.5 !px-2"
              autoFocus
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {filtered.map(ct => (
              <button
                key={ct.id}
                onClick={() => { onChange(ct.id); setOpen(false); setSearch(''); }}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  value === ct.id ? 'bg-primary/15 text-primary' : 'hover:bg-card-hover'
                }`}
              >
                <span className="flex-1">{ct.name}</span>
                <span className="text-xs text-muted font-mono">{ct.id}</span>
              </button>
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
