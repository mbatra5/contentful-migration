'use client';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [tokenInput, setTokenInput] = useState('');
  const { login, loading, error, isAuthenticated } = useAuth();
  const router = useRouter();

  if (isAuthenticated) {
    router.push('/dashboard');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    await login(trimmed);
    if (!error) router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Contentful Migrator</h1>
          <p className="mt-2 text-muted text-sm">
            Extract, migrate, and transform content across Contentful spaces.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-xl border border-border">
          <div>
            <label className="block text-sm font-medium mb-2">CMA Token</label>
            <input
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="CFPAT-xxxxxxxxxxxxxxxxxx"
              className="w-full"
              autoFocus
            />
            <p className="mt-1.5 text-xs text-muted">
              Generate at{' '}
              <a
                href="https://app.contentful.com/account/profile/cma_tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Contentful &rarr; Settings &rarr; CMA Tokens
              </a>
            </p>
          </div>

          {error && (
            <div className="text-sm text-error bg-error/10 px-3 py-2 rounded-lg">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !tokenInput.trim()}
            className="w-full py-2.5 px-4 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>

        <p className="text-center text-xs text-muted">
          Your token is stored in browser session memory only. It is never sent to any server.
        </p>
      </div>
    </div>
  );
}
