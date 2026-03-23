const LOCAL_BASE = 'http://localhost:11434';
const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const OLLAMA_MODEL = 'gpt-oss:20b';

export async function checkOllama(): Promise<boolean> {
  try {
    if (isLocal) {
      const r = await fetch(`${LOCAL_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;
      const data = await r.json();
      return (data.models || []).some((m: { name: string }) => m.name.startsWith('gpt-oss'));
    }
    const r = await fetch('/api/ollama', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: 'user', content: 'hi' }], stream: false }),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: string | Record<string, unknown> } }>;
}

interface ToolDef {
  type: string;
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export async function callOllama(messages: OllamaMessage[], tools: ToolDef[]): Promise<OllamaMessage> {
  const endpoint = isLocal ? `${LOCAL_BASE}/api/chat` : '/api/ollama';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, tools, stream: false }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.message;
}
