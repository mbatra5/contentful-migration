'use client';
import { useState, useEffect, useCallback } from 'react';
import { getToken, setToken as saveToken, clearToken } from '@/lib/auth';
import { getCurrentUser } from '@/lib/contentful-client';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getToken();
    if (stored) {
      setTokenState(stored);
      getCurrentUser(stored)
        .then(setUser)
        .catch(() => { clearToken(); setTokenState(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (newToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const u = await getCurrentUser(newToken);
      saveToken(newToken);
      setTokenState(newToken);
      setUser(u);
    } catch {
      setError('Invalid token. Make sure it starts with CFPAT- and has not expired.');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  return { token, user, loading, error, login, logout, isAuthenticated: !!token };
}
