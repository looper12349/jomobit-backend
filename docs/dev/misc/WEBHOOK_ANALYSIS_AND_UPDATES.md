# Webhook Analysis for 10-Year Cycle Implementation

## Executive Summary

**Good News:** The webhook handlers already sync `totalCount`, `remainingCount`, and `paidCount` from Razorpay! ✅

**Required Changes:** Minimal - just verify the sync logic works correctly with 10-year cycles.

---

## Current Webhook Flow

### 1. Webhook Entry Point

**File:** `src/controllers/webhookController.js`
**Method:** `handleRazorpayWebhook()`

**Events Handled:**
- `subscription.authenticated`
- `subscription.activated`
- `subscription.charged`
- `subscription.updated` ← **Critical for plan changes**
- `subscription.pending`
- `subscription.halted`
- `subscription.completed`
- `subscription.cancelled`

---

### 2. Key Method: `handleUpdated()`

**Location:** `src/controllers/webhookController.js` lines 1428-1600

**Current Behavior:**

```javascript
async handleUpdated(payload, webhookEvent, subscription) {
  const subscriptionEntity = payload.subscription.entity;
  
  // ✅ ALREADY SYNCS totalCount and remainingCount!
  subscription.status = subscriptionEntity.status;
  subscription.currentPeriodStart = new Date(subscriptionEntity.current_start * 1000);
  subscription.currentPeriodEnd = new Date(subscriptionEntity.current_end * 1000);
  subscription.paidCount = subscriptionEntity.paid_count || subscription.paidCount;
  subscription.remainingCount = subscriptionEntity.remaining_count || subscription.remainingCount;
  subscription.chargeAt = subscriptionEntity.charge_at ? new Date(subscriptionEntity.charge_at * 1000) : null;
  
  // Detects plan changes
  if (currentPlanRazorpayId !== newPlanRazorpayId) {
    // Plan changed - update subscription
    subscription.planId = newPlan._id;
    subscription.billing = { ... };
    await subscription.save();
    
    // Grant credits for new plan
    await this.grantSubscriptionCreditsWithoutPayment(subscription, ...);
  }
}
```

**Analysis:**
- ✅ **Already syncs `paidCount`** from Razorpay
- ✅ **Already syncs `remainingCount`** from Razorpay
- ✅ **Detects plan changes** by comparing DB plan vs Razorpay plan
- ✅ **Updates subscription** when plan changes
- ✅ **Grants credits** for new plan

**Conclusion:** This webhook handler is already perfect for our 10-year cycle approach!

---

### 3. Other Webhook Handlers

#### `handleActivated()`
**Purpose:** Handle subscription.activated event (first payment)

**Syncs:**
- `status`
- `currentPeriodStart`
- `currentPeriodEnd`
- `paidCount`
- `remainingCount` ← **Synced from Razorpay**

**Conclusion:** ✅ Already syncs correctly

---

#### `handleCharged()`
**Purpose:** Handle subscription.charged event (recurring payment)

**Syncs:**
- `status`
- `currentPeriodStart`
- `currentPeriodEnd`
- `paidCount` ← **Incremented**
- `remainingCount` ← **Decremented**

**Conclusion:** ✅ Already syncs correctly

---

#### `handleAuthenticated()`
**Purpose:** Handle subscription.authenticated event (payment method added)

**Syncs:**
- `status`
- Basic subscription details

**Conclusion:** ✅ No changes needed

---

## Impact on 10-Year Cycle Implementation

### Scenario 1: Create Subscription

```
User Request → Controller
  ↓
Controller calculates: totalCount = 120 (10 years for monthly)
  ↓
Create in Razorpay with total_count: 120
  ↓
Save to DB with totalCount: 120
  ↓
User pays → subscription.activated webhook
  ↓
Webhook syncs: paidCount = 1, remainingCount = 119
  ↓
✅ Everything synced correctly
```

**Webhook Changes Needed:** ❌ None

---

### Scenario 2: Immediate Upgrade (Monthly → Yearly)

```
User Request → Controller
  ↓
Controller calculates: remaining_count = 10 (10 years for yearly)
  ↓
Update Razorpay with remaining_count: 10
  ↓
Razorpay sends subscription.updated webhook
  ↓
Webhook detects plan change (monthly → yearly)
  ↓
Webhook syncs: remainingCount = 10, paidCount = 0 (reset)
  ↓
Webhook updates: planId, billing, credits
  ↓
✅ Everything synced correctly
```

**Webhook Changes Needed:** ❌ None

---

### Scenario 3: Scheduled Downgrade (Yearly → Monthly)

```
User Request → Controller
  ↓
Controller calculates: remaining_count = 120 (10 years for monthly)
  ↓
Update Razorpay with schedule_change_at: 'cycle_end', remaining_count: 120
  ↓
Store scheduledChange in DB (for UI display)
  ↓
... wait for cycle end ...
  ↓
Razorpay executes plan change at cycle end
  ↓
Razorpay sends subscription.updated webhook
  ↓
Webhook detects plan change (yearly → monthly)
  ↓
Webhook syncs: remainingCount = 120, paidCount = 0 (reset)
  ↓
Webhook updates: planId, billing, credits
  ↓
Webhook clears: scheduledChange field
  ↓
✅ Everything synced correctly
```

**Webhook Changes Needed:** ✅ **Minor** - Clear `scheduledChange` field

---

## Required Webhook Changes

### Change 1: Clear `scheduledChange` on Plan Change

**File:** `src/controllers/webhookController.js`
**Method:** `handleUpdated()`
**Location:** After line ~1560 (after updating subscription.planId)

**Current Code:**
```javascript
// NOW update the DB (webhook is source of truth)
subscription.planId = newPlan._id;
subscription.billing = {
  amount: newPlan.pricing.amount,
  currency: newPlan.pricing.currency,
  interval: newPlan.pricing.interval,
  intervalCount: newPlan.pricing.intervalCount || 1
};

await subscription.save();
```

**New Code:**
```javascript
// NOW update the DB (webhook is source of truth)
subscription.planId = newPlan._id;
subscription.billing = {
  amount: newPlan.pricing.amount,
  currency: newPlan.pricing.currency,
  interval: newPlan.pricing.interval,
  intervalCount: newPlan.pricing.intervalCount || 1
};

// Clear scheduledChange if it exists (plan change completed)
if (subscription.scheduledChange) {
  logger.info('Clearing scheduledChange after plan change', {
    subscriptionId: subscription._id,
    userId: subscription.userId,
    scheduledChange: subscription.scheduledChange
  });
  subscription.scheduledChange = undefined;
}

await subscription.save();
```

**Rationale:** When a scheduled plan change completes, we need to clear the `scheduledChange` field since it's no longer pending.

---

### Change 2: Add totalCount Sync (Optional)

**File:** `src/controllers/webhookController.js`
**Method:** `handleUpdated()`
**Location:** Line ~1453 (where other fields are synced)

**Current Code:**
```javascript
subscription.paidCount = subscriptionEntity.paid_count || subscription.paidCount;
subscription.remainingCount = subscriptionEntity.remaining_count || subscription.remainingCount;
```

**New Code:**
```javascript
subscription.paidCount = subscriptionEntity.paid_count || subscription.paidCount;
subscription.remainingCount = subscriptionEntity.remaining_count || subscription.remainingCount;
subscription.totalCount = subscriptionEntity.total_count || subscription.totalCount;
```

**Rationale:** Keep `totalCount` in sync with Razorpay (though it rarely changes after creation).

---

## Verification Checklist

### For Each Webhook Handler:

#### ✅ `handleActivated()`
- [x] Syncs `paidCount` from Razorpay
- [x] Syncs `remainingCount` from Razorpay
- [x] No changes needed

#### ✅ `handleCharged()`
- [x] Syncs `paidCount` from Razorpay
- [x] Syncs `remainingCount` from Razorpay
- [x] No changes needed

#### ⚠️ `handleUpdated()`
- [x] Syncs `paidCount` from Razorpay
- [x] Syncs `remainingCount` from Razorpay
- [ ] **TODO:** Add `totalCount` sync (optional)
- [ ] **TODO:** Clear `scheduledChange` on plan change

#### ✅ `handleAuthenticated()`
- [x] No count fields involved
- [x] No changes needed

#### ✅ `handleCompleted()`
- [x] Marks subscription as completed
- [x] No changes needed

#### ✅ `handleCancelled()`
- [x] Marks subscription as cancelled
- [x] No changes needed

---

## Testing Plan for Webhooks

### Test 1: Create Subscription Webhook
```json
POST /api/webhooks/razorpay
{
  "event": "subscription.activated",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_XXX",
        "plan_id": "plan_monthly",
        "total_count": 120,
        "paid_count": 1,
        "remaining_count": 119,
        "status": "active"
      }
    }
  }
}

Expected:
- subscription.totalCount = 120 ✅
- subscription.paidCount = 1 ✅
- subscription.remainingCount = 119 ✅
```

### Test 2: Plan Change Webhook (Immediate)
```json
POST /api/webhooks/razorpay
{
  "event": "subscription.updated",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_XXX",
        "plan_id": "plan_yearly",  // Changed from monthly
        "total_count": 10,
        "paid_count": 0,
        "remaining_count": 10,
        "status": "active"
      }
    }
  }
}

Expected:
- subscription.planId = yearly plan ID ✅
- subscription.totalCount = 10 ✅
- subscription.remainingCount = 10 ✅
- subscription.scheduledChange = undefined ✅ (cleared)
- Credits granted for new plan ✅
```

### Test 3: Plan Change Webhook (Scheduled)
```json
POST /api/webhooks/razorpay
{
  "event": "subscription.updated",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_XXX",
        "plan_id": "plan_monthly",  // Changed from yearly
        "total_count": 120,
        "paid_count": 0,
        "remaining_count": 120,
        "status": "active",
        "has_scheduled_changes": false  // Completed
      }
    }
  }
}

Expected:
- subscription.planId = monthly plan ID ✅
- subscription.totalCount = 120 ✅
- subscription.remainingCount = 120 ✅
- subscription.scheduledChange = undefined ✅ (cleared)
- Credits granted for new plan ✅
```

### Test 4: Recurring Payment Webhook
```json
POST /api/webhooks/razorpay
{
  "event": "subscription.charged",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_XXX",
        "paid_count": 2,
        "remaining_count": 118,
        "status": "active"
      }
    }
  }
}

Expected:
- subscription.paidCount = 2 ✅
- subscription.remainingCount = 118 ✅
- Credits granted for new period ✅
```

---

## Summary

### Webhook Changes Required:

| File | Method | Change | Priority | Complexity |
|------|--------|--------|----------|------------|
| `webhookController.js` | `handleUpdated()` | Clear `scheduledChange` | **HIGH** | ⭐ Low |
| `webhookController.js` | `handleUpdated()` | Sync `totalCount` | Medium | ⭐ Low |

### Total Impact:
- **2 changes** in 1 file
- **~5 lines** of code
- **Very low** complexity
- **Very low** risk

### Conclusion:

The webhook system is **already well-designed** and requires **minimal changes** to support the 10-year cycle approach. The main addition is clearing the `scheduledChange` field when a plan change completes.

---

## Updated Implementation Plan

With webhook analysis complete, the full implementation now includes:

1. **Subscription Controller** (~100 lines)
   - Add `getTenYearCycle()` helper
   - Simplify `calculateRemainingCount()`
   - Update `createSubscription()`
   - No changes to `upgradeSubscription()` (already works)

2. **Webhook Controller** (~5 lines)
   - Clear `scheduledChange` in `handleUpdated()`
   - Optionally sync `totalCount` in `handleUpdated()`

3. **Documentation** (multiple files)
   - Update all docs with new approach

**Total:** ~105 lines of code changes across 2 files

**Risk:** 🟢 Very Low

**Ready for approval!**
