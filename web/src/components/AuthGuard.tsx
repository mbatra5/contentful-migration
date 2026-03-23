'use client';
import { useAuth } from '@/hooks/useAuth';
import { createContext, useContext, type ReactNode } from 'react';

interface AuthContextValue {
  token: string;
  user: { id: string; email: string; firstName: string; lastName: string };
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthGuard');
  return ctx;
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const { token, user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted animate-pulse">Connecting...</div>
      </div>
    );
  }

  if (!isAuthenticated || !token || !user) {
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  return (
    <AuthContext.Provider value={{ token, user, logout: () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}
