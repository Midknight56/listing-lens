// Daily limits for Staging Brief.
export const DAILY_QLOO_CALLS = 500; // 500 x 27 days = 13,500, or 27% of the 50,000 monthly shared quota.
export const DAILY_QLOO_CALLS_PER_VISITOR = 48; // 3 fresh runs x 16 calls per run.
export const DAILY_FRESH_RUNS_PER_VISITOR = 3; // 3 fresh visitor runs each day.
export const DAILY_PLAIN_PER_VISITOR = 2; // 2 plain tabs x 1 writing call each.
export const DEFAULT_DAILY_NEURONS = 450; // 3,500 + 700 + 700 + 2,000 + 1,500 + 450 + 450 = 9,300 <= 9,500.
export const DEFAULT_ACCOUNT_NEURONS = 9500; // Shared account allowance, below the 10,000 free daily cap.
// The room held in the ledger before each writing call; the row then takes the call's real cost, even when it is more.
// Measured in the shared ledger: largest observed call 48.4, mean 29.3. Reserve = 48.4 x 1.5 = 72.6, rounded up to 73.
export const MAX_CALL_NEURONS = 73;
export const MAX_RUN_QLOO_CALLS = 16; // 3 anchors + 1 place + 1 relax + 3 sections + 6 room + 1 audit + 1 relax.
