# Razorpay Subscription Payment Testing Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Test Scenarios](#test-scenarios)
4. [Razorpay Test Cards](#razorpay-test-cards)
5. [Webhook Testing](#webhook-testing)
6. [Troubleshooting](#troubleshooting)

## Prerequisites

Before testing, ensure you have:
- Razorpay test account with API keys
- MongoDB running locally or accessible
- Backend server running
- Postman or curl for API testing
- Access to Razorpay dashboard for webhook logs

## Environment Setup

### 1. Configure Environment Variables

Create or update `.env` file:

```bash
# Razorpay Configuration (TEST MODE)
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# MongoDB
MONGODB_URI=mongodb://localhost:27017/jomobit-test

# Credit Configuration
DEFAULT_USER_CREDITS=3

# Server
PORT=3000
NODE_ENV=test
```

### 2. Create Test Plans in Razorpay Dashboard

Go to Razorpay Dashboard → Plans and create:

**Plan 1: Basic (Monthly)**
- Plan ID: `plan_basic_monthly`
- Amount: ₹99
- Interval: Monthly
- Description: Basic Plan - 10 credits/month

**Plan 2: Pro (Monthly)**
- Plan ID: `plan_pro_monthly`
- Amount: ₹299
- Interval: Monthly
- Description: Pro Plan - 50 credits/month

**Plan 3: Enterprise (Monthly)**
- Plan ID: `plan_enterprise_monthly`
- Amount: ₹999
- Interval: Monthly
- Description: Enterprise Plan - 200 credits/month

### 3. Configure Webhook in Razorpay

1. Go to Razorpay Dashboard → Webhooks
2. Create new webhook: `https://your-domain.com/api/webhooks/razorpay`
3. Select events:
   - subscription.authenticated
   - subscription.activated
   - subscription.charged
   - subscription.pending
   - subscription.halted
   - subscription.completed
   - subscription.cancelled
   - subscription.paused
   - subscription.resumed
   - subscription.updated
   - payment.failed
4. Copy webhook secret to `.env`

### 4. Create Test Plans in Database

```bash
# Run this script or use MongoDB shell
node scripts/create-test-plans.js
```


## Test Scenarios

### Test 1: New Subscription Creation (Happy Path)

**Objective**: Verify complete subscription creation flow from API call to credit granting

**Steps**:

1. **Get Auth Token**
```bash
# Login or register to get JWT token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "testpassword"
  }'

# Save the token
export TOKEN="your_jwt_token_here"
```

2. **Create Subscription**
```bash
curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "PLAN_OBJECT_ID_FROM_DB",
    "totalCount": 12,
    "customerNotify": true
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "subscription": {
    "_id": "subscription_object_id",
    "razorpaySubscriptionId": "sub_xxxxxxxxxxxxx",
    "status": "created",
    "short_url": "https://rzp.io/i/xxxxxxxx",
    "currentPeriodStart": "2025-01-10T00:00:00.000Z",
    "currentPeriodEnd": "2025-02-10T00:00:00.000Z",
    "billing": {
      "amount": 29900,
      "currency": "INR",
      "interval": "monthly",
      "intervalCount": 1
    }
  },
  "plan": {
    "name": "Pro Plan",
    "pricing": {
      "amount": 29900,
      "currency": "INR"
    },
    "features": {
      "credits": {
        "monthly": 50
      }
    }
  },
  "message": "Subscription created successfully"
}
```

3. **Open Payment Link**
- Copy the `short_url` from response
- Open in browser
- Complete payment using test card (see Razorpay Test Cards section)

4. **Verify Webhooks Received**

Check server logs for:
```
[INFO] Received Razorpay webhook { event: 'subscription.authenticated', subscriptionId: 'sub_xxx' }
[INFO] Processing webhook { event: 'subscription.authenticated', uniqueKey: 'xxx' }
[INFO] Webhook processed successfully { event: 'subscription.authenticated', processingTime: '45ms' }

[INFO] Received Razorpay webhook { event: 'subscription.activated', subscriptionId: 'sub_xxx' }
[INFO] Granting subscription credits { userId: 'xxx', amount: 50, expiryDate: '2025-02-10' }
[INFO] Credits granted successfully { userId: 'xxx', credits: 50 }

[INFO] Received Razorpay webhook { event: 'subscription.charged', subscriptionId: 'sub_xxx' }
[INFO] Payment already processed (dedupe) { paymentId: 'pay_xxx' }
```

5. **Verify Subscription Status**
```bash
curl -X GET http://localhost:3000/api/subscriptions/current \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "subscription": {
    "status": "active",
    "currentPeriodStart": "2025-01-10T00:00:00.000Z",
    "currentPeriodEnd": "2025-02-10T00:00:00.000Z",
    "cancelAtPeriodEnd": false,
    "paidCount": 1,
    "remainingCount": 11
  },
  "plan": {
    "name": "Pro Plan",
    "pricing": { "amount": 29900 }
  }
}
```

6. **Verify Credits Granted**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "userId": "user_id",
  "defaultCredits": 3,
  "subscriptionCredits": 50,
  "reservedCredits": 0,
  "totalCredits": 53,
  "availableCredits": 53,
  "subscriptionCreditExpiry": "2025-02-10T00:00:00.000Z"
}
```

**Success Criteria**:
- ✅ Subscription created with status='created'
- ✅ short_url returned for payment
- ✅ Payment completed successfully
- ✅ Webhooks received and processed
- ✅ Subscription status updated to 'active'
- ✅ Credits granted (50 subscription credits)
- ✅ Credits have correct expiry date (currentPeriodEnd)

---

### Test 2: Subscription Renewal (Next Month)

**Objective**: Verify automatic renewal, credit expiry, and new credit granting

**Prerequisites**: Complete Test 1 first

**Steps**:

1. **Simulate Time Passing (Option A: Wait for actual renewal)**
- Wait for next billing cycle (1 month)
- Razorpay will automatically charge

**OR**

**Simulate Time Passing (Option B: Manual webhook simulation)**
```bash
# Manually trigger renewal webhook (for testing)
# Note: Use actual webhook payload from Razorpay dashboard

curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: CALCULATE_SIGNATURE" \
  -d '{
    "event": "subscription.charged",
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_xxxxxxxxxxxxx",
          "status": "active",
          "current_start": 1707523200,
          "current_end": 1710201600,
          "paid_count": 2,
          "remaining_count": 10,
          "charge_at": 1712793600
        }
      },
      "payment": {
        "entity": {
          "id": "pay_yyyyyyyyyyy",
          "amount": 29900,
          "currency": "INR",
          "status": "captured",
          "method": "card",
          "created_at": 1707523200
        }
      }
    },
    "created_at": 1707523200
  }'
```

2. **Verify Webhook Processing**

Check logs for:
```
[INFO] Handling subscription.charged { subscriptionId: 'sub_xxx', paymentId: 'pay_yyy' }
[INFO] Starting subscription credit expiration { expiryDate: '2025-02-10' }
[INFO] Subscription credits expired { userId: 'xxx', expiredCredits: 50 }
[INFO] Granting subscription credits { userId: 'xxx', amount: 50, expiryDate: '2025-03-10' }
[INFO] Credits granted successfully { userId: 'xxx', credits: 50 }
```

3. **Verify Credit Balance**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "defaultCredits": 3,
  "subscriptionCredits": 50,
  "totalCredits": 53,
  "subscriptionCreditExpiry": "2025-03-10T00:00:00.000Z"
}
```

4. **Verify Credit Transactions**
```bash
curl -X GET http://localhost:3000/api/credits/transactions \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response** (recent transactions):
```json
{
  "transactions": [
    {
      "type": "grant",
      "amount": 50,
      "creditType": "subscription",
      "createdAt": "2025-02-10T00:00:00.000Z",
      "metadata": {
        "expiryDate": "2025-03-10T00:00:00.000Z",
        "source": "subscription_renewal"
      }
    },
    {
      "type": "expire",
      "amount": -50,
      "creditType": "subscription",
      "createdAt": "2025-02-10T00:00:00.000Z",
      "metadata": {
        "reason": "monthly_expiration"
      }
    }
  ]
}
```

**Success Criteria**:
- ✅ Renewal webhook received
- ✅ Old credits expired (50 credits)
- ✅ New credits granted (50 credits)
- ✅ Expiry date updated to new currentPeriodEnd
- ✅ Payment recorded with deduplication
- ✅ paidCount incremented to 2

---

### Test 3: Payment Failure and Recovery

**Objective**: Verify payment failure handling, retry logic, and credit expiry

**Steps**:

1. **Create Subscription with Failing Card**

Use Razorpay test card that fails: `4000000000000002`

Complete Test 1 steps but use failing card for payment.

2. **Verify Initial Failure**

Check logs for:
```
[INFO] Handling subscription.pending { subscriptionId: 'sub_xxx', authAttempts: 1 }
[INFO] Subscription payment pending { status: 'pending', authAttempts: 1 }
```

3. **Verify Subscription Status**
```bash
curl -X GET http://localhost:3000/api/subscriptions/current \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "subscription": {
    "status": "pending",
    "authAttempts": 1
  }
}
```

4. **Verify Credits NOT Expired**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Previous month's credits still available

5. **Simulate All Retries Failed**

Send `subscription.halted` webhook:
```bash
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: CALCULATE_SIGNATURE" \
  -d '{
    "event": "subscription.halted",
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_xxxxxxxxxxxxx",
          "status": "halted",
          "auth_attempts": 4
        }
      }
    }
  }'
```

6. **Verify Credits Expired**

Check logs:
```
[INFO] Handling subscription.halted { subscriptionId: 'sub_xxx', authAttempts: 4 }
[INFO] Subscription halted - credits expired { subscriptionId: 'xxx', userId: 'xxx' }
```

7. **Verify Credit Balance**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "defaultCredits": 3,
  "subscriptionCredits": 0,
  "totalCredits": 3
}
```

**Success Criteria**:
- ✅ Payment failure recorded
- ✅ Status set to 'pending'
- ✅ authAttempts incremented
- ✅ Credits NOT expired during pending
- ✅ After halted: credits expired immediately
- ✅ User falls back to default credits only

---


### Test 4: Plan Upgrade at Cycle End

**Objective**: Verify plan upgrade scheduling and execution at billing cycle end

**Prerequisites**: Active subscription on Basic plan

**Steps**:

1. **Check Current Subscription**
```bash
curl -X GET http://localhost:3000/api/subscriptions/current \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Active subscription on Basic plan (₹99, 10 credits)

2. **Schedule Upgrade to Pro Plan**
```bash
curl -X POST http://localhost:3000/api/subscriptions/upgrade \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newPlanId": "PRO_PLAN_OBJECT_ID",
    "immediate": false,
    "reason": "user_upgrade"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "subscription": {
    "scheduledChange": {
      "newPlanId": "pro_plan_id",
      "changeType": "upgrade",
      "effectiveDate": "2025-02-10T00:00:00.000Z",
      "requestedAt": "2025-01-15T10:30:00.000Z",
      "reason": "user_upgrade"
    }
  },
  "oldPlan": {
    "name": "Basic Plan",
    "pricing": { "amount": 9900 }
  },
  "newPlan": {
    "name": "Pro Plan",
    "pricing": { "amount": 29900 }
  },
  "changeType": "upgrade",
  "scheduledFor": "2025-02-10T00:00:00.000Z",
  "message": "upgrade scheduled for 2025-02-10"
}
```

3. **Verify Current Plan Still Active**
```bash
curl -X GET http://localhost:3000/api/subscriptions/current \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Still on Basic plan with scheduledChange field populated

4. **Verify Current Credits**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Still have Basic plan credits (10 credits)

5. **Wait for Cycle End (or manually trigger job)**

**Option A: Wait for actual cycle end**
- Wait until currentPeriodEnd date

**Option B: Manually trigger scheduled job**
```bash
# In Node.js console or create test script
const subscriptionJobs = require('./src/jobs/subscriptionJobs');
await subscriptionJobs.scheduleScheduledPlanChanges();
```

6. **Verify Plan Changed**

Check logs:
```
[INFO] Processing scheduled plan change {
  subscriptionId: 'xxx',
  fromPlan: 'plan_basic_monthly',
  toPlan: 'plan_pro_monthly',
  changeType: 'upgrade'
}
[INFO] Scheduled plan change completed { subscriptionId: 'xxx', newPlan: 'plan_pro_monthly' }
```

7. **Verify Subscription Updated**
```bash
curl -X GET http://localhost:3000/api/subscriptions/current \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Response**:
```json
{
  "subscription": {
    "planId": "pro_plan_id",
    "billing": {
      "amount": 29900,
      "currency": "INR"
    },
    "scheduledChange": null,
    "planChanges": [
      {
        "fromPlanId": "basic_plan_id",
        "toPlanId": "pro_plan_id",
        "changeType": "upgrade",
        "effectiveDate": "2025-02-10T00:00:00.000Z"
      }
    ]
  },
  "plan": {
    "name": "Pro Plan",
    "pricing": { "amount": 29900 }
  }
}
```

8. **Verify Next Charge Uses New Plan**

When next renewal occurs:
- Razorpay charges ₹299 (Pro plan amount)
- Credits granted: 50 (Pro plan credits)

**Success Criteria**:
- ✅ Upgrade scheduled successfully
- ✅ scheduledChange field populated
- ✅ Current plan and credits remain until cycle end
- ✅ At cycle end: plan updated
- ✅ Razorpay subscription updated
- ✅ planChanges array updated
- ✅ scheduledChange cleared
- ✅ Next charge uses new plan amount
- ✅ Next credits use new plan amount

---

### Test 5: Webhook Deduplication

**Objective**: Verify webhook deduplication prevents double-charging and double-granting credits

**Steps**:

1. **Send Webhook First Time**
```bash
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: VALID_SIGNATURE" \
  -d '{
    "event": "subscription.charged",
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_test123",
          "current_start": 1707523200,
          "current_end": 1710201600,
          "paid_count": 1
        }
      },
      "payment": {
        "entity": {
          "id": "pay_test456",
          "amount": 29900,
          "status": "captured",
          "created_at": 1707523200
        }
      }
    },
    "created_at": 1707523200
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Webhook processed successfully",
  "processingTime": "45ms"
}
```

Check logs:
```
[INFO] Processing webhook { event: 'subscription.charged', uniqueKey: 'abc123...' }
[INFO] Credits granted successfully { userId: 'xxx', credits: 50 }
[INFO] Webhook processed successfully { processingTime: '45ms' }
```

2. **Send Same Webhook Again (Duplicate)**
```bash
# Send exact same payload again
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: VALID_SIGNATURE" \
  -d '{
    "event": "subscription.charged",
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_test123",
          "current_start": 1707523200,
          "current_end": 1710201600,
          "paid_count": 1
        }
      },
      "payment": {
        "entity": {
          "id": "pay_test456",
          "amount": 29900,
          "status": "captured",
          "created_at": 1707523200
        }
      }
    },
    "created_at": 1707523200
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Webhook already processed",
  "processedAt": "2025-01-10T10:30:00.000Z"
}
```

Check logs:
```
[INFO] Webhook already processed (dedupe) {
  event: 'subscription.charged',
  uniqueKey: 'abc123...',
  processedAt: '2025-01-10T10:30:00.000Z'
}
```

3. **Verify Credits NOT Double-Granted**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Credits should be 50, NOT 100

4. **Verify Payment NOT Duplicated**
```bash
# Query database
db.payments.find({ razorpayPaymentId: 'pay_test456' }).count()
```

**Expected**: Count should be 1, not 2

5. **Verify WebhookEvent Recorded**
```bash
# Query database
db.webhookevents.find({ uniqueKey: 'abc123...' })
```

**Expected**:
```json
{
  "uniqueKey": "abc123...",
  "event": "subscription.charged",
  "processed": true,
  "processedAt": "2025-01-10T10:30:00.000Z",
  "attempts": 2
}
```

**Success Criteria**:
- ✅ First webhook processed normally
- ✅ Credits granted once
- ✅ Payment recorded once
- ✅ Second webhook detected as duplicate
- ✅ Second webhook returns success immediately
- ✅ Credits NOT double-granted
- ✅ Payment NOT duplicated
- ✅ WebhookEvent.attempts incremented

---

### Test 6: Subscription Cancellation

**Objective**: Verify subscription cancellation with access until period end

**Steps**:

1. **Cancel at Period End**
```bash
curl -X POST http://localhost:3000/api/subscriptions/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "immediately": false,
    "reason": "user_requested"
  }'
```

**Expected Response**:
```json
{
  "success": true,
  "subscription": {
    "status": "active",
    "cancelAtPeriodEnd": true,
    "cancelledAt": null,
    "accessUntil": "2025-02-10T00:00:00.000Z"
  },
  "message": "Subscription will be cancelled at period end"
}
```

2. **Verify Credits Still Available**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: Credits still available until currentPeriodEnd

3. **Wait for Period End**

Razorpay sends `subscription.cancelled` webhook at period end.

4. **Verify Cancellation Webhook**

Check logs:
```
[INFO] Handling subscription.cancelled { subscriptionId: 'sub_xxx' }
[INFO] Subscription cancelled { status: 'cancelled', endedAt: '2025-02-10' }
```

5. **Verify Subscription Status**
```bash
curl -X GET http://localhost:3000/api/subscriptions/current \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**: 404 Not Found (no active subscription)

6. **Verify Credits Expired**
```bash
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer $TOKEN"
```

**Expected**:
```json
{
  "defaultCredits": 3,
  "subscriptionCredits": 0,
  "totalCredits": 3
}
```

**Success Criteria**:
- ✅ cancelAtPeriodEnd set to true
- ✅ Credits remain until period end
- ✅ Access maintained until period end
- ✅ At period end: status set to cancelled
- ✅ Credits expired at period end
- ✅ User falls back to default credits

---


## Razorpay Test Cards

Use these test cards in Razorpay test mode:

### Successful Payments

**Domestic Debit Card (Success)**
- Card Number: `4111 1111 1111 1111`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Payment succeeds immediately

**Domestic Credit Card (Success)**
- Card Number: `5555 5555 5555 4444`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Payment succeeds immediately

**International Card (Success)**
- Card Number: `4012 0010 3714 1112`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Payment succeeds immediately

### Failed Payments

**Card Declined**
- Card Number: `4000 0000 0000 0002`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Payment fails with "Card declined"

**Insufficient Funds**
- Card Number: `4000 0000 0000 9995`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Payment fails with "Insufficient funds"

**Invalid CVV**
- Card Number: `4111 1111 1111 1111`
- CVV: `000`
- Expiry: Any future date
- Result: Payment fails with "Invalid CVV"

### 3D Secure Authentication

**3DS Required (Success)**
- Card Number: `4000 0027 6000 3184`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Requires 3DS authentication, then succeeds

**3DS Required (Failure)**
- Card Number: `4000 0000 0000 3220`
- CVV: Any 3 digits
- Expiry: Any future date
- Result: Requires 3DS authentication, then fails

### Test UPI IDs

**Success**
- UPI ID: `success@razorpay`
- Result: Payment succeeds

**Failure**
- UPI ID: `failure@razorpay`
- Result: Payment fails

---

## Webhook Testing

### Manual Webhook Testing

#### 1. Using Razorpay Dashboard

1. Go to Razorpay Dashboard → Webhooks
2. Click on your webhook
3. Go to "Logs" tab
4. Find a webhook event
5. Click "Replay" to resend

#### 2. Using curl with Signature

Calculate signature:
```javascript
const crypto = require('crypto');
const webhookSecret = 'your_webhook_secret';
const payload = JSON.stringify(webhookBody);

const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex');

console.log('X-Razorpay-Signature:', signature);
```

Send webhook:
```bash
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: CALCULATED_SIGNATURE" \
  -d @webhook-payload.json
```

#### 3. Using Postman

1. Create new POST request to `http://localhost:3000/api/webhooks/razorpay`
2. Add header: `Content-Type: application/json`
3. Add header: `X-Razorpay-Signature: CALCULATED_SIGNATURE`
4. Add JSON body with webhook payload
5. Send request

### Webhook Payload Examples

#### subscription.authenticated
```json
{
  "event": "subscription.authenticated",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_xxxxxxxxxxxxx",
        "status": "authenticated",
        "plan_id": "plan_xxxxxxxxxxxxx",
        "customer_id": "cust_xxxxxxxxxxxxx",
        "start_at": 1707523200,
        "charge_at": 1707523200,
        "auth_attempts": 1,
        "notes": {
          "userId": "user_object_id"
        }
      }
    },
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxx",
        "amount": 29900,
        "currency": "INR",
        "status": "captured",
        "method": "card",
        "created_at": 1707523200
      }
    }
  },
  "created_at": 1707523200
}
```

#### subscription.activated
```json
{
  "event": "subscription.activated",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_xxxxxxxxxxxxx",
        "status": "active",
        "plan_id": "plan_xxxxxxxxxxxxx",
        "customer_id": "cust_xxxxxxxxxxxxx",
        "current_start": 1707523200,
        "current_end": 1710201600,
        "paid_count": 1,
        "total_count": 12,
        "remaining_count": 11,
        "charge_at": 1710201600,
        "notes": {
          "userId": "user_object_id"
        }
      }
    },
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxx",
        "amount": 29900,
        "currency": "INR",
        "status": "captured",
        "method": "card",
        "created_at": 1707523200
      }
    }
  },
  "created_at": 1707523200
}
```

#### subscription.charged
```json
{
  "event": "subscription.charged",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_xxxxxxxxxxxxx",
        "status": "active",
        "current_start": 1710201600,
        "current_end": 1712880000,
        "paid_count": 2,
        "remaining_count": 10,
        "charge_at": 1712880000
      }
    },
    "payment": {
      "entity": {
        "id": "pay_yyyyyyyyyyy",
        "amount": 29900,
        "currency": "INR",
        "status": "captured",
        "method": "card",
        "created_at": 1710201600
      }
    }
  },
  "created_at": 1710201600
}
```

#### subscription.pending
```json
{
  "event": "subscription.pending",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_xxxxxxxxxxxxx",
        "status": "pending",
        "auth_attempts": 1,
        "charge_at": 1710288000
      }
    }
  },
  "created_at": 1710201600
}
```

#### subscription.halted
```json
{
  "event": "subscription.halted",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_xxxxxxxxxxxxx",
        "status": "halted",
        "auth_attempts": 4
      }
    }
  },
  "created_at": 1710460800
}
```

#### payment.failed
```json
{
  "event": "payment.failed",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxx",
        "amount": 29900,
        "currency": "INR",
        "status": "failed",
        "method": "card",
        "error_code": "BAD_REQUEST_ERROR",
        "error_description": "Payment failed due to insufficient funds",
        "created_at": 1710201600
      }
    },
    "subscription": {
      "entity": {
        "id": "sub_xxxxxxxxxxxxx"
      }
    }
  },
  "created_at": 1710201600
}
```

---

## Cron Job Testing

### Manual Job Triggers

#### 1. Credit Expiry Job
```javascript
// In Node.js console or test script
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

// Trigger credit expiry job
await subscriptionJobs.scheduleExpireCreditsJob();

// Check logs for:
// - Subscriptions processed
// - Credits expired
// - Errors
```

#### 2. Subscription Reconciliation Job
```javascript
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

// Trigger reconciliation job
await subscriptionJobs.scheduleSubscriptionReconciliation();

// Check logs for:
// - Subscriptions checked
// - Mismatches found
// - Updates made
```

#### 3. Scheduled Plan Changes Job
```javascript
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

// Trigger plan changes job
await subscriptionJobs.scheduleScheduledPlanChanges();

// Check logs for:
// - Plan changes processed
// - Razorpay updates
// - Errors
```

### Verify Job Execution

Check logs for scheduled job execution:
```bash
# Credit expiry (hourly)
grep "Running credit expiry job" logs/combined.log

# Reconciliation (daily at 1 AM)
grep "Running subscription reconciliation job" logs/combined.log

# Plan changes (every 6 hours)
grep "Running scheduled plan changes job" logs/combined.log
```

---

## Troubleshooting

### Issue 1: Webhook Signature Verification Fails

**Symptoms**:
- Webhooks rejected with 401
- Log: "Invalid Razorpay webhook signature"

**Solutions**:
1. Verify `RAZORPAY_WEBHOOK_SECRET` in `.env` matches Razorpay dashboard
2. Check webhook secret is not expired
3. Ensure raw body is used for signature verification
4. Test signature calculation manually

**Debug**:
```javascript
// In webhookController.js, add logging
console.log('Received signature:', req.headers['x-razorpay-signature']);
console.log('Calculated signature:', expectedSignature);
console.log('Body:', JSON.stringify(req.body));
```

### Issue 2: Credits Double-Granted

**Symptoms**:
- User has 2x expected credits
- Multiple grant transactions for same payment

**Solutions**:
1. Check Payment.razorpayPaymentId has unique index
2. Check WebhookEvent.uniqueKey has unique index
3. Verify Payment.processed flag is checked before granting
4. Check webhook deduplication logic

**Debug**:
```bash
# Check for duplicate payments
db.payments.aggregate([
  { $group: { _id: "$razorpayPaymentId", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
])

# Check for duplicate webhooks
db.webhookevents.aggregate([
  { $group: { _id: "$uniqueKey", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
])
```

### Issue 3: Credits Not Expiring

**Symptoms**:
- Old credits remain after renewal
- subscriptionCredits not reset

**Solutions**:
1. Check cron job is running (logs)
2. Verify `expireSubscriptionCredits()` is called in webhook handler
3. Check currentPeriodEnd dates are correct
4. Manually trigger credit expiry job

**Debug**:
```javascript
// Check subscriptions with expired periods
db.subscriptions.find({
  status: 'active',
  currentPeriodEnd: { $lt: new Date() }
})

// Check credit wallets with expired credits
db.creditwallets.find({
  subscriptionCredits: { $gt: 0 },
  subscriptionCreditExpiry: { $lt: new Date() }
})
```

### Issue 4: Scheduled Plan Change Not Applied

**Symptoms**:
- Plan not changed at cycle end
- scheduledChange still present

**Solutions**:
1. Check cron job is running
2. Verify effectiveDate is in the past
3. Check Razorpay API credentials
4. Manually trigger plan change job

**Debug**:
```javascript
// Check subscriptions with pending plan changes
db.subscriptions.find({
  'scheduledChange.effectiveDate': { $lt: new Date() },
  'scheduledChange.newPlanId': { $exists: true }
})
```

### Issue 5: Razorpay API Errors

**Symptoms**:
- Subscription creation fails
- 500 errors in API responses

**Solutions**:
1. Verify Razorpay API keys are correct
2. Check Razorpay account is in test mode
3. Verify plan exists in Razorpay dashboard
4. Check Razorpay API status

**Debug**:
```javascript
// Test Razorpay connection
const Razorpay = require('razorpay');
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Test API call
razorpay.plans.all()
  .then(plans => console.log('Plans:', plans))
  .catch(error => console.error('Error:', error));
```

---

## Database Queries for Verification

### Check Webhook Processing
```javascript
// Recent webhooks
db.webhookevents.find().sort({ receivedAt: -1 }).limit(10)

// Failed webhooks
db.webhookevents.find({ processed: false, attempts: { $gt: 0 } })

// Webhooks for specific subscription
db.webhookevents.find({ razorpaySubscriptionId: 'sub_xxx' }).sort({ receivedAt: 1 })
```

### Check Payments
```javascript
// Recent payments
db.payments.find().sort({ createdAt: -1 }).limit(10)

// Payments for subscription
db.payments.find({ subscriptionId: ObjectId('xxx') }).sort({ createdAt: 1 })

// Unprocessed payments
db.payments.find({ status: 'captured', processed: false })
```

### Check Subscriptions
```javascript
// Active subscriptions
db.subscriptions.find({ status: 'active' })

// Subscriptions with scheduled changes
db.subscriptions.find({ 'scheduledChange.newPlanId': { $exists: true } })

// Subscriptions expiring soon
db.subscriptions.find({
  status: 'active',
  currentPeriodEnd: {
    $gte: new Date(),
    $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }
})
```

### Check Credits
```javascript
// User credit balance
db.creditwallets.findOne({ userId: ObjectId('xxx') })

// Recent credit transactions
db.credittransactions.find({ userId: ObjectId('xxx') })
  .sort({ createdAt: -1 })
  .limit(20)

// Expired credits
db.creditwallets.find({
  subscriptionCredits: { $gt: 0 },
  subscriptionCreditExpiry: { $lt: new Date() }
})
```

---

## Success Checklist

After completing all tests, verify:

- [ ] ✅ New subscriptions can be created via API
- [ ] ✅ Payment links (short_url) work correctly
- [ ] ✅ Webhooks are received and processed
- [ ] ✅ Webhook signatures are verified
- [ ] ✅ Webhook deduplication works (no double-processing)
- [ ] ✅ Payment deduplication works (no double-charging)
- [ ] ✅ Credits are granted on subscription activation
- [ ] ✅ Credits have correct expiry dates
- [ ] ✅ Subscription renewals work automatically
- [ ] ✅ Old credits expire on renewal
- [ ] ✅ New credits granted on renewal
- [ ] ✅ Payment failures are handled correctly
- [ ] ✅ Pending status doesn't expire credits
- [ ] ✅ Halted status expires credits immediately
- [ ] ✅ Plan upgrades can be scheduled
- [ ] ✅ Scheduled upgrades execute at cycle end
- [ ] ✅ Razorpay subscription is updated on plan change
- [ ] ✅ Subscription cancellation works
- [ ] ✅ Credits remain until period end on cancellation
- [ ] ✅ Cron jobs run on schedule
- [ ] ✅ Credit expiry job works correctly
- [ ] ✅ Reconciliation job works correctly
- [ ] ✅ Plan change job works correctly
- [ ] ✅ All logs are structured and informative
- [ ] ✅ Errors are logged with full context
- [ ] ✅ Database indexes are created
- [ ] ✅ API endpoints return correct status codes
- [ ] ✅ API responses match expected format

---

## Production Deployment Checklist

Before deploying to production:

- [ ] Switch Razorpay to live mode
- [ ] Update RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET with live keys
- [ ] Update RAZORPAY_WEBHOOK_SECRET with live webhook secret
- [ ] Configure webhook URL to production domain
- [ ] Create production plans in Razorpay dashboard
- [ ] Update Plan records in database with live razorpayPlanId
- [ ] Verify all database indexes are created
- [ ] Test with real payment (small amount)
- [ ] Monitor webhook logs for first few subscriptions
- [ ] Set up alerts for webhook failures
- [ ] Set up alerts for payment failures
- [ ] Configure log aggregation (e.g., CloudWatch, Datadog)
- [ ] Set up error tracking (e.g., Sentry)
- [ ] Document rollback procedure
- [ ] Prepare customer support scripts
- [ ] Test cancellation and refund procedures

---

## Support and Resources

**Razorpay Documentation**:
- Subscriptions API: https://razorpay.com/docs/api/subscriptions/
- Webhooks: https://razorpay.com/docs/webhooks/
- Test Cards: https://razorpay.com/docs/payments/payments/test-card-details/

**Internal Documentation**:
- Requirements: `.kiro/specs/razorpay-subscription-system/requirements.md`
- Design: `.kiro/specs/razorpay-subscription-system/design.md`
- Tasks: `.kiro/specs/razorpay-subscription-system/tasks.md`

**Contact**:
- Razorpay Support: support@razorpay.com
- Razorpay Dashboard: https://dashboard.razorpay.com/
