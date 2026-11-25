/**
 * Picks which Gemini model to use for the next request. When a model is busy
 * ("high demand") or hits its limit, the next one in the list is used instead,
 * so translation keeps going while one model is overloaded.
 */

export type ModelProblem = 'busy' | 'rate' | 'daily';

export class ModelPool {
  private readonly models: string[];
  private readonly busyUntil = new Map<string, number>();
  private readonly exhausted = new Set<string>();

  constructor(preferred: string, others: string[], private readonly now: () => number = Date.now) {
    this.models = [preferred, ...others.filter((m) => m && m !== preferred)].filter(Boolean);
  }

  /** The model to use now, or how long to wait for one, or null if none are left today. */
  pick(): { model: string } | { waitMs: number } | null {
    const t = this.now();
    let soonest = Infinity;
    for (const m of this.models) {
      if (this.exhausted.has(m)) continue;
      const until = this.busyUntil.get(m) ?? 0;
      if (until <= t) return { model: m };
      soonest = Math.min(soonest, until - t);
    }
    return soonest === Infinity ? null : { waitMs: soonest };
  }

  report(model: string, problem: ModelProblem, retryAfterMs?: number) {
    if (problem === 'daily') {
      this.exhausted.add(model);
      return;
    }
    // A busy model is left alone for a minute; a rate limit for as long as Google asks.
    const pause = problem === 'busy' ? 60_000 : Math.max(5_000, retryAfterMs ?? 20_000);
    this.busyUntil.set(model, this.now() + pause);
  }

  /** Short name for showing on screen, e.g. "gemini-…-flash". */
  static label(model: string): string {
    return model.replace(/^models\//, '');
  }
}
