import { html, Fragment, useState } from '../lib/preact.js';
import { getCurrentUser } from '../lib/contentful-client.js';
import { runAnalyze } from '../operations/analyze.js';
import { runExtract } from '../operations/extract.js';
import { runCreate } from '../operations/create.js';
import { runMigrate } from '../operations/migrate.js';
import { runTransform } from '../operations/transform.js';
import { runFixBrokenAssets } from '../operations/fix-broken-assets.js';
import { SpaceInput } from './SpaceInput.js';
import { ContentTypePicker } from './ContentTypePicker.js';
import { ContentTypeMultiSelect } from './ContentTypeMultiSelect.js';
import { ConsoleLog } from './ConsoleLog.js';
import { AIAgent } from '../agent/AIAgent.js';

const MODES = [
  { key: 'extract-create', label: 'Extract & Create', icon: '↓↑', desc: 'Extract entries from source, preview them, then create in target.' },
  { key: 'migrate', label: 'Direct Migrate', icon: '⇄', desc: 'Walk source tree and create entries in target in one step.' },
  { key: 'transform', label: 'Transform', icon: '✎', desc: 'Bulk update fields on existing entries in a space.' },
];

export function Workspace({ token, user, onLogout, log }) {
  const [topMode, setTopMode] = useState('manual');
  const [mode, setMode] = useState('extract-create');
  const [srcSpace, setSrcSpace] = useState(''); const [srcEnv, setSrcEnv] = useState('dev');
  const [tgtSpace, setTgtSpace] = useState(''); const [tgtEnv, setTgtEnv] = useState('master');
  const [entryId, setEntryId] = useState(''); const [depth, setDepth] = useState(1); const [skipTypes, setSkipTypes] = useState([]);
  const [publish, setPublish] = useState(false);

  const [tContentType, setTContentType] = useState('');
  const [tDraftOnly, setTDraftOnly] = useState(false); const [tPublishedOnly, setTPublishedOnly] = useState(false);
  const [tUpdatedByMe, setTUpdatedByMe] = useState(false); const [tNameContains, setTNameContains] = useState('');
  const [tPreset, setTPreset] = useState('fix-broken-assets');
  const [tReplacementId, setTReplacementId] = useState('');
  const [tRule, setTRule] = useState('set'); const [tField, setTField] = useState('');
  const [tTargetLocale, setTTargetLocale] = useState('en'); const [tSourceLocale, setTSourceLocale] = useState('en');
  const [tValue, setTValue] = useState(''); const [tJsonValue, setTJsonValue] = useState(false);

  const [step, setStep] = useState('configure');
  const [analysis, setAnalysis] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [migrateResult, setMigrateResult] = useState(null);
  const [transformResult, setTransformResult] = useState(null);
  const [fixResult, setFixResult] = useState(null);

  const busy = ['analyzing', 'extracting', 'creating', 'executing'].includes(step);
  const isTree = mode === 'extract-create' || mode === 'migrate';

  const reset = () => { setStep('configure'); setAnalysis(null); setExtraction(null); setMigrateResult(null); setTransformResult(null); setFixResult(null); setPublish(false); };
  const switchMode = m => { setMode(m); reset(); log.clear(); };

  const resolveFilters = async () => {
    const f = {};
    if (tDraftOnly) f.draft = true;
    if (tPublishedOnly) f.published = true;
    if (tUpdatedByMe) { const u = await getCurrentUser(token); f.updatedBy = u.id; log.info(`Resolved "me" → ${u.id}`); }
    if (tNameContains.trim()) f.nameContains = tNameContains.trim();
    return f;
  };

  const handleAnalyze = async () => { if (!srcSpace || !entryId) return; setStep('analyzing'); setAnalysis(null); log.clear(); try { const r = await runAnalyze(token, srcSpace, srcEnv, entryId, { maxDepth: depth, skipTypes }, log); setAnalysis(r); setStep('analyzed'); } catch (e) { log.error(`Fatal: ${e.message || e}`); setStep('configure'); } };
  const handleExtract = async () => { if (!srcSpace || !entryId) return; setStep('extracting'); setExtraction(null); log.clear(); try { const r = await runExtract(token, srcSpace, srcEnv, entryId, { maxDepth: depth, skipTypes }, log); setExtraction(r); setStep('extracted'); } catch (e) { log.error(`Fatal: ${e.message || e}`); setStep('analyzed'); } };
  const handleCreate = async () => { if (!extraction || !tgtSpace) return; setStep('creating'); log.clear(); try { const r = await runCreate(token, extraction, { spaceId: tgtSpace, envId: tgtEnv }, { publish }, log); setMigrateResult(r); setStep('done'); } catch (e) { log.error(`Fatal: ${e.message || e}`); setStep('extracted'); } };
  const handleMigrate = async () => { if (!srcSpace || !tgtSpace || !entryId) return; setStep('executing'); log.clear(); try { const r = await runMigrate(token, { spaceId: srcSpace, envId: srcEnv, entryId }, { spaceId: tgtSpace, envId: tgtEnv }, { maxDepth: depth, skipTypes, publish }, log); setMigrateResult(r); setStep('done'); } catch (e) { log.error(`Fatal: ${e.message || e}`); setStep('analyzed'); } };

  const handleTransform = async () => {
    if (!tgtSpace || !tContentType) return;
    setStep('executing'); log.clear();
    try {
      const filters = await resolveFilters();
      if (tPreset === 'fix-broken-assets') {
        if (!tReplacementId) { log.error('Replacement Entry ID is required.'); setStep('configure'); return; }
        const r = await runFixBrokenAssets(token, tgtSpace, tgtEnv, tContentType, tReplacementId, filters, log);
        setFixResult(r); setStep('done');
      } else {
        let pv = tValue;
        if (tJsonValue) { try { pv = JSON.parse(tValue); } catch { log.error('Invalid JSON value.'); setStep('configure'); return; } }
        const t = { rule: tRule, field: tField || undefined, targetLocale: tTargetLocale, sourceLocale: tRule === 'copy' ? tSourceLocale : undefined, value: tRule === 'set' ? pv : undefined };
        const r = await runTransform(token, tgtSpace, tgtEnv, tContentType, [t], filters, log);
        setTransformResult(r); setStep('done');
      }
    } catch (e) { log.error(`Fatal: ${e.message || e}`); setStep('configure'); }
  };

  const stepDefs = mode === 'extract-create' ? [{ k: 'configure', l: 'Configure' }, { k: 'analyze', l: 'Analyze' }, { k: 'extract', l: 'Extract' }, { k: 'create', l: 'Create' }]
    : mode === 'migrate' ? [{ k: 'configure', l: 'Configure' }, { k: 'analyze', l: 'Analyze' }, { k: 'migrate', l: 'Migrate' }]
    : [{ k: 'configure', l: 'Configure' }, { k: 'execute', l: 'Execute' }];

  const stepIdx = mode === 'extract-create'
    ? step === 'configure' ? 0 : (step === 'analyzing' || step === 'analyzed') ? 1 : (step === 'extracting' || step === 'extracted') ? 2 : (step === 'creating' || step === 'done') ? 3 : 0
    : mode === 'migrate'
    ? step === 'configure' ? 0 : (step === 'analyzing' || step === 'analyzed') ? 1 : (step === 'executing' || step === 'done') ? 2 : 0
    : step === 'configure' ? 0 : (step === 'executing' || step === 'done') ? 1 : 0;

  return html`<div>
    <nav class="nav">
      <span class="nav-title">Contentful Migrator</span>
      <div style="display:flex;align-items:center;gap:1rem">
        <div class="mode-switch">
          <button class=${topMode === 'manual' ? 'active' : ''} onClick=${() => setTopMode('manual')}>Manual</button>
          <button class=${topMode === 'agent' ? 'active' : ''} onClick=${() => setTopMode('agent')}>AI Agent</button>
        </div>
        <div class="nav-right"><span class="text-muted">${user.firstName} ${user.lastName}</span><button class="btn-logout" onClick=${onLogout}>Logout</button></div>
      </div>
    </nav>

    ${topMode === 'agent' && html`<${AIAgent} token=${token} user=${user} log=${log}
      srcSpace=${srcSpace} srcEnv=${srcEnv} tgtSpace=${tgtSpace} tgtEnv=${tgtEnv}
      onSrcSpaceChange=${setSrcSpace} onSrcEnvChange=${setSrcEnv} onTgtSpaceChange=${setTgtSpace} onTgtEnvChange=${setTgtEnv} />`}

    ${topMode === 'manual' && html`<div class="container" style="padding-top:2rem;padding-bottom:2rem"><div class="stack">
      <!-- Header + Steps -->
      <div class="flex-between">
        <div><h1 style="font-size:1.5rem;font-weight:700">Workspace</h1><p class="text-xs text-muted">${user.firstName} ${user.lastName} · ${user.email}</p></div>
        <div class="steps">${stepDefs.map((s, i) => html`<${Fragment} key=${s.k}>
          <span class="step-pill ${i < stepIdx ? 'step-done' : i === stepIdx ? 'step-active' : 'step-pending'}">${i < stepIdx ? '✓ ' : `${i + 1}. `}${s.l}</span>
          ${i < stepDefs.length - 1 && html`<span class="step-arrow">→</span>`}<//>`)}
        </div>
      </div>

      <!-- Mode tabs -->
      <div class="tabs">${MODES.map(m => html`<button key=${m.key} class="tab ${mode === m.key ? 'active' : ''}" onClick=${() => switchMode(m.key)} disabled=${busy}>
        <span style="margin-right:.375rem">${m.icon}</span>${m.label}</button>`)}</div>
      <p class="text-xs text-muted">${MODES.find(m => m.key === mode).desc}</p>

      <!-- Spaces -->
      <div class="section"><div class="section-header"><h2>Spaces</h2></div><div class="section-body">
        <div class="grid-2">
          ${isTree && html`<${SpaceInput} label="Source Space" spaceId=${srcSpace} envId=${srcEnv} onSpaceChange=${setSrcSpace} onEnvChange=${setSrcEnv} />`}
          ${(mode !== 'extract' || mode === 'transform' || isTree) && html`<${SpaceInput} label="Target Space" spaceId=${tgtSpace} envId=${tgtEnv} onSpaceChange=${setTgtSpace} onEnvChange=${setTgtEnv} />`}
        </div>
      </div></div>

      <!-- Tree options -->
      ${isTree && html`<div class="section"><div class="section-header"><h2>Entry Tree Options</h2></div><div class="section-body stack" style="gap:1.25rem">
        <div class="grid-3">
          <div><label class="text-xs font-semibold text-muted">Entry ID</label><input value=${entryId} onInput=${e => setEntryId(e.target.value)} placeholder="e.g. 4HmRxJk2OikYAU72YeTKEv" /></div>
          <div><label class="text-xs font-semibold text-muted">Max Depth</label><select value=${depth} onChange=${e => setDepth(Number(e.target.value))}>
            ${[0, 1, 2, 3, 5, 10].map(d => html`<option key=${d} value=${d}>${d === 0 ? '0 (root only)' : d}</option>`)}</select></div>
          <${ContentTypeMultiSelect} token=${token} spaceId=${srcSpace} envId=${srcEnv} selected=${skipTypes} onChange=${setSkipTypes} label="Skip Types" />
        </div>
        ${(mode === 'migrate' || mode === 'extract-create') && html`<label class="cb"><input type="checkbox" checked=${publish} onChange=${e => setPublish(e.target.checked)} />Auto-publish entries after creation</label>`}
      </div></div>`}

      <!-- Transform options -->
      ${mode === 'transform' && html`<div class="section"><div class="section-header"><h2>Transform Options</h2></div><div class="section-body stack" style="gap:1.25rem">
        <${ContentTypePicker} token=${token} spaceId=${tgtSpace} envId=${tgtEnv} value=${tContentType} onChange=${setTContentType} label="Content Type" />
        <fieldset class="stack" style="gap:.5rem"><legend class="text-xs font-semibold text-muted uppercase">Filters</legend>
          <div class="flex" style="flex-wrap:wrap;gap:1rem">
            <label class="cb"><input type="checkbox" checked=${tDraftOnly} onChange=${e => { setTDraftOnly(e.target.checked); if (e.target.checked) setTPublishedOnly(false); }} />Draft only</label>
            <label class="cb"><input type="checkbox" checked=${tPublishedOnly} onChange=${e => { setTPublishedOnly(e.target.checked); if (e.target.checked) setTDraftOnly(false); }} />Published only</label>
            <label class="cb"><input type="checkbox" checked=${tUpdatedByMe} onChange=${e => setTUpdatedByMe(e.target.checked)} />Updated by me</label>
          </div>
          <div style="margin-top:.75rem"><label class="text-xs text-muted">Name contains <span style="opacity:.5">(optional)</span></label>
            <input value=${tNameContains} onInput=${e => setTNameContains(e.target.value)} placeholder='e.g. QA — only entries whose name includes this text' /></div>
        </fieldset>
        <fieldset class="stack" style="gap:.75rem"><legend class="text-xs font-semibold text-muted uppercase">Action</legend>
          <div class="grid-2">
            <button class="preset ${tPreset === 'fix-broken-assets' ? 'active' : ''}" onClick=${() => setTPreset('fix-broken-assets')}><div class="preset-title">Fix Broken Assets</div><div class="preset-desc">Check for broken/missing asset or entry references and replace them.</div></button>
            <button class="preset ${tPreset === 'custom-rule' ? 'active' : ''}" onClick=${() => setTPreset('custom-rule')}><div class="preset-title">Custom Rule</div><div class="preset-desc">Set, copy, delete, or modify field values across entries.</div></button>
          </div>
        </fieldset>
        ${tPreset === 'fix-broken-assets' && html`<div><label class="text-xs font-semibold text-muted">Replacement Entry ID</label><input value=${tReplacementId} onInput=${e => setTReplacementId(e.target.value)} placeholder="e.g. 7GgQy8BHWnwSPt1ADlLBTx" />
          <p class="text-xs text-muted" style="margin-top:.25rem">Broken references (404, empty, no URL) get replaced with this entry.</p></div>`}
        ${tPreset === 'custom-rule' && html`<div class="stack" style="gap:1rem">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem">${['set', 'copy', 'delete', 'modify'].map(r => html`<button key=${r} class="rule-btn ${tRule === r ? 'active' : ''}" onClick=${() => setTRule(r)}>${r[0].toUpperCase() + r.slice(1)}</button>`)}</div>
          <div class="grid-2"><div><label class="text-xs text-muted">Field (leave empty for all)</label><input value=${tField} onInput=${e => setTField(e.target.value)} placeholder="e.g. image" /></div>
            <div><label class="text-xs text-muted">Target Locale</label><input value=${tTargetLocale} onInput=${e => setTTargetLocale(e.target.value)} /></div>
            ${tRule === 'copy' && html`<div><label class="text-xs text-muted">Source Locale</label><input value=${tSourceLocale} onInput=${e => setTSourceLocale(e.target.value)} /></div>`}
            ${(tRule === 'set' || tRule === 'modify') && html`<div style="grid-column:1/-1">
              <div class="flex-between"><label class="text-xs text-muted">Value</label><label class="cb text-xs text-muted"><input type="checkbox" checked=${tJsonValue} onChange=${e => setTJsonValue(e.target.checked)} style="width:.75rem;height:.75rem" />JSON</label></div>
              <textarea value=${tValue} onInput=${e => setTValue(e.target.value)} rows=${tJsonValue ? 4 : 1} class="font-mono text-xs"
                placeholder=${tJsonValue ? '{"sys": {"type": "Link", ...}}' : 'Plain text value'} /></div>`}
          </div></div>`}
      </div></div>`}

      <!-- Actions -->
      <div class="flex">
        ${isTree && step === 'configure' && html`<button class="btn btn-secondary" onClick=${handleAnalyze} disabled=${!srcSpace || !entryId || busy}>Analyze</button>`}
        ${isTree && step === 'analyzing' && html`<button class="btn btn-secondary" disabled><span class="spinner"></span>Analyzing...</button>`}
        ${isTree && step === 'analyzed' && mode === 'extract-create' && html`<button class="btn btn-primary" onClick=${handleExtract} disabled=${busy}>Extract</button>`}
        ${isTree && step === 'analyzed' && mode === 'migrate' && html`<button class="btn btn-primary" onClick=${handleMigrate} disabled=${!tgtSpace || busy}>Migrate</button>`}
        ${mode === 'extract-create' && step === 'extracted' && html`<button class="btn btn-primary" onClick=${handleCreate} disabled=${!tgtSpace || busy}>Create in Target</button>`}
        ${step === 'extracting' && html`<button class="btn btn-primary" disabled><span class="spinner"></span>Extracting...</button>`}
        ${step === 'creating' && html`<button class="btn btn-primary" disabled><span class="spinner"></span>Creating...</button>`}
        ${step === 'executing' && mode === 'migrate' && html`<button class="btn btn-primary" disabled><span class="spinner"></span>Migrating...</button>`}
        ${mode === 'transform' && step === 'configure' && html`<button class="btn btn-primary" onClick=${handleTransform}
          disabled=${!tgtSpace || !tContentType || busy || (tPreset === 'fix-broken-assets' && !tReplacementId)}>
          ${tPreset === 'fix-broken-assets' ? 'Fix Broken Assets' : 'Run Transform'}</button>`}
        ${mode === 'transform' && step === 'executing' && html`<button class="btn btn-primary" disabled><span class="spinner"></span>Transforming...</button>`}
        ${step !== 'configure' && !busy && html`<${Fragment}>
          ${isTree && step !== 'done' && html`<button class="btn btn-ghost" onClick=${handleAnalyze} disabled=${!srcSpace || !entryId}>Re-analyze</button>`}
          <button class="btn btn-ghost" onClick=${() => { reset(); log.clear(); }}>Reset</button><//>`}
      </div>

      <!-- Analysis panel -->
      ${analysis && ['analyzed', 'extracting', 'extracted', 'creating', 'done'].includes(step) && isTree && html`<div class="section"><div class="section-body stack" style="gap:1rem">
        <div class="flex-between"><h3 class="text-sm font-semibold">Tree: ${analysis.rootTitle}</h3>
          <span class="text-xs pill">${analysis.totalEntries} entries · ${analysis.totalAssets} assets</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem">${Object.entries(analysis.contentTypeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) =>
          html`<div key=${t} class="flex-between" style="background:var(--bg);border-radius:.25rem;padding:.375rem .75rem;font-size:.75rem">
            <span class="font-mono truncate" style="margin-right:.5rem">${t}</span><span class="font-bold text-primary">${c}</span></div>`)}</div>
        <details><summary class="text-xs text-muted" style="cursor:pointer">Entry tree (${analysis.entries.length} nodes, depth ${analysis.maxDepthReached})</summary>
          <div style="margin-top:.5rem;max-height:14rem;overflow-y:auto;background:var(--bg);border-radius:.5rem;padding:.75rem;font-family:var(--mono);font-size:.75rem">
            ${analysis.entries.map(e => html`<div key=${e.id} class="tree-line" style="padding-left:${e.depth * 16}px">
              <span class="text-muted">${e.depth > 0 ? '└─' : '●'}</span><span class="text-primary">${e.contentType}</span>
              <span class="truncate">${e.title || e.id}</span>
              ${e.refCount > 0 && html`<span class="text-muted">(${e.refCount} refs)</span>`}
              ${e.assetCount > 0 && html`<span class="text-warning">(${e.assetCount} assets)</span>`}</div>`)}</div>
        </details>
      </div></div>`}

      <!-- Extraction summary -->
      ${extraction && ['extracted', 'creating', 'done'].includes(step) && mode === 'extract-create' && html`<div class="section"><div class="section-body stack" style="gap:.75rem">
        <div class="flex-between"><h3 class="text-sm font-semibold">Extracted: ${extraction.rootTitle}</h3>
          ${step === 'extracted' && html`<span class="text-xs pill">Ready to create</span>`}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem">
          <div class="stat"><div class="stat-value text-primary">${extraction.dependencyOrder.length}</div><div class="stat-label">Entries</div></div>
          <div class="stat"><div class="stat-value text-warning">${extraction.assetIds.length}</div><div class="stat-label">Assets</div></div>
          <div class="stat"><div class="stat-value text-success">${new Set(Object.values(extraction.entries).map(e => e.contentType)).size}</div><div class="stat-label">Types</div></div></div>
      </div></div>`}

      <!-- Migrate / Create result -->
      ${migrateResult && step === 'done' && (mode === 'migrate' || mode === 'extract-create') && html`<div class="section"><div class="section-body stack" style="gap:.75rem">
        <h3 class="text-sm font-semibold">${mode === 'migrate' ? 'Migration' : 'Create'} Complete</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem">
          <div class="stat"><div class="stat-value text-success">${migrateResult.created}</div><div class="stat-label">Created</div></div>
          <div class="stat"><div class="stat-value text-warning">${migrateResult.skipped}</div><div class="stat-label">Skipped</div></div>
          <div class="stat"><div class="stat-value text-error">${migrateResult.failed}</div><div class="stat-label">Failed</div></div></div>
        ${Object.keys(migrateResult.remap).length > 0 && html`<details><summary class="text-sm text-muted">ID Mapping (${Object.keys(migrateResult.remap).length} entries)</summary>
          <div style="margin-top:.5rem;background:var(--bg);border-radius:.5rem;padding:.75rem;font-family:var(--mono);font-size:.75rem;max-height:12rem;overflow-y:auto">
            ${Object.entries(migrateResult.remap).map(([s, t]) => html`<div key=${s}><span class="text-muted">${s}</span> → <span class="text-success">${t}</span></div>`)}</div></details>`}
      </div></div>`}

      <!-- Transform result -->
      ${transformResult && step === 'done' && tPreset === 'custom-rule' && html`<div class="section"><div class="section-body stack" style="gap:.75rem">
        <h3 class="text-sm font-semibold">Transform Complete</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem">
          <div class="stat"><div class="stat-value text-success">${transformResult.updated}</div><div class="stat-label">Updated</div></div>
          <div class="stat"><div class="stat-value text-warning">${transformResult.skipped}</div><div class="stat-label">Skipped</div></div>
          <div class="stat"><div class="stat-value text-error">${transformResult.failed}</div><div class="stat-label">Failed</div></div></div>
      </div></div>`}

      <!-- Fix result -->
      ${fixResult && step === 'done' && tPreset === 'fix-broken-assets' && html`<div class="section"><div class="section-body stack" style="gap:.75rem">
        <h3 class="text-sm font-semibold">Fix Broken Assets Complete</h3>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem">
          <div class="stat"><div class="stat-value">${fixResult.checked}</div><div class="stat-label">Checked</div></div>
          <div class="stat"><div class="stat-value text-success">${fixResult.fixed}</div><div class="stat-label">Fixed</div></div>
          <div class="stat"><div class="stat-value text-muted">${fixResult.skipped}</div><div class="stat-label">OK</div></div>
          <div class="stat"><div class="stat-value text-error">${fixResult.failed}</div><div class="stat-label">Failed</div></div></div>
      </div></div>`}

      <!-- Console -->
      <${ConsoleLog} log=${log} />
    </div></div>`}
  </div>`;
}
