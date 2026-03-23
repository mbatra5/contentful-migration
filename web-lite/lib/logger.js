export function createLogger() {
  let entries = [];
  let listeners = new Set();

  const add = (msg, level) => {
    const e = { ts: new Date(), level, message: msg };
    entries.push(e);
    listeners.forEach(fn => fn());
  };

  return {
    info: m => add(m, 'info'),
    success: m => add(m, 'success'),
    warn: m => add(m, 'warning'),
    error: m => add(m, 'error'),
    getEntries: () => entries,
    clear: () => { entries = []; listeners.forEach(fn => fn()); },
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    toText: () => entries.map(e =>
      `[${e.ts.toISOString().replace('T', ' ').slice(0, 19)}] [${e.level.toUpperCase()}] ${e.message}`
    ).join('\n'),
  };
}
