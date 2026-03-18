# Task 9 Verification Test Guide

## Quick Verification Steps

### 1. Check Server Startup Logs

Start the server and verify the subscription jobs are initialized:

```bash
npm start
```

**Expected Log Output**:
```
[INFO] All database connections established
[INFO] Initializing subscription jobs...
[INFO] Credit expiry job scheduled (runs hourly)
[INFO] Subscription reconciliation job scheduled (runs daily at 1 AM)
[INFO] Scheduled plan change job scheduled (runs every 6 hours)
[INFO] All subscription jobs initialized successfully { jobCount: 3 }
[INFO] Subscription jobs initialized
[INFO] Server running on port 3000
```

### 2. Verify Webhook Route

Test that the Razorpay webhook endpoint is accessible:

```bash
# Test webhook endpoint exists (should return 401 for invalid signature)
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -d '{"event":"test","payload":{}}'
```

**Expected Response**: 401 Unauthorized (because signature is missing/invalid)

### 3. Check Job Status

You can verify jobs are running by checking the logs after the scheduled times:

- **Credit Expiry**: Runs every hour at minute 0
- **Reconciliation**: Runs daily at 1:00 AM
- **Plan Changes**: Runs every 6 hours at minute 0

### 4. Test Graceful Shutdown

```bash
# Start the server
npm start

# Press Ctrl+C to trigger graceful shutdown
```

**Expected Log Output**:
```
[INFO] Received SIGINT. Starting graceful shutdown...
[INFO] HTTP server closed
[INFO] Stopping all subscription jobs
[INFO] Stopped job: creditExpiry
[INFO] Stopped job: reconciliation
[INFO] Stopped job: scheduledPlanChange
[INFO] Subscription jobs stopped
[INFO] All connections closed. Exiting process.
```

### 5. Manual Job Trigger (For Testing)

If you want to test the jobs immediately without waiting for the cron schedule, you can add a test endpoint or use Node.js REPL:

```javascript
// In Node.js REPL or test script
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

// Test credit expiry job
await subscriptionJobs.runCreditExpiryJob();

// Test reconciliation job
await subscriptionJobs.runReconciliationJob();

// Test scheduled plan change job
await subscriptionJobs.runScheduledPlanChangeJob();
```

## Integration Test

Create a simple integration test to verify the complete flow:

```javascript
// test-task-9.js
const App = require('./src/app');
const subscriptionJobs = require('./src/jobs/subscriptionJobs');

async function testTask9() {
  console.log('Testing Task 9 Implementation...\n');

  try {
    // 1. Test app initialization
    console.log('1. Creating app instance...');
    const app = new App();
    
    // 2. Test database connection and job initialization
    console.log('2. Connecting to databases and initializing jobs...');
    await app.connectDatabases();
    
    // 3. Verify jobs are initialized
    console.log('3. Checking job status...');
    const jobStatus = subscriptionJobs.getJobStatus();
    console.log('Job Status:', JSON.stringify(jobStatus, null, 2));
    
    if (jobStatus.initialized && jobStatus.jobCount === 3) {
      console.log('✅ All jobs initialized successfully!');
    } else {
      console.log('❌ Job initialization failed!');
      return false;
    }
    
    // 4. Test graceful shutdown
    console.log('4. Testing graceful shutdown...');
    subscriptionJobs.stopAllJobs();
    const statusAfterStop = subscriptionJobs.getJobStatus();
    
    if (!statusAfterStop.initialized && statusAfterStop.jobCount === 0) {
      console.log('✅ Jobs stopped successfully!');
    } else {
      console.log('❌ Job shutdown failed!');
      return false;
    }
    
    console.log('\n✅ All Task 9 tests passed!');
    return true;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
}

// Run the test
testTask9()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });
```

Run the test:
```bash
node test-task-9.js
```

## Checklist

- [ ] Server starts without errors
- [ ] Logs show "Subscription jobs initialized"
- [ ] Three jobs are scheduled (credit expiry, reconciliation, plan changes)
- [ ] Webhook endpoint responds (even if with 401 for invalid signature)
- [ ] Graceful shutdown stops all jobs
- [ ] No memory leaks or orphaned processes

## Common Issues

### Issue: Jobs not initializing
**Solution**: Check MongoDB connection is successful before jobs initialize

### Issue: Jobs running multiple times
**Solution**: Verify `isInitialized` flag prevents duplicate initialization

### Issue: Jobs not stopping on shutdown
**Solution**: Ensure `stopAllJobs()` is called in graceful shutdown handler

### Issue: Webhook route not found
**Solution**: Verify routes are loaded in correct order in app.js

## Success Criteria

✅ Task 9 is complete when:
1. Server starts and initializes 3 subscription jobs
2. Webhook route exists and is accessible
3. Jobs run according to their cron schedules
4. Graceful shutdown properly stops all jobs
5. No errors in logs during startup or shutdown
