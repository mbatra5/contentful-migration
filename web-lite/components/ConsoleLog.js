import { html, useState, useEffect, useRef } from '../lib/preact.js';

const LOG_COLORS = { info: '#cbd5e1', success: '#4ade80', warning: '#facc15', error: '#f87171' };

export function ConsoleLog({ log }) {
  const [entries, setEntries] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    const unsub = log.subscribe(() => setEntries([...log.getEntries()]));
    return () => { unsub(); };
  }, [log]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [entries.length]);

  const download = () => {
    const b = new Blob([log.toText()], { type: 'text/plain' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u;
    a.download = `log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(u);
  };

  return html`<div class="console">
    <div class="console-header">
      <span class="font-mono text-xs text-muted">Console Output</span>
      <div class="flex">
        <button class="console-btn text-muted" onClick=${() => { log.clear(); setEntries([]); }}>Clear</button>
        <button class="console-btn text-primary" onClick=${download}>Download Log</button>
      </div>
    </div>
    <div class="console-body">
      ${entries.length === 0 && html`<span class="text-muted">Waiting for operation...</span>`}
      ${entries.map((e, i) => html`<div key=${i} style="color:${LOG_COLORS[e.level] || LOG_COLORS.info}">
        <span class="text-muted" style="margin-right:.5rem">${e.ts.toLocaleTimeString()}</span>${e.message}
      </div>`)}
      <div ref=${bottomRef} />
    </div>
  </div>`;
}
