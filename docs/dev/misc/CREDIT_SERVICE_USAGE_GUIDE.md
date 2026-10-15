# Credit Service Usage Guide for Webhook Handlers

## Overview
This guide explains how to use the enhanced credit service with atomic operations and payment deduplication in webhook handlers.

## Main Method: `grantSubscriptionCreditsWithPayment`

### Purpose
This method provides atomic credit operations with complete deduplication protection for subscription renewals. It should be used by webhook handlers when processing subscription payments.

### Method Signature
```javascript
async grantSubscriptionCreditsWithPayment(
  userId,           // string|ObjectId - User ID
  subscriptionId,   // string - Subscription ID
  paymentId,        // string - Razorpay payment ID for deduplication
  amount,           // number - Credit amount to grant
  expiryDate,       // Date - Credit expiry date
  metadata = {}     // Object - Additional metadata
)
```

### What It Does
1. **Checks Payment Deduplication**: Verifies payment hasn't been processed before
2. **Expires Old Credits**: Atomically removes old subscription credits
3. **Grants New Credits**: Adds new subscription credits with expiry
4. **Updates Payment**: Marks payment as processed with timestamp
5. **Creates Audit Trail**: Records all operations in credit transactions

### Return Value
```javascript
{
  success: true,
  wallet: { /* wallet object */ },
  payment: { /* payment object */ },
  grantTransaction: { /* transaction object */ },
  oldCreditsExpired: 50,      // Number of old credits expired
  newCreditsGranted: 100,     // Number of new credits granted
  message: "Atomic operation completed: expired 50 credits, granted 100 new credits"
}
```

### If Already Processed
```javascript
{
  success: true,
  alreadyProcessed: true,
  wallet: { /* wallet object */ },
  payment: { /* payment object */ },
  message: "Payment already processed, credits previously granted"
}
```

## Usage in Webhook Handlers

### Example: subscription.charged Event Handler

```javascript
async handleCharged(payload, webhookEvent) {
  const { subscription: subscriptionEntity, payment: paymentEntity } = payload;
  
  // Find local subscription
  const subscription = await Subscription.findOne({
    razorpaySubscriptionId: subscriptionEntity.entity.id
  });
  
  if (!subscription) {
    throw new Error('Subscription not found');
  }
  
  // Record payment (idempotent)
  const { payment, created } = await Payment.createOrGet({
    razorpayPaymentId: paymentEntity.entity.id,
    subscriptionId: subscription._id,
    userId: subscription.userId,
    amount: paymentEntity.entity.amount,
    currency: paymentEntity.entity.currency,
    status: paymentEntity.entity.status,
    method: paymentEntity.entity.method,
    capturedAt: new Date(paymentEntity.entity.captured_at * 1000),
    webhookData: paymentEntity
  });
  
  // Calculate expiry date (end of current period)
  const expiryDate = new Date(subscriptionEntity.entity.current_end * 1000);
  
  // Get credit amount from plan
  const plan = await Plan.findById(subscription.planId);
  const creditsAmount = plan.features.credits.monthly;
  
  // ATOMIC OPERATION: Expire old credits + Grant new credits
  const creditService = require('../services/creditService');
  const result = await creditService.grantSubscriptionCreditsWithPayment(
    subscription.userId,
    subscription._id.toString(),
    payment.razorpayPaymentId,
    creditsAmount,
    expiryDate,
    {
      source: 'webhook',
      event: 'subscription.charged',
      webhookEventId: webhookEvent._id,
      planId: plan._id,
      planName: plan.name
    }
  );
  
  if (result.alreadyProcessed) {
    logger.info('Payment already processed, credits previously granted', {
      userId: subscription.userId,
      paymentId: payment.razorpayPaymentId,
      creditsGranted: payment.creditsGranted
    });
  } else {
    logger.info('Credits granted successfully', {
      userId: subscription.userId,
      paymentId: payment.razorpayPaymentId,
      oldCreditsExpired: result.oldCreditsExpired,
      newCreditsGranted: result.newCreditsGranted
    });
  }
  
  // Update subscription billing details
  subscription.currentPeriodStart = new Date(subscriptionEntity.entity.current_start * 1000);
  subscription.currentPeriodEnd = expiryDate;
  subscription.paidCount = subscriptionEntity.entity.paid_count;
  subscription.remainingCount = subscriptionEntity.entity.remaining_count;
  subscription.chargeAt = new Date(subscriptionEntity.entity.charge_at * 1000);
  await subscription.save();
  
  return {
    subscriptionId: subscription._id,
    userId: subscription.userId
  };
}
```

### Example: subscription.activated Event Handler

```javascript
async handleActivated(payload, webhookEvent) {
  const { subscription: subscriptionEntity, payment: paymentEntity } = payload;
  
  // Find or create subscription
  let subscription = await Subscription.findOne({
    razorpaySubscriptionId: subscriptionEntity.entity.id
  });
  
  if (!subscription) {
    // Create new subscription (first activation)
    subscription = await Subscription.create({
      userId: /* user ID from razorpayCustomerId lookup */,
      planId: /* plan ID from razorpayPlanId lookup */,
      razorpaySubscriptionId: subscriptionEntity.entity.id,
      status: 'active',
      // ... other fields
    });
  } else {
    subscription.status = 'active';
  }
  
  // Record payment
  const { payment } = await Payment.createOrGet({
    razorpayPaymentId: paymentEntity.entity.id,
    subscriptionId: subscription._id,
    userId: subscription.userId,
    amount: paymentEntity.entity.amount,
    currency: paymentEntity.entity.currency,
    status: paymentEntity.entity.status,
    capturedAt: new Date(paymentEntity.entity.captured_at * 1000)
  });
  
  // Grant credits (first time, no old credits to expire)
  const expiryDate = new Date(subscriptionEntity.entity.current_end * 1000);
  const plan = await Plan.findById(subscription.planId);
  
  const creditService = require('../services/creditService');
  await creditService.grantSubscriptionCreditsWithPayment(
    subscription.userId,
    subscription._id.toString(),
    payment.razorpayPaymentId,
    plan.features.credits.monthly,
    expiryDate,
    {
      source: 'webhook',
      event: 'subscription.activated',
      webhookEventId: webhookEvent._id
    }
  );
  
  await subscription.save();
  
  return {
    subscriptionId: subscription._id,
    userId: subscription.userId
  };
}
```

## Error Handling

### Payment Not Found
```javascript
try {
  await creditService.grantSubscriptionCreditsWithPayment(...);
} catch (error) {
  if (error.code === 'CREDIT_OPERATION_ERROR' && 
      error.message.includes('Payment record not found')) {
    // Payment should be recorded before calling this method
    logger.error('Payment not found, cannot grant credits', { paymentId });
  }
}
```

### Transaction Rollback
If any operation fails, all changes are automatically rolled back:
- Payment remains unprocessed
- Wallet is not modified
- No credit transactions are created

## Best Practices

### 1. Always Record Payment First
```javascript
// ✅ CORRECT
const { payment } = await Payment.createOrGet({ ... });
await creditService.grantSubscriptionCreditsWithPayment(...);

// ❌ WRONG
await creditService.grantSubscriptionCreditsWithPayment(...);
const { payment } = await Payment.createOrGet({ ... });
```

### 2. Use Payment ID for Deduplication
```javascript
// ✅ CORRECT - Uses Razorpay payment ID
await creditService.grantSubscriptionCreditsWithPayment(
  userId,
  subscriptionId,
  payment.razorpayPaymentId,  // Unique payment ID
  amount,
  expiryDate
);
```

### 3. Check alreadyProcessed Flag
```javascript
const result = await creditService.grantSubscriptionCreditsWithPayment(...);

if (result.alreadyProcessed) {
  // Log and continue - this is normal for duplicate webhooks
  logger.info('Duplicate webhook, credits already granted');
  return { success: true };
}
```

### 4. Include Metadata for Audit Trail
```javascript
await creditService.grantSubscriptionCreditsWithPayment(
  userId,
  subscriptionId,
  paymentId,
  amount,
  expiryDate,
  {
    source: 'webhook',
    event: 'subscription.charged',
    webhookEventId: webhookEvent._id,
    planId: plan._id,
    planName: plan.name,
    razorpayInvoiceId: invoiceId
  }
);
```

## Backward Compatibility

The existing `grantSubscriptionCredits` method still works and now supports payment deduplication:

```javascript
// Old method with new paymentId parameter
await creditService.grantSubscriptionCredits(
  userId,
  amount,
  expiryDate,
  subscriptionId,
  paymentId,  // Optional - enables deduplication
  metadata
);
```

However, for webhook handlers, prefer `grantSubscriptionCreditsWithPayment` as it:
- Requires payment record to exist (validation)
- Returns more detailed information
- Has clearer semantics for the use case

## Testing

For testing, disable transactions:
```javascript
const creditService = new CreditService({ useTransactions: false });
```

For production, use default (transactions enabled):
```javascript
const creditService = new CreditService();
// or
const creditService = require('../services/creditService');
```

## Monitoring

### Key Metrics to Track
- Deduplication rate (alreadyProcessed responses)
- Credit grant success rate
- Old credits expired per renewal
- Processing time per operation

### Log Analysis
Search for these log messages:
- "Starting atomic credit operation" - Operation started
- "Payment already processed" - Deduplication occurred
- "Expiring old subscription credits" - Old credits being removed
- "Atomic credit operation completed" - Success
- "Error granting subscription credits" - Failure

## Summary

The `grantSubscriptionCreditsWithPayment` method provides:
- ✅ Complete payment deduplication
- ✅ Atomic expire + grant operations
- ✅ Automatic payment record updates
- ✅ Comprehensive audit trail
- ✅ Transaction support with rollback
- ✅ Idempotent operations safe to retry

Use this method in all webhook handlers that process subscription payments to ensure credits are granted exactly once with proper expiry management.
