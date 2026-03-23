import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { listContentTypes } from '../lib/contentful-client.js';

export function ContentTypePicker({ token, spaceId, envId, value, onChange, label }) {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!token || !spaceId || !envId) { setTypes([]); return; }
    let c = false;
    setLoading(true);
    listContentTypes(token, spaceId, envId)
      .then(t => { if (!c) setTypes(t); })
      .catch(() => {})
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [token, spaceId, envId]);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const sel = types.find(t => t.id === value);
  const filtered = types.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase())
  );

  return html`<div class="dropdown" ref=${ref}>
    <label class="text-xs font-semibold text-muted">${label || 'Content Type'}</label>
    <button class="dropdown-trigger" style="width:100%;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:.5rem;padding:.5rem .75rem;font-size:.875rem" onClick=${() => setOpen(!open)}>
      <span class=${value ? '' : 'text-muted'}>${loading ? 'Loading...' : types.length === 0 ? 'Enter space ID first' : sel ? `${sel.name} (${sel.id})` : 'Select content type'}</span>
      <span class="text-muted text-xs">${open ? '▲' : '▼'}</span>
    </button>
    ${open && types.length > 0 && html`<div class="dropdown-panel">
      <div class="dropdown-search"><input value=${search} onInput=${e => setSearch(e.target.value)} placeholder="Search..." autofocus /></div>
      <div class="dropdown-list">
        ${filtered.map(ct => html`<button key=${ct.id} class="dropdown-item ${value === ct.id ? 'selected' : ''}" onClick=${() => { onChange(ct.id); setOpen(false); setSearch(''); }}>
          <span style="flex:1">${ct.name}</span><span class="text-xs text-muted font-mono">${ct.id}</span>
        </button>`)}
        ${filtered.length === 0 && html`<div class="text-xs text-muted" style="padding:.5rem;text-align:center">No matches</div>`}
      </div>
    </div>`}
  </div>`;
}
