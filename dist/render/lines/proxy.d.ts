import type { RenderContext } from "../../types.js";
/**
 * Renders the standalone reclaude.ai (carpool/proxy) usage line.
 *
 * Shape (expanded):
 *   "ReClaude ▓▓▓▓░░░░░░ 79% ($39.33/$50 18m/5h)"
 *   "ReClaude ⚠ login required"     (when auth sentinel present)
 * Shape (compact mode, usageCompact: true):
 *   "proxy: 79% $39.33/$50 (18m)"
 *
 * Returns null when there's no data and no auth warning to show, or when
 * the provider hides usage (Bedrock).
 *
 * NOTE: this renderer is intentionally NOT gated by `display.showUsage`.
 * `showUsage` controls Anthropic-native rate-limit reading; ReClaude is
 * a separate quota stream gated by `display.reclaude.enabled` inside the
 * data-loading layer (`getProxyUsage` / `getProxyAuthStatus`).
 */
export declare function renderProxyLine(ctx: RenderContext, alignLabels?: boolean): string | null;
//# sourceMappingURL=proxy.d.ts.map