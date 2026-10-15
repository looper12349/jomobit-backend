# remaining_count Fix for Scheduled Changes

## Problem

When attempting to schedule a downgrade from yearly to monthly plan:
```
Error: remaining_count should be present to update to new plan which has different period
```

## Root Cause

Razorpay **requires** the `remaining_count` parameter for **BOTH** immediate AND scheduled changes when billing intervals differ (monthly ↔ yearly, etc.).

Initial assumption was wrong: `remaining_count` is NOT optional for `schedule_change_at: 'cycle_end'`.

## Why Razorpay Needs This

Even for scheduled changes at cycle end:
1. Current plan completes its cycle (e.g., 1 year)
2. At cycle end, new plan starts (e.g., monthly)
3. **Question:** How many cycles of the NEW plan should run? 1? 12? Unlimited?

Razorpay can't assume this, so they require explicit `remaining_count`.

## Solution Implemented

### 1. Created Helper Function

```javascript
function calculateRemainingCount(currentPlan, newPlan, subscription, isScheduled)
```

**Logic:**
- Returns `null` if intervals are the same (no change needed)
- Returns high number for unlimited subscriptions (`totalCount = 0`) to simulate unlimited (Razorpay requires >= 1)
  - Daily: 3650 cycles (~10 years)
  - Weekly: 520 cycles (~10 years)
  - Monthly: 120 cycles (10 years)
  - Yearly: 10 cycles (10 years)
- For scheduled changes: Calculates equivalent cycles in new interval to preserve duration
- For immediate changes: Returns `1` as default

**Examples:**

| Scenario | Current | New | totalCount | remainingCount | Result |
|----------|---------|-----|------------|----------------|--------|
| Unlimited yearly → monthly | yearly | monthly | 0 | 2 | **120** (10 years of monthly) |
| Unlimited monthly → yearly | monthly | yearly | 0 | 9 | **10** (10 years of yearly) |
| Limited yearly → monthly | yearly | monthly | 2 | 1 | **12** (365 days / 30 days) |
| Limited monthly → yearly | monthly | yearly | 12 | 9 | **1** (270 days / 365 days) |
| Same interval | monthly | monthly | 12 | 9 | **null** (not needed) |

### 2. Updated Immediate Changes

```javascript
const updateParams = {
  plan_id: newPlan.razorpayPlanId,
  schedule_change_at: 'now',
  quantity: 1
};

const remainingCount = calculateRemainingCount(currentPlan, newPlan, subscription, false);
if (remainingCount !== null) {
  updateParams.remaining_count = remainingCount;
}
```

### 3. Updated Scheduled Changes

```javascript
const updateParams = {
  plan_id: newPlan.razorpayPlanId,
  schedule_change_at: 'cycle_end',
  quantity: 1
};

const remainingCount = calculateRemainingCount(currentPlan, newPlan, subscription, true);
if (remainingCount !== null) {
  updateParams.remaining_count = remainingCount;
}
```

## Test Case: Your Scenario

**Request:**
- From: `max_annual` (yearly, ₹880)
- To: `pro_monthly` (monthly, ₹26)
- Type: Downgrade
- Schedule: cycle_end
- Subscription: `totalCount = 0` (unlimited)

**Calculation:**
1. Intervals differ: yearly ≠ monthly ✓
2. Unlimited subscription: `totalCount = 0` ✓
3. New interval: monthly
4. Result: `remaining_count = 120` (10 years of monthly cycles)

**Razorpay Update:**
```javascript
{
  plan_id: "plan_RRwlDw0IGfELNA",
  schedule_change_at: "cycle_end",
  quantity: 1,
  remaining_count: 120  // ← 10 years of monthly cycles to simulate unlimited
}
```

**Note:** Razorpay requires `remaining_count >= 1`, so we can't use `0` for unlimited. Instead, we use a high number (10 years worth of cycles) to effectively simulate unlimited behavior.

## Benefits

1. **Handles unlimited subscriptions correctly** - uses high cycle count to simulate unlimited (10 years)
2. **Preserves subscription duration** - converts remaining cycles appropriately for limited subscriptions
3. **Works for all interval combinations** - daily, weekly, monthly, yearly
4. **Single source of logic** - DRY principle, easier to maintain
5. **Proper logging** - tracks calculation reasoning
6. **Razorpay compliant** - respects the `remaining_count >= 1` requirement

## Files Modified

- `src/controllers/subscriptionController.js` - Added helper function and updated both immediate and scheduled change logic
- `SCHEDULED_CHANGE_REFACTOR.md` - Updated documentation

## Testing

Test these scenarios:
- [ ] Unlimited yearly → monthly (downgrade, scheduled)
- [ ] Unlimited monthly → yearly (upgrade, immediate)
- [ ] Limited yearly → monthly (downgrade, scheduled)
- [ ] Limited monthly → yearly (upgrade, immediate)
- [ ] Same interval changes (should not add remaining_count)
- [ ] Verify webhook processes changes correctly
- [ ] Verify unlimited subscriptions get high remaining_count (120 for monthly, 10 for yearly)
- [ ] Verify subscription continues for extended period after change
