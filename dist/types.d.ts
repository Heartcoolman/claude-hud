import type { HudConfig } from './config.js';
import type { GitStatus } from './git.js';
export interface StdinData {
    transcript_path?: string;
    cwd?: string;
    workspace?: {
        current_dir?: string;
        project_dir?: string;
        added_dirs?: string[];
        git_worktree?: string;
    } | null;
    model?: {
        id?: string;
        display_name?: string;
    };
    context_window?: {
        context_window_size?: number;
        total_input_tokens?: number | null;
        total_output_tokens?: number | null;
        current_usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        } | null;
        used_percentage?: number | null;
        remaining_percentage?: number | null;
    };
    cost?: {
        total_cost_usd?: number | null;
        total_duration_ms?: number | null;
        total_api_duration_ms?: number | null;
        total_lines_added?: number | null;
        total_lines_removed?: number | null;
    } | null;
    rate_limits?: {
        five_hour?: {
            used_percentage?: number | null;
            resets_at?: number | null;
        } | null;
        seven_day?: {
            used_percentage?: number | null;
            resets_at?: number | null;
        } | null;
    } | null;
    effort?: string | {
        level?: string | null;
        [key: string]: unknown;
    } | null;
}
export interface ToolEntry {
    id: string;
    name: string;
    target?: string;
    status: 'running' | 'completed' | 'error';
    startTime: Date;
    endTime?: Date;
}
export interface AgentEntry {
    id: string;
    type: string;
    model?: string;
    description?: string;
    status: 'running' | 'completed';
    startTime: Date;
    endTime?: Date;
}
export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
export interface UsageData {
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: Date | null;
    sevenDayResetAt: Date | null;
}
export interface ExternalUsageSnapshot {
    five_hour?: {
        used_percentage?: number | null;
        resets_at?: string | number | null;
    } | null;
    seven_day?: {
        used_percentage?: number | null;
        resets_at?: string | number | null;
    } | null;
    updated_at?: string | number | null;
}
/**
 * Carpool / proxy provider 5-hour usage (e.g. reclaude.ai).
 *
 * This sits alongside Anthropic's native `rate_limits` (UsageData) — the
 * proxy account has its own 5h cap measured in USD, independent of the
 * upstream Anthropic 5h percentage exposed via stdin.
 */
export interface ProxyUsageData {
    /** USD already spent in current 5h window. */
    usedUsd: number;
    /** USD cap for current 5h window. */
    quotaUsd: number;
    /** 0-100, derived from used / quota and clamped. */
    percent: number;
    /** When the 5h window resets. null when the upstream omits it. */
    resetAt: Date | null;
    /** When the snapshot was fetched (UNIX ms). Used for staleness checks. */
    fetchedAt: number;
}
export interface MemoryInfo {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
}
/** Check if usage limit is reached (either window at 100%) */
export declare function isLimitReached(data: UsageData): boolean;
export interface SessionTokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
}
export interface TranscriptData {
    tools: ToolEntry[];
    agents: AgentEntry[];
    todos: TodoItem[];
    sessionStart?: Date;
    sessionName?: string;
    lastAssistantResponseAt?: Date;
    sessionTokens?: SessionTokenUsage;
    lastCompactBoundaryAt?: Date;
    lastCompactPostTokens?: number;
}
export interface RenderContext {
    stdin: StdinData;
    transcript: TranscriptData;
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
    sessionDuration: string;
    gitStatus: GitStatus | null;
    usageData: UsageData | null;
    proxyUsage: ProxyUsageData | null;
    proxyAuthStatus: 'login_required' | null;
    memoryUsage: MemoryInfo | null;
    config: HudConfig;
    extraLabel: string | null;
    outputStyle?: string;
    claudeCodeVersion?: string;
    effortLevel?: string;
    effortSymbol?: string;
}
//# sourceMappingURL=types.d.ts.map