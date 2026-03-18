# Cancellation Feature Testing Guide

## Quick Test Commands

### 1. Test Cancel Subscription API

```bash
# Cancel active subscription
curl -X POST http://localhost:3000/api/subscriptions/cancel \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "reason": "user_cancellation"
  }'

# Expected Response:
# {
#   "success": true,
#   "message": "Subscription will be cancelled at the end of the current billing period on 2025-02-15. You will continue to have access until then.",
#   "subscription": {
#     "_id": "...",
#     "status": "active",
#     "cancelAtPeriodEnd": true,
#     "accessUntil": "2025-02-15T10:30:00Z",
#     "cancellationReason": "user_cancellation"
#   }
# }
```

### 2. Test Already Cancelled Error

```bash
# Try to cancel again (should fail)
curl -X POST http://localhost:3000/api/subscriptions/cancel \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "reason": "user_cancellation"
  }'

# Expected Response:
# {
#   "success": false,
#   "error": "ALREADY_SCHEDULED_FOR_CANCELLATION",
#   "message": "Subscription is already scheduled for cancellation at period end",
#   ...
# }
```

### 3. Simulate Webhook (For Testing)

```bash
# Simulate subscription.cancelled webhook
curl -X POST http://localhost:3000/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: YOUR_SIGNATURE" \
  -d '{
    "event": "subscription.cancelled",
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_RAZORPAY_ID",
          "status": "cancelled",
          "ended_at": 1708000000
        }
      }
    },
    "created_at": 1708000000
  }'
```

---

## Manual Testing Steps

### Test Case 1: Normal Cancellation Flow

**Step 1:** Create a test subscription
```bash
POST /api/subscriptions/create
Body: { "planId": "pro" }
```

**Step 2:** Verify subscription is active
```bash
GET /api/subscriptions/current
```
- ✅ Status should be "active"
- ✅ cancelAtPeriodEnd should be false

**Step 3:** Cancel subscription
```bash
POST /api/subscriptions/cancel
Body: { "reason": "testing" }
```
- ✅ Should return success
- ✅ cancelAtPeriodEnd should be true
- ✅ Status should still be "active"

**Step 4:** Check credits are still available
```bash
GET /api/credits/balance
```
- ✅ subscriptionCredits should be > 0
- ✅ User should still have access

**Step 5:** Wait for cycle end or simulate webhook
```bash
# Simulate webhook
POST /webhooks/razorpay
Body: { "event": "subscription.cancelled", ... }
```

**Step 6:** Verify credits expired and access revoked
```bash
GET /api/credits/balance
```
- ✅ subscriptionCredits should be 0
- ✅ Status should be "cancelled"

---

### Test Case 2: Edge Cases

#### 2.1 Cancel with No Active Subscription
```bash
POST /api/subscriptions/cancel
```
**Expected:** 404 error "No active subscription found"

#### 2.2 Cancel Already Cancelled Subscription
```bash
# Cancel once
POST /api/subscriptions/cancel

# Cancel again
POST /api/subscriptions/cancel
```
**Expected:** 400 error "Already scheduled for cancellation"

#### 2.3 Webhook with No Credits
```bash
# User has 0 subscription credits
# Fire webhook
POST /webhooks/razorpay
```
**Expected:** Success, creditsExpired: 0

---

## Database Verification

### Check Subscription Status
```javascript
// MongoDB query
db.subscriptions.findOne({ 
  razorpaySubscriptionId: "sub_RAZORPAY_ID" 
})

// Should show:
// - cancelAtPeriodEnd: true (after cancel API)
// - status: "cancelled" (after webhook)
// - cancelledAt: Date
// - endedAt: Date
```

### Check Credit Transactions
```javascript
// MongoDB query
db.credittransactions.find({ 
  userId: ObjectId("USER_ID"),
  type: "expire",
  "reference.type": "cancellation"
}).sort({ createdAt: -1 })

// Should show:
// - type: "expire"
// - amount: negative value
// - creditType: "subscription"
// - metadata.reason: "subscription_cancelled"
```

### Check Credit Wallet
```javascript
// MongoDB query
db.creditwallets.findOne({ 
  userId: ObjectId("USER_ID") 
})

// After webhook should show:
// - subscriptionCredits: 0
// - subscriptionCreditExpiry: null
```

---

## Logs to Monitor

### Cancellation API Logs
```
[INFO] Subscription scheduled for cancellation at cycle end
  userId: ...
  subscriptionId: ...
  razorpaySubscriptionId: ...
  cancelAtPeriodEnd: true
  accessUntil: ...
  reason: user_cancellation
```

### Webhook Processing Logs
```
[INFO] Processing subscription.cancelled event
  razorpaySubscriptionId: ...
  subscriptionId: ...
  userId: ...
  event: subscription.cancelled

[INFO] Subscription status updated to cancelled
  subscriptionId: ...
  userId: ...
  status: cancelled
  endedAt: ...
  cancelledAt: ...

[INFO] Expiring subscription credits for user
  userId: ...
  reason: subscription_cancelled
  operation: expire_user_subscription_credits

[INFO] User subscription credits expired successfully
  userId: ...
  creditsExpired: 100
  reason: subscription_cancelled
  newBalance: 0
  operation: expire_user_subscription_credits

[INFO] Subscription credits expired and access revoked
  subscriptionId: ...
  userId: ...
  creditsExpired: 100
  status: cancelled
  accessRevoked: true
  event: subscription.cancelled
```

---

## Razorpay Dashboard Verification

1. Go to Razorpay Dashboard → Subscriptions
2. Find the test subscription
3. Verify it shows "Scheduled for cancellation"
4. Check the cancellation date matches cycle end
5. After cycle end, verify status changes to "Cancelled"

---

## Integration Test Script

```javascript
// test/integration/cancellation.test.js

describe('Subscription Cancellation', () => {
  it('should cancel subscription at cycle end', async () => {
    // 1. Create subscription
    const subscription = await createTestSubscription();
    
    // 2. Cancel subscription
    const cancelResponse = await request(app)
      .post('/api/subscriptions/cancel')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'testing' });
    
    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body.subscription.cancelAtPeriodEnd).toBe(true);
    
    // 3. Verify credits still available
    const creditsResponse = await request(app)
      .get('/api/credits/balance')
      .set('Authorization', `Bearer ${token}`);
    
    expect(creditsResponse.body.subscriptionCredits).toBeGreaterThan(0);
    
    // 4. Simulate webhook
    await simulateWebhook('subscription.cancelled', subscription);
    
    // 5. Verify credits expired
    const finalCreditsResponse = await request(app)
      .get('/api/credits/balance')
      .set('Authorization', `Bearer ${token}`);
    
    expect(finalCreditsResponse.body.subscriptionCredits).toBe(0);
  });
});
```

---

## Troubleshooting

### Issue: Cancellation API returns 500 error
**Check:**
- Razorpay API credentials
- Network connectivity to Razorpay
- Razorpay subscription ID is valid
- Logs for detailed error message

### Issue: Webhook doesn't expire credits
**Check:**
- CreditService is properly imported
- User has a credit wallet
- Logs show credit expiry attempt
- Database transaction completed successfully

### Issue: Credits not expiring to 0
**Check:**
- `expireUserSubscriptionCredits` method is called
- MongoDB transaction is committing
- No errors in credit service logs
- CreditTransaction record created

---

## Success Criteria

✅ Cancel API returns success with cancelAtPeriodEnd: true
✅ User retains access until cycle end
✅ Credits remain available until cycle end
✅ Webhook fires at cycle end
✅ Credits expire to 0 immediately after webhook
✅ Access revoked (status = cancelled)
✅ CreditTransaction audit trail created
✅ Proper logging at each step
✅ No errors in logs
✅ Database state is consistent

---

## Performance Benchmarks

- Cancel API response time: < 500ms
- Webhook processing time: < 2000ms
- Credit expiry operation: < 1000ms
- Database transaction time: < 500ms

---

## Next Steps After Testing

1. ✅ Verify all test cases pass
2. ✅ Check logs for any warnings
3. ✅ Monitor production for 24 hours
4. ✅ Update API documentation
5. ✅ Notify frontend team of API changes
6. ✅ Update user-facing cancellation flow
7. ✅ Add monitoring alerts
8. ✅ Document rollback procedure
