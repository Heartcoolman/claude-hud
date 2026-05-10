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
 * the surrounding usage area is hidden (Bedrock provider, showUsage off).
 */
export declare function renderProxyLine(ctx: RenderContext, alignLabels?: boolean): string | null;
//# sourceMappingURL=proxy.d.ts.map