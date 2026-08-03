export interface CacheEntry<T> {
  key: string;
  value: T;
  insertedAt: number;
}

export interface TileCache<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  set(key: string, value: T): void;
  delete(key: string): boolean;
  clear(): void;
  size(): number;
}

export interface TileLoader<T> {
  load(key: string): Promise<T>;
}

export class MemoryTileCache<T> implements TileCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(key: string, value: T): void {
    this.entries.set(key, { key, value, insertedAt: Date.now() });
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * A cache-backed loader that coalesces concurrent requests for the same tile.
 * The loader is deliberately provider-neutral: a future approved adapter can
 * supply local filesystem, worker, or 3D Tiles-backed loading without changing
 * the viewport contract.
 */
export class DeduplicatingTileLoader<T> {
  private readonly pending = new Map<string, Promise<T>>();
  private readonly cache: TileCache<T>;

  constructor(cache: TileCache<T>) {
    this.cache = cache;
  }

  async load(key: string, loader: TileLoader<T>["load"]): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = loader(key)
      .then((value) => {
        this.cache.set(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
