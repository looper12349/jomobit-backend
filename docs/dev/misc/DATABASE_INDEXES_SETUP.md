# Database Indexes Setup Guide

This guide provides quick instructions for setting up database indexes for the Razorpay subscription system.

## Quick Start

### Option 1: Automatic Setup (Recommended)

Indexes are automatically created when your application starts and connects to MongoDB:

```bash
# Start your application
npm start
```

Mongoose will create all indexes defined in the models automatically.

### Option 2: Manual Setup Using Script

Run the provided setup script:

```bash
# Using .env configuration
node scripts/setup-database-indexes.js

# Or with custom MongoDB URI
MONGODB_URI=mongodb://localhost:27017/mydb node scripts/setup-database-indexes.js
```

**Script Output:**
```
🚀 Database Index Setup Script
================================

📍 Connecting to: mongodb://***@localhost:27017/jomobit
✅ Connected to MongoDB

📊 Creating indexes for payments...
  ✅ Index created successfully: razorpayPaymentId_unique
  ✅ Index created successfully: subscriptionId_createdAt
  ✅ Index created successfully: userId_status_createdAt
  ✅ Index created successfully: status_processed

📊 Creating indexes for webhookevents...
  ✅ Index created successfully: uniqueKey_unique
  ✅ Index created successfully: event_processed_receivedAt
  ✅ Index created successfully: razorpaySubscriptionId_event
  ✅ Index created successfully: processed_attempts

📊 Creating indexes for subscriptions...
  ✅ Index created successfully: razorpaySubscriptionId_unique
  ✅ Index created successfully: razorpayCustomerId
  ✅ Index created successfully: paidCount
  ✅ Index created successfully: chargeAt
  ✅ Index created successfully: startAt
  ✅ Index created successfully: endAt
  ✅ Index created successfully: endedAt
  ✅ Index created successfully: userId_status
  ✅ Index created successfully: status_currentPeriodEnd

✨ Setup Complete!
==================
✅ Indexes created: 18
ℹ️  Indexes already existing: 0
❌ Errors: 0

🎉 All indexes are set up successfully!
```

### Option 3: Manual Setup Using MongoDB Shell

Connect to MongoDB and run these commands:

```javascript
use jomobit;

// Payment indexes
db.payments.createIndex({ razorpayPaymentId: 1 }, { unique: true });
db.payments.createIndex({ subscriptionId: 1, createdAt: -1 });
db.payments.createIndex({ userId: 1, status: 1, createdAt: -1 });
db.payments.createIndex({ status: 1, processed: 1 });

// WebhookEvent indexes
db.webhookevents.createIndex({ uniqueKey: 1 }, { unique: true });
db.webhookevents.createIndex({ event: 1, processed: 1, receivedAt: -1 });
db.webhookevents.createIndex({ razorpaySubscriptionId: 1, event: 1 });
db.webhookevents.createIndex({ processed: 1, attempts: 1 });

// Subscription indexes
db.subscriptions.createIndex({ razorpaySubscriptionId: 1 }, { unique: true });
db.subscriptions.createIndex({ razorpayCustomerId: 1 });
db.subscriptions.createIndex({ paidCount: 1 });
db.subscriptions.createIndex({ chargeAt: 1 });
db.subscriptions.createIndex({ startAt: 1 });
db.subscriptions.createIndex({ endAt: 1 });
db.subscriptions.createIndex({ endedAt: 1 });
db.subscriptions.createIndex({ userId: 1, status: 1 });
db.subscriptions.createIndex({ status: 1, currentPeriodEnd: 1 });
db.subscriptions.createIndex({ 'scheduledChange.effectiveDate': 1 });
```

## Verifying Indexes

### Using the Setup Script

The script automatically displays all indexes after creation.

### Using MongoDB Shell

```javascript
// Check Payment indexes
db.payments.getIndexes();

// Check WebhookEvent indexes
db.webhookevents.getIndexes();

// Check Subscription indexes
db.subscriptions.getIndexes();
```

### Expected Output

You should see these indexes:

**Payment Collection (4 indexes):**
- `_id_` (default)
- `razorpayPaymentId_1` (unique)
- `subscriptionId_1_createdAt_-1`
- `userId_1_status_1_createdAt_-1`
- `status_1_processed_1`

**WebhookEvent Collection (4 indexes):**
- `_id_` (default)
- `uniqueKey_1` (unique)
- `event_1_processed_1_receivedAt_-1`
- `razorpaySubscriptionId_1_event_1`
- `processed_1_attempts_1`

**Subscription Collection (10 indexes):**
- `_id_` (default)
- `razorpaySubscriptionId_1` (unique)
- `razorpayCustomerId_1`
- `paidCount_1`
- `chargeAt_1`
- `startAt_1`
- `endAt_1`
- `endedAt_1`
- `userId_1_status_1`
- `status_1_currentPeriodEnd_1`
- `scheduledChange.effectiveDate_1`

## Index Purpose Summary

### Critical Deduplication Indexes (Unique)
- **Payment.razorpayPaymentId**: Prevents double-charging
- **WebhookEvent.uniqueKey**: Prevents webhook replay attacks
- **Subscription.razorpaySubscriptionId**: Ensures one-to-one Razorpay mapping

### Performance Optimization Indexes
- **Composite indexes**: Optimize multi-field queries
- **Date indexes**: Support time-based queries and scheduled jobs
- **Status indexes**: Enable efficient filtering by subscription/payment status

### Scheduled Job Indexes
- **Credit expiry job**: Uses `status + currentPeriodEnd`
- **Reconciliation job**: Uses `razorpaySubscriptionId`
- **Plan change job**: Uses `scheduledChange.effectiveDate`

## Troubleshooting

### Duplicate Key Error

If you get a duplicate key error when creating unique indexes:

```bash
# Find duplicates
mongo jomobit --eval "db.payments.aggregate([
  { \$group: { _id: '\$razorpayPaymentId', count: { \$sum: 1 } } },
  { \$match: { count: { \$gt: 1 } } }
])"
```

Clean up duplicates before creating the index.

### Index Creation Timeout

For large collections, index creation may take time:

```bash
# Create indexes in background (production)
db.payments.createIndex({ razorpayPaymentId: 1 }, { unique: true, background: true });
```

### Permission Denied

Ensure your MongoDB user has the required permissions:

```javascript
// Grant necessary roles
db.grantRolesToUser("your_user", [
  { role: "dbAdmin", db: "jomobit" },
  { role: "readWrite", db: "jomobit" }
]);
```

## Production Deployment Checklist

- [ ] Review all index definitions in model files
- [ ] Run setup script in staging environment
- [ ] Verify all indexes created successfully
- [ ] Test query performance with production-like data
- [ ] Monitor index usage after deployment
- [ ] Document any custom indexes added
- [ ] Set up index monitoring alerts

## Performance Monitoring

After deployment, monitor index usage:

```javascript
// Check index statistics (MongoDB 4.4+)
db.payments.aggregate([{ $indexStats: {} }]);

// Find unused indexes
db.payments.aggregate([
  { $indexStats: {} },
  { $match: { 'accesses.ops': 0 } }
]);
```

## Additional Resources

- **Detailed Documentation**: See `docs/database-indexes.md`
- **Model Definitions**: Check `src/models/` directory
- **Setup Script**: `scripts/setup-database-indexes.js`

## Support

If you encounter issues:

1. Check MongoDB logs for detailed error messages
2. Verify MongoDB version compatibility (4.0+)
3. Ensure sufficient disk space for index creation
4. Review the detailed documentation in `docs/database-indexes.md`

---

**Last Updated**: December 2025  
**MongoDB Version**: 4.0+  
**Mongoose Version**: 6.0+
