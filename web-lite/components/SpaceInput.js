import { html } from '../lib/preact.js';

export function SpaceInput({ label, spaceId, envId, onSpaceChange, onEnvChange }) {
  return html`<fieldset class="stack" style="gap:.5rem">
    <legend class="text-xs font-semibold text-muted">${label}</legend>
    <div class="flex">
      <div style="flex:1">
        <label class="text-xs text-muted">Space ID</label>
        <input value=${spaceId} onInput=${e => onSpaceChange(e.target.value)} placeholder="e.g. vsw90ltyito7" />
      </div>
      <div style="width:10rem">
        <label class="text-xs text-muted">Environment</label>
        <input value=${envId} onInput=${e => onEnvChange(e.target.value)} placeholder="e.g. master" />
      </div>
    </div>
  </fieldset>`;
}
