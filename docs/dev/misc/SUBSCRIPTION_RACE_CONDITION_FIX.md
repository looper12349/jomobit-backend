# Subscription Race Condition Fix & Recovery System

## Problem Statement

### The Race Condition Vulnerability

**Issue**: Users can create multiple active subscriptions during the webhook processing window (1-3 minutes), violating the business rule: "One user should have only one active subscription."

**Root Cause**: The `/create` endpoint only checks for subscriptions with `status='active'`, but newly created subscriptions start with `status='created'` and take 1-3 minutes to become `active` via webhooks.

### Attack Scenario Timeline

```
T=0s    : User creates subscription A → status='created'
T=1s    : User completes payment for A
T=30s   : User creates subscription B → status='created' (A is not 'active' yet, so check passes ❌)
T=45s   : User completes payment for B
T=90s   : Webhook for A arrives → status='active' + credits granted
T=120s  : Webhook for B arrives → status='active' + credits granted
Result  : User has 2 active subscriptions + 2x credits! 🚨
```

### Additional Edge Cases

1. **Webhook Failure (Backend Down)**: User pays but subscription stuck in `created` state
2. **All Webhooks Fail (3+ days)**: Razorpay stops retrying, user permanently stuck
3. **Duplicate Detection in Webhook**: If we throw error, webhook retries 14 times
4. **Abandoned Subscriptions**: Created but never paid, blocking new subscriptions

---

## Razorpay Webhook Retry Policy

- **Total Attempts**: 14 retries over 3 days
- **Retry Schedule**: Exponential backoff
  - Immediate
  - 5 minutes
  - 10 minutes
  - 30 minutes
  - 1 hour
  - 2 hours
  - 4 hours
  - 8 hours
  - Then every 12 hours until 3 days
- **Success Criteria**: HTTP 200 response
- **Failure Criteria**: Non-200 response or timeout (30 seconds)

---

## Solution: Multi-Layer Defense System

### Phase 1: Critical Fixes (Implement Immediately)

#### 1.1 Expand Active Subscription Check

**File**: `src/models/Subscription.js`

**Add new method**:
```javascript
/**
 * Get user's pending or active subscription
 * Prevents race condition by checking all non-terminal states
 * @param {ObjectId} userId - User ID
 * @returns {Promise<Subscription|null>} Pending/Active subscription or null
 */
async getUserPendingOrActiveSubscription(userId) {
  return this.findOne({
    userId,
    status: { $in: ['created', 'authenticated', 'active', 'pending'] }
  })
  .populate('planId')
  .exec();
}
```

**File**: `src/controllers/subscriptionController.js`

**Replace in `createSubscription` method** (around line 207):
```javascript
// OLD CODE:
const existingSubscription = await Subscription.getUserActiveSubscription(actualUserId);

// NEW CODE:
const existingSubscription = await Subscription.getUserPendingOrActiveSubscription(actualUserId);
```

**Update error message**:
```javascript
if (existingSubscription) {
  return res.status(409).json({
    success: false,
    error: 'Active or pending subscription exists',
    message: 'You already have an active or pending subscription. Please wait for it to activate or cancel it first.',
    subscription: {
      _id: existingSubscription._id,
      status: existingSubscription.status,
      createdAt: existingSubscription.createdAt
    }
  });
}
```

---

#### 1.2 Add Database Partial Unique Index

**File**: `src/models/Subscription.js`

**Add after existing indexes** (around line 250):
```javascript
// Prevent multiple active/pending subscriptions per user (database-level constraint)
subscriptionSchema.index(
  { userId: 1, status: 1 },
  {
    unique: true,
    name: 'unique_active_subscription_per_user',
    partialFilterExpression: {
      status: { $in: ['created', 'authenticated', 'active', 'pending'] }
    }
  }
);
```

**Note**: This creates a database-level constraint that prevents duplicate subscriptions even if application logic fails.

---

#### 1.3 Graceful Webhook Error Handling

**File**: `src/controllers/webhookController.js`

**Update `handleActivated` method**:
`
```jav
ascript
async handleActivated(payload, webhookEvent, subscription) {
  const Subscription = require('../models/Subscription');
  const Plan = require('../models/Plan');

  try {
    const subscriptionEntity = payload.subscription.entity;
    const paymentEntity = payload.payment?.entity;

    logger.info('Processing subscription.activated event', {
      razorpaySubscriptionId: subscriptionEntity.id,
      subscriptionId: subscription?._id,
      paymentId: paymentEntity?.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found for Razorpay ID: ${subscriptionEntity.id}`);
    }

    // ✅ CHECK FOR DUPLICATE ACTIVE SUBSCRIPTION
    const existingActive = await Subscription.findOne({
      userId: subscription.userId,
      status: 'active',
      _id: { $ne: subscription._id }
    });

    if (existingActive) {
      logger.error('🚨 DUPLICATE ACTIVE SUBSCRIPTION DETECTED', {
        existingSubscriptionId: existingActive._id,
        newSubscriptionId: subscription._id,
        userId: subscription.userId,
        existingRazorpayId: existingActive.razorpaySubscriptionId,
        newRazorpayId: subscription.razorpaySubscriptionId,
        action: 'cancelling_duplicate'
      });

      // ✅ Cancel the duplicate subscription on Razorpay
      try {
        const razorpay = require('../config/razorpay.config');
        await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
        
        subscription.status = 'cancelled';
        subscription.cancellationReason = 'duplicate_active_subscription_detected';
        subscription.cancelledAt = new Date();
        await subscription.save();
        
        logger.info('✅ Cancelled duplicate subscription', {
          subscriptionId: subscription._id,
          razorpayId: subscription.razorpaySubscriptionId
        });
      } catch (cancelError) {
        logger.error('❌ Failed to cancel duplicate subscription on Razorpay', {
          subscriptionId: subscription._id,
          error: cancelError.message
        });
        
        // Still mark as cancelled locally
        subscription.status = 'cancelled';
        subscription.cancellationReason = 'duplicate_detected_cancel_failed';
        await subscription.save();
      }

      // ✅ IMPORTANT: Return 200 to stop webhook retries
      return {
        success: true,
        message: 'Duplicate subscription detected and cancelled',
        action: 'cancelled_duplicate',
        subscriptionId: subscription._id
      };
    }

    // Normal activation flow continues...
    subscription.status = 'active';
    subscription.currentPeriodStart = new Date(subscriptionEntity.current_start * 1000);
    subscription.currentPeriodEnd = new Date(subscriptionEntity.current_end * 1000);
    subscription.paidCount = subscriptionEntity.paid_count || subscription.paidCount;
    subscription.remainingCount = subscriptionEntity.remaining_count || subscription.remainingCount;
    subscription.chargeAt = subscriptionEntity.charge_at ? new Date(subscriptionEntity.charge_at * 1000) : null;

    await subscription.save();

    // Record payment and grant credits
    if (paymentEntity) {
      await this.recordPayment(paymentEntity, subscription, true);
    }

    logger.info('✅ Subscription activated successfully', {
      subscriptionId: subscription._id,
      userId: subscription.userId,
      status: subscription.status
    });

    return {
      success: true,
      message: 'Subscription activated successfully',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };

  } catch (error) {
    logger.error('❌ Error in handleActivated', {
      razorpaySubscriptionId: payload.subscription?.entity?.id,
      subscriptionId: subscription?._id,
      error: error.message,
      stack: error.stack
    });

    // ✅ IMPORTANT: Return 200 even on error to prevent infinite retries
    // Log to monitoring system for manual review
    return {
      success: false,
      message: 'Error handled, manual review required',
      error: error.message,
      requiresManualReview: true
    };
  }
}
```

**Key Changes**:
- Check for duplicate active subscription before activating
- Cancel duplicate on Razorpay if detected
- Return 200 (success) even when cancelling duplicate to stop retries
- Return 200 even on errors to prevent retry storms
- Log all actions for monitoring

---

### Phase 2: Recovery & Reconciliation System

#### 2.1 Automated Reconciliation Job

**Create new file**: `src/jobs/subscriptionReconciliation.js`


```javascript
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const { CreditService } = require('../services/creditService');
const razorpay = require('../config/razorpay.config');
const logger = require('../utils/logger');

/**
 * Subscription Reconciliation Job
 * Runs every hour to detect and fix stuck subscriptions
 * Handles webhook failures and syncs with Razorpay
 */
class SubscriptionReconciliationJob {
  constructor() {
    this.creditService = new CreditService();
  }

  async run() {
    logger.info('🔄 Starting subscription reconciliation job');
    
    try {
      // Step 1: Fix stuck subscriptions (created/authenticated > 1 hour)
      await this.fixStuckSubscriptions();
      
      // Step 2: Cancel abandoned subscriptions (created > 7 days)
      await this.cancelAbandonedSubscriptions();
      
      // Step 3: Detect and fix duplicate active subscriptions
      await this.fixDuplicateActiveSubscriptions();
      
      logger.info('✅ Subscription reconciliation job completed');
    } catch (error) {
      logger.error('❌ Subscription reconciliation job failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  async fixStuckSubscriptions() {
    // Find subscriptions stuck in 'created' or 'authenticated' for > 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const stuckSubscriptions = await Subscription.find({
      status: { $in: ['created', 'authenticated'] },
      createdAt: { $lt: oneHourAgo }
    });
    
    logger.info(`Found ${stuckSubscriptions.length} stuck subscriptions`);
    
    for (const subscription of stuckSubscriptions) {
      try {
        // Fetch current state from Razorpay
        const razorpaySubscription = await razorpay.subscriptions.fetch(
          subscription.razorpaySubscriptionId
        );
        
        logger.info('Reconciling stuck subscription', {
          subscriptionId: subscription._id,
          localStatus: subscription.status,
          razorpayStatus: razorpaySubscription.status,
          createdAt: subscription.createdAt
        });
        
        // Sync status based on Razorpay state
        if (razorpaySubscription.status === 'active' && subscription.status !== 'active') {
          // Check for duplicate active subscription first
          const existingActive = await Subscription.findOne({
            userId: subscription.userId,
            status: 'active',
            _id: { $ne: subscription._id }
          });
          
          if (existingActive) {
            // Cancel this subscription
            await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
            subscription.status = 'cancelled';
            subscription.cancellationReason = 'duplicate_detected_during_reconciliation';
            await subscription.save();
            
            logger.warn('Cancelled duplicate subscription during reconciliation', {
              cancelledId: subscription._id,
              existingActiveId: existingActive._id,
              userId: subscription.userId
            });
            continue;
          }
          
          // Activate subscription
          subscription.status = 'active';
          subscription.currentPeriodStart = new Date(razorpaySubscription.current_start * 1000);
          subscription.currentPeriodEnd = new Date(razorpaySubscription.current_end * 1000);
          subscription.paidCount = razorpaySubscription.paid_count;
          subscription.remainingCount = razorpaySubscription.remaining_count;
          await subscription.save();
          
          // Grant credits
          const plan = await Plan.findById(subscription.planId);
          if (plan && plan.features?.credits?.monthly > 0) {
            await this.creditService.grantSubscriptionCredits(
              subscription.userId,
              plan.features.credits.monthly,
              subscription.currentPeriodEnd,
              subscription._id.toString(),
              null, // No payment ID for reconciliation
              {
                source: 'reconciliation_job',
                reason: 'webhook_failure_recovery',
                planId: plan._id
              }
            );
          }
          
          logger.info('✅ Subscription activated via reconciliation', {
            subscriptionId: subscription._id,
            userId: subscription.userId,
            creditsGranted: plan?.features?.credits?.monthly || 0
          });
          
        } else if (razorpaySubscription.status === 'cancelled') {
          subscription.status = 'cancelled';
          subscription.cancelledAt = new Date();
          await subscription.save();
          
          logger.info('Subscription cancelled via reconciliation', {
            subscriptionId: subscription._id
          });
        }
        
      } catch (error) {
        logger.error('Error reconciling stuck subscription', {
          subscriptionId: subscription._id,
          error: error.message
        });
      }
    }
  }

  async cancelAbandonedSubscriptions() {
    // Find subscriptions stuck in 'created' for > 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const abandonedSubscriptions = await Subscription.find({
      status: 'created',
      createdAt: { $lt: sevenDaysAgo }
    });
    
    logger.info(`Found ${abandonedSubscriptions.length} abandoned subscriptions`);
    
    for (const subscription of abandonedSubscriptions) {
      try {
        // Try to cancel on Razorpay (might already be cancelled)
        try {
          await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
        } catch (razorpayError) {
          // Razorpay might have already cancelled it or it doesn't exist
          logger.warn('Could not cancel on Razorpay (might already be cancelled)', {
            subscriptionId: subscription._id,
            error: razorpayError.message
          });
        }
        
        subscription.status = 'cancelled';
        subscription.cancellationReason = 'abandoned_never_activated';
        subscription.cancelledAt = new Date();
        await subscription.save();
        
        logger.info('Cancelled abandoned subscription', {
          subscriptionId: subscription._id,
          createdAt: subscription.createdAt,
          age: `${Math.floor((Date.now() - subscription.createdAt) / (24 * 60 * 60 * 1000))} days`
        });
        
      } catch (error) {
        logger.error('Error cancelling abandoned subscription', {
          subscriptionId: subscription._id,
          error: error.message
        });
      }
    }
  }

  async fixDuplicateActiveSubscriptions() {
    // Find users with multiple active subscriptions
    const duplicates = await Subscription.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $group: {
          _id: '$userId',
          count: { $sum: 1 },
          subscriptions: { $push: { id: '$_id', createdAt: '$createdAt' } }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    
    logger.info(`Found ${duplicates.length} users with duplicate active subscriptions`);
    
    for (const duplicate of duplicates) {
      try {
        const userId = duplicate._id;
        const subscriptionIds = duplicate.subscriptions.map(s => s.id);
        
        // Get all active subscriptions for this user
        const subscriptions = await Subscription.find({
          _id: { $in: subscriptionIds }
        }).sort({ createdAt: 1 }); // Oldest first
        
        // Keep the oldest, cancel the rest
        const [keepSubscription, ...cancelSubscriptions] = subscriptions;
        
        logger.warn('🚨 Duplicate active subscriptions detected', {
          userId,
          totalCount: subscriptions.length,
          keepingSubscriptionId: keepSubscription._id,
          cancellingCount: cancelSubscriptions.length
        });
        
        for (const subscription of cancelSubscriptions) {
          try {
            await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);
            subscription.status = 'cancelled';
            subscription.cancellationReason = 'duplicate_active_subscription_cleanup';
            subscription.cancelledAt = new Date();
            await subscription.save();
            
            logger.info('Cancelled duplicate subscription', {
              subscriptionId: subscription._id,
              userId
            });
          } catch (error) {
            logger.error('Error cancelling duplicate subscription', {
              subscriptionId: subscription._id,
              error: error.message
            });
          }
        }
        
      } catch (error) {
        logger.error('Error fixing duplicate subscriptions', {
          userId: duplicate._id,
          error: error.message
        });
      }
    }
  }
}

module.exports = SubscriptionReconciliationJob;
```

**Schedule the job** in `src/jobs/subscriptionJobs.js`:


```javascript
const cron = require('node-cron');
const SubscriptionReconciliationJob = require('./subscriptionReconciliation');
const logger = require('../utils/logger');

// Run reconciliation job every hour
cron.schedule('0 * * * *', async () => {
  logger.info('⏰ Triggering subscription reconciliation job');
  const job = new SubscriptionReconciliationJob();
  await job.run();
});

logger.info('✅ Subscription reconciliation job scheduled (every hour)');
```

---

#### 2.2 Manual Webhook Replay Endpoint (Admin)

**File**: `src/controllers/subscriptionController.js`

**Add new method**:

```javascript
/**
 * Manual webhook replay for admin recovery
 * POST /api/admin/subscriptions/replay-webhook
 */
async replayWebhook(req, res) {
  try {
    const { razorpaySubscriptionId } = req.body;
    
    if (!razorpaySubscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: 'razorpaySubscriptionId is required'
      });
    }
    
    logger.info('Manual webhook replay requested', {
      razorpaySubscriptionId,
      adminUser: req.user.id
    });
    
    // Fetch latest subscription state from Razorpay
    const razorpay = require('../config/razorpay.config');
    const razorpaySubscription = await razorpay.subscriptions.fetch(razorpaySubscriptionId);
    
    // Find local subscription
    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.findOne({ razorpaySubscriptionId });
    
    if (!subscription) {
      return res.status(404).json({
        success: false,
        error: 'Subscription not found',
        message: 'No local subscription found for this Razorpay ID'
      });
    }
    
    logger.info('Subscription found, syncing state', {
      subscriptionId: subscription._id,
      localStatus: subscription.status,
      razorpayStatus: razorpaySubscription.status
    });
    
    // Manually sync state
    if (razorpaySubscription.status === 'active' && subscription.status !== 'active') {
      // Check for duplicate active subscription
      const existingActive = await Subscription.findOne({
        userId: subscription.userId,
        status: 'active',
        _id: { $ne: subscription._id }
      });
      
      if (existingActive) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate active subscription',
          message: 'User already has an active subscription',
          existingSubscriptionId: existingActive._id
        });
      }
      
      // Activate subscription
      subscription.status = 'active';
      subscription.currentPeriodStart = new Date(razorpaySubscription.current_start * 1000);
      subscription.currentPeriodEnd = new Date(razorpaySubscription.current_end * 1000);
      subscription.paidCount = razorpaySubscription.paid_count;
      subscription.remainingCount = razorpaySubscription.remaining_count;
      await subscription.save();
      
      // Grant credits
      const Plan = require('../models/Plan');
      const plan = await Plan.findById(subscription.planId);
      
      if (plan && plan.features?.credits?.monthly > 0) {
        const WebhookController = require('./webhookController');
        const webhookController = new WebhookController();
        
        await webhookController.grantSubscriptionCreditsWithoutPayment(subscription, {
          source: 'manual_webhook_replay',
          reason: 'admin_recovery',
          adminUser: req.user.id
        });
      }
      
      logger.info('✅ Manual webhook replay successful', {
        subscriptionId: subscription._id,
        userId: subscription.userId,
        adminUser: req.user.id
      });
      
      return res.json({
        success: true,
        message: 'Subscription activated manually',
        subscription: subscription.toObject()
      });
    }
    
    // Already in sync
    res.json({
      success: true,
      message: 'Subscription already in sync',
      razorpayStatus: razorpaySubscription.status,
      localStatus: subscription.status,
      subscription: subscription.toObject()
    });
    
  } catch (error) {
    logger.error('Error replaying webhook', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}
```

**Add route** in `src/routes/subscriptions.js`:

```javascript
// Admin routes (require admin authentication middleware)
router.post('/admin/subscriptions/replay-webhook', 
  authenticateToken, 
  requireAdmin, 
  subscriptionController.replayWebhook
);
```

---

#### 2.3 User Self-Service Sync Endpoint

**File**: `src/controllers/subscriptionController.js`

**Add new method**:

```javascript
/**
 * Sync subscription status with Razorpay
 * POST /api/subscriptions/sync
 */
async syncSubscriptionStatus(req, res) {
  try {
    const userId = req.user.id; // Auth0 ID
    
    // Get user by Auth0 ID
    const UserService = require('../services/userService');
    const userService = new UserService();
    const userResult = await userService.getUserByAuth0Id(userId);
    const actualUserId = userResult.user._id;
    
    logger.info('User requested subscription sync', {
      userId: actualUserId
    });
    
    // Get user's pending/created subscription
    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.findOne({
      userId: actualUserId,
      status: { $in: ['created', 'authenticated', 'pending'] }
    }).sort({ createdAt: -1 }); // Get most recent
    
    if (!subscription) {
      return res.json({
        success: true,
        message: 'No pending subscription found',
        hasActiveSubscription: !!(await Subscription.getUserActiveSubscription(actualUserId))
      });
    }
    
    logger.info('Found pending subscription, fetching from Razorpay', {
      subscriptionId: subscription._id,
      razorpaySubscriptionId: subscription.razorpaySubscriptionId,
      currentStatus: subscription.status
    });
    
    // Fetch from Razorpay
    const razorpay = require('../config/razorpay.config');
    const razorpaySubscription = await razorpay.subscriptions.fetch(
      subscription.razorpaySubscriptionId
    );
    
    logger.info('Razorpay subscription fetched', {
      razorpayStatus: razorpaySubscription.status,
      localStatus: subscription.status
    });
    
    // Sync status
    if (razorpaySubscription.status === 'active' && subscription.status !== 'active') {
      // Check for duplicate
      const existingActive = await Subscription.findOne({
        userId: actualUserId,
        status: 'active',
        _id: { $ne: subscription._id }
      });
      
      if (existingActive) {
        return res.status(409).json({
          success: false,
          error: 'Duplicate active subscription',
          message: 'You already have an active subscription'
        });
      }
      
      // Activate
      subscription.status = 'active';
      subscription.currentPeriodStart = new Date(razorpaySubscription.current_start * 1000);
      subscription.currentPeriodEnd = new Date(razorpaySubscription.current_end * 1000);
      subscription.paidCount = razorpaySubscription.paid_count;
      subscription.remainingCount = razorpaySubscription.remaining_count;
      await subscription.save();
      
      // Grant credits
      const Plan = require('../models/Plan');
      const plan = await Plan.findById(subscription.planId);
      
      if (plan && plan.features?.credits?.monthly > 0) {
        const WebhookController = require('./webhookController');
        const webhookController = new WebhookController();
        
        await webhookController.grantSubscriptionCreditsWithoutPayment(subscription, {
          source: 'user_self_service_sync',
          reason: 'manual_sync_request'
        });
      }
      
      logger.info('✅ Subscription activated via user sync', {
        subscriptionId: subscription._id,
        userId: actualUserId
      });
      
      return res.json({
        success: true,
        message: 'Subscription activated successfully!',
        subscription: subscription.toObject()
      });
    }
    
    // Return current status
    res.json({
      success: true,
      message: 'Subscription status synced',
      subscription: {
        _id: subscription._id,
        status: subscription.status,
        razorpayStatus: razorpaySubscription.status,
        createdAt: subscription.createdAt
      }
    });
    
  } catch (error) {
    if (error.name === 'UserNotFoundError') {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        message: 'User profile not found in database'
      });
    }
    
    logger.error('Error syncing subscription', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to sync subscription status'
    });
  }
}
```

**Add route** in `src/routes/subscriptions.js`:

```javascript
router.post('/sync', authenticateToken, subscriptionController.syncSubscriptionStatus);
```

---

### Phase 3: Frontend Protection

#### 3.1 Disable Subscribe Button After Click

**Frontend Component** (React example):


```javascript
import { useState, useEffect } from 'react';

function SubscriptionButton({ planId }) {
  const [isCreating, setIsCreating] = useState(false);
  const [hasPendingSubscription, setHasPendingSubscription] = useState(false);

  // Check for pending subscription on mount
  useEffect(() => {
    checkPendingSubscription();
  }, []);

  const checkPendingSubscription = async () => {
    try {
      const response = await fetch('/api/subscriptions/current', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      const data = await response.json();
      
      if (data.subscription && 
          ['created', 'authenticated', 'pending', 'active'].includes(data.subscription.status)) {
        setHasPendingSubscription(true);
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
    }
  };

  const handleSubscribe = async () => {
    setIsCreating(true);
    
    try {
      // Create subscription
      const response = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ planId })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        alert(data.message);
        setIsCreating(false);
        return;
      }
      
      // Store timestamp to prevent duplicate attempts
      localStorage.setItem('lastSubscriptionAttempt', Date.now());
      
      // Open Razorpay payment popup
      const options = {
        subscription_id: data.subscription.razorpaySubscriptionId,
        handler: async (response) => {
          // Payment successful
          showMessage('Payment successful! Activating your subscription...');
          
          // Poll for activation
          await pollForActivation();
        },
        modal: {
          ondismiss: () => {
            setIsCreating(false);
          }
        }
      };
      
      const razorpay = new Razorpay(options);
      razorpay.open();
      
    } catch (error) {
      console.error('Error creating subscription:', error);
      alert('Failed to create subscription');
      setIsCreating(false);
    }
  };

  const pollForActivation = async () => {
    const maxAttempts = 36; // 3 minutes (5 seconds * 36)
    let attempts = 0;
    
    const poll = setInterval(async () => {
      attempts++;
      
      try {
        const response = await fetch('/api/subscriptions/current', {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.subscription?.status === 'active') {
          clearInterval(poll);
          showSuccess('Subscription activated! Redirecting...');
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 1000);
        } else if (attempts >= maxAttempts) {
          clearInterval(poll);
          showWarning('Activation is taking longer than expected. Please refresh the page in a moment.');
          setIsCreating(false);
        }
      } catch (error) {
        console.error('Error polling subscription:', error);
      }
    }, 5000); // Poll every 5 seconds
  };

  // Check if last attempt was within 3 minutes
  const lastAttempt = localStorage.getItem('lastSubscriptionAttempt');
  const isWithinCooldown = lastAttempt && (Date.now() - lastAttempt < 180000);

  if (hasPendingSubscription || isWithinCooldown) {
    return (
      <div>
        <button disabled className="btn-disabled">
          Subscription Pending...
        </button>
        <p className="text-sm text-gray-600 mt-2">
          Your subscription is being activated. This usually takes 1-3 minutes.
        </p>
        <button 
          onClick={async () => {
            const response = await fetch('/api/subscriptions/sync', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (data.success) {
              window.location.reload();
            }
          }}
          className="btn-link mt-2"
        >
          Refresh Status
        </button>
      </div>
    );
  }

  return (
    <button 
      onClick={handleSubscribe}
      disabled={isCreating}
      className="btn-primary"
    >
      {isCreating ? 'Processing...' : 'Subscribe Now'}
    </button>
  );
}
```

---

#### 3.2 Check Subscription Status Before Showing Plans

```javascript
function PricingPage() {
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentSubscription();
  }, []);

  const fetchCurrentSubscription = async () => {
    try {
      const response = await fetch('/api/subscriptions/current', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setCurrentSubscription(data.subscription);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  // User has active or pending subscription
  if (currentSubscription && 
      ['created', 'authenticated', 'pending', 'active'].includes(currentSubscription.status)) {
    return (
      <div className="subscription-status">
        <h2>Your Subscription</h2>
        <p>Status: {currentSubscription.status}</p>
        
        {currentSubscription.status === 'active' ? (
          <div>
            <p>Your subscription is active!</p>
            <a href="/dashboard">Go to Dashboard</a>
          </div>
        ) : (
          <div>
            <p>Your subscription is being activated...</p>
            <button onClick={async () => {
              const response = await fetch('/api/subscriptions/sync', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
              });
              const data = await response.json();
              if (data.success) {
                fetchCurrentSubscription();
              }
            }}>
              Refresh Status
            </button>
          </div>
        )}
      </div>
    );
  }

  // Show pricing plans
  return <PricingPlans />;
}
```

---

### Phase 4: Monitoring & Alerting

#### 4.1 Alert Configuration

**Create file**: `src/utils/alerting.js`

```javascript
const logger = require('./logger');

/**
 * Send alert to monitoring system (Slack, Email, etc.)
 */
async function sendAlert(alert) {
  const { type, title, message, data } = alert;
  
  logger.warn('🚨 ALERT', {
    type,
    title,
    message,
    data
  });
  
  // TODO: Integrate with your alerting system
  // Examples:
  // - Send to Slack webhook
  // - Send email via SendGrid
  // - Send to PagerDuty
  // - Log to monitoring service (Datadog, New Relic, etc.)
  
  // Example Slack integration:
  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 ${title}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${title}*\n${message}`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `\`\`\`${JSON.stringify(data, null, 2)}\`\`\``
              }
            }
          ]
        })
      });
    } catch (error) {
      logger.error('Failed to send Slack alert', { error: error.message });
    }
  }
}

module.exports = { sendAlert };
```

#### 4.2 Add Alerts to Reconciliation Job

**Update** `src/jobs/subscriptionReconciliation.js`:

```javascript
const { sendAlert } = require('../utils/alerting');

// In fixStuckSubscriptions method, after finding stuck subscriptions:
if (stuckSubscriptions.length > 0) {
  await sendAlert({
    type: 'warning',
    title: 'Stuck Subscriptions Detected',
    message: `Found ${stuckSubscriptions.length} subscriptions stuck in pending state`,
    data: {
      count: stuckSubscriptions.length,
      subscriptions: stuckSubscriptions.map(s => ({
        id: s._id,
        userId: s.userId,
        status: s.status,
        createdAt: s.createdAt,
        ageHours: Math.floor((Date.now() - s.createdAt) / (60 * 60 * 1000))
      }))
    }
  });
}

// In fixDuplicateActiveSubscriptions method:
if (duplicates.length > 0) {
  await sendAlert({
    type: 'critical',
    title: '🚨 DUPLICATE ACTIVE SUBSCRIPTIONS',
    message: `Found ${duplicates.length} users with multiple active subscriptions!`,
    data: {
      count: duplicates.length,
      users: duplicates.map(d => ({
        userId: d._id,
        subscriptionCount: d.count
      }))
    }
  });
}
```

---

## Implementation Checklist

### Phase 1: Critical Fixes (Day 1)
- [ ] Add `getUserPendingOrActiveSubscription()` method to Subscription model
- [ ] Update `/create` endpoint to use new method
- [ ] Add partial unique index to Subscription schema
- [ ] Update `handleActivated` webhook with duplicate detection
- [ ] Test duplicate subscription prevention
- [ ] Deploy to production

### Phase 2: Recovery System (Week 1)
- [ ] Create `subscriptionReconciliation.js` job
- [ ] Schedule reconciliation job (hourly)
- [ ] Add admin webhook replay endpoint
- [ ] Add user self-service sync endpoint
- [ ] Test reconciliation scenarios
- [ ] Deploy to production

### Phase 3: Frontend Protection (Week 1)
- [ ] Add subscription status check before showing plans
- [ ] Implement button disable logic
- [ ] Add polling for activation status
- [ ] Add "Refresh Status" button
- [ ] Test user flow end-to-end
- [ ] Deploy to production

### Phase 4: Monitoring (Week 2)
- [ ] Set up alerting system (Slack/Email)
- [ ] Add alerts to reconciliation job
- [ ] Add alerts to webhook handlers
- [ ] Create monitoring dashboard
- [ ] Test alert delivery
- [ ] Deploy to production

---

## Testing Scenarios

### Test 1: Race Condition Prevention
1. Create subscription A
2. Immediately try to create subscription B (within 1 minute)
3. **Expected**: Second creation should fail with 409 error

### Test 2: Webhook Failure Recovery
1. Create subscription
2. Stop backend server
3. Complete payment
4. Wait 2 minutes
5. Start backend server
6. **Expected**: Reconciliation job activates subscription within 1 hour

### Test 3: Duplicate Detection in Webhook
1. Manually create 2 subscriptions in database with same userId
2. Trigger activation webhook for second subscription
3. **Expected**: Second subscription cancelled, first remains active

### Test 4: User Self-Service Sync
1. Create subscription
2. Complete payment
3. Click "Refresh Status" button before webhook arrives
4. **Expected**: Subscription activated immediately

### Test 5: Abandoned Subscription Cleanup
1. Create subscription
2. Don't complete payment
3. Wait 7 days
4. **Expected**: Reconciliation job cancels subscription

---

## Recovery Time Objectives (RTO)

| Scenario | Recovery Method | RTO |
|----------|----------------|-----|
| Webhook delayed (< 3 days) | Razorpay auto-retry | Minutes to hours |
| Webhook failed (> 3 days) | Reconciliation job | 1 hour (next job run) |
| User impatient | Self-service sync button | Immediate |
| Duplicate subscription | Webhook handler | Immediate |
| Abandoned subscription | Auto-cancel | 7 days |
| Manual intervention | Admin replay endpoint | Immediate |

---

## Environment Variables

Add to `.env`:

```bash
# Alerting
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Reconciliation Job
RECONCILIATION_JOB_ENABLED=true
RECONCILIATION_JOB_INTERVAL=hourly
ABANDONED_SUBSCRIPTION_DAYS=7
```

---

## Monitoring Queries

### Find Stuck Subscriptions
```javascript
db.subscriptions.find({
  status: { $in: ['created', 'authenticated'] },
  createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) }
})
```

### Find Duplicate Active Subscriptions
```javascript
db.subscriptions.aggregate([
  { $match: { status: 'active' } },
  { $group: { _id: '$userId', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
])
```

### Find Abandoned Subscriptions
```javascript
db.subscriptions.find({
  status: 'created',
  createdAt: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
})
```

---

## Support Documentation

### For Users

**Q: My payment was successful but I don't have access yet**
A: Subscription activation can take 1-3 minutes. Please wait a moment and click the "Refresh Status" button. If the issue persists after 5 minutes, contact support.

**Q: I accidentally created two subscriptions**
A: Don't worry! Our system automatically detects and cancels duplicate subscriptions. Only one will remain active. If you were charged twice, contact support for a refund.

### For Support Team

**Stuck Subscription Recovery Steps:**
1. Get user's email/ID
2. Find subscription in database
3. Check Razorpay dashboard for payment status
4. Use admin webhook replay endpoint: `POST /api/admin/subscriptions/replay-webhook`
5. If that fails, manually update subscription status and grant credits

**Duplicate Subscription Resolution:**
1. Check database for multiple active subscriptions
2. Identify which subscription to keep (usually oldest)
3. Cancel duplicate on Razorpay
4. Update database status to 'cancelled'
5. Verify user has correct credits

---

## Notes

- **Database Migration**: After adding the partial unique index, existing duplicate subscriptions will need to be cleaned up manually before the index can be created
- **Backward Compatibility**: All changes are backward compatible with existing subscriptions
- **Performance**: Reconciliation job should complete in < 5 minutes for typical workloads
- **Scalability**: For high-volume systems, consider using a message queue (Redis/RabbitMQ) instead of cron jobs

---

## References

- [Razorpay Webhook Documentation](https://razorpay.com/docs/webhooks/)
- [Razorpay Subscription API](https://razorpay.com/docs/api/subscriptions/)
- [MongoDB Partial Indexes](https://docs.mongodb.com/manual/core/index-partial/)
- [Idempotency in Distributed Systems](https://en.wikipedia.org/wiki/Idempotence)

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-20  
**Status**: Ready for Implementation
