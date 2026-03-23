export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
}

export type LogListener = (entry: LogEntry) => void;

export class Logger {
  private entries: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();

  log(message: string, level: LogLevel = 'info') {
    const entry: LogEntry = { timestamp: new Date(), level, message };
    this.entries.push(entry);
    this.listeners.forEach(fn => fn(entry));
  }

  info(message: string) { this.log(message, 'info'); }
  success(message: string) { this.log(message, 'success'); }
  warn(message: string) { this.log(message, 'warning'); }
  error(message: string) { this.log(message, 'error'); }

  subscribe(fn: LogListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
  }

  toText(): string {
    return this.entries.map(e => {
      const ts = e.timestamp.toISOString().replace('T', ' ').slice(0, 19);
      return `[${ts}] [${e.level.toUpperCase()}] ${e.message}`;
    }).join('\n');
  }
}
