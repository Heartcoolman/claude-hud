import { shouldHideUsage } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import { progressLabel } from "./label-align.js";
import { formatResetTime } from "../format-reset-time.js";
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
export function renderProxyLine(ctx, alignLabels = false) {
    const display = ctx.config?.display;
    const colors = ctx.config?.colors;
    if (display?.showUsage === false)
        return null;
    if (shouldHideUsage(ctx.stdin))
        return null;
    if (!ctx.proxyUsage && !ctx.proxyAuthStatus)
        return null;
    const timeFormat = display?.timeFormat ?? 'relative';
    const showResetLabel = display?.showResetLabel ?? true;
    const usageCompact = display?.usageCompact ?? false;
    const usageBarEnabled = display?.usageBarEnabled ?? true;
    const barWidth = getAdaptiveBarWidth();
    if (ctx.proxyUsage) {
        return usageCompact
            ? formatCompactProxyPart(ctx.proxyUsage, timeFormat, colors)
            : formatProxyWindowPart({
                proxyUsage: ctx.proxyUsage,
                colors,
                usageBarEnabled,
                barWidth,
                timeFormat,
                showResetLabel,
                alignLabels,
            });
    }
    // Auth-error sentinel — render warning instead of hiding
    if (ctx.proxyAuthStatus === 'login_required') {
        const proxyLabel = usageCompact
            ? label("proxy:", colors)
            : progressLabel("label.proxy", colors, alignLabels);
        return `${proxyLabel} ${critical(`⚠ ${t('status.loginRequired')}`, colors)}`;
    }
    return null;
}
function formatUsagePercent(percent, colors) {
    if (percent === null)
        return label("--", colors);
    const color = getQuotaColor(percent, colors);
    return `${color}${percent}%${RESET}`;
}
function formatMoney(used, quota) {
    const usedStr = used.toFixed(2);
    const quotaStr = Number.isInteger(quota) ? quota.toFixed(0) : quota.toFixed(2);
    return `$${usedStr}/$${quotaStr}`;
}
/** 5-hour rolling window expressed in milliseconds (matches reclaude.ai cap). */
const FIVE_HOUR_MS = 5 * 3600 * 1000;
function computeTimePercent(resetAt, now = Date.now()) {
    if (!resetAt)
        return null;
    const remainingMs = resetAt.getTime() - now;
    if (!Number.isFinite(remainingMs))
        return null;
    const elapsedMs = Math.max(0, Math.min(FIVE_HOUR_MS, FIVE_HOUR_MS - remainingMs));
    return Math.round((elapsedMs / FIVE_HOUR_MS) * 100);
}
function formatProxyWindowPart({ proxyUsage, colors, usageBarEnabled, barWidth, timeFormat, showResetLabel, alignLabels, }) {
    const styledLabel = progressLabel("label.proxy", colors, alignLabels);
    const moneyPercentDisplay = formatUsagePercent(proxyUsage.percent, colors);
    const reset = formatResetTime(proxyUsage.resetAt, timeFormat);
    const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
    const money = formatMoney(proxyUsage.usedUsd, proxyUsage.quotaUsd);
    if (usageBarEnabled) {
        // Money bar: spend / cap
        const moneyBar = `${label("$", colors)} ${quotaBar(proxyUsage.percent, barWidth, colors)} ${moneyPercentDisplay} ${label(`(${money})`, colors)}`;
        // Time bar: elapsed share of the 5-hour rolling window
        const timePercent = computeTimePercent(proxyUsage.resetAt);
        if (timePercent !== null) {
            const timePercentDisplay = formatUsagePercent(timePercent, colors);
            let timeText = "";
            if (reset) {
                if (timeFormat === 'relative') {
                    timeText = `${reset} / 5h`;
                }
                else if (showResetLabel) {
                    timeText = `${t(resetsKey)} ${reset}`;
                }
                else {
                    timeText = reset;
                }
            }
            const timeSuffix = timeText ? ` ${label(`(${timeText})`, colors)}` : "";
            const timeBar = `${label("⏱", colors)} ${quotaBar(timePercent, barWidth, colors)} ${timePercentDisplay}${timeSuffix}`;
            return `${styledLabel} ${moneyBar} | ${timeBar}`;
        }
        return `${styledLabel} ${moneyBar}`;
    }
    // Text-only mode: keep single-line compact rendering
    const styledMoney = label(money, colors);
    const resetSuffix = reset
        ? showResetLabel
            ? `(${t(resetsKey)} ${reset})`
            : `(${reset})`
        : "";
    return resetSuffix
        ? `${styledLabel} ${moneyPercentDisplay} ${styledMoney} ${resetSuffix}`
        : `${styledLabel} ${moneyPercentDisplay} ${styledMoney}`;
}
function formatCompactProxyPart(proxyUsage, timeFormat, colors) {
    const usageDisplay = formatUsagePercent(proxyUsage.percent, colors);
    const reset = formatResetTime(proxyUsage.resetAt, timeFormat);
    const styledLabel = label("proxy:", colors);
    const styledMoney = label(formatMoney(proxyUsage.usedUsd, proxyUsage.quotaUsd), colors);
    return reset
        ? `${styledLabel} ${usageDisplay} ${styledMoney} ${label(`(${reset})`, colors)}`
        : `${styledLabel} ${usageDisplay} ${styledMoney}`;
}
//# sourceMappingURL=proxy.js.map