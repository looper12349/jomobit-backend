# Scheduled Plan Change Refactor

## Problem Identified

The original implementation used a cron job (`runScheduledPlanChangeJob`) to process scheduled plan changes. This approach had several issues:

1. **Unnecessary Dependency**: Your codebase was responsible for timing that Razorpay already handles
2. **Reliability Risk**: If server is down when job runs, changes get delayed
3. **Complexity**: Maintaining state (`scheduledChange` field) that duplicates Razorpay's scheduling
4. **Long-term Risk**: For yearly plans, maintaining state for 12 months
5. **Job Timing**: Job runs every 6 hours, causing potential delays up to 6 hours after effective date

## Solution: Let Razorpay Handle It

Razorpay's subscription update API supports `schedule_change_at` parameter:
- `"now"` - immediate change
- `"cycle_end"` - change at end of current billing cycle
- Unix timestamp - change at specific time

### New Flow

**For Scheduled Changes (Downgrades or any cycle_end changes):**

```javascript
await razorpay.subscriptions.update(
  subscription.razorpaySubscriptionId,
  {
    plan_id: newPlan.razorpayPlanId,
    schedule_change_at: 'cycle_end',
    quantity: 1
  }
);
```

Razorpay will:
1. Store the scheduled change on their side
2. Execute it at the right time (end of billing cycle)
3. Send `subscription.updated` webhook when it happens
4. You update your DB in response to the webhook

## Key Implementation Details

### remaining_count Parameter

**IMPORTANT:** Razorpay requires `remaining_count` for **BOTH** immediate and scheduled changes when billing intervals differ.

**For Immediate Changes (`schedule_change_at: 'now'`):**
- ✅ **Required** when billing intervals differ (monthly ↔ yearly)
- Razorpay needs to know how to handle remaining cycles mid-cycle
- Logic: Use helper function to calculate based on subscription type

**For Scheduled Changes (`schedule_change_at: 'cycle_end'`):**
- ✅ **Also Required** when billing intervals differ
- Even though current cycle completes naturally, Razorpay needs to know how many cycles of the NEW plan to run
- Logic: Calculate equivalent cycles in new interval to preserve subscription duration

**Calculation Logic:**
- **Unlimited subscriptions** (`totalCount = 0`): Set high `remaining_count` to simulate unlimited (Razorpay requires >= 1)
  - Monthly: 120 cycles (10 years)
  - Yearly: 10 cycles (10 years)
- **Limited subscriptions**: Convert remaining days to equivalent cycles in new interval
- **Immediate changes**: Default to `1` cycle if calculation not applicable

### scheduledChange Field

The `scheduledChange` field in your DB is now **informational only**:

**Purpose:**
1. **UI Display**: Show users "You have a pending downgrade to Plan X on Date Y"
2. **Audit Trail**: Track when change was requested vs when it took effect
3. **Cancellation**: Allow users to cancel scheduled change before it takes effect

**Not Used For:**
- ❌ Execution timing (Razorpay handles this)
- ❌ Source of truth (Razorpay is the source of truth)

### Cron Job Status

The `runScheduledPlanChangeJob` is now **deprecated**:
- Marked with `@deprecated` JSDoc comment
- Kept for backward compatibility with existing `scheduledChange` records
- New scheduled changes are handled by Razorpay + webhooks
- Can be safely removed after all existing scheduled changes are processed

## Changes Made

### 1. Added Helper Function: calculateRemainingCount()

```javascript
/**
 * Calculate remaining_count for Razorpay when billing intervals differ
 * @param {Object} currentPlan - Current plan with pricing.interval
 * @param {Object} newPlan - New plan with pricing.interval
 * @param {Object} subscription - Current subscription with totalCount, remainingCount
 * @param {boolean} isScheduled - Whether this is a scheduled change or immediate
 * @returns {number|null} remaining_count value, or null if not needed
 */
function calculateRemainingCount(currentPlan, newPlan, subscription, isScheduled) {
  // If intervals are the same, no need for remaining_count
  if (currentPlan.pricing.interval === newPlan.pricing.interval) {
    return null;
  }

  // For unlimited subscriptions (totalCount = 0), use high number
  // Razorpay requires remaining_count >= 1
  if (subscription.totalCount === 0) {
    const unlimitedCounts = {
      'monthly': 120,  // 10 years
      'yearly': 10     // 10 years
    };
    return unlimitedCounts[newPlan.pricing.interval] || 120;
  }

  // For scheduled changes, preserve subscription duration
  if (isScheduled) {
    const intervalDays = { 'daily': 1, 'weekly': 7, 'monthly': 30, 'yearly': 365 };
    const remainingDays = subscription.remainingCount * intervalDays[currentPlan.pricing.interval];
    return Math.max(1, Math.ceil(remainingDays / intervalDays[newPlan.pricing.interval]));
  }

  // For immediate changes, default to 1 cycle
  return 1;
}
```

### 2. subscriptionController.js - upgradeSubscription()

**Immediate Changes (immediate=true):**
```javascript
const updateParams = {
  plan_id: newPlan.razorpayPlanId,
  schedule_change_at: 'now',
  quantity: 1
};

// Calculate remaining_count if billing intervals differ
const remainingCount = calculateRemainingCount(currentPlan, newPlan, subscription, false);
if (remainingCount !== null) {
  updateParams.remaining_count = remainingCount;
}
```

**Scheduled Changes (immediate=false or downgrades):**
```javascript
const updateParams = {
  plan_id: newPlan.razorpayPlanId,
  schedule_change_at: 'cycle_end',
  quantity: 1
};

// Calculate remaining_count if billing intervals differ
// Razorpay requires this even for cycle_end changes when periods differ
const remainingCount = calculateRemainingCount(currentPlan, newPlan, subscription, true);
if (remainingCount !== null) {
  updateParams.remaining_count = remainingCount;
}

await razorpay.subscriptions.update(
  subscription.razorpaySubscriptionId,
  updateParams
);

// Store scheduledChange for UI/audit only
subscription.scheduledChange = {
  newPlanId: newPlan._id,
  changeType: changeType,
  effectiveDate: subscription.currentPeriodEnd,
  requestedAt: new Date(),
  reason: reason,
  razorpayScheduled: true // Flag indicating Razorpay is handling it
};
```

### 2. subscriptionJobs.js

Added deprecation notice to `runScheduledPlanChangeJob()`:
```javascript
/**
 * @deprecated This job is now redundant. Razorpay handles scheduled changes
 * via schedule_change_at: 'cycle_end' parameter.
 */
```

## Benefits

1. **Reliability**: Razorpay handles timing, no dependency on your server uptime
2. **Simplicity**: Less code to maintain, fewer failure points
3. **Accuracy**: Changes happen exactly at cycle end, no 6-hour delays
4. **Scalability**: No cron job overhead as subscriptions grow
5. **Consistency**: Single source of truth (Razorpay)

## Migration Path

### For Existing Scheduled Changes

The cron job will continue to process any existing `scheduledChange` records that were created before this refactor.

### For New Scheduled Changes

All new scheduled changes go through Razorpay immediately and are processed via webhooks.

### Future Cleanup

After all existing scheduled changes are processed (check `scheduledChange` field in DB), you can:
1. Remove `runScheduledPlanChangeJob()` method
2. Remove the job scheduling in `scheduleScheduledPlanChangeJob()`
3. Remove the job from initialization

## Testing Checklist

- [ ] Test immediate upgrade (same interval)
- [ ] Test immediate upgrade (different interval - monthly → yearly)
- [ ] Test immediate upgrade (different interval - yearly → monthly)
- [ ] Test scheduled downgrade (monthly → yearly at cycle end)
- [ ] Test scheduled downgrade (yearly → monthly at cycle end)
- [ ] Verify webhook processes `subscription.updated` correctly
- [ ] Verify `scheduledChange` field is cleared after webhook
- [ ] Verify UI shows pending scheduled changes correctly
- [ ] Test canceling a scheduled change before it takes effect

## Webhook Handler Requirements

Your `subscription.updated` webhook handler should:

1. Detect plan changes by comparing DB plan vs Razorpay plan
2. Update `subscription.planId` to new plan
3. Update billing details from new plan
4. Clear `scheduledChange` field
5. Record change in `planChanges` array
6. Update credits if needed (upgrade/downgrade logic)

## Conclusion

This refactor eliminates unnecessary complexity and leverages Razorpay's native scheduling capabilities. The system is now more reliable, simpler, and easier to maintain.
