'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import { useAuth } from '@/hooks/useAuth';
import { Navbar } from '@/components/Navbar';
import { listContentTypes, getCurrentUser } from '@/lib/contentful-client';
import { runAnalyze } from '@/lib/operations';
import { useLogger } from '@/hooks/useLogger';
import { checkOllama, callOllama, OLLAMA_MODEL } from '@/lib/agent/ollama-client';
import { TOOL_DEFS } from '@/lib/agent/tool-definitions';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { tryParseToolCallFromText } from '@/lib/agent/tool-parser';
import { useRouter } from 'next/navigation';

marked.setOptions({ breaks: true, gfm: true });

const SAFE_TOOLS = ['list_content_types', 'analyze', 'search_entries', 'get_entry'];

const SUGGESTIONS = [
  'List content types in my source space',
  'Find all footnote entries with QA in their name',
  'Rename entry 6nofbx3BhcZNKiRtHnGdw8 to "QA Updated"',
  'Append " IN" to en-IN locale of all hero entries with QA',
];

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  ts: Date;
  jsonCard?: { tool: string; args: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_calls?: any[];
}

export default function AgentPage() {
  const { token, isAuthenticated, loading: authLoading } = useAuth();
  const { logger, entries: logEntries, subscribe, clear } = useLogger();
  const router = useRouter();

  const [srcSpace, setSrcSpace] = useState('');
  const [srcEnv, setSrcEnv] = useState('dev');
  const [tgtSpace, setTgtSpace] = useState('');
  const [tgtEnv, setTgtEnv] = useState('master');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!authLoading && !isAuthenticated) router.push('/'); }, [authLoading, isAuthenticated, router]);
  useEffect(() => { const unsub = subscribe(); return unsub; }, [subscribe]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, thinking]);

  useEffect(() => {
    checkOllama().then(setOllamaOk);
    const i = setInterval(() => checkOllama().then(setOllamaOk), 30000);
    return () => clearInterval(i);
  }, []);

  const addMsg = (role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>) => {
    setMessages(prev => [...prev, { role, content, ts: new Date(), ...extra }]);
  };

  const copyJson = useCallback((json: Record<string, unknown>, idx: number) => {
    navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const executeReadAction = async (name: string, args: Record<string, any>) => {
    clear();
    setConsoleOpen(true);
    if (!token) return { ok: false, summary: 'Not authenticated' };

    try {
      switch (name) {
        case 'analyze': {
          const result = await runAnalyze(token, args.spaceId, args.envId, args.entryId, { maxDepth: args.maxDepth ?? 1, skipTypes: args.skipTypes ?? ['page'] }, logger);
          return { ok: true, summary: `Analysis complete: ${result.totalEntries} entries, ${result.totalAssets} assets across ${Object.keys(result.contentTypeCounts).length} content types. Root: "${result.rootTitle}".` };
        }
        case 'list_content_types': {
          const cts = await listContentTypes(token, args.spaceId, args.envId);
          cts.forEach((c, i) => logger.info(`  ${i + 1}. ${c.name} (${c.id})`));
          logger.success(`\n${cts.length} content types found.`);
          const data = JSON.stringify(cts.slice(0, 40).map(c => ({ name: c.name, id: c.id })));
          return { ok: true, summary: `Found ${cts.length} content types. Results as JSON:\n${data}\n\nPresent these to the user as a clean markdown list or table.` };
        }
        case 'search_entries': {
          logger.info(`Searching ${args.contentType} entries...`);
          const client = (await import('@/lib/contentful-client')).getClient(token);
          const res = await client.entry.getMany({ spaceId: args.spaceId, environmentId: args.envId, query: { content_type: args.contentType, limit: args.limit || 100 } });
          let items = res.items;
          logger.info(`Found ${items.length} raw entries.`);

          if (args.nameContains) {
            const q = args.nameContains.toLowerCase();
            items = items.filter((e: { fields: Record<string, Record<string, unknown>> }) => {
              const title = Object.values(e.fields).map(lm => typeof Object.values(lm)[0] === 'string' ? Object.values(lm)[0] as string : '').find(v => v) || '';
              return title.toLowerCase().includes(q);
            });
            logger.info(`Name filter "${args.nameContains}": ${items.length} matches.`);
          }
          if (args.draftOnly) items = items.filter((e: { sys: { publishedVersion?: number } }) => !e.sys.publishedVersion);
          if (args.publishedOnly) items = items.filter((e: { sys: { publishedVersion?: number } }) => !!e.sys.publishedVersion);
          if (args.updatedByMe) {
            const me = await getCurrentUser(token);
            items = items.filter((e: { sys: { updatedBy?: { sys: { id: string } } } }) => e.sys.updatedBy?.sys?.id === me.id);
          }

          const entries = items.map((e: { sys: { id: string; publishedVersion?: number; updatedAt?: string }; fields: Record<string, Record<string, unknown>> }) => {
            const firstField = Object.values(e.fields)[0];
            const title = firstField ? (typeof Object.values(firstField)[0] === 'string' ? Object.values(firstField)[0] as string : e.sys.id) : e.sys.id;
            return { id: e.sys.id, title, status: e.sys.publishedVersion ? 'published' : 'draft', updated: e.sys.updatedAt ? new Date(e.sys.updatedAt).toLocaleDateString() : '' };
          });
          entries.forEach((e: { title: string; id: string; status: string; updated: string }, i: number) => logger.info(`  ${i + 1}. ${e.title} (${e.id}) [${e.status}] ${e.updated}`));
          logger.success(`\n${entries.length} entries found.`);

          const data = JSON.stringify(entries.slice(0, 30));
          return { ok: true, summary: `Found ${entries.length} ${args.contentType} entries. Results as JSON:\n${data}\n\nPresent these in a markdown table with title, ID, and status.` };
        }
        case 'get_entry': {
          logger.info(`Fetching entry ${args.entryId}...`);
          const client = (await import('@/lib/contentful-client')).getClient(token);
          const entry = await client.entry.get({ spaceId: args.spaceId, environmentId: args.envId, entryId: args.entryId });
          const ct = entry.sys.contentType.sys.id;
          const fieldNames = Object.keys(entry.fields);
          logger.success(`Entry: ${args.entryId} (${ct})`);
          fieldNames.forEach(fn => {
            const lm = entry.fields[fn];
            if (!lm || typeof lm !== 'object') return;
            const locales = Object.keys(lm);
            const firstVal = lm[locales[0]];
            const preview = typeof firstVal === 'string' ? firstVal.slice(0, 120) : JSON.stringify(firstVal).slice(0, 80);
            logger.info(`  ${fn} [${locales.join(',')}]: ${preview}`);
          });
          const data = JSON.stringify({ id: args.entryId, contentType: ct, fields: Object.fromEntries(fieldNames.map(fn => [fn, '...'])) });
          return { ok: true, summary: `Entry data as JSON:\n${data}\n\nPresent this entry to the user in a clear markdown format.` };
        }
        default:
          return { ok: false, summary: `Unknown read action: ${name}` };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, summary: `Error: ${msg}` };
    }
  };

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || thinking) return;
    setInput('');
    addMsg('user', msg);
    setThinking(true);

    try {
      const spaces = { srcSpace, srcEnv, tgtSpace, tgtEnv };
      const history = [...messages, { role: 'user' as const, content: msg, ts: new Date() }];
      const apiMsgs = [
        { role: 'system', content: buildSystemPrompt(spaces) },
        ...history.filter(m => ['user', 'assistant', 'tool'].includes(m.role)).map(m => ({
          role: m.role, content: m.content || '',
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
      ];

      const reply = await callOllama(apiMsgs, TOOL_DEFS);
      let toolName: string | null = null;
      let toolArgs: Record<string, unknown> | null = null;

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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addMsg('assistant', `Could not reach Ollama. Error: ${msg}`);
    }
    setThinking(false);
  };

  if (authLoading) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Navbar />
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 py-4">
        {/* Config bar */}
        <div className="grid grid-cols-4 gap-2 mb-2">
          <label className="text-xs text-muted">Source Space<input className="w-full mt-1 px-2 py-1.5 text-sm bg-card border border-border rounded" value={srcSpace} onChange={e => setSrcSpace(e.target.value)} placeholder="Space ID" /></label>
          <label className="text-xs text-muted">Source Env<input className="w-full mt-1 px-2 py-1.5 text-sm bg-card border border-border rounded" value={srcEnv} onChange={e => setSrcEnv(e.target.value)} /></label>
          <label className="text-xs text-muted">Target Space<input className="w-full mt-1 px-2 py-1.5 text-sm bg-card border border-border rounded" value={tgtSpace} onChange={e => setTgtSpace(e.target.value)} placeholder="Space ID" /></label>
          <label className="text-xs text-muted">Target Env<input className="w-full mt-1 px-2 py-1.5 text-sm bg-card border border-border rounded" value={tgtEnv} onChange={e => setTgtEnv(e.target.value)} /></label>
        </div>
        <div className="flex items-center gap-2 mb-4 text-xs">
          <span className={`w-2 h-2 rounded-full ${ollamaOk ? 'bg-green-400' : ollamaOk === null ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
          <span className={ollamaOk ? 'text-green-400' : 'text-red-400'}>
            {ollamaOk ? `Connected · ${OLLAMA_MODEL}` : ollamaOk === null ? 'Connecting...' : 'Ollama unavailable'}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-3 mb-4">
          {messages.length === 0 && !thinking && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
              <h2 className="text-xl font-bold">AI Agent</h2>
              <p className="text-sm text-muted">Describe what you want to do with your Contentful content.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => handleSend(s)} className="text-xs px-3 py-1.5 bg-card border border-border rounded-lg hover:border-primary hover:text-primary transition-colors cursor-pointer">{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`max-w-[85%] ${m.role === 'user' ? 'self-end' : 'self-start'}`}>
              <div className={`px-4 py-3 rounded-xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-primary text-white rounded-br-sm' : 'bg-card border border-border rounded-bl-sm'}`}>
                {m.role === 'user' ? m.content : (
                  <div className="prose-sm" dangerouslySetInnerHTML={{ __html: marked.parse(m.content || '') as string }} />
                )}
                {m.jsonCard && (
                  <div className="mt-2 bg-background border border-border rounded-lg p-3">
                    <div className="text-xs font-bold uppercase tracking-wide text-primary mb-2">{m.jsonCard.tool.replace(/_/g, ' ')} — instruction</div>
                    <pre className="text-xs bg-[#0d1117] rounded p-3 overflow-x-auto max-h-72 overflow-y-auto font-mono"><code>{JSON.stringify({ tool: m.jsonCard.tool, ...m.jsonCard.args }, null, 2)}</code></pre>
                    <button onClick={() => copyJson({ tool: m.jsonCard!.tool, ...m.jsonCard!.args }, i)} className="mt-2 text-xs px-3 py-1.5 bg-primary text-white rounded hover:opacity-90 transition-opacity cursor-pointer">
                      {copiedIdx === i ? 'Copied!' : 'Copy JSON'}
                    </button>
                  </div>
                )}
              </div>
              <div className={`text-[0.65rem] text-muted mt-1 ${m.role === 'user' ? 'text-right' : ''}`}>{m.ts.toLocaleTimeString()}</div>
            </div>
          ))}
          {thinking && (
            <div className="self-start max-w-[85%]">
              <div className="px-4 py-3 rounded-xl text-sm bg-card border border-border rounded-bl-sm flex items-center gap-2">
                <span className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />Thinking...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Console */}
        {logEntries.length > 0 && (
          <div className="mb-4">
            <button onClick={() => setConsoleOpen(!consoleOpen)} className="w-full flex items-center justify-between px-3 py-1.5 bg-[#0d1117] border border-border rounded-t-lg text-xs text-muted font-mono cursor-pointer">
              <span>Console ({logEntries.length} lines)</span>
              <span>{consoleOpen ? '▼' : '▲'}</span>
            </button>
            {consoleOpen && (
              <div className="bg-[#0d1117] border border-border border-t-0 rounded-b-lg p-3 max-h-44 overflow-y-auto font-mono text-[0.7rem] leading-relaxed">
                {logEntries.map((e, i) => (
                  <div key={i} style={{ color: e.level === 'success' ? '#4ade80' : e.level === 'error' ? '#f87171' : e.level === 'warning' ? '#facc15' : '#cbd5e1' }}>{e.message}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2 border-t border-border pt-3">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={thinking || !ollamaOk} placeholder={ollamaOk ? 'Describe what you want to do...' : 'Connecting to Ollama...'}
            className="flex-1 px-4 py-2.5 text-sm bg-card border border-border rounded-lg focus:outline-none focus:border-primary" />
          <button onClick={() => handleSend()} disabled={thinking || !input.trim() || !ollamaOk}
            className="px-5 py-2.5 text-sm bg-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer">Send</button>
        </div>
      </div>
    </div>
  );
}
