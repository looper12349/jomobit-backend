# Quick Reference - Immediate Subscription Upgrade

## 🚀 Quick Start

### Immediate Upgrade
```bash
POST /api/subscriptions/upgrade
{
  "newPlanId": "max_monthly",
  "immediate": true,
  "reason": "user_upgrade"
}
```
**Result:** Plan changes instantly, credits updated via webhook

### Scheduled Upgrade
```bash
POST /api/subscriptions/upgrade
{
  "newPlanId": "max_monthly",
  "immediate": false,
  "reason": "user_upgrade"
}
```
**Result:** Plan changes at end of billing cycle

---

## 📋 Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `newPlanId` | string | ✅ Yes | - | Plan identifier (e.g., "max_monthly") |
| `immediate` | boolean | ❌ No | `false` | Apply change immediately vs scheduled |
| `reason` | string | ❌ No | `"user_upgrade"` | Reason for plan change |

---

## 🔄 Flow Comparison

| Step | Immediate | Scheduled |
|------|-----------|-----------|
| **1. API Call** | Controller → Razorpay NOW | Controller → Save scheduledChange |
| **2. Razorpay** | Processes immediately | Waits for job |
| **3. Charge** | Prorated charge now | Full charge next cycle |
| **4. Webhook** | Arrives in ~5-10 sec | Arrives at next billing |
| **5. Credits** | Updated immediately | Updated at next billing |
| **6. Timeline** | ~10 seconds | Up to 6 hours + billing cycle |

---

## ✅ Success Response

```json
{
  "success": true,
  "message": "Plan upgrade applied immediately. Prorated charge will be processed.",
  "immediate": true,
  "changeType": "upgrade",
  "effectiveDate": "2025-10-18T15:45:30.123Z",
  "subscription": { ... },
  "oldPlan": {
    "name": "Pro Monthly",
    "planId": "pro_monthly",
    "pricing": { "amount": 5900 }
  },
  "newPlan": {
    "name": "Max Monthly",
    "planId": "max_monthly",
    "pricing": { "amount": 9900 }
  }
}
```

---

## ❌ Error Responses

### Missing Plan ID
```json
{
  "success": false,
  "error": "Validation error",
  "message": "New plan ID is required"
}
```
**Status:** 400

### Same Plan
```json
{
  "success": false,
  "error": "SAME_PLAN",
  "message": "Cannot change to the same plan"
}
```
**Status:** 400

### Invalid Plan
```json
{
  "success": false,
  "error": "PLAN_NOT_FOUND",
  "message": "Invalid plan ID provided"
}
```
**Status:** 400

### No Active Subscription
```json
{
  "success": false,
  "error": "NO_ACTIVE_SUBSCRIPTION",
  "message": "No active subscription found"
}
```
**Status:** 404

### Razorpay Error
```json
{
  "success": false,
  "error": "RAZORPAY_UPDATE_FAILED",
  "message": "Failed to update subscription in Razorpay",
  "details": "Subscription cannot be updated when payment mode is UPI"
}
```
**Status:** 500

---

## 🔍 Log Messages

### Success Indicators
```
✅ Processing immediate plan change
✅ Razorpay subscription updated successfully
✅ Immediate plan change completed successfully
✅ Processing subscription.charged event
✅ Credits granted successfully for subscription payment
```

### Error Indicators
```
❌ Error updating Razorpay subscription
❌ Error handling subscription.charged event
❌ Error granting credits for subscription
```

---

## 💳 Credit Flow

### Before Upgrade
- **Pro Monthly:** 50 credits (ACTIVE)
- **Bonus:** 10 credits (ACTIVE)

### During Webhook
1. **Expire:** 50 Pro credits → EXPIRED
2. **Grant:** 200 Max credits → ACTIVE

### After Upgrade
- **Max Monthly:** 200 credits (ACTIVE)
- **Bonus:** 10 credits (ACTIVE)
- **Old Pro:** 50 credits (EXPIRED)

**Note:** Bonus credits are preserved!

---

## 🎯 Use Cases

### When to use `immediate: true`
- ✅ User needs features NOW
- ✅ User wants to upgrade mid-cycle
- ✅ Competitive upgrade offer
- ✅ User willing to pay prorated amount

### When to use `immediate: false`
- ✅ User wants to wait for next billing
- ✅ Avoid mid-cycle charges
- ✅ Scheduled plan changes
- ✅ Default behavior

---

## 🛠️ Troubleshooting

### Credits not updated?
1. Check webhook received: Look for "subscription.charged"
2. Check webhook processed: Look for "Credits granted successfully"
3. Check payment record: `processed: true`
4. Check deduplication: No "Duplicate webhook" messages

### Razorpay update failed?
1. Check API credentials in `.env`
2. Verify subscription status (must be active/authenticated)
3. Check payment method (UPI doesn't support immediate updates)
4. Check Razorpay dashboard for errors

### Webhook not arriving?
1. Verify webhook URL configured in Razorpay dashboard
2. Check webhook secret matches `.env`
3. Check firewall/network allows Razorpay IPs
4. Test webhook endpoint manually

---

## 📊 Database Fields

### Subscription Document
```javascript
{
  planId: ObjectId("..."),           // ✅ Updated immediately
  billing: { amount, currency, ... }, // ✅ Updated immediately
  paidCount: 5,                      // ✅ Updated via webhook
  remainingCount: 7,                 // ✅ Updated via webhook
  scheduledChange: undefined,        // ✅ Cleared for immediate
  planChanges: [{                    // ✅ History recorded
    fromPlanId, toPlanId,
    changeType, effectiveDate,
    reason, immediate: true
  }]
}
```

### Payment Record
```javascript
{
  razorpayPaymentId: "pay_xxx",
  amount: 40,                        // Prorated amount
  status: "captured",
  creditsGranted: 200,               // ✅ Set via webhook
  processed: true,                   // ✅ Set via webhook
  processedAt: ISODate("...")        // ✅ Set via webhook
}
```

---

## 🔐 Security

- ✅ Webhook signature verification
- ✅ Payment deduplication
- ✅ Idempotent operations
- ✅ Atomic credit updates
- ✅ User authentication required

---

## 📈 Monitoring

### Key Metrics
- Immediate upgrade success rate
- Average webhook processing time
- Credit grant success rate
- Razorpay API error rate
- Webhook deduplication rate

### Alerts
- ⚠️ Razorpay API failures
- ⚠️ Webhook processing failures
- ⚠️ Credit grant failures
- ⚠️ High deduplication rate (may indicate webhook replay)

---

## 🚦 Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Plan changed successfully |
| 400 | Bad Request | Check request parameters |
| 401 | Unauthorized | Check authentication token |
| 404 | Not Found | Check subscription exists |
| 500 | Server Error | Check logs, contact support |

---

## 📞 Support

### Check These First
1. **Logs:** Look for error messages
2. **Razorpay Dashboard:** Check subscription status
3. **Database:** Verify subscription document
4. **Webhook Events:** Check webhook delivery

### Common Issues
- **UPI subscriptions:** Don't support immediate updates
- **Cancelled subscriptions:** Can't be upgraded
- **Invalid plan ID:** Check plan exists in database
- **Webhook delays:** Usually arrive within 10 seconds

---

## 🔗 Related Endpoints

```bash
# Get current subscription
GET /api/subscriptions/current

# Get available plans
GET /api/subscriptions/plans

# Get billing history
GET /api/subscriptions/billing

# Cancel subscription
POST /api/subscriptions/cancel
```

---

## 📚 Documentation Files

- `IMMEDIATE_UPGRADE_IMPLEMENTATION.md` - Detailed implementation guide
- `FLOW_DIAGRAM.md` - Visual flow diagrams
- `TESTING_CHECKLIST.md` - Complete testing guide
- `test_immediate_upgrade.http` - API test cases
- `IMPLEMENTATION_SUMMARY.md` - Quick summary

---

## 🎓 Examples

### Example 1: Upgrade Pro → Max (Immediate)
```bash
curl -X POST https://api.example.com/api/subscriptions/upgrade \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newPlanId": "max_monthly",
    "immediate": true,
    "reason": "user_upgrade"
  }'
```

### Example 2: Downgrade Pro → Plus (Scheduled)
```bash
curl -X POST https://api.example.com/api/subscriptions/upgrade \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newPlanId": "plus_monthly",
    "immediate": false,
    "reason": "user_downgrade"
  }'
```

### Example 3: Check Current Plan
```bash
curl -X GET https://api.example.com/api/subscriptions/current \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## ⚡ Performance

- **API Response Time:** ~200-500ms
- **Razorpay Update:** ~1-2 seconds
- **Webhook Arrival:** ~5-10 seconds
- **Total Time:** ~10-15 seconds end-to-end

---

## 🎉 Benefits

✅ **Instant gratification** - No waiting for job cycle  
✅ **Better UX** - Users get features immediately  
✅ **Proper billing** - Razorpay handles proration  
✅ **Reliable credits** - Webhook ensures consistency  
✅ **Backward compatible** - Existing behavior unchanged  

---

**Version:** 1.0  
**Last Updated:** October 18, 2025  
**Status:** ✅ Production Ready
