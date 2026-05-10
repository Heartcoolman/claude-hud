export interface LoginAttemptInput {
    email: string;
    passwordKeychainService: string;
    cacheDir: string;
    timeoutMs: number;
    now?: number;
}
/**
 * Attempt one login. Returns the new rc_sid value on success, or null.
 * Honours and updates a cooldown file to throttle repeated 401s.
 */
export declare function loginAndExtractRcSid(input: LoginAttemptInput): Promise<string | null>;
//# sourceMappingURL=proxy-login.d.ts.map