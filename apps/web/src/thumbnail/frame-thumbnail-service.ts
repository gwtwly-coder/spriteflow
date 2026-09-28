import type {
  AssetRef,
  Frame,
  PipelineClient,
  PipelineError,
  PixelBuffer,
  Rect,
} from "@spriteflow/pipeline";

export const THUMBNAIL_MAX_DIMENSION = 112;
export const PLAYER_MAX_DIMENSION = 320;
export const THUMBNAIL_CACHE_LIMIT_BYTES = 32 * 1024 * 1024;

type CacheKind = "thumbnail" | "player";
type PendingTask = {
  cancel(): Promise<unknown>;
  result: Promise<{ outcome: { ok: boolean; value?: unknown; error?: PipelineError } }>;
};
type QueueEntry = {
  key: string;
  asset: AssetRef;
  sourceRect: Rect;
  generation: number;
  kind: CacheKind;
  maxDimension: number;
  resolve: (pixels: PixelBuffer) => void;
  reject: (reason: Error) => void;
};
type CachedPixels = { pixels: PixelBuffer; bytes: number; usedAt: number };

/** Schedules small preview crops without competing with foreground pipeline work. */
export class FrameThumbnailService {
  private readonly thumbnailCache = new Map<string, CachedPixels>();
  // Q2 will use this second cache. Its bytes already count toward the shared budget.
  private readonly playerCache = new Map<string, CachedPixels>();
  private readonly pending = new Map<string, QueueEntry>();
  private active: { entry: QueueEntry; task: PendingTask | null } | null = null;
  private cacheBytes = 0;
  private generation = 0;
  private usage = 0;
  private paused = false;
  private scheduled = false;

  constructor(
    private readonly getClient: () => Promise<PipelineClient>,
    private readonly isUserTaskActive: () => boolean,
  ) {}

  requestThumbnail(asset: AssetRef, frame: Frame, scope: string): Promise<PixelBuffer> {
    return this.request("thumbnail", THUMBNAIL_MAX_DIMENSION, asset, frame, scope);
  }

  requestPlayer(asset: AssetRef, frame: Frame, scope: string): Promise<PixelBuffer> {
    return this.request("player", PLAYER_MAX_DIMENSION, asset, frame, scope);
  }

  private request(
    kind: CacheKind,
    maxDimension: number,
    asset: AssetRef,
    frame: Frame,
    scope: string,
  ): Promise<PixelBuffer> {
    if (!frame.bbox) return Promise.reject(new Error("Frame has no preview bounds"));
    const key = this.key(kind, asset, frame, scope);
    const cached = this.getCached(kind, key);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) {
      return new Promise((resolve, reject) => {
        const priorResolve = existing.resolve;
        const priorReject = existing.reject;
        existing.resolve = (pixels) => {
          priorResolve(pixels);
          resolve(pixels);
        };
        existing.reject = (error) => {
          priorReject(error);
          reject(error);
        };
      });
    }
    return new Promise((resolve, reject) => {
      this.pending.set(key, {
        key,
        asset,
        sourceRect: frame.bbox as Rect,
        generation: this.generation,
        kind,
        maxDimension,
        resolve,
        reject,
      });
      this.schedule();
    });
  }

  pauseForUserTask() {
    this.paused = true;
    void this.active?.task?.cancel();
  }

  resumeAfterUserTask() {
    this.paused = false;
    this.schedule();
  }

  invalidate() {
    this.generation += 1;
    this.thumbnailCache.clear();
    this.playerCache.clear();
    this.cacheBytes = 0;
    for (const entry of this.pending.values())
      entry.reject(new Error("Thumbnail request is stale"));
    this.pending.clear();
    void this.active?.task?.cancel();
  }

  dispose() {
    this.invalidate();
    this.paused = true;
  }

  private key(kind: CacheKind, asset: AssetRef, frame: Frame, scope: string) {
    const rect = frame.bbox as Rect;
    return [
      kind,
      scope,
      asset.assetId,
      asset.revision,
      frame.id,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    ].join(":");
  }

  private getCached(kind: CacheKind, key: string) {
    const cache = kind === "thumbnail" ? this.thumbnailCache : this.playerCache;
    const entry = cache.get(key);
    if (!entry) return null;
    entry.usedAt = ++this.usage;
    return entry.pixels;
  }

  private putCached(kind: CacheKind, key: string, pixels: PixelBuffer) {
    const cache = kind === "thumbnail" ? this.thumbnailCache : this.playerCache;
    const prior = cache.get(key);
    if (prior) this.cacheBytes -= prior.bytes;
    const entry = { pixels, bytes: pixels.data.byteLength, usedAt: ++this.usage };
    cache.set(key, entry);
    this.cacheBytes += entry.bytes;
    while (this.cacheBytes > THUMBNAIL_CACHE_LIMIT_BYTES) this.evictOldest();
  }

  private evictOldest() {
    const candidates = [...this.thumbnailCache.entries(), ...this.playerCache.entries()];
    const oldest = candidates.reduce<[string, CachedPixels, CacheKind] | null>(
      (result, [key, entry]) =>
        !result || entry.usedAt < result[1].usedAt
          ? [key, entry, this.thumbnailCache.has(key) ? "thumbnail" : "player"]
          : result,
      null,
    );
    if (!oldest) return;
    const cache = oldest[2] === "thumbnail" ? this.thumbnailCache : this.playerCache;
    cache.delete(oldest[0]);
    this.cacheBytes -= oldest[1].bytes;
  }

  private schedule() {
    if (this.scheduled || this.paused || this.isUserTaskActive() || !this.pending.size) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      void this.drain();
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 200 });
    } else {
      globalThis.setTimeout(run, 0);
    }
  }

  private async drain() {
    if (this.active || this.paused || this.isUserTaskActive()) return;
    const entry = this.pending.values().next().value as QueueEntry | undefined;
    if (!entry) return;
    this.active = { entry, task: null };
    try {
      const client = await this.getClient();
      if (this.paused || this.isUserTaskActive()) return;
      const task = client.submit("preview", {
        asset: entry.asset,
        sourceRect: entry.sourceRect,
        maxDimension: entry.maxDimension,
      }) as PendingTask;
      this.active.task = task;
      const response = await task.result;
      if (!response.outcome.ok) throw response.outcome.error ?? new Error("Preview failed");
      if (entry.generation !== this.generation || !this.pending.has(entry.key)) return;
      const pixels = response.outcome.value as PixelBuffer;
      this.putCached(entry.kind, entry.key, pixels);
      this.pending.delete(entry.key);
      entry.resolve(pixels);
    } catch (error) {
      if (!this.paused && this.pending.get(entry.key) === entry) {
        this.pending.delete(entry.key);
        entry.reject(error instanceof Error ? error : new Error("Preview failed"));
      }
    } finally {
      this.active = null;
      this.schedule();
    }
  }
}
