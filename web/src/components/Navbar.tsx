'use client';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

export function Navbar() {
  const { user, logout, isAuthenticated } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <nav className="border-b border-border px-6 py-3 flex items-center justify-between bg-card">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-bold text-foreground hover:text-primary transition-colors">
          Contentful Migrator
        </Link>
        <Link href="/dashboard" className="text-sm text-muted hover:text-foreground transition-colors">
          Manual
        </Link>
        <Link href="/agent" className="text-sm text-muted hover:text-foreground transition-colors">
          AI Agent
        </Link>
      </div>
      {user && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">{user.firstName} {user.lastName}</span>
          <button onClick={logout} className="text-error hover:underline cursor-pointer">
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}
