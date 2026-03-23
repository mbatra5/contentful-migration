'use client';
import { useState, useRef, useCallback } from 'react';
import { Logger, type LogEntry } from '@/lib/logger';

export function useLogger() {
  const loggerRef = useRef(new Logger());
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const subscribe = useCallback(() => {
    const unsub = loggerRef.current.subscribe(() => {
      setEntries([...loggerRef.current.getEntries()]);
    });
    return () => { unsub(); };
  }, []);

  const clear = useCallback(() => {
    loggerRef.current.clear();
    setEntries([]);
  }, []);

  const download = useCallback(() => {
    const text = loggerRef.current.toText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return { logger: loggerRef.current, entries, subscribe, clear, download };
}
