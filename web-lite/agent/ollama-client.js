const LOCAL_BASE = 'http://localhost:11434';
const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

const LOCAL_MODEL = 'gpt-oss:120b-cloud';
const CLOUD_MODEL = 'gpt-oss:20b';
export const OLLAMA_MODEL = isLocal ? LOCAL_MODEL : CLOUD_MODEL;

export async function checkOllama() {
  try {
    if (isLocal) {
      const r = await fetch(`${LOCAL_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return false;
      const data = await r.json();
      return (data.models || []).some(m => m.name.startsWith('gpt-oss'));
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

export async function callOllama(messages, tools) {
  if (isLocal) {
    const res = await fetch(`${LOCAL_BASE}/api/chat`, {
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

  const res = await fetch('/api/ollama', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, tools, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama cloud error ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.message;
}
