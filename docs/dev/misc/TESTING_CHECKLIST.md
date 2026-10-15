# Testing Checklist - Immediate Subscription Upgrade

## Pre-Testing Setup

- [ ] Ensure Razorpay test/live credentials are configured in `.env`
- [ ] Verify webhook endpoint is accessible by Razorpay
- [ ] Check that `RAZORPAY_WEBHOOK_SECRET` is set
- [ ] Confirm at least 2 plans exist in database (for upgrade/downgrade testing)
- [ ] Have a test user with an active subscription

## Test Cases

### ✅ Test 1: Immediate Upgrade (Higher Price Plan)

**Scenario:** Upgrade from Pro Monthly (₹59) to Max Monthly (₹99)

**Steps:**
1. [ ] Get current subscription: `GET /api/subscriptions/current`
2. [ ] Note current plan, credits, and billing period
3. [ ] Call upgrade endpoint:
   ```json
   POST /api/subscriptions/upgrade
   {
     "newPlanId": "max_monthly",
     "immediate": true,
     "reason": "user_upgrade"
   }
   ```
4. [ ] Verify response has `immediate: true`
5. [ ] Verify response has `changeType: "upgrade"`
6. [ ] Check logs for "Processing immediate plan change"
7. [ ] Check logs for "Razorpay subscription updated successfully"
8. [ ] Wait for webhook (should arrive within 5-10 seconds)
9. [ ] Check logs for "Processing subscription.charged event"
10. [ ] Check logs for "Credits granted successfully"
11. [ ] Get current subscription again
12. [ ] Verify plan changed to Max Monthly
13. [ ] Verify credits updated (old expired, new granted)
14. [ ] Check billing history for prorated payment

**Expected Results:**
- ✅ Response: `success: true, immediate: true`
- ✅ Razorpay charges prorated amount
- ✅ Webhook received and processed
- ✅ Old credits expired
- ✅ New credits granted
- ✅ Payment recorded
- ✅ Plan change in history

---

### ✅ Test 2: Immediate Downgrade (Lower Price Plan)

**Scenario:** Downgrade from Pro Monthly (₹59) to Plus Monthly (₹25)

**Steps:**
1. [ ] Get current subscription
2. [ ] Call upgrade endpoint:
   ```json
   POST /api/subscriptions/upgrade
   {
     "newPlanId": "plus_monthly",
     "immediate": true,
     "reason": "user_downgrade"
   }
   ```
3. [ ] Verify response has `changeType: "downgrade"`
4. [ ] Wait for webhook
5. [ ] Verify credits updated
6. [ ] Check that credit difference is applied to next cycle

**Expected Results:**
- ✅ Response: `success: true, immediate: true, changeType: "downgrade"`
- ✅ Razorpay credits difference to next billing
- ✅ Credits updated correctly

---

### ✅ Test 3: Scheduled Upgrade (Existing Behavior)

**Scenario:** Schedule upgrade for end of billing cycle

**Steps:**
1. [ ] Call upgrade endpoint:
   ```json
   POST /api/subscriptions/upgrade
   {
     "newPlanId": "max_monthly",
     "immediate": false,
     "reason": "user_upgrade"
   }
   ```
2. [ ] Verify response has `immediate: false`
3. [ ] Verify response has `scheduledFor` date
4. [ ] Check subscription has `scheduledChange` field
5. [ ] Verify plan has NOT changed yet
6. [ ] Verify credits have NOT changed yet

**Expected Results:**
- ✅ Response: `success: true, immediate: false`
- ✅ `scheduledChange` field populated
- ✅ Plan unchanged until job runs
- ✅ Credits unchanged until next billing

---

### ✅ Test 4: Default Behavior (Omit immediate parameter)

**Scenario:** Test default behavior when `immediate` is not provided

**Steps:**
1. [ ] Call upgrade endpoint WITHOUT `immediate` parameter:
   ```json
   POST /api/subscriptions/upgrade
   {
     "newPlanId": "max_monthly",
     "reason": "user_upgrade"
   }
   ```
2. [ ] Verify it behaves like Test 3 (scheduled)

**Expected Results:**
- ✅ Defaults to `immediate: false`
- ✅ Scheduled for end of billing cycle

---

### ✅ Test 5: Error - Missing newPlanId

**Steps:**
1. [ ] Call upgrade endpoint:
   ```json
   POST /api/subscriptions/upgrade
   {
     "immediate": true,
     "reason": "user_upgrade"
   }
   ```

**Expected Results:**
- ✅ Status: 400
- ✅ Error: "Validation error"
- ✅ Message: "New plan ID is required"

---

### ✅ Test 6: Error - Same Plan

**Steps:**
1. [ ] Get current plan (e.g., pro_monthly)
2. [ ] Try to upgrade to same plan:
   ```json
   POST /api/subscriptions/upgrade
   {
     "newPlanId": "pro_monthly",
     "immediate": true
   }
   ```

**Expected Results:**
- ✅ Status: 400
- ✅ Error: "SAME_PLAN"
- ✅ Message: "Cannot change to the same plan"

---

### ✅ Test 7: Error - Invalid Plan ID

**Steps:**
1. [ ] Call upgrade endpoint:
   ```json
   POST /api/subscriptions/upgrade
   {
     "newPlanId": "invalid_plan_xyz",
     "immediate": true
   }
   ```

**Expected Results:**
- ✅ Status: 400
- ✅ Error: "PLAN_NOT_FOUND"
- ✅ Message: "Invalid plan ID provided"

---

### ✅ Test 8: Error - No Active Subscription

**Steps:**
1. [ ] Use a user without active subscription
2. [ ] Call upgrade endpoint

**Expected Results:**
- ✅ Status: 404
- ✅ Error: "NO_ACTIVE_SUBSCRIPTION"
- ✅ Message: "No active subscription found"

---

### ✅ Test 9: Webhook Deduplication

**Scenario:** Ensure duplicate webhooks don't grant credits twice

**Steps:**
1. [ ] Perform immediate upgrade
2. [ ] Wait for webhook to process
3. [ ] Manually replay the same webhook (if possible)
4. [ ] Check logs for "Duplicate webhook detected"
5. [ ] Verify credits NOT granted twice

**Expected Results:**
- ✅ First webhook: Credits granted
- ✅ Second webhook: Skipped (already processed)
- ✅ No duplicate credits

---

### ✅ Test 10: Credit Expiry and Grant

**Scenario:** Verify old credits expire and new credits grant correctly

**Steps:**
1. [ ] Before upgrade: Note subscription credits (e.g., 50)
2. [ ] Perform immediate upgrade
3. [ ] After webhook: Check credit wallet
4. [ ] Verify old credits status = EXPIRED
5. [ ] Verify new credits status = ACTIVE
6. [ ] Verify new credit amount matches new plan
7. [ ] Verify bonus credits NOT affected

**Expected Results:**
- ✅ Old subscription credits: EXPIRED
- ✅ New subscription credits: ACTIVE
- ✅ Correct credit amount for new plan
- ✅ Bonus credits preserved

---

### ✅ Test 11: Payment Recording

**Scenario:** Verify prorated payment is recorded correctly

**Steps:**
1. [ ] Perform immediate upgrade
2. [ ] Wait for webhook
3. [ ] Check billing history: `GET /api/subscriptions/billing`
4. [ ] Verify payment record exists
5. [ ] Verify payment amount is prorated
6. [ ] Verify payment status is "captured"
7. [ ] Verify `creditsGranted` field is populated
8. [ ] Verify `processed: true`

**Expected Results:**
- ✅ Payment record created
- ✅ Prorated amount correct
- ✅ Status: captured
- ✅ Credits granted field populated
- ✅ Processed flag set

---

### ✅ Test 12: Plan Change History

**Scenario:** Verify plan change is recorded in history

**Steps:**
1. [ ] Perform immediate upgrade
2. [ ] Get subscription: `GET /api/subscriptions/current`
3. [ ] Check `planChanges` array
4. [ ] Verify latest entry has:
   - `fromPlanId`: old plan
   - `toPlanId`: new plan
   - `changeType`: "upgrade" or "downgrade"
   - `effectiveDate`: recent timestamp
   - `reason`: "user_upgrade"
   - `immediate`: true

**Expected Results:**
- ✅ Plan change recorded in history
- ✅ All fields populated correctly
- ✅ `immediate: true` flag present

---

### ✅ Test 13: Razorpay Sync Fields

**Scenario:** Verify Razorpay fields are synced correctly

**Steps:**
1. [ ] Perform immediate upgrade
2. [ ] Check subscription document
3. [ ] Verify `paidCount` updated
4. [ ] Verify `remainingCount` updated
5. [ ] Verify `chargeAt` updated

**Expected Results:**
- ✅ All Razorpay fields synced
- ✅ Values match Razorpay response

---

### ✅ Test 14: Concurrent Requests

**Scenario:** Test race condition handling

**Steps:**
1. [ ] Send two immediate upgrade requests simultaneously
2. [ ] Check logs for any errors
3. [ ] Verify only one upgrade processed
4. [ ] Verify credits granted only once

**Expected Results:**
- ✅ One request succeeds
- ✅ Other request may fail or be deduplicated
- ✅ No duplicate credits

---

### ✅ Test 15: Scheduled Then Immediate

**Scenario:** Schedule upgrade, then change to immediate

**Steps:**
1. [ ] Schedule upgrade: `immediate: false`
2. [ ] Verify `scheduledChange` field exists
3. [ ] Immediately call upgrade again: `immediate: true`
4. [ ] Verify `scheduledChange` field cleared
5. [ ] Verify immediate upgrade processed

**Expected Results:**
- ✅ Scheduled change overridden
- ✅ Immediate upgrade processed
- ✅ `scheduledChange` field cleared

---

## Log Monitoring

During testing, watch for these log messages:

### Success Flow
```
✅ "Processing immediate plan change"
✅ "Razorpay subscription updated successfully"
✅ "Immediate plan change completed successfully"
✅ "Processing subscription.charged event"
✅ "Expiring old subscription credits"
✅ "Granting subscription credits"
✅ "Credits granted successfully for subscription payment"
```

### Error Indicators
```
❌ "Error updating Razorpay subscription"
❌ "Error handling subscription.charged event"
❌ "Error granting credits for subscription"
❌ "Duplicate webhook detected" (expected for deduplication test)
```

---

## Database Verification

After each test, verify database state:

### Subscription Document
```javascript
{
  planId: ObjectId("new_plan_id"),  // ✅ Updated
  billing: {
    amount: 9900,  // ✅ New plan amount
    currency: "INR",
    interval: "monthly"
  },
  paidCount: 5,  // ✅ Incremented
  remainingCount: 7,  // ✅ Updated
  scheduledChange: undefined,  // ✅ Cleared (for immediate)
  planChanges: [
    {
      fromPlanId: ObjectId("old_plan_id"),
      toPlanId: ObjectId("new_plan_id"),
      changeType: "upgrade",
      effectiveDate: ISODate("..."),
      reason: "user_upgrade",
      immediate: true  // ✅ Flag present
    }
  ]
}
```

### Credit Wallet
```javascript
{
  subscriptionCredits: 200,  // ✅ New plan credits
  subscriptionCreditExpiry: ISODate("..."),  // ✅ Updated
  bonusCredits: 10,  // ✅ Unchanged
  // Old credits in history with status: "expired"
}
```

### Payment Record
```javascript
{
  razorpayPaymentId: "pay_xxx",
  subscriptionId: ObjectId("..."),
  userId: ObjectId("..."),
  amount: 40,  // ✅ Prorated amount
  status: "captured",
  creditsGranted: 200,  // ✅ Populated
  processed: true,  // ✅ Set
  processedAt: ISODate("...")  // ✅ Timestamp
}
```

---

## Performance Testing

- [ ] Test with 10 concurrent immediate upgrades
- [ ] Verify all process correctly
- [ ] Check for any race conditions
- [ ] Monitor database connection pool
- [ ] Check webhook processing time

---

## Edge Cases

- [ ] Test upgrade during trial period
- [ ] Test upgrade on last day of billing cycle
- [ ] Test upgrade with pending payment
- [ ] Test upgrade with halted subscription
- [ ] Test upgrade with cancelled subscription (should fail)

---

## Rollback Plan

If issues found:

1. [ ] Revert `src/controllers/subscriptionController.js` to previous version
2. [ ] Restart application
3. [ ] Scheduled upgrades will continue to work
4. [ ] No database changes needed

---

## Sign-Off

- [ ] All test cases passed
- [ ] No errors in logs
- [ ] Database state correct
- [ ] Webhooks processing correctly
- [ ] Credits updating correctly
- [ ] Payments recording correctly
- [ ] Ready for production deployment

**Tested By:** _______________  
**Date:** _______________  
**Environment:** [ ] Development [ ] Staging [ ] Production  
**Status:** [ ] PASS [ ] FAIL  

**Notes:**
_____________________________________________
_____________________________________________
_____________________________________________
