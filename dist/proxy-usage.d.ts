import type { HudConfig } from './config.js';
import type { ProxyUsageData } from './types.js';
/**
 * Read the cached reclaude.ai carpool quota and compute display fields.
 *
 * Side-effect: when the cache is stale (older than `cacheTTLMs`) or missing,
 * spawns a detached background fetcher and returns whatever cached data we
 * have right now (or null). The next statusline tick will see fresh data.
 *
 * Returns null when:
 *   - feature disabled or no cookie configured
 *   - cache absent (first run / never fetched)
 *   - cache older than `maxStaleMs`
 *   - upstream reports `enabled: false` or `status !== "active"`
 *   - quota_usd is non-positive or unparseable
 */
export declare function getProxyUsage(config: HudConfig, now?: number): ProxyUsageData | null;
/**
 * Returns 'login_required' when a recent auth-error sentinel is present.
 * Returns null when there's no sentinel, it's stale, or feature disabled.
 */
export declare function getProxyAuthStatus(config: HudConfig, now?: number): 'login_required' | null;
//# sourceMappingURL=proxy-usage.d.ts.map