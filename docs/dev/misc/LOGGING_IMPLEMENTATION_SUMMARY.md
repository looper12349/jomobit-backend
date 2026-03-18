# Logging Implementation Summary

## Overview

This document summarizes the comprehensive logging and error handling implementation for the Razorpay subscription system. All logging follows structured logging principles with proper context, sanitization of sensitive data, and detailed error tracking.

## Logging Categories

### 1. Webhook Processing Logging

**Location**: `src/controllers/webhookController.js`

#### Main Webhook Handler
- **Event**: Webhook received
- **Logs**: Event type, subscription ID, payment ID, timestamp
- **Level**: INFO

```javascript
logger.info('Received Razorpay webhook', {
  event,
  razorpaySubscriptionId,
  razorpayPaymentId,
  timestamp: new Date().toISOString()
});
```

#### Deduplication Detection
- **Event**: Duplicate webhook detected
- **Logs**: Unique key, event, original processed time, processing time
- **Level**: INFO

```javascript
logger.info('Duplicate webhook detected, skipping processing', {
  uniqueKey,
  event,
  originalProcessedAt: existingWebhook.processedAt,
  processingTime: `${processingTime}ms`,
  deduplicationDetected: true
});
```

#### Webhook Processing Success
- **Event**: Webhook processed successfully
- **Logs**: Event, unique key, processing time
- **Level**: INFO

```javascript
logger.info('Webhook processed successfully', {
  event,
  uniqueKey,
  processingTime: `${processingTime}ms`
});
```

#### Webhook Processing Errors
- **Event**: Webhook processing failed
- **Logs**: Event, error message, stack trace, processing time
- **Level**: ERROR

```javascript
logger.error('Error processing Razorpay webhook', {
  event: req.body?.event,
  error: error.message,
  stack: error.stack,
  processingTime: `${processingTime}ms`
});
```

### 2. Payment Recording Logging

**Location**: `src/controllers/webhookController.js`

#### Payment Recording
- **Event**: Payment being recorded
- **Logs**: Payment ID, subscription ID, user ID, amount, currency, status
- **Level**: INFO

```javascript
logger.info('Recording payment', {
  paymentId: paymentEntity.id,
  subscriptionId: subscription._id,
  userId: subscription.userId,
  amount: paymentEntity.amount / 100,
  currency: paymentEntity.currency,
  status: paymentEntity.status,
  grantCredits
});
```

#### Payment Deduplication
- **Event**: Payment already processed
- **Logs**: Payment ID, user ID, subscription ID, credits granted, original processed time
- **Level**: INFO

```javascript
logger.info('Payment deduplication: already processed, skipping credit operations', {
  paymentId: payment.razorpayPaymentId,
  userId: subscription.userId,
  subscriptionId: subscription._id,
  creditsGranted: payment.creditsGranted,
  originalProcessedAt: payment.processedAt,
  deduplicationDetected: true
});
```

### 3. Credit Operations Logging

**Location**: `src/services/creditService.js`, `src/controllers/webhookController.js`

#### Granting Subscription Credits
- **Event**: Subscription credits being granted
- **Logs**: User ID, amount, expiry date, subscription ID, payment ID, source
- **Level**: INFO

```javascript
logger.info('Credit operation: granting subscription credits', {
  userId,
  amount,
  expiryDate,
  subscriptionId,
  paymentId,
  source: metadata.source || 'subscription',
  operation: 'grant_subscription_credits'
});
```

#### Credit Deduplication
- **Event**: Payment already processed for credits
- **Logs**: User ID, payment ID, subscription ID, credits granted, original processed time
- **Level**: INFO

```javascript
logger.info('Credit deduplication: payment already processed, skipping credit grant', {
  userId,
  paymentId,
  subscriptionId,
  creditsGranted: payment.creditsGranted,
  originalProcessedAt: payment.processedAt,
  deduplicationDetected: true,
  operation: 'grant_subscription_credits'
});
```

#### Expiring Old Credits
- **Event**: Old subscription credits being expired before renewal
- **Logs**: User ID, old credits, old expiry, subscription ID, reason
- **Level**: INFO

```javascript
logger.info('Credit operation: expiring old subscription credits before granting new ones', {
  userId,
  oldCredits: wallet.subscriptionCredits,
  oldExpiry: wallet.subscriptionCreditExpiry,
  subscriptionId,
  reason: 'subscription_renewal',
  operation: 'expire_before_grant'
});
```

#### Credits Granted Successfully
- **Event**: Subscription credits granted successfully
- **Logs**: User ID, amount, expiry date, subscription ID, old credits expired, new balance, payment ID
- **Level**: INFO

```javascript
logger.info('Credit operation: subscription credits granted successfully', {
  userId,
  amount,
  expiryDate,
  subscriptionId,
  oldCreditsExpired: oldSubscriptionCredits,
  newBalance: wallet.totalCredits,
  paymentId,
  source: metadata.source || 'subscription',
  operation: 'grant_subscription_credits'
});
```

### 4. Payment Failure Logging

**Location**: `src/controllers/webhookController.js`

#### Payment Failed Event
- **Event**: Payment attempt failed
- **Logs**: Payment ID, subscription ID, user ID, amount, error code, error description, retry count
- **Level**: ERROR

```javascript
logger.error('Processing payment.failed event', {
  razorpayPaymentId: paymentEntity.id,
  subscriptionId: subscription?._id,
  userId: subscription?.userId,
  amount: paymentEntity.amount / 100,
  currency: paymentEntity.currency,
  method: paymentEntity.method,
  errorCode: paymentEntity.error_code,
  errorDescription: paymentEntity.error_description,
  errorSource: paymentEntity.error_source,
  errorStep: paymentEntity.error_step,
  errorReason: paymentEntity.error_reason,
  retryCount: subscription?.authAttempts || 0
});
```

#### Failed Payment Recorded
- **Event**: Failed payment recorded in database
- **Logs**: Payment ID, subscription ID, user ID, amount, failure reason, error code, retry count
- **Level**: WARN

```javascript
logger.warn('Failed payment recorded', {
  paymentId: payment.razorpayPaymentId,
  subscriptionId: subscription?._id,
  userId: subscription?.userId,
  amount: payment.amount,
  currency: payment.currency,
  failureReason: paymentEntity.error_description,
  errorCode: paymentEntity.error_code,
  retryCount: subscription?.authAttempts || 0,
  paymentMethod: paymentEntity.method
});
```

#### Subscription Halted
- **Event**: Subscription halted after all retries exhausted
- **Logs**: Subscription ID, user ID, auth attempts, credits expired, reason
- **Level**: ERROR (initial), WARN (after processing)

```javascript
logger.error('Processing subscription.halted event - all payment retries exhausted', {
  razorpaySubscriptionId: subscriptionEntity.id,
  subscriptionId: subscription?._id,
  userId: subscription?.userId,
  authAttempts: subscriptionEntity.auth_attempts,
  totalAttempts: subscriptionEntity.auth_attempts
});

logger.warn('Subscription halted, credits expired immediately', {
  subscriptionId: subscription._id,
  userId: subscription.userId,
  authAttempts: subscription.authAttempts,
  status: subscription.status,
  creditsExpired: expiryResult.totalExpired || 0,
  reason: 'payment_retries_exhausted'
});
```

### 5. Scheduled Jobs Logging

**Location**: `src/jobs/subscriptionJobs.js`

#### Job Started
- **Event**: Scheduled job started
- **Logs**: Job name, start time, schedule
- **Level**: INFO

```javascript
logger.info('Scheduled job started: credit expiry', {
  jobName: 'creditExpiry',
  startTime: startTimeFormatted,
  schedule: 'hourly'
});
```

#### Job Progress
- **Event**: Job processing items
- **Logs**: Job name, items found, items processed, current status
- **Level**: INFO

```javascript
logger.info('Scheduled job: credit expiry - found subscriptions to check', {
  jobName: 'creditExpiry',
  subscriptionsFound: subscriptions.length,
  checkDate: now.toISOString()
});
```

#### Job Completed
- **Event**: Scheduled job completed successfully
- **Logs**: Job name, start time, end time, execution time, processed count, errors
- **Level**: INFO

```javascript
logger.info('Scheduled job completed: credit expiry', {
  jobName: 'creditExpiry',
  startTime: startTimeFormatted,
  endTime: endTimeFormatted,
  executionTimeMs: executionTime,
  subscriptionsChecked: stats.subscriptionsChecked,
  subscriptionsProcessed: stats.subscriptionsProcessed,
  creditsExpired: stats.creditsExpired,
  errors: stats.errors,
  success: stats.errors === 0
});
```

#### Job Failed
- **Event**: Scheduled job failed
- **Logs**: Job name, start time, end time, execution time, error message, stack trace
- **Level**: ERROR

```javascript
logger.error('Scheduled job failed: credit expiry', {
  jobName: 'creditExpiry',
  startTime: startTimeFormatted,
  endTime: endTimeFormatted,
  executionTimeMs: executionTime,
  error: error.message,
  stack: error.stack
});
```

### 6. Subscription Lifecycle Events

#### Subscription Pending
- **Event**: Payment retry in progress
- **Logs**: Subscription ID, user ID, auth attempts
- **Level**: WARN

```javascript
logger.warn('Processing subscription.pending event - payment retry in progress', {
  razorpaySubscriptionId: subscriptionEntity.id,
  subscriptionId: subscription?._id,
  authAttempts: subscriptionEntity.auth_attempts
});
```

## Security: Sensitive Data Sanitization

**Location**: `src/utils/logger.js`

### Sanitization Function

A comprehensive sanitization function has been added to prevent logging of sensitive data:

```javascript
logger.sanitize = (data) => {
  // Sanitizes sensitive keys including:
  // - password, secret, token
  // - apiKey, api_key
  // - webhookSecret, webhook_secret
  // - razorpayKeySecret, razorpay_key_secret
  // - RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
  // - authorization, x-razorpay-signature
  // - cardNumber, card_number, cvv, pin
  
  // Returns data with sensitive values replaced with '[REDACTED]'
};
```

### Protected Data

The following data is **NEVER** logged:
- Webhook secrets (RAZORPAY_WEBHOOK_SECRET)
- API keys (RAZORPAY_KEY_SECRET)
- Passwords
- Authorization tokens
- Full card numbers (only last4 is logged)
- CVV codes
- PINs
- Signature values

### Usage

```javascript
// Automatically sanitize webhook data
const sanitizedData = logger.sanitize(webhookData);
logger.info('Webhook received', sanitizedData);
```

## Helper Logging Methods

### Webhook Logging
```javascript
logger.logWebhook(event, data);
```

### Credit Operation Logging
```javascript
logger.logCreditOperation(operation, userId, amount, details);
```

### Job Execution Logging
```javascript
logger.logJobExecution(jobName, status, stats);
```

## Log Levels

- **ERROR**: Critical failures, payment failures, subscription halted, job failures
- **WARN**: Payment retries, subscription pending, status mismatches, deduplication events
- **INFO**: Successful operations, webhook processing, credit operations, job progress
- **DEBUG**: Detailed processing steps (development only)

## Structured Logging Format

All logs follow a consistent JSON structure:

```json
{
  "timestamp": "2025-12-10T12:00:00.000Z",
  "level": "info",
  "message": "Webhook processed successfully",
  "service": "jomobit-backend-api",
  "environment": "production",
  "version": "1.0.0",
  "pid": 12345,
  "hostname": "server-01",
  "event": "subscription.charged",
  "uniqueKey": "abc123...",
  "processingTime": "150ms"
}
```

## Log Aggregation

Logs are written to:
- **Console**: Formatted for development, JSON for production
- **error.log**: ERROR level and above
- **combined.log**: All levels
- **http.log**: HTTP requests
- **debug.log**: DEBUG level (development only)

## Monitoring and Alerting

### Key Metrics to Monitor

1. **Webhook Processing**
   - Processing time > 500ms
   - Error rate > 5%
   - Duplicate webhook rate

2. **Payment Operations**
   - Payment failure rate > 10%
   - Deduplication events
   - Credit granting failures

3. **Scheduled Jobs**
   - Job execution time
   - Job failure rate
   - Items processed per job

4. **Credit Operations**
   - Credit granting failures
   - Expiry operations
   - Deduplication events

## Testing Logging

To test logging in development:

```bash
# Enable debug logging
export LOG_LEVEL=debug

# Enable logging in tests
export ENABLE_LOGGING=true

# Run application
npm start
```

## Requirements Satisfied

✅ **11.5**: Structured logging for webhook processing (event, subscriptionId, paymentId, processingTime)
✅ **11.6**: Logging for credit operations (userId, amount, expiryDate, source)
✅ **13.1**: Logging for deduplication events (duplicate detection, original processing time)
✅ **13.2**: Logging for scheduled jobs (start time, end time, processed count, errors)
✅ **13.3**: Logging for payment failures (failure reason, error code, retry count)
✅ **13.4**: Sensitive data (webhook secrets, API keys) are never logged
✅ **13.5**: Error handling with full context and stack traces
✅ **13.6**: Comprehensive audit trail for all operations

## Best Practices

1. **Always include context**: User ID, subscription ID, payment ID when available
2. **Use appropriate log levels**: ERROR for failures, WARN for retries, INFO for success
3. **Include timing information**: Processing time, execution time
4. **Sanitize sensitive data**: Use logger.sanitize() for webhook payloads
5. **Structure your logs**: Use consistent field names across the application
6. **Log both success and failure**: Track the full lifecycle of operations
7. **Include deduplication markers**: Flag when deduplication occurs
8. **Track job statistics**: Count processed items, errors, execution time

## Example Log Queries

### Find all payment failures
```
level:error AND message:"payment.failed"
```

### Find duplicate webhooks
```
deduplicationDetected:true
```

### Find slow webhook processing
```
processingTime:>500ms
```

### Find job failures
```
level:error AND jobName:*
```

### Find credit operations for a user
```
operation:grant_subscription_credits AND userId:"123456"
```

## Conclusion

The logging implementation provides comprehensive visibility into the Razorpay subscription system with:
- Structured, searchable logs
- Sensitive data protection
- Detailed error tracking
- Performance monitoring
- Audit trail for compliance
- Deduplication tracking
- Job execution monitoring

All logs are production-ready and follow industry best practices for observability and security.
