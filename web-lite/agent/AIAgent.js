import { h, html, useState, useEffect, useRef, useCallback } from '../lib/preact.js';
import { marked } from 'https://esm.sh/marked@12';
import { listContentTypes, getEntries, getEntry, getCurrentUser } from '../lib/contentful-client.js';
import { getDisplayTitle, extractLinkReferences, applyPostFilters } from '../lib/helpers.js';
import { runAnalyze } from '../operations/analyze.js';
import { checkOllama, callOllama, OLLAMA_MODEL } from './ollama-client.js';
import { TOOL_DEFS } from './tool-definitions.js';
import { buildSystemPrompt } from './system-prompt.js';
import { tryParseToolCallFromText } from './tool-parser.js';

marked.setOptions({ breaks: true, gfm: true });

function Markdown({ content }) {
  if (!content) return null;
  const raw = marked.parse(content);
  return h('div', { dangerouslySetInnerHTML: { __html: raw }, class: 'md-content' });
}

const LOG_COLORS = { info: '#cbd5e1', success: '#4ade80', warning: '#facc15', error: '#f87171' };

const SUGGESTIONS = [
  'List content types in my source space',
  'Find all footnote entries with QA in their name',
  'Rename entry 6nofbx3BhcZNKiRtHnGdw8 to "QA Updated"',
  'Append " IN" to en-IN locale of all hero entries with QA in their title',
];

const SAFE_TOOLS = ['list_content_types', 'analyze', 'search_entries', 'get_entry'];

export function AIAgent({ token, user, log, srcSpace, srcEnv, tgtSpace, tgtEnv, onSrcSpaceChange, onSrcEnvChange, onTgtSpaceChange, onTgtEnvChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [ollamaOk, setOllamaOk] = useState(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [logEntries, setLogEntries] = useState([]);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const copyJson = useCallback((json, idx) => {
    navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);

  useEffect(() => {
    checkOllama().then(setOllamaOk);
    const i = setInterval(() => checkOllama().then(setOllamaOk), 30000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => { const unsub = log.subscribe(() => setLogEntries([...log.getEntries()])); return () => { unsub(); }; }, [log]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, thinking]);

  const addMsg = (role, content, extra) => {
    setMessages(prev => [...prev, { role, content, ts: new Date(), ...extra }]);
  };

  const executeReadAction = async (name, args) => {
    log.clear();
    setConsoleOpen(true);
    try {
      switch (name) {
        case 'analyze': {
          const result = await runAnalyze(token, args.spaceId, args.envId, args.entryId, { maxDepth: args.maxDepth ?? 1, skipTypes: args.skipTypes ?? ['page'] }, log);
          return { ok: true, summary: `Analysis complete: ${result.totalEntries} entries, ${result.totalAssets} assets across ${Object.keys(result.contentTypeCounts).length} content types. Root: "${result.rootTitle}". Types: ${Object.entries(result.contentTypeCounts).map(([t, c]) => `${t}(${c})`).join(', ')}` };
        }
        case 'list_content_types': {
          const cts = await listContentTypes(token, args.spaceId, args.envId);
          cts.forEach((c, i) => log.info(`  ${i + 1}. ${c.name} (${c.id})`));
          log.success(`\n${cts.length} content types found.`);
          const data = JSON.stringify(cts.slice(0, 40).map(c => ({ name: c.name, id: c.id })));
          return { ok: true, summary: `Found ${cts.length} content types. Results as JSON:\n${data}\n\nPresent these to the user as a clean markdown list or table with name and ID.` };
        }
        case 'search_entries': {
          log.info(`Searching ${args.contentType} entries...`);
          const res = await getEntries(token, args.spaceId, args.envId, {
            content_type: args.contentType,
            limit: args.limit || 100,
          });
          let items = res.items;
          log.info(`Found ${items.length} raw entries.`);

          const filters = {};
          if (args.draftOnly) filters.draft = true;
          if (args.publishedOnly) filters.published = true;
          if (args.nameContains) filters.nameContains = args.nameContains;
          if (args.updatedByMe) {
            const me = await getCurrentUser(token);
            filters.updatedBy = me.id;
            log.info(`Resolved current user → ${me.id} (${me.firstName} ${me.lastName})`);
          }
          items = applyPostFilters(items, filters, log);

          const entries = items.map(e => {
            const title = getDisplayTitle(e.fields) || e.sys.id;
            const status = e.sys.publishedVersion ? 'published' : 'draft';
            const updated = e.sys.updatedAt ? new Date(e.sys.updatedAt).toLocaleDateString() : '';
            return { id: e.sys.id, title, status, updated };
          });

          entries.forEach((e, i) => log.info(`  ${i + 1}. ${e.title} (${e.id}) [${e.status}] ${e.updated}`));
          log.success(`\n${entries.length} entries found.`);

          const data = JSON.stringify(entries.slice(0, 30).map(e => ({ title: e.title, id: e.id, status: e.status, updated: e.updated })));
          return { ok: true, summary: `Found ${entries.length} ${args.contentType} entries. Results as JSON array:\n${data}${entries.length > 30 ? `\n(showing first 30 of ${entries.length})` : ''}\n\nPresent these results to the user in a clear formatted way using markdown — use a table or bullet list. Include title, ID, and status.` };
        }
        case 'get_entry': {
          log.info(`Fetching entry ${args.entryId}...`);
          const entry = await getEntry(token, args.spaceId, args.envId, args.entryId);
          const ct = entry.sys.contentType.sys.id;
          const title = getDisplayTitle(entry.fields) || args.entryId;
          const sysStatus = entry.sys.publishedVersion
            ? (entry.sys.version === entry.sys.publishedVersion + 1 ? 'Published' : 'Changed (draft)')
            : 'Draft';
          const refs = extractLinkReferences(entry.fields);
          const fieldNames = Object.keys(entry.fields);

          const sys = {
            id: entry.sys.id,
            contentType: ct,
            status: sysStatus,
            createdAt: entry.sys.createdAt || null,
            firstPublishedAt: entry.sys.firstPublishedAt || null,
            publishedAt: entry.sys.publishedAt || null,
            updatedAt: entry.sys.updatedAt || null,
            version: entry.sys.version ?? null,
            publishedVersion: entry.sys.publishedVersion ?? null,
            publishedCounter: entry.sys.publishedCounter ?? null,
            createdBy: entry.sys.createdBy?.sys?.id || null,
            updatedBy: entry.sys.updatedBy?.sys?.id || null,
          };

          log.success(`Entry: "${title}" (${args.entryId})`);
          log.info(`  Content type: ${ct} | Status: ${sysStatus}`);
          log.info(`  Created: ${sys.createdAt || 'N/A'}`);
          log.info(`  First published: ${sys.firstPublishedAt || 'Never'}`);
          log.info(`  Last published: ${sys.publishedAt || 'N/A'}`);
          log.info(`  Updated: ${sys.updatedAt || 'N/A'} by ${sys.updatedBy || 'unknown'}`);
          log.info(`  Version: ${sys.version} | Published count: ${sys.publishedCounter ?? 'N/A'}`);
          log.info(`  References: ${refs.entries.length} entries, ${refs.assets.length} assets`);

          if (args.field) {
            const lm = entry.fields[args.field];
            if (!lm || typeof lm !== 'object') {
              log.info(`  Field "${args.field}": not found`);
              const data = JSON.stringify({ sys, fieldQuery: { field: args.field, locale: args.locale || null, found: false, value: null } });
              return { ok: true, summary: `Entry "${title}" (${ct}).\n\nField query result as JSON:\n${data}\n\nThe field "${args.field}" does not exist on this entry. Tell the user clearly.` };
            }
            if (args.locale) {
              const val = lm[args.locale];
              const found = args.locale in lm;
              const preview = found ? (typeof val === 'string' ? val : JSON.stringify(val).slice(0, 200)) : null;
              log.info(`  ${args.field} [${args.locale}]: ${found ? preview : '(locale not found)'}`);
              log.info(`  Available locales for ${args.field}: ${Object.keys(lm).join(', ')}`);
              const data = JSON.stringify({ sys, fieldQuery: { field: args.field, locale: args.locale, found, value: found ? val : null, availableLocales: Object.keys(lm) } });
              return { ok: true, summary: `Entry "${title}" (${ct}).\n\nField query result as JSON:\n${data}\n\nAnswer the user's question about the field and locale directly. If the locale was not found, tell them which locales exist.` };
            }
            const allLocales = {};
            for (const [loc, val] of Object.entries(lm)) {
              allLocales[loc] = typeof val === 'string' ? val : JSON.stringify(val).slice(0, 200);
              log.info(`  ${args.field} [${loc}]: ${allLocales[loc]}`);
            }
            const data = JSON.stringify({ sys, fieldQuery: { field: args.field, locale: null, found: true, values: allLocales } });
            return { ok: true, summary: `Entry "${title}" (${ct}).\n\nField values as JSON:\n${data}\n\nShow all locale values for the field clearly.` };
          }

          log.info(`  Fields:`);
          const fieldData = {};
          const localeCoverage = {};
          fieldNames.forEach(fn => {
            const lm = entry.fields[fn];
            if (!lm || typeof lm !== 'object') { fieldData[fn] = null; return; }
            fieldData[fn] = {};
            for (const [loc, val] of Object.entries(lm)) {
              if (!localeCoverage[loc]) localeCoverage[loc] = [];
              localeCoverage[loc].push(fn);
              const preview = typeof val === 'string' ? val.slice(0, 120)
                : typeof val === 'boolean' ? String(val)
                : typeof val === 'number' ? String(val)
                : val?.sys?.type === 'Link' ? `→ ${val.sys.linkType} ${val.sys.id}`
                : Array.isArray(val) ? `[${val.length} items]`
                : val?.nodeType === 'document' ? '(rich text)'
                : JSON.stringify(val).slice(0, 80);
              fieldData[fn][loc] = preview;
            }
            const locales = Object.keys(fieldData[fn]);
            log.info(`    ${fn} [${locales.join(',')}]: ${fieldData[fn][locales[0]]}`);
          });

          const data = JSON.stringify({
            title, sys, fields: fieldData, localeCoverage,
            references: { entries: refs.entries.length, assets: refs.assets.length },
          });
          return { ok: true, summary: `Entry data as JSON:\n${data}\n\nPresent this entry to the user in a clear markdown format. Include sys metadata (dates, version, status) and field values with their locales. Use bold for field names.` };
        }
        default:
          return { ok: false, summary: `Unknown read action: ${name}` };
      }
    } catch (e) {
      return { ok: false, summary: `Error: ${e.message || e}` };
    }
  };

  const handleSend = async (text) => {
    const msg = (text || input).trim();
    if (!msg || thinking) return;
    setInput('');
    addMsg('user', msg);
    setThinking(true);

    try {
      const spaces = { srcSpace, srcEnv, tgtSpace, tgtEnv };
      const history = [...messages, { role: 'user', content: msg }];
      const apiMsgs = [
        { role: 'system', content: buildSystemPrompt(spaces) },
        ...history.filter(m => ['user', 'assistant', 'tool'].includes(m.role)).map(m => ({
          role: m.role, content: m.content || '',
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
      ];

      const reply = await callOllama(apiMsgs, TOOL_DEFS);

      let toolName = null, toolArgs = null;
      if (reply.tool_calls && reply.tool_calls.length > 0) {
        const tc = reply.tool_calls[0];
        toolName = tc.function.name;
        toolArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
      } else if (reply.content) {
        const parsed = tryParseToolCallFromText(reply.content);
        if (parsed) { toolName = parsed.name; toolArgs = parsed.args; }
      }

      if (toolName && toolArgs) {
        const displayText = reply.content?.replace(/```[\s\S]*?```/g, '').replace(/\{[\s\S]*?\}/g, '').trim();

        if (SAFE_TOOLS.includes(toolName)) {
          addMsg('assistant', displayText || `Running ${toolName.replace(/_/g, ' ')}...`);
          const result = await executeReadAction(toolName, toolArgs);
          const followUp = [
            ...apiMsgs,
            { role: 'assistant', content: '', tool_calls: [{ function: { name: toolName, arguments: JSON.stringify(toolArgs) } }] },
            { role: 'tool', content: result.summary },
          ];
          try {
            const summary = await callOllama(followUp, TOOL_DEFS);
            addMsg('assistant', summary.content || result.summary);
          } catch { addMsg('assistant', result.summary); }
        } else {
          addMsg('assistant', displayText || `Here's the instruction for **${toolName.replace(/_/g, ' ')}**. Copy the JSON and execute it via Cursor or the manual UI.`, { jsonCard: { tool: toolName, args: toolArgs } });
        }
      } else {
        addMsg('assistant', reply.content);
      }
    } catch (e) {
      addMsg('assistant', `Could not reach Ollama. Make sure Ollama is running (\`ollama serve\`) and you've signed in (\`ollama signin\`).\n\nError: ${e.message || e}`);
    }
    setThinking(false);
  };

  return html`<div class="chat-wrap">
    <!-- Compact config bar -->
    <div class="chat-spaces">
      <fieldset><label>Source Space</label><input value=${srcSpace} onInput=${e => onSrcSpaceChange(e.target.value)} placeholder="Space ID" /></fieldset>
      <fieldset><label>Source Env</label><input value=${srcEnv} onInput=${e => onSrcEnvChange(e.target.value)} style="max-width:6rem" /></fieldset>
      <fieldset><label>Target Space</label><input value=${tgtSpace} onInput=${e => onTgtSpaceChange(e.target.value)} placeholder="Space ID" /></fieldset>
      <fieldset><label>Target Env</label><input value=${tgtEnv} onInput=${e => onTgtEnvChange(e.target.value)} style="max-width:6rem" /></fieldset>
      <div class="ollama-status"><span class="ollama-dot ${ollamaOk ? 'connected' : ollamaOk === null ? 'checking' : 'disconnected'}"></span><span class=${ollamaOk ? 'text-success' : 'text-error'}>${ollamaOk ? `Connected · ${OLLAMA_MODEL}` : ollamaOk === null ? 'Connecting...' : 'Ollama unavailable'}</span></div>
    </div>

    <!-- Messages -->
    ${messages.length === 0 && !thinking ? html`<div class="chat-empty">
      <h2>AI Agent</h2>
      <p class="text-sm">Describe what you want to do with your Contentful content.</p>
      <div class="suggestions">${SUGGESTIONS.map(s => html`<button key=${s} class="suggestion" onClick=${() => handleSend(s)}>${s}</button>`)}</div>
    </div>` : html`<div class="chat-messages">
      ${messages.map((m, i) => html`<div key=${i} class="msg msg-${m.role === 'user' ? 'user' : 'assistant'}">
        <div class="msg-bubble">
          ${m.role === 'user' ? html`<div>${m.content}</div>` : html`<${Markdown} content=${m.content} />`}
          ${m.jsonCard && html`<div class="action-card">
            <div class="action-card-title">${m.jsonCard.tool.replace(/_/g, ' ')} — instruction</div>
            <pre class="json-preview"><code>${JSON.stringify({ tool: m.jsonCard.tool, ...m.jsonCard.args }, null, 2)}</code></pre>
            <div class="action-card-btns">
              <button class="btn btn-primary" style="font-size:.8rem;padding:.375rem 1rem" onClick=${() => copyJson({ tool: m.jsonCard.tool, ...m.jsonCard.args }, i)}>
                ${copiedIdx === i ? 'Copied!' : 'Copy JSON'}
              </button>
            </div>
          </div>`}
        </div>
        <div class="msg-meta">${m.ts.toLocaleTimeString()}</div>
      </div>`)}
      ${thinking && html`<div class="msg msg-assistant"><div class="msg-bubble"><span class="spinner"></span>Thinking...</div></div>`}
      <div ref=${chatEndRef} />
    </div>`}

    <!-- Collapsible console -->
    ${logEntries.length > 0 && html`<div>
      <div class="chat-console-toggle ${consoleOpen ? '' : 'collapsed'}" onClick=${() => setConsoleOpen(!consoleOpen)}>
        <span class="font-mono">Console (${logEntries.length} lines)</span>
        <span>${consoleOpen ? '▼' : '▲'}</span>
      </div>
      ${consoleOpen && html`<div class="chat-console-body">
        ${logEntries.map((e, i) => html`<div key=${i} style="color:${LOG_COLORS[e.level] || LOG_COLORS.info}">${e.message}</div>`)}
      </div>`}
    </div>`}

    <!-- Input -->
    <div class="chat-input-bar">
      <input ref=${inputRef} value=${input} onInput=${e => setInput(e.target.value)} placeholder=${ollamaOk ? 'Describe what you want to do...' : 'Start Ollama to use AI Agent...'}
        onKeyDown=${e => e.key === 'Enter' && !e.shiftKey && handleSend()} disabled=${thinking || !ollamaOk} />
      <button class="btn btn-primary" onClick=${() => handleSend()} disabled=${thinking || !input.trim() || !ollamaOk}>Send</button>
    </div>
  </div>`;
}
