# Subscription Jobs - Quick Start Guide

## Installation

The subscription jobs system has been implemented and is ready to use. The required dependency `node-cron` has been installed.

## Quick Setup

### 1. Add to Your Server

In your `server.js` or `app.js`, add the following after MongoDB connection:

```javascript
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

// After MongoDB connects successfully
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    
    // Initialize subscription jobs
    subscriptionJobs.initializeJobs();
    console.log('✅ Subscription jobs initialized');
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });
```

### 2. Add Graceful Shutdown

Add this to handle graceful shutdown:

```javascript
// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  subscriptionJobs.stopAllJobs();
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  subscriptionJobs.stopAllJobs();
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});
```

### 3. Environment Variables

Ensure these are set in your `.env` file:

```env
# Required
MONGODB_URI=mongodb://localhost:27017/your-database
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Optional
SUBSCRIPTION_RECONCILIATION_ENABLED=true
```

## Testing

### Test All Jobs

```bash
node scripts/test-subscription-jobs.js all
```

### Test Individual Jobs

```bash
# Test credit expiry job
node scripts/test-subscription-jobs.js credit-expiry

# Test reconciliation job
node scripts/test-subscription-jobs.js reconciliation

# Test plan change job
node scripts/test-subscription-jobs.js plan-change
```

## What Each Job Does

### 1. Credit Expiry Job (Hourly)
- Runs every hour
- Finds subscriptions that have ended
- Expires credits if no renewal payment was made
- Logs: subscriptions processed, credits expired, errors

### 2. Reconciliation Job (Daily at 1 AM)
- Runs once per day at 1 AM
- Syncs local subscription data with Razorpay
- Updates any mismatched statuses
- Logs: total checked, mismatches found, errors

### 3. Plan Change Job (Every 6 Hours)
- Runs every 6 hours
- Processes scheduled plan upgrades/downgrades
- Updates both local and Razorpay subscriptions
- Logs: plan changes processed, errors

## Monitoring

Check job status programmatically:

```javascript
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

const status = subscriptionJobs.getJobStatus();
console.log(status);
// Output:
// {
//   initialized: true,
//   jobCount: 3,
//   jobs: [
//     { name: 'creditExpiry' },
//     { name: 'reconciliation' },
//     { name: 'scheduledPlanChange' }
//   ]
// }
```

## Logs

All jobs log to your configured Winston logger. Look for:

- `Starting [job name] job` - Job started
- `[Job name] job completed` - Job finished with statistics
- `Error running [job name] job` - Job encountered an error

## Troubleshooting

### Jobs Not Running

1. Check if jobs are initialized:
   ```javascript
   console.log(subscriptionJobs.getJobStatus());
   ```

2. Check server logs for initialization errors

3. Verify MongoDB connection is successful before initializing jobs

### Reconciliation Failing

1. Verify Razorpay credentials are correct
2. Check network connectivity to Razorpay API
3. Review error logs for specific API errors

### High Error Rates

1. Check MongoDB connection stability
2. Verify data integrity (subscriptions, plans)
3. Review individual error logs for patterns

## Manual Execution

You can manually trigger any job for testing:

```javascript
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

// Run credit expiry job
await subscriptionJobs.runCreditExpiryJob();

// Run reconciliation job
await subscriptionJobs.runReconciliationJob();

// Run plan change job
await subscriptionJobs.runScheduledPlanChangeJob();
```

## Next Steps

1. ✅ Jobs are implemented and ready
2. ⏭️ Add job initialization to your server
3. ⏭️ Test jobs in development environment
4. ⏭️ Monitor job execution in logs
5. ⏭️ Set up alerts for job failures (optional)

## Documentation

For detailed documentation, see:
- `docs/subscription-jobs.md` - Complete documentation
- `SUBSCRIPTION_JOBS_IMPLEMENTATION.md` - Implementation details

## Support

If you encounter issues:
1. Check the logs for error messages
2. Review the documentation
3. Test jobs manually using the test script
4. Verify environment variables are set correctly
