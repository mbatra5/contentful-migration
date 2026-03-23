import { html, useState, useEffect, useRef } from '../lib/preact.js';
import { listContentTypes } from '../lib/contentful-client.js';

export function ContentTypeMultiSelect({ token, spaceId, envId, selected, onChange, label }) {
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

  const toggle = id => onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  const filtered = types.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase())
  );

  return html`<div class="dropdown" ref=${ref}>
    <label class="text-xs font-semibold text-muted">${label || 'Skip Types'}</label>
    <button class="dropdown-trigger" style="width:100%;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:.5rem;padding:.5rem .75rem;font-size:.875rem" onClick=${() => setOpen(!open)}>
      <span class=${selected.length > 0 ? '' : 'text-muted'}>${loading ? 'Loading...' : types.length === 0 ? 'Enter space ID first' : selected.length === 0 ? 'None (traverse all)' : `${selected.length} selected`}</span>
      <span class="text-muted text-xs">${open ? '▲' : '▼'}</span>
    </button>
    ${selected.length > 0 && html`<div class="flex" style="flex-wrap:wrap;gap:.375rem;margin-top:.375rem">
      ${selected.map(id => {
        const ct = types.find(t => t.id === id);
        return html`<span key=${id} class="pill">${ct?.name || id}<button onClick=${() => toggle(id)}>×</button></span>`;
      })}
    </div>`}
    ${open && types.length > 0 && html`<div class="dropdown-panel">
      <div class="dropdown-search" style="display:flex;gap:.5rem">
        <input value=${search} onInput=${e => setSearch(e.target.value)} placeholder="Search..." autofocus style="flex:1" />
        <button class="text-xs text-primary" onClick=${() => onChange(filtered.map(t => t.id))}>All</button>
        <button class="text-xs text-error" onClick=${() => onChange([])}>None</button>
      </div>
      <div class="dropdown-list">
        ${filtered.map(ct => html`<label key=${ct.id} class="dropdown-item" style="cursor:pointer">
          <input type="checkbox" checked=${selected.includes(ct.id)} onChange=${() => toggle(ct.id)} style="width:.875rem;height:.875rem" />
          <span style="flex:1">${ct.name}</span><span class="text-xs text-muted font-mono">${ct.id}</span>
        </label>`)}
        ${filtered.length === 0 && html`<div class="text-xs text-muted" style="padding:.5rem;text-align:center">No matches</div>`}
      </div>
    </div>`}
  </div>`;
}
