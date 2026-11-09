// Each mounted agenda owns its cache; private events are never shared between users.
export class CalendarMonthCache<T> {
  private entries = new Map<string, { data?: T[]; loadedAt: number; pending?: Promise<T[]> }>();
  private generation = 0;

  constructor(private maxEntries = 96, private maxAge = 60_000) {}

  peek(key: string) { return this.entries.get(key)?.data; }

  async load(key: string, loader: () => Promise<T[]>) {
    const existing = this.entries.get(key);
    if (existing?.pending) return existing.pending;
    if (existing?.data && Date.now() - existing.loadedAt < this.maxAge) return existing.data;
    const generation = this.generation;
    const entry: { data?: T[]; loadedAt: number; pending?: Promise<T[]> } = existing || { loadedAt: 0 };
    const pending = Promise.resolve().then(loader).then(data => {
      if (generation === this.generation && this.entries.get(key) === entry) {
        entry.data = data;
        entry.loadedAt = Date.now();
        this.entries.delete(key);
        this.entries.set(key, entry);
        while (this.entries.size > this.maxEntries) {
          const oldest = [...this.entries].find(([other, value]) => other !== key && !value.pending);
          if (!oldest) break;
          this.entries.delete(oldest[0]);
        }
      }
      return data;
    }).finally(() => { if (entry.pending === pending) entry.pending = undefined; });
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }

  invalidate() {
    this.generation += 1;
    for (const entry of this.entries.values()) { entry.loadedAt = 0; entry.pending = undefined; }
  }

  update(transform: (data: T[]) => T[]) {
    this.invalidate();
    for (const entry of this.entries.values()) if (entry.data) entry.data = transform(entry.data);
  }

  clear() { this.generation += 1; this.entries.clear(); }
}

export function calendarMonth(month: Date, offset = 0) {
  const start = new Date(month.getFullYear(), month.getMonth() + offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, start, end };
}
