# Immediate Upgrade Flow Diagram

## Complete Flow: Pro Monthly → Max Monthly (Immediate)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER INITIATES UPGRADE                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
        POST /api/subscriptions/upgrade
        {
          "newPlanId": "max_monthly",
          "immediate": true,           ◄─── NEW PARAMETER
          "reason": "user_upgrade"
        }
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    CONTROLLER: upgradeSubscription()                    │
│                                                                         │
│  1. Validate user, subscription, plans                                 │
│  2. Check immediate === true                                           │
│  3. Call Razorpay SDK:                                                 │
│     razorpay.subscriptions.update(subId, {                            │
│       plan_id: "plan_max_monthly",                                     │
│       schedule_change_at: 'now',  ◄─── IMMEDIATE CHANGE               │
│       quantity: 1                                                      │
│     })                                                                 │
│  4. Update local DB:                                                   │
│     - subscription.planId = max_monthly                                │
│     - subscription.billing = { amount: 9900, ... }                     │
│     - subscription.planChanges.push({ ... })                           │
│  5. Return success response                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
        Response: {
          "success": true,
          "immediate": true,
          "message": "Plan upgrade applied immediately..."
        }
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         RAZORPAY PROCESSING                             │
│                                                                         │
│  1. Calculate proration:                                               │
│     - Current plan: ₹59/month (Pro)                                    │
│     - New plan: ₹99/month (Max)                                        │
│     - Days remaining: 10 days                                          │
│     - Prorated charge: ₹40 (difference for 10 days)                    │
│                                                                         │
│  2. Charge customer: ₹40                                               │
│  3. Update subscription status                                         │
│  4. Generate payment record                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    RAZORPAY SENDS WEBHOOK                               │
│                                                                         │
│  Event: subscription.charged                                           │
│  Payload: {                                                            │
│    subscription: { id: "sub_xxx", ... },                               │
│    payment: { id: "pay_xxx", amount: 4000, ... }                       │
│  }                                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              WEBHOOK HANDLER: handleCharged()                           │
│                                                                         │
│  1. Verify signature ✓                                                 │
│  2. Check deduplication ✓                                              │
│  3. Update subscription:                                               │
│     - currentPeriodStart = new Date(...)                               │
│     - currentPeriodEnd = new Date(...)                                 │
│     - paidCount++                                                      │
│     - status = 'active'                                                │
│  4. Call recordPayment(paymentEntity, subscription, true)              │
│                                      grantCredits = true ◄─── IMPORTANT │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   RECORD PAYMENT (with deduplication)                   │
│                                                                         │
│  1. Check if payment already processed ✓                               │
│  2. Create/get payment record                                          │
│  3. If grantCredits === true:                                          │
│     → Call grantCreditsForSubscription()                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│            GRANT CREDITS: grantCreditsForSubscription()                 │
│                                                                         │
│  1. Get plan details (Max Monthly)                                     │
│  2. Get credit amount: 200 credits                                     │
│                                                                         │
│  3. EXPIRE OLD CREDITS:                                                │
│     ┌────────────────────────────────────────┐                         │
│     │ Pro Monthly: 50 credits                │                         │
│     │ Status: ACTIVE → EXPIRED               │                         │
│     │ Expiry: NOW                            │                         │
│     └────────────────────────────────────────┘                         │
│                                                                         │
│  4. GRANT NEW CREDITS:                                                 │
│     ┌────────────────────────────────────────┐                         │
│     │ Max Monthly: 200 credits               │                         │
│     │ Status: ACTIVE                         │                         │
│     │ Expiry: currentPeriodEnd               │                         │
│     │ Source: subscription_payment           │                         │
│     └────────────────────────────────────────┘                         │
│                                                                         │
│  5. Update payment record:                                             │
│     - creditsGranted = 200                                             │
│     - processed = true                                                 │
│     - processedAt = NOW                                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            COMPLETE ✓                                   │
│                                                                         │
│  User now has:                                                         │
│  ✓ Max Monthly subscription (active)                                   │
│  ✓ 200 credits (expires at currentPeriodEnd)                           │
│  ✓ Payment recorded (₹40 prorated charge)                              │
│  ✓ Plan change in history                                              │
│  ✓ Old Pro Monthly credits expired                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Comparison: Immediate vs Scheduled

### IMMEDIATE UPGRADE (immediate: true)

```
User Request
    ↓
Controller → Razorpay API (NOW)
    ↓
Razorpay charges prorated amount
    ↓
Webhook: subscription.charged
    ↓
Credits: EXPIRE old + GRANT new
    ↓
✓ COMPLETE (within seconds)
```

**Timeline:** ~5-10 seconds

---

### SCHEDULED UPGRADE (immediate: false)

```
User Request
    ↓
Controller → Save scheduledChange
    ↓
Wait for currentPeriodEnd...
    ↓
Job runs (every 6 hours)
    ↓
Job → Razorpay API
    ↓
Next billing cycle
    ↓
Webhook: subscription.charged
    ↓
Credits: EXPIRE old + GRANT new
    ↓
✓ COMPLETE
```

**Timeline:** Up to 6 hours + time until next billing cycle

---

## Credit Flow Detail

### Before Upgrade
```
┌─────────────────────────────────┐
│     Credit Wallet               │
├─────────────────────────────────┤
│ Subscription Credits: 50        │
│ Plan: Pro Monthly               │
│ Status: ACTIVE                  │
│ Expiry: 2025-11-18              │
│                                 │
│ Bonus Credits: 10               │
│ Status: ACTIVE                  │
│ Expiry: 2025-12-31              │
└─────────────────────────────────┘
```

### During Upgrade (Webhook Processing)
```
┌─────────────────────────────────┐
│ 1. Expire Subscription Credits  │
├─────────────────────────────────┤
│ Old: 50 credits → EXPIRED       │
│ Reason: subscription_renewal    │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│ 2. Grant New Credits            │
├─────────────────────────────────┤
│ New: 200 credits → ACTIVE       │
│ Plan: Max Monthly               │
│ Expiry: 2025-11-18              │
│ Source: subscription_payment    │
└─────────────────────────────────┘
```

### After Upgrade
```
┌─────────────────────────────────┐
│     Credit Wallet               │
├─────────────────────────────────┤
│ Subscription Credits: 200       │
│ Plan: Max Monthly               │
│ Status: ACTIVE                  │
│ Expiry: 2025-11-18              │
│                                 │
│ Bonus Credits: 10               │
│ Status: ACTIVE                  │
│ Expiry: 2025-12-31              │
│                                 │
│ (Old 50 credits: EXPIRED)       │
└─────────────────────────────────┘
```

**Note:** Bonus credits are NOT affected by plan changes!

---

## Error Handling Flow

### Razorpay API Error
```
User Request
    ↓
Controller → Razorpay API
    ↓
❌ ERROR (e.g., UPI subscription)
    ↓
Controller catches error
    ↓
Return 500 response:
{
  "success": false,
  "error": "RAZORPAY_UPDATE_FAILED",
  "message": "Failed to update subscription in Razorpay",
  "details": "Subscription cannot be updated when payment mode is UPI"
}
    ↓
Local DB NOT updated
Credits NOT changed
User stays on old plan
```

### Webhook Deduplication
```
Webhook arrives
    ↓
Check: Payment already processed?
    ↓
YES → Skip all operations
    ↓
Return 200 (already processed)
    ↓
No duplicate credits granted ✓
```

---

## Key Points

1. **Controller updates Razorpay** → Razorpay charges → Webhook updates credits
2. **Credits are NOT granted in controller** → Only via webhook (ensures consistency)
3. **Deduplication prevents double-granting** → Payment.processed flag
4. **Old credits always expired first** → Then new credits granted
5. **Atomic operations** → Either all succeed or all fail
6. **Bonus credits preserved** → Only subscription credits affected

---

## Monitoring Points

Watch these log messages for successful flow:

```
1. "Processing immediate plan change"
   → Controller started

2. "Razorpay subscription updated successfully"
   → Razorpay API call succeeded

3. "Immediate plan change completed successfully"
   → Local DB updated

4. "Processing subscription.charged event"
   → Webhook received

5. "Expiring old subscription credits"
   → Old credits being removed

6. "Granting subscription credits"
   → New credits being added

7. "Credits granted successfully for subscription payment"
   → Complete!
```

If any step fails, check the error logs at that point.
