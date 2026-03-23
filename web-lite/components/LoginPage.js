import { html, useState, useRef } from '../lib/preact.js';

export function LoginPage({ onLogin, loading, error }) {
  const inputRef = useRef(null);
  const [hasValue, setHasValue] = useState(false);

  const checkInput = () => setHasValue(!!(inputRef.current?.value?.trim()));
  const submit = () => { const t = inputRef.current?.value?.trim(); if (t) onLogin(t); };

  return html`<div class="login-wrap"><div class="login-card stack" style="gap:2rem">
    <div style="text-align:center">
      <h1 style="font-size:1.875rem;font-weight:700">Contentful Migrator</h1>
      <p class="text-muted text-sm" style="margin-top:.5rem">Extract, migrate, and transform content across Contentful spaces.</p>
    </div>
    <div class="section"><div class="section-body stack" style="gap:1rem">
      <div>
        <label class="text-sm font-semibold">CMA Token</label>
        <input type="password" ref=${inputRef} placeholder="CFPAT-xxxxxxxxxxxxxxxxxx"
          onInput=${checkInput} onKeyUp=${checkInput} onChange=${checkInput}
          onKeyDown=${e => e.key === 'Enter' && submit()} autofocus style="margin-top:.5rem" />
        <p class="text-xs text-muted" style="margin-top:.375rem">Generate at <a href="https://app.contentful.com/account/profile/cma_tokens" target="_blank" class="text-primary">Contentful → Settings → CMA Tokens</a></p>
      </div>
      ${error && html`<div class="text-sm text-error" style="background:rgba(239,68,68,.1);padding:.5rem .75rem;border-radius:.5rem">${error}</div>`}
      <button class="btn btn-primary" style="width:100%;padding:.625rem" onClick=${submit} disabled=${loading || !hasValue}>
        ${loading ? html`<span class="spinner"></span>Connecting...` : 'Connect'}
      </button>
    </div></div>
    <p class="text-xs text-muted" style="text-align:center">Token stored in browser session only. Never sent to any server.</p>
  </div></div>`;
}
