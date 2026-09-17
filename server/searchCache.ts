// Caches search results per key (e.g. source + keyword) so repeated searches don't re-scrape.
//
// - Entries expire after `ttlMs`; empty results expire sooner (`emptyTtlMs`), because scrapers
//   return [] when a site blocks or fails and it's worth retrying soon.
// - At most `maxEntries` results are kept; the least recently used entry is dropped first.
// - Identical searches that overlap share one scrape instead of starting another.
// - Each caller can pass an AbortSignal. A caller that aborts gets [] immediately. The shared
//   scrape is cancelled only when every caller waiting on it has aborted, and a cancelled
//   scrape's (partial) result is never cached.

export interface SearchCacheOptions {
  ttlMs: number;
  emptyTtlMs: number;
  maxEntries: number;
  now?: () => number;
}

interface Entry<T> {
  value: T[];
  expiresAt: number;
}

interface InFlight<T> {
  promise: Promise<T[]>;
  controller: AbortController;
  waiters: number;
}

export class SearchCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inFlight = new Map<string, InFlight<T>>();
  private now: () => number;

  constructor(private options: SearchCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, load: (signal: AbortSignal) => Promise<T[]>, callerSignal?: AbortSignal): Promise<T[]> {
    if (callerSignal?.aborted) return Promise.resolve([]);

    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      // Re-insert to mark as most recently used.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(cached.value);
    }
    if (cached) this.entries.delete(key);

    const flight = this.inFlight.get(key) ?? this.start(key, load);
    return this.join(key, flight, callerSignal);
  }

  private start(key: string, load: (signal: AbortSignal) => Promise<T[]>): InFlight<T> {
    const controller = new AbortController();
    const flight: InFlight<T> = { controller, waiters: 0, promise: Promise.resolve([]) };
    flight.promise = (async () => {
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted) this.store(key, value);
        return value;
      } finally {
        if (this.inFlight.get(key) === flight) this.inFlight.delete(key);
      }
    })();
    // Callers handle errors through join(); this stops an abandoned flight's rejection going unhandled.
    flight.promise.catch(() => {});
    this.inFlight.set(key, flight);
    return flight;
  }

  private join(key: string, flight: InFlight<T>, callerSignal?: AbortSignal): Promise<T[]> {
    flight.waiters++;
    return new Promise<T[]>((resolve, reject) => {
      let left = false;
      const leave = () => {
        if (left) return false;
        left = true;
        flight.waiters--;
        callerSignal?.removeEventListener("abort", onAbort);
        return true;
      };
      const onAbort = () => {
        if (!leave()) return;
        if (flight.waiters === 0) {
          flight.controller.abort();
          if (this.inFlight.get(key) === flight) this.inFlight.delete(key);
        }
        resolve([]);
      };
      callerSignal?.addEventListener("abort", onAbort, { once: true });
      flight.promise.then(
        (value) => { if (leave()) resolve(value); },
        (err) => { if (leave()) reject(err); }
      );
    });
  }

  private store(key: string, value: T[]) {
    const ttl = value.length > 0 ? this.options.ttlMs : this.options.emptyTtlMs;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttl });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
