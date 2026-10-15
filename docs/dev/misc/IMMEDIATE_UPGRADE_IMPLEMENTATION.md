# Immediate Subscription Upgrade Implementation

## Overview
Added support for immediate subscription plan changes via the `immediate` parameter in the `/api/subscriptions/upgrade` endpoint. When `immediate: true`, the plan change happens instantly via Razorpay API instead of waiting for the scheduled job.

## Changes Made

### Modified File: `src/controllers/subscriptionController.js`

#### Function: `upgradeSubscription()`

**New Parameter:**
- `immediate` (boolean, default: `false`) - Controls whether the plan change happens immediately or at the end of the billing cycle

**Implementation Logic:**

1. **Extract `immediate` parameter** from request body
2. **If `immediate === true`:**
   - Call Razorpay SDK: `razorpay.subscriptions.update()` with `schedule_change_at: 'now'`
   - Update local subscription immediately (planId, billing details)
   - Sync Razorpay fields (paidCount, remainingCount, chargeAt)
   - Record plan change in `planChanges` array with `immediate: true` flag
   - Clear any existing `scheduledChange`
   - Return success response with `immediate: true`

3. **If `immediate === false` (default):**
   - Keep existing behavior
   - Schedule change for `currentPeriodEnd`
   - Job processes it later

## API Usage

### Immediate Upgrade Example
```bash
POST {{base_url}}/api/subscriptions/upgrade
Content-Type: application/json
Authorization: Bearer <token>

{
  "newPlanId": "max_monthly",
  "immediate": true,
  "reason": "user_upgrade"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Plan upgrade applied immediately. Prorated charge will be processed.",
  "immediate": true,
  "subscription": {
    "_id": "...",
    "status": "active",
    "currentPeriodEnd": "2025-11-18T10:30:00.000Z",
    "paidCount": 5,
    "remainingCount": 7
  },
  "oldPlan": {
    "_id": "...",
    "name": "Pro Monthly",
    "planId": "pro_monthly",
    "pricing": { "amount": 5900, "currency": "INR", "interval": "monthly" }
  },
  "newPlan": {
    "_id": "...",
    "name": "Max Monthly",
    "planId": "max_monthly",
    "pricing": { "amount": 9900, "currency": "INR", "interval": "monthly" }
  },
  "changeType": "upgrade",
  "effectiveDate": "2025-10-18T15:45:30.123Z"
}
```

### Scheduled Upgrade Example (Existing Behavior)
```bash
POST {{base_url}}/api/subscriptions/upgrade
Content-Type: application/json
Authorization: Bearer <token>

{
  "newPlanId": "max_monthly",
  "immediate": false,
  "reason": "user_upgrade"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Plan upgrade scheduled for 2025-11-18T10:30:00.000Z",
  "immediate": false,
  "subscription": {
    "_id": "...",
    "status": "active",
    "currentPeriodEnd": "2025-11-18T10:30:00.000Z",
    "scheduledChange": {
      "newPlanId": "...",
      "changeType": "upgrade",
      "effectiveDate": "2025-11-18T10:30:00.000Z",
      "requestedAt": "2025-10-18T15:45:30.123Z",
      "reason": "user_upgrade"
    }
  },
  "oldPlan": { ... },
  "newPlan": { ... },
  "changeType": "upgrade",
  "scheduledFor": "2025-11-18T10:30:00.000Z"
}
```

## Complete Flow: Immediate Upgrade from `pro_monthly` to `max_monthly`

### Step 1: API Call
User calls `/api/subscriptions/upgrade` with `immediate: true`

### Step 2: Controller Processing
1. Validates user, subscription, and new plan
2. Calls Razorpay SDK:
   ```javascript
   await razorpay.subscriptions.update(
     subscription.razorpaySubscriptionId,
     {
       plan_id: newPlan.razorpayPlanId,
       schedule_change_at: 'now',
       quantity: 1
     }
   );
   ```
3. Updates local subscription document
4. Records plan change in history
5. Returns success response

### Step 3: Razorpay Processing
- Razorpay calculates prorated amount
- For upgrade: Charges difference immediately (e.g., ₹40 for remaining days)
- For downgrade: Credits difference to next billing cycle
- Updates subscription status

### Step 4: Webhook Received
Razorpay sends `subscription.charged` webhook to your app

### Step 5: Webhook Processing (`handleCharged`)
1. Updates subscription billing period:
   - `currentPeriodStart`
   - `currentPeriodEnd`
2. Updates payment tracking:
   - `paidCount`
   - `remainingCount`
   - `chargeAt`
3. Ensures status is `active`
4. Calls `recordPayment(paymentEntity, subscription, true)`

### Step 6: Credit Management (`grantCreditsForSubscription`)
1. Fetches plan details (max_monthly)
2. Gets credit amount from plan (e.g., 200 credits)
3. **Expires old pro_monthly credits** (50 credits)
4. **Grants new max_monthly credits** (200 credits)
5. Sets expiry to `currentPeriodEnd`
6. Updates payment record:
   - `creditsGranted: 200`
   - `processed: true`
   - `processedAt: <timestamp>`

### Step 7: Complete
User now has:
- ✅ Active max_monthly subscription
- ✅ 200 new credits (old 50 expired)
- ✅ Prorated payment recorded
- ✅ Plan change in history

## Key Benefits

### 1. **Instant Gratification**
- No waiting for 6-hour job cycle
- User gets new plan features immediately
- Credits updated in real-time

### 2. **Razorpay Native**
- Uses Razorpay's built-in `schedule_change_at: 'now'` parameter
- Automatic proration calculation
- Proper billing cycle management

### 3. **Minimal Code Changes**
- Only modified `upgradeSubscription()` function
- No changes to webhook handlers
- No changes to scheduled job
- Existing credit flow works perfectly

### 4. **Backward Compatible**
- Default behavior unchanged (`immediate: false`)
- Scheduled upgrades still work via job
- No breaking changes to API

### 5. **Proper Credit Management**
- Old credits automatically expired
- New credits granted via webhook
- Deduplication prevents double-granting
- Atomic operations ensure consistency

## Error Handling

### Razorpay API Errors
If Razorpay update fails:
```json
{
  "success": false,
  "error": "RAZORPAY_UPDATE_FAILED",
  "message": "Failed to update subscription in Razorpay",
  "details": "Subscription cannot be updated when payment mode is UPI"
}
```

### Validation Errors
- Missing `newPlanId`: 400 error
- No active subscription: 404 error
- Same plan: 400 error
- Invalid plan: 400 error

## Testing Scenarios

### Test 1: Immediate Upgrade
```bash
# Upgrade from pro_monthly (₹59) to max_monthly (₹99)
POST /api/subscriptions/upgrade
{
  "newPlanId": "max_monthly",
  "immediate": true,
  "reason": "user_upgrade"
}

# Expected:
# - Razorpay charges prorated amount
# - subscription.charged webhook received
# - Old credits expired, new credits granted
# - Response: immediate: true
```

### Test 2: Immediate Downgrade
```bash
# Downgrade from pro_monthly (₹59) to plus_monthly (₹25)
POST /api/subscriptions/upgrade
{
  "newPlanId": "plus_monthly",
  "immediate": true,
  "reason": "user_downgrade"
}

# Expected:
# - Razorpay credits difference to next cycle
# - subscription.charged webhook received
# - Old credits expired, new credits granted
# - Response: immediate: true, changeType: "downgrade"
```

### Test 3: Scheduled Upgrade (Existing Behavior)
```bash
# Schedule upgrade for end of billing cycle
POST /api/subscriptions/upgrade
{
  "newPlanId": "max_monthly",
  "immediate": false,
  "reason": "user_upgrade"
}

# Expected:
# - scheduledChange field populated
# - Job processes at currentPeriodEnd
# - Response: immediate: false, scheduledFor: <date>
```

### Test 4: Omit Immediate Parameter
```bash
# Default behavior (scheduled)
POST /api/subscriptions/upgrade
{
  "newPlanId": "max_monthly",
  "reason": "user_upgrade"
}

# Expected:
# - Same as Test 3 (defaults to immediate: false)
```

## Monitoring & Logging

### Log Events

**Immediate Upgrade Started:**
```
Processing immediate plan change
- userId: <id>
- subscriptionId: <id>
- razorpaySubscriptionId: sub_xxx
- fromPlan: pro_monthly
- toPlan: max_monthly
- changeType: upgrade
```

**Razorpay Update Success:**
```
Razorpay subscription updated successfully
- razorpaySubscriptionId: sub_xxx
- newPlanId: plan_xxx
- razorpayStatus: active
- paidCount: 5
- remainingCount: 7
```

**Local Update Complete:**
```
Immediate plan change completed successfully
- userId: <id>
- subscriptionId: <id>
- fromPlan: pro_monthly
- toPlan: max_monthly
- changeType: upgrade
- note: Credits will be updated via subscription.charged webhook
```

**Webhook Processing:**
```
Processing subscription.charged event
- razorpaySubscriptionId: sub_xxx
- subscriptionId: <id>
- paymentId: pay_xxx
```

**Credits Updated:**
```
Credits granted successfully for subscription payment
- userId: <id>
- amount: 200
- expiryDate: 2025-11-18T10:30:00.000Z
- paymentId: pay_xxx
- subscriptionId: <id>
- planName: Max Monthly
- source: subscription_payment
```

## Razorpay API Reference

### Update Subscription Endpoint
```
PATCH https://api.razorpay.com/v1/subscriptions/:id
```

**Parameters:**
- `plan_id` (string, required): New Razorpay plan ID
- `schedule_change_at` (string): When to apply change
  - `'now'`: Immediate change with proration
  - `'cycle_end'`: At end of current billing cycle (default)
- `quantity` (integer): Number of units (default: 1)

**Response:**
```json
{
  "id": "sub_xxx",
  "entity": "subscription",
  "plan_id": "plan_xxx",
  "status": "active",
  "current_start": 1729260600,
  "current_end": 1731852600,
  "paid_count": 5,
  "remaining_count": 7,
  "charge_at": 1731852600,
  ...
}
```

## Notes

1. **Credits are NOT granted immediately in controller** - They are granted via the `subscription.charged` webhook to ensure consistency with Razorpay's payment processing.

2. **Proration is handled by Razorpay** - Your app doesn't need to calculate prorated amounts; Razorpay does this automatically.

3. **Webhook deduplication** - The existing webhook deduplication logic prevents double-processing of credits.

4. **Job still runs** - The scheduled job continues to process scheduled changes; immediate changes bypass it entirely.

5. **UPI subscriptions** - Razorpay doesn't support immediate updates for UPI payment mode. The API will return an error in this case.

## Future Enhancements

1. **Add proration preview** - Show user the prorated amount before confirming
2. **Support custom effective dates** - Allow scheduling for specific future dates
3. **Add rollback capability** - Revert to previous plan within X hours
4. **Email notifications** - Notify user when immediate upgrade completes
5. **Admin dashboard** - View immediate vs scheduled upgrade metrics

## Conclusion

The immediate upgrade feature is now fully implemented and integrated with your existing webhook-based credit management system. Users can choose between immediate plan changes (with proration) or scheduled changes (at billing cycle end) based on their needs.
