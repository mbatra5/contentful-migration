export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OLLAMA_API_KEY not configured' });
    return;
  }

  try {
    const ollamaRes = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      res.status(ollamaRes.status).json({ error: text });
      return;
    }

    const data = await ollamaRes.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Failed to reach Ollama cloud' });
  }
}
