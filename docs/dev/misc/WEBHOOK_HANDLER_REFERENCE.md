# Webhook Handler Reference Guide

## Overview
This document provides a quick reference for the comprehensive Razorpay webhook handler implementation completed in Task 3.

## Key Methods

### 1. verifyRazorpaySignature(req, secret)
**Purpose:** Verify webhook signature using HMAC SHA256

**Parameters:**
- `req` - Express request object with headers and body
- `secret` - Webhook secret from environment variable

**Returns:** `boolean` - true if signature is valid

**Usage:**
```javascript
const isValid = this.verifyRazorpaySignature(req, process.env.RAZORPAY_WEBHOOK_SECRET);
if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

### 2. handleRazorpayWebhook(req, res)
**Purpose:** Main webhook entry point with routing and deduplication

**Flow:**
1. Verify signature
2. Generate unique key for deduplication
3. Check if webhook already processed
4. Record webhook event
5. Route to appropriate handler
6. Mark as processed or failed
7. Return response with processing time

**Event Routing:**
- `subscription.authenticated` → handleAuthenticated()
- `subscription.activated` → handleActivated()
- `subscription.charged` → handleCharged()
- `subscription.pending` → handlePending()
- `subscription.halted` → handleHalted()
- `subscription.completed` → handleCompleted()
- `subscription.cancelled` → handleCancelled()
- `payment.failed` → handlePaymentFailed()

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed successfully",
  "processingTime": "125ms"
}
```

---

### 3. recordPayment(paymentEntity, subscription, grantCredits)
**Purpose:** Idempotent payment recording with optional credit granting

**Parameters:**
- `paymentEntity` - Razorpay payment entity from webhook
- `subscription` - Subscription document from database
- `grantCredits` - Boolean flag to grant credits (default: false)

**Returns:** `Promise<Payment>` - Payment document

**Features:**
- Idempotent using Payment.createOrGet()
- Checks Payment.processed flag
- Converts amount from paise to rupees
- Extracts card details safely
- Grants credits if requested and payment captured

**Usage:**
```javascript
const payment = await this.recordPayment(
  payload.payment.entity,
  subscription,
  true // Grant credits
);
```

---

### 4. grantCreditsForSubscription(subscription, payment)
**Purpose:** Atomic credit operations - expire old, grant new

**Parameters:**
- `subscription` - Subscription document
- `payment` - Payment document

**Flow:**
1. Fetch plan to get credit amount
2. Check for existing subscription credits
3. Expire old subscription credits
4. Grant new credits with expiry date
5. Update payment.creditsGranted and payment.processed
6. Log operation

**Features:**
- Atomic operation (expire + grant)
- Uses currentPeriodEnd as expiry date
- Updates payment processed flag
- Comprehensive logging

**Usage:**
```javascript
await this.grantCreditsForSubscription(subscription, payment);
```

---

## Deduplication Strategy

### Layer 1: WebhookEvent Unique Key
- Generated from: event + subscriptionId + paymentId + timestamp
- SHA256 hash for consistency
- Checked before processing
- Returns success immediately if duplicate

### Layer 2: Payment.createOrGet()
- Uses razorpayPaymentId unique constraint
- Returns existing payment if already created
- Prevents duplicate payment records

### Layer 3: Payment.processed Flag
- Checked before granting credits
- Skips credit operations if already processed
- Prevents double-granting

---

## Error Handling

### Signature Verification Failure
- Returns 401 Unauthorized
- Logs warning with IP and headers
- Does not process webhook

### Duplicate Webhook
- Returns 200 OK immediately
- Logs info with original processing time
- Does not reprocess

### Processing Error
- Marks WebhookEvent as failed
- Logs error with full context
- Returns 500 Internal Server Error
- Allows Razorpay to retry

---

## Logging

### Webhook Received
```javascript
logger.info('Received Razorpay webhook', {
  event,
  razorpaySubscriptionId,
  razorpayPaymentId,
  timestamp
});
```

### Duplicate Detection
```javascript
logger.info('Duplicate webhook detected, skipping processing', {
  uniqueKey,
  event,
  originalProcessedAt,
  processingTime
});
```

### Payment Recording
```javascript
logger.info('Payment already processed, skipping credit operations', {
  paymentId,
  userId,
  creditsGranted
});
```

### Credit Granting
```javascript
logger.info('Credits granted successfully for subscription payment', {
  userId,
  amount,
  paymentId,
  subscriptionId
});
```

---

## Security

### Signature Verification
- HMAC SHA256 algorithm
- Timing-safe comparison
- Validates webhook secret configuration
- Logs all verification failures

### Data Validation
- Validates webhook structure
- Checks for required fields
- Handles missing data gracefully

---

## Testing

### Manual Testing
```bash
# Send test webhook
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: <signature>" \
  -d '{
    "event": "subscription.activated",
    "payload": {
      "subscription": {
        "entity": {
          "id": "sub_123"
        }
      }
    },
    "created_at": 1234567890
  }'
```

### Signature Generation
```javascript
const crypto = require('crypto');
const body = { event: 'subscription.activated', ... };
const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
const signature = crypto
  .createHmac('sha256', secret)
  .update(JSON.stringify(body))
  .digest('hex');
```

---

## Environment Variables

Required:
- `RAZORPAY_WEBHOOK_SECRET` - Webhook secret from Razorpay dashboard

Optional:
- Logging level configuration
- Database connection settings

---

## Next Steps (Task 4)

Implement the event handler methods:
1. handleAuthenticated() - First payment authorization
2. handleActivated() - Subscription becomes active
3. handleCharged() - Recurring payment succeeded
4. handlePending() - Payment failed, retries in progress
5. handleHalted() - All retries exhausted
6. handleCompleted() - All billing cycles completed
7. handleCancelled() - User cancelled subscription
8. handlePaymentFailed() - Payment attempt failed

---

## Common Issues

### Issue: Invalid Signature
**Cause:** Webhook secret mismatch or body modification
**Solution:** Verify RAZORPAY_WEBHOOK_SECRET matches Razorpay dashboard

### Issue: Duplicate Processing
**Cause:** Razorpay retry or network issues
**Solution:** Already handled by deduplication layers

### Issue: Credits Not Granted
**Cause:** Payment not captured or already processed
**Solution:** Check payment.status and payment.processed flag

---

## References

- Task 3 Implementation: `.kiro/specs/razorpay-subscription-system/tasks.md`
- Requirements: `.kiro/specs/razorpay-subscription-system/requirements.md`
- Design: `.kiro/specs/razorpay-subscription-system/design.md`
- Implementation Summary: `TASK_3_IMPLEMENTATION_SUMMARY.md`
