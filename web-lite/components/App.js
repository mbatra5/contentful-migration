import { html, render, useState, useEffect, useRef } from '../lib/preact.js';
import { getCurrentUser } from '../lib/contentful-client.js';
import { createLogger } from '../lib/logger.js';
import { LoginPage } from './LoginPage.js';
import { Workspace } from './Workspace.js';

function App() {
  const [token, setToken] = useState(sessionStorage.getItem('cma_token') || '');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(!!sessionStorage.getItem('cma_token'));
  const [authError, setAuthError] = useState('');
  const log = useRef(createLogger()).current;

  useEffect(() => {
    const stored = sessionStorage.getItem('cma_token');
    if (stored) {
      getCurrentUser(stored)
        .then(u => { setUser(u); setToken(stored); })
        .catch(() => { sessionStorage.removeItem('cma_token'); setToken(''); })
        .finally(() => setAuthLoading(false));
    }
  }, []);

  const handleLogin = async (rawToken) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const u = await getCurrentUser(rawToken);
      sessionStorage.setItem('cma_token', rawToken);
      setToken(rawToken);
      setUser(u);
    } catch {
      setAuthError('Invalid token. Make sure it starts with CFPAT- and has not expired.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => { sessionStorage.removeItem('cma_token'); setToken(''); setUser(null); };

  if (authLoading) return html`<div class="login-wrap"><div class="text-muted">Connecting...</div></div>`;
  if (!token || !user) return html`<${LoginPage} onLogin=${handleLogin} loading=${authLoading} error=${authError} />`;
  return html`<${Workspace} token=${token} user=${user} onLogout=${handleLogout} log=${log} />`;
}

render(html`<${App} />`, document.getElementById('app'));
