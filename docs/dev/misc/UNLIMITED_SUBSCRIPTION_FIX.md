# Unlimited Subscription Fix

## Problem

When trying to change an unlimited subscription (`totalCount = 0`) from yearly to monthly:

```
Error: The remaining count must be at least 1.
```

## Root Cause

Razorpay **does not accept** `remaining_count = 0`. The API requires `remaining_count >= 1`.

Initial assumption was that `0` meant "unlimited" in Razorpay, but this is incorrect.

## Solution

For unlimited subscriptions, use a **high number** to simulate unlimited behavior:

```javascript
const unlimitedCounts = {
  'daily': 3650,   // ~10 years (3650 days)
  'weekly': 520,   // ~10 years (520 weeks)
  'monthly': 120,  // 10 years (120 months)
  'yearly': 10     // 10 years
};
```

### Why 10 Years?

- Long enough to be effectively "unlimited" for most business cases
- Not so high that it causes issues with Razorpay's systems
- Easy to understand and maintain
- Can be monitored and renewed if needed

## Implementation

Updated `calculateRemainingCount()` function:

```javascript
// For unlimited subscriptions (totalCount = 0), set a high number
if (subscription.totalCount === 0) {
  const unlimitedCounts = {
    'daily': 3650,
    'weekly': 520,
    'monthly': 120,
    'yearly': 10
  };
  
  const remainingCount = unlimitedCounts[newPlan.pricing.interval] || 120;
  
  logger.info('Unlimited subscription detected, setting high remaining_count', {
    currentInterval: currentPlan.pricing.interval,
    newInterval: newPlan.pricing.interval,
    totalCount: subscription.totalCount,
    remainingCount: remainingCount,
    note: 'Razorpay requires at least 1, using high number to simulate unlimited'
  });
  
  return remainingCount;
}
```

## Examples

| Scenario | totalCount | New Interval | remaining_count | Duration |
|----------|------------|--------------|-----------------|----------|
| Unlimited → Monthly | 0 | monthly | 120 | 10 years |
| Unlimited → Yearly | 0 | yearly | 10 | 10 years |
| Unlimited → Weekly | 0 | weekly | 520 | ~10 years |
| Unlimited → Daily | 0 | daily | 3650 | ~10 years |

## Your Test Case

**Request:**
- From: `max_annual` (yearly, unlimited)
- To: `pro_monthly` (monthly)
- Subscription: `totalCount = 0`

**Result:**
- `remaining_count = 120` (10 years of monthly cycles)

**Razorpay Update:**
```javascript
{
  plan_id: "plan_RRwlDw0IGfELNA",
  schedule_change_at: "cycle_end",
  quantity: 1,
  remaining_count: 120  // ✅ 10 years of monthly billing
}
```

## Monitoring

After 10 years (120 monthly cycles), the subscription will complete. You should:

1. **Monitor subscriptions** approaching the limit (e.g., 12 months remaining)
2. **Automatically extend** by updating `remaining_count` via Razorpay API
3. **Notify users** if needed before expiration

Example monitoring query:
```javascript
// Find subscriptions with < 12 months remaining
const expiringSubscriptions = await Subscription.find({
  totalCount: 0,  // Originally unlimited
  remainingCount: { $lt: 12 }
});

// Extend them
for (const sub of expiringSubscriptions) {
  await razorpay.subscriptions.update(sub.razorpaySubscriptionId, {
    remaining_count: 120  // Reset to 10 years
  });
}
```

## Alternative Approaches Considered

### 1. Use Very High Number (e.g., 9999)
- ❌ Might cause issues with Razorpay's systems
- ❌ Harder to reason about
- ❌ Could be seen as abuse

### 2. Use 1 and Renew Each Cycle
- ❌ Requires webhook handling for every renewal
- ❌ More complex logic
- ❌ Risk of missing renewals

### 3. Use totalCount = null (Don't Set)
- ❌ Razorpay still requires the parameter when intervals differ
- ❌ Doesn't solve the problem

### 4. Use 10 Years (Chosen Solution) ✅
- ✅ Reasonable timeframe
- ✅ Easy to monitor and extend
- ✅ Clear intent
- ✅ Works with Razorpay's requirements

## Files Modified

- `src/controllers/subscriptionController.js` - Updated `calculateRemainingCount()` function
- `REMAINING_COUNT_FIX.md` - Updated documentation
- `SCHEDULED_CHANGE_REFACTOR.md` - Updated documentation

## Testing

Your test should now pass:

```http
POST http://localhost:3000/api/subscriptions/upgrade
Content-Type: application/json

{
  "newPlanId": "pro_monthly",
  "immediate": false
}
```

Expected response: Success with `remaining_count: 120` sent to Razorpay.
