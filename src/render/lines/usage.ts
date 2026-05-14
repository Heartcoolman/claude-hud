import type { RenderContext } from "../../types.js";
import { isLimitReached } from "../../types.js";
import type { MessageKey } from "../../i18n/types.js";
import { shouldHideUsage } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import { progressLabel } from "./label-align.js";
import type { TimeFormatMode, UsageValueMode } from "../../config.js";
import { formatResetTime } from "../format-reset-time.js";

export function renderUsageLine(
  ctx: RenderContext,
  alignLabels = false,
): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData) {
    return null;
  }

  if (shouldHideUsage(ctx.stdin)) {
    return null;
  }

  const usageLabel = progressLabel("label.usage", colors, alignLabels);

  if (ctx.usageData.balanceLabel) {
    return `${usageLabel} ${ctx.usageData.balanceLabel}`;
  }

  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const showResetLabel = display?.showResetLabel ?? true;
  const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
  const usageCompact = display?.usageCompact ?? false;
  const usageValueMode = display?.usageValue ?? 'percent';

  if (isLimitReached(ctx.usageData)) {
    const resetTime =
      ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt, timeFormat)
        : formatResetTime(ctx.usageData.sevenDayResetAt, timeFormat);
    if (usageCompact) {
      return critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors);
    }
    const resetSuffix = resetTime
      ? showResetLabel
        ? ` (${t(resetsKey)} ${resetTime})`
        : ` (${resetTime})`
      : "";
    return `${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;

  if (usageCompact) {
    const fiveHourPart = fiveHour !== null
      ? formatCompactWindowPart("5h", fiveHour, ctx.usageData.fiveHourResetAt, timeFormat, colors, usageValueMode)
      : null;
    const sevenDayPart = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
      ? formatCompactWindowPart("7d", sevenDay, ctx.usageData.sevenDayResetAt, timeFormat, colors, usageValueMode)
      : null;

    if (fiveHourPart && sevenDayPart) {
      return `${fiveHourPart} | ${sevenDayPart}`;
    }
    return fiveHourPart ?? sevenDayPart ?? null;
  }

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const barWidth = getAdaptiveBarWidth();

  if (fiveHour === null && sevenDay !== null) {
    const weeklyOnlyPart = formatUsageWindowPart({
      label: t("label.weekly"),
      labelKey: "label.weekly",
      percent: sevenDay,
      resetAt: ctx.usageData.sevenDayResetAt,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
      forceLabel: true,
      alignLabels,
      usageValueMode,
    });
    return `${usageLabel} ${weeklyOnlyPart}`;
  }

  const fiveHourPart = formatUsageWindowPart({
    label: "5h",
    percent: fiveHour,
    resetAt: ctx.usageData.fiveHourResetAt,
    colors,
    usageBarEnabled,
    barWidth,
    timeFormat,
    showResetLabel,
    usageValueMode,
  });

  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayPart = formatUsageWindowPart({
      label: t("label.weekly"),
      labelKey: "label.weekly",
      windowSuffix: "7d",
      percent: sevenDay,
      resetAt: ctx.usageData.sevenDayResetAt,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
      alignLabels,
      usageValueMode,
    });
    return `${usageLabel} ${fiveHourPart} | ${sevenDayPart}`;
  }

  return `${usageLabel} ${fiveHourPart}`;
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  timeFormat: TimeFormatMode,
  colors?: RenderContext["config"]["colors"],
  usageValueMode: UsageValueMode = 'percent',
): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext["config"]["colors"],
  mode: UsageValueMode = 'percent',
): string {
  if (percent === null) {
    return label("--", colors);
  }
  const color = getQuotaColor(percent, colors);
  const displayPercent = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
  return `${color}${displayPercent}%${RESET}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  labelKey,
  windowSuffix,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat = 'relative',
  showResetLabel,
  forceLabel = false,
  alignLabels = false,
  usageValueMode = 'percent',
}: {
  label: string;
  labelKey?: MessageKey;
  /** Override what appears after `${reset} /` inside the parens (defaults to `label`). */
  windowSuffix?: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext["config"]["colors"];
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat?: TimeFormatMode;
  showResetLabel: boolean;
  forceLabel?: boolean;
  alignLabels?: boolean;
  usageValueMode?: UsageValueMode;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat);
  const styledLabel = labelKey
    ? progressLabel(labelKey, colors, alignLabels)
    : label(windowLabel, colors);
  const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
  const suffixText = windowSuffix ?? windowLabel;

  if (usageBarEnabled) {
    // Relative mode keeps the upstream "(duration / windowLabel)" pattern
    // (e.g. "(38m / 5h)"). Absolute/both modes use the preposition form
    // ("(at 14:30)") since "(at 14:30 / 5h)" is incoherent.
    const barReset = timeFormat === 'relative'
      ? (reset ? `${reset} / ${suffixText}` : null)
      : (reset ? (showResetLabel ? `${t(resetsKey)} ${reset}` : reset) : null);
    const body = barReset
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} (${barReset})`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    // Outer label only when explicitly forced or when stacked (alignLabels) so
    // the merged-line wrapping still renders "Weekly" / "本周" prefix.
    return (forceLabel || alignLabels) ? `${styledLabel} ${body}` : body;
  }

  const resetSuffix = reset
    ? showResetLabel
      ? `(${t(resetsKey)} ${reset})`
      : `(${reset})`
    : "";
  return resetSuffix
    ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
    : `${styledLabel} ${usageDisplay}`;
}
