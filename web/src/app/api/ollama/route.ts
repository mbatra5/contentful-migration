import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OLLAMA_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const ollamaRes = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      return NextResponse.json({ error: text }, { status: ollamaRes.status });
    }

    const data = await ollamaRes.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to reach Ollama cloud';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
