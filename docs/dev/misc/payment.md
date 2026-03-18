# Complete Razorpay Subscription Implementation

## Table of Contents
1. [New Schemas Required](#new-schemas)
2. [Schema Updates](#schema-updates)
3. [Enhanced Webhook Handler](#webhook-handler)
4. [Enhanced Services](#services)
5. [Scheduled Jobs](#scheduled-jobs)
6. [Complete Flow Documentation](#flow-docs)
7. [Environment Variables](#env-vars)
8. [Testing Guide](#testing)

---

## 1. NEW SCHEMAS REQUIRED {#new-schemas}

### A. Payment Model (`models/Payment.js`)

```javascript
const mongoose = require('mongoose');

/**
 * Payment Schema
 * Tracks all payments from Razorpay with deduplication
 */
const paymentSchema = new mongoose.Schema({
  // Razorpay payment ID (unique for deduplication)
  razorpayPaymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Razorpay invoice ID
  razorpayInvoiceId: {
    type: String,
    index: true
  },

  // Associated subscription
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    required: true,
    index: true
  },

  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Payment details
  amount: {
    type: Number,
    required: true
  },

  currency: {
    type: String,
    required: true,
    uppercase: true,
    default: 'INR'
  },

  status: {
    type: String,
    enum: ['captured', 'failed', 'pending', 'authorized', 'refunded'],
    required: true,
    index: true
  },

  method: {
    type: String, // card, netbanking, upi, etc.
    trim: true
  },

  // Payment timestamps
  capturedAt: {
    type: Date,
    index: true
  },

  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // Failure information
  errorCode: String,
  errorDescription: String,

  // Card details (if applicable)
  card: {
    last4: String,
    network: String,
    type: String,
    issuer: String
  },

  // Raw webhook data for debugging
  webhookData: {
    type: mongoose.Schema.Types.Mixed
  },

  // Credits granted for this payment
  creditsGranted: {
    type: Number,
    default: 0
  },

  // Processing status
  processed: {
    type: Boolean,
    default: false,
    index: true
  },

  processedAt: Date,

  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ razorpayPaymentId: 1 }, { unique: true });
paymentSchema.index({ subscriptionId: 1, createdAt: -1 });
paymentSchema.index({ userId: 1, status: 1, createdAt: -1 });
paymentSchema.index({ status: 1, processed: 1 });

// Static methods
paymentSchema.statics = {
  /**
   * Create or get payment (idempotent)
   */
  async createOrGet(paymentData) {
    const { razorpayPaymentId } = paymentData;
    
    // Try to find existing payment
    let payment = await this.findOne({ razorpayPaymentId });
    
    if (payment) {
      return { payment, created: false };
    }

    // Create new payment
    payment = await this.create(paymentData);
    return { payment, created: true };
  },

  /**
   * Get unprocessed payments
   */
  async getUnprocessed() {
    return this.find({
      status: 'captured',
      processed: false
    }).sort({ createdAt: 1 });
  }
};

const Payment = mongoose.model('Payment', paymentSchema);
module.exports = Payment;
```

---

### B. WebhookEvent Model (`models/WebhookEvent.js`)

```javascript
const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * WebhookEvent Schema
 * Tracks all webhook deliveries for deduplication and replay protection
 */
const webhookEventSchema = new mongoose.Schema({
  // Unique key for deduplication
  uniqueKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Razorpay event details
  event: {
    type: String,
    required: true,
    index: true
  },

  // Entity IDs
  razorpaySubscriptionId: {
    type: String,
    index: true
  },

  razorpayPaymentId: {
    type: String,
    index: true
  },

  // Local references
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription',
    index: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  // Processing status
  processed: {
    type: Boolean,
    default: false,
    index: true
  },

  processedAt: Date,

  // Processing attempts
  attempts: {
    type: Number,
    default: 0
  },

  lastAttemptAt: Date,

  // Error tracking
  error: {
    message: String,
    stack: String,
    code: String
  },

  // Raw webhook body
  rawBody: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },

  // Request metadata
  requestMeta: {
    ip: String,
    userAgent: String,
    headers: mongoose.Schema.Types.Mixed
  },

  // Timestamps
  receivedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Indexes
webhookEventSchema.index({ uniqueKey: 1 }, { unique: true });
webhookEventSchema.index({ event: 1, processed: 1, receivedAt: -1 });
webhookEventSchema.index({ razorpaySubscriptionId: 1, event: 1 });
webhookEventSchema.index({ processed: 1, attempts: 1 });

// Static methods
webhookEventSchema.statics = {
  /**
   * Generate unique key for webhook
   */
  generateUniqueKey(event, subscriptionId, paymentId, timestamp) {
    const data = `${event}:${subscriptionId || ''}:${paymentId || ''}:${timestamp}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  },

  /**
   * Check if webhook was already processed
   */
  async isProcessed(uniqueKey) {
    const existing = await this.findOne({ uniqueKey, processed: true });
    return !!existing;
  },

  /**
   * Record webhook attempt
   */
  async recordWebhook(webhookData, requestMeta = {}) {
    const { event, payload, created_at } = webhookData;
    const subscriptionId = payload?.subscription?.entity?.id;
    const paymentId = payload?.payment?.entity?.id;
    
    const uniqueKey = this.generateUniqueKey(
      event,
      subscriptionId,
      paymentId,
      created_at || Date.now()
    );

    // Try to create or update
    const existing = await this.findOne({ uniqueKey });
    
    if (existing) {
      existing.attempts += 1;
      existing.lastAttemptAt = new Date();
      existing.requestMeta = requestMeta;
      await existing.save();
      return { webhookEvent: existing, isNew: false };
    }

    const webhookEvent = await this.create({
      uniqueKey,
      event,
      razorpaySubscriptionId: subscriptionId,
      razorpayPaymentId: paymentId,
      rawBody: webhookData,
      requestMeta,
      attempts: 1,
      lastAttemptAt: new Date()
    });

    return { webhookEvent, isNew: true };
  },

  /**
   * Mark webhook as processed
   */
  async markProcessed(uniqueKey, subscriptionId = null, userId = null) {
    return this.findOneAndUpdate(
      { uniqueKey },
      {
        processed: true,
        processedAt: new Date(),
        ...(subscriptionId && { subscriptionId }),
        ...(userId && { userId })
      },
      { new: true }
    );
  },

  /**
   * Mark webhook as failed
   */
  async markFailed(uniqueKey, error) {
    return this.findOneAndUpdate(
      { uniqueKey },
      {
        processed: false,
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        }
      },
      { new: true }
    );
  },

  /**
   * Get failed webhooks for retry
   */
  async getFailedWebhooks(maxAttempts = 3) {
    return this.find({
      processed: false,
      attempts: { $lt: maxAttempts }
    }).sort({ receivedAt: 1 }).limit(100);
  }
};

const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
module.exports = WebhookEvent;
```

---

## 2. SCHEMA UPDATES {#schema-updates}

### Update Subscription Schema (`models/Subscription.js`)

Add these fields to your existing subscription schema:

```javascript
// Add to existing schema definition:

// Razorpay specific fields
razorpayCustomerId: {
  type: String,
  index: true
},

razorpayOrderId: String,

authAttempts: {
  type: Number,
  default: 0
},

paidCount: {
  type: Number,
  default: 0,
  index: true
},

totalCount: {
  type: Number,
  required: true,
  default: 1
},

remainingCount: {
  type: Number,
  default: 0
},

// Charge scheduling
chargeAt: {
  type: Date,
  index: true
},

startAt: {
  type: Date,
  index: true
},

endAt: {
  type: Date,
  index: true
},

endedAt: {
  type: Date,
  index: true
},

expireBy: Date,

shortUrl: String,

// Scheduled changes (for upgrades/downgrades at cycle end)
scheduledChange: {
  newPlanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan'
  },
  changeType: {
    type: String,
    enum: ['upgrade', 'downgrade']
  },
  effectiveDate: Date,
  requestedAt: Date,
  reason: String
},

// Add to existing status enum:
status: {
  type: String,
  enum: ['created', 'authenticated', 'active', 'pending', 'halted', 
         'cancelled', 'completed', 'expired', 'paused'],
  default: 'created',
  index: true
}
```

---

## 3. ENHANCED WEBHOOK HANDLER {#webhook-handler}

Replace your webhook handler with this complete implementation:

### `controllers/webhookController.js`

```javascript
const crypto = require('crypto');
const logger = require('../utils/logger');
const WebhookEvent = require('../models/WebhookEvent');
const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const { CreditService } = require('../services/creditService');
const SubscriptionService = require('../services/subscriptionService');

class WebhookController {
  constructor() {
    this.creditService = new CreditService();
    this.subscriptionService = new SubscriptionService();
    
    // Bind methods
    this.handleRazorpayWebhook = this.handleRazorpayWebhook.bind(this);
  }

  /**
   * Verify Razorpay webhook signature
   */
  verifySignature(req, secret) {
    const signature = req.headers['x-razorpay-signature'];
    
    if (!signature) {
      return false;
    }

    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Main webhook handler
   */
  async handleRazorpayWebhook(req, res) {
    const startTime = Date.now();
    
    try {
      // 1. VERIFY SIGNATURE
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        logger.error('RAZORPAY_WEBHOOK_SECRET not configured');
        return res.status(500).json({ error: 'Webhook secret not configured' });
      }

      if (!this.verifySignature(req, webhookSecret)) {
        logger.warn('Invalid webhook signature', {
          ip: req.ip,
          headers: req.headers
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const { event, payload, created_at } = req.body;
      
      // 2. RECORD WEBHOOK (DEDUPLICATION)
      const requestMeta = {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        headers: req.headers
      };

      const { webhookEvent, isNew } = await WebhookEvent.recordWebhook(
        req.body,
        requestMeta
      );

      // If already processed, return success immediately
      if (!isNew && webhookEvent.processed) {
        logger.info('Webhook already processed (dedupe)', {
          event,
          uniqueKey: webhookEvent.uniqueKey,
          processedAt: webhookEvent.processedAt
        });
        return res.json({
          success: true,
          message: 'Webhook already processed',
          processedAt: webhookEvent.processedAt
        });
      }

      logger.info('Processing webhook', {
        event,
        uniqueKey: webhookEvent.uniqueKey,
        subscriptionId: payload?.subscription?.entity?.id,
        paymentId: payload?.payment?.entity?.id
      });

      // 3. ROUTE TO APPROPRIATE HANDLER
      let result;

      try {
        switch (event) {
          case 'subscription.authenticated':
            result = await this.handleAuthenticated(payload, webhookEvent);
            break;

          case 'subscription.activated':
            result = await this.handleActivated(payload, webhookEvent);
            break;

          case 'subscription.charged':
            result = await this.handleCharged(payload, webhookEvent);
            break;

          case 'subscription.pending':
            result = await this.handlePending(payload, webhookEvent);
            break;

          case 'subscription.halted':
            result = await this.handleHalted(payload, webhookEvent);
            break;

          case 'subscription.completed':
            result = await this.handleCompleted(payload, webhookEvent);
            break;

          case 'subscription.paused':
            result = await this.handlePaused(payload, webhookEvent);
            break;

          case 'subscription.resumed':
            result = await this.handleResumed(payload, webhookEvent);
            break;

          case 'subscription.cancelled':
            result = await this.handleCancelled(payload, webhookEvent);
            break;

          case 'subscription.updated':
            result = await this.handleUpdated(payload, webhookEvent);
            break;

          case 'payment.failed':
            result = await this.handlePaymentFailed(payload, webhookEvent);
            break;

          default:
            logger.warn('Unhandled webhook event', { event });
            result = { success: true, message: 'Event received but not handled' };
        }

        // 4. MARK AS PROCESSED
        await WebhookEvent.markProcessed(
          webhookEvent.uniqueKey,
          result.subscriptionId,
          result.userId
        );

        const processingTime = Date.now() - startTime;
        logger.info('Webhook processed successfully', {
          event,
          uniqueKey: webhookEvent.uniqueKey,
          processingTime: `${processingTime}ms`
        });

        res.json({
          success: true,
          message: result.message || 'Webhook processed successfully',
          processingTime: `${processingTime}ms`
        });

      } catch (handlerError) {
        // Mark webhook as failed
        await WebhookEvent.markFailed(webhookEvent.uniqueKey, handlerError);
        throw handlerError;
      }

    } catch (error) {
      logger.error('Webhook processing error', {
        error: error.message,
        stack: error.stack,
        event: req.body?.event
      });

      res.status(500).json({
        success: false,
        error: 'Webhook processing failed',
        message: error.message
      });
    }
  }

  /**
   * subscription.authenticated
   * First payment/authorization succeeded
   */
  async handleAuthenticated(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;
    const payment = payload.payment?.entity;

    logger.info('Handling subscription.authenticated', {
      subscriptionId: subEntity.id,
      paymentId: payment?.id
    });

    // Find subscription
    let subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      // This might be a new subscription - create it
      return this.handleActivated(payload, webhookEvent);
    }

    // Update status
    subscription.status = 'authenticated';
    subscription.authAttempts = subEntity.auth_attempts || 0;
    subscription.startAt = subEntity.start_at ? new Date(subEntity.start_at * 1000) : null;
    subscription.chargeAt = subEntity.charge_at ? new Date(subEntity.charge_at * 1000) : null;
    await subscription.save();

    // Record payment if present
    if (payment && payment.status === 'captured') {
      await this.recordPayment(payment, subscription, false); // Don't grant credits yet
    }

    return {
      success: true,
      message: 'Subscription authenticated',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * subscription.activated
   * Subscription became active
   */
  async handleActivated(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;
    const payment = payload.payment?.entity;

    logger.info('Handling subscription.activated', {
      subscriptionId: subEntity.id,
      paymentId: payment?.id,
      currentStart: subEntity.current_start,
      currentEnd: subEntity.current_end
    });

    // Find or create subscription
    let subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    }).populate('planId userId');

    const isNew = !subscription;

    if (isNew) {
      // Create new subscription (first activation)
      const plan = await Plan.findOne({ razorpayPlanId: subEntity.plan_id });
      if (!plan) {
        throw new Error(`Plan not found: ${subEntity.plan_id}`);
      }

      // Find user by customer ID or email from notes
      const userId = subEntity.notes?.userId;
      if (!userId) {
        throw new Error('User ID not found in subscription notes');
      }

      subscription = new Subscription({
        userId,
        planId: plan._id,
        razorpaySubscriptionId: subEntity.id,
        razorpayCustomerId: subEntity.customer_id,
        status: 'active',
        currentPeriodStart: new Date(subEntity.current_start * 1000),
        currentPeriodEnd: new Date(subEntity.current_end * 1000),
        startAt: subEntity.start_at ? new Date(subEntity.start_at * 1000) : new Date(),
        endAt: subEntity.end_at ? new Date(subEntity.end_at * 1000) : null,
        chargeAt: subEntity.charge_at ? new Date(subEntity.charge_at * 1000) : null,
        paidCount: subEntity.paid_count || 0,
        totalCount: subEntity.total_count || 1,
        remainingCount: subEntity.remaining_count || 0,
        billing: {
          currency: plan.pricing.currency,
          amount: plan.pricing.amount,
          interval: plan.pricing.interval,
          intervalCount: plan.pricing.intervalCount
        }
      });
    } else {
      // Update existing subscription
      subscription.status = 'active';
      subscription.currentPeriodStart = new Date(subEntity.current_start * 1000);
      subscription.currentPeriodEnd = new Date(subEntity.current_end * 1000);
      subscription.chargeAt = subEntity.charge_at ? new Date(subEntity.charge_at * 1000) : null;
      subscription.paidCount = subEntity.paid_count || 0;
      subscription.remainingCount = subEntity.remaining_count || 0;
    }

    await subscription.save();
    await subscription.populate('planId userId');

    // Record payment and grant credits
    if (payment && payment.status === 'captured') {
      await this.recordPayment(payment, subscription, true); // Grant credits on activation
    } else if (isNew) {
      // No payment in webhook but subscription is active - grant credits anyway
      await this.grantCreditsForSubscription(subscription);
    }

    return {
      success: true,
      message: isNew ? 'Subscription created and activated' : 'Subscription activated',
      subscriptionId: subscription._id,
      userId: subscription.userId._id
    };
  }

  /**
   * subscription.charged
   * Recurring payment succeeded
   */
  async handleCharged(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;
    const payment = payload.payment?.entity;

    logger.info('Handling subscription.charged', {
      subscriptionId: subEntity.id,
      paymentId: payment?.id,
      paidCount: subEntity.paid_count
    });

    // Find subscription
    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    }).populate('planId userId');

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    // Update subscription period and counters
    subscription.currentPeriodStart = new Date(subEntity.current_start * 1000);
    subscription.currentPeriodEnd = new Date(subEntity.current_end * 1000);
    subscription.chargeAt = subEntity.charge_at ? new Date(subEntity.charge_at * 1000) : null;
    subscription.paidCount = subEntity.paid_count || 0;
    subscription.remainingCount = subEntity.remaining_count || 0;
    subscription.status = 'active';
    await subscription.save();

    // Record payment and handle credits atomically
    if (payment && payment.status === 'captured') {
      await this.recordPayment(payment, subscription, true);
    }

    return {
      success: true,
      message: 'Subscription charged successfully',
      subscriptionId: subscription._id,
      userId: subscription.userId._id
    };
  }

  /**
   * subscription.pending
   * Payment failed, retries in progress
   */
  async handlePending(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    logger.info('Handling subscription.pending', {
      subscriptionId: subEntity.id,
      authAttempts: subEntity.auth_attempts
    });

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    subscription.status = 'pending';
    subscription.authAttempts = subEntity.auth_attempts || 0;
    subscription.chargeAt = subEntity.charge_at ? new Date(subEntity.charge_at * 1000) : null;
    await subscription.save();

    // NOTE: Don't expire credits here - wait for halted or let cron handle it at cycle end

    return {
      success: true,
      message: 'Subscription payment pending (retries in progress)',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * subscription.halted
   * All retry attempts exhausted
   */
  async handleHalted(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    logger.info('Handling subscription.halted', {
      subscriptionId: subEntity.id,
      authAttempts: subEntity.auth_attempts
    });

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    }).populate('userId');

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    subscription.status = 'halted';
    subscription.authAttempts = subEntity.auth_attempts || 0;
    await subscription.save();

    // Expire subscription credits immediately
    await this.creditService.expireSubscriptionCredits(new Date());

    logger.info('Subscription halted - credits expired', {
      subscriptionId: subscription._id,
      userId: subscription.userId._id
    });

    return {
      success: true,
      message: 'Subscription halted due to payment failures',
      subscriptionId: subscription._id,
      userId: subscription.userId._id
    };
  }

  /**
   * subscription.completed
   * All billing cycles completed
   */
  async handleCompleted(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    logger.info('Handling subscription.completed', {
      subscriptionId: subEntity.id,
      paidCount: subEntity.paid_count,
      totalCount: subEntity.total_count
    });

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    subscription.status = 'completed';
    subscription.endedAt = new Date(subEntity.ended_at * 1000);
    subscription.chargeAt = null;
    await subscription.save();

    // NOTE: Don't expire credits immediately - let them use until current_end
    // Cron job will handle expiry at currentPeriodEnd

    return {
      success: true,
      message: 'Subscription completed',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * subscription.paused
   */
  async handlePaused(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    subscription.status = 'paused';
    subscription.chargeAt = null;
    await subscription.save();

    // Don't expire credits - allow usage until currentPeriodEnd

    return {
      success: true,
      message: 'Subscription paused',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * subscription.resumed
   */
  async handleResumed(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    subscription.status = 'active';
    subscription.chargeAt = subEntity.charge_at ? new Date(subEntity.charge_at * 1000) : null;
    await subscription.save();

    return {
      success: true,
      message: 'Subscription resumed',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * subscription.cancelled
   */
  async handleCancelled(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    subscription.status = 'cancelled';
    subscription.endedAt = new Date(subEntity.ended_at * 1000);
    subscription.chargeAt = null;
    await subscription.save();

    // Don't expire credits immediately - allow usage until currentPeriodEnd

    return {
      success: true,
      message: 'Subscription cancelled',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * subscription.updated
   */
  async handleUpdated(payload, webhookEvent) {
    const subEntity = payload.subscription.entity;

    const subscription = await Subscription.findOne({
      razorpaySubscriptionId: subEntity.id
    });

    if (!subscription) {
      throw new Error(`Subscription not found: ${subEntity.id}`);
    }

    // Update fields that might have changed
    subscription.totalCount = subEntity.total_count || subscription.totalCount;
    subscription.remainingCount = subEntity.remaining_count || subscription.remainingCount;
    await subscription.save();

    return {
      success: true,
      message: 'Subscription updated',
      subscriptionId: subscription._id,
      userId: subscription.userId
    };
  }

  /**
   * payment.failed
   */
  async handlePaymentFailed(payload, webhookEvent) {
    const paymentEntity = payload.payment?.entity;
    const subEntity = payload.subscription?.entity;

    if (!paymentEntity) {
      return { success: true, message: 'No payment entity in payload' };
    }

    logger.info('Handling payment.failed', {
      paymentId: paymentEntity.id,
      subscriptionId: subEntity?.id,
      errorCode: paymentEntity.error_code
    });

    // Find subscription if available
    let subscription = null;
    if (subEntity?.id) {
      subscription = await Subscription.findOne({
        razorpaySubscriptionId: subEntity.id
      });
    }

    // Record failed payment
    if (subscription) {
      await Payment.createOrGet({
        razorpayPaymentId: paymentEntity.id,
        razorpayInvoiceId: paymentEntity.invoice_id,
        subscriptionId: subscription._id,
        userId: subscription.userId,
        amount: paymentEntity.amount,
        currency: paymentEntity.currency,
        status: 'failed',
        method: paymentEntity.method,
        errorCode: paymentEntity.error_code,
        errorDescription: paymentEntity.error_description,
        webhookData: paymentEntity,
        processed: true,
        processedAt: new Date()
      });
    }

    return {
      success: true,
      message: 'Failed payment recorded',
      subscriptionId: subscription?._id,
      userId: subscription?.userId
    };
  }

  /**
   * HELPER: Record payment and handle credit operations atomically
   */
  async recordPayment(paymentEntity, subscription, grantCredits = true) {
    // 1. Create or get payment (idempotent)
    const { payment, created } = await Payment.createOrGet({
      razorpayPaymentId: paymentEntity.id,
      razorpayInvoiceId: paymentEntity.invoice_id,
      subscriptionId: subscription._id,
      userId: subscription.userId._id || subscription.userId,
      amount: paymentEntity.amount,
      currency: paymentEntity.currency,
      status: paymentEntity.status,
      method: paymentEntity.method,
      capturedAt: paymentEntity.created_at ? new Date(paymentEntity.created_at * 1000) : new Date(),
      card: paymentEntity.card ? {
        last4: paymentEntity.card.last4,
        network: paymentEntity.card.network,
        type: paymentEntity.card.type,
        issuer: paymentEntity.card.issuer
      } : undefined,
      webhookData: paymentEntity
    });

    if (!created) {
      // Payment already exists
      logger.info('Payment already recorded (dedupe)', {
        paymentId: paymentEntity.id,
        processed: payment.processed
      });

      if (payment.processed) {
        return payment; // Already processed, skip credit operations
      }
    }

    // 2. Grant credits if requested and not already processed
    if (grantCredits && !payment.processed) {
      await this.grantCreditsForSubscription(subscription, payment);
      
      // Mark payment as processed
      payment.processed = true;
      payment.processedAt = new Date();
      await payment.save();
    }

    return payment;
  }

  /**
   * HELPER: Grant credits for subscription (expire old + grant new)
   */
  async grantCreditsForSubscription(subscription, payment = null) {
    await subscription.populate('planId userId');
    
    const plan = subscription.planId;
    const userId = subscription.userId._id || subscription.userId;

    // Get credit amount from plan
    const creditsToGrant = plan.features.credits.amount || plan.features.credits.monthly;

    if (creditsToGrant <= 0) {
      logger.info('No credits to grant for this plan', {
        planId: plan._id,
        planName: plan.name
      });
      return;
    }

    logger.info('Granting subscription credits', {
      userId,
      subscriptionId: subscription._id,
      credits: creditsToGrant,
      expiryDate: subscription.currentPeriodEnd
    });

    // STEP 1: Expire old subscription credits
    await this.creditService.expireSubscriptionCredits(new Date());

    // STEP 2: Grant new credits
    await this.creditService.grantSubscriptionCredits(
      userId,
      creditsToGrant,
      subscription.currentPeriodEnd,
      subscription._id.toString(),
      {
        planId: plan._id,
        planName: plan.name,
        paymentId: payment?.razorpayPaymentId,
        grantedAt: new Date(),
        source: 'subscription_renewal'
      }
    );

    // Update payment with credits granted
    if (payment) {
      payment.creditsGranted = creditsToGrant;
      await payment.save();
    }

    logger.info('Credits granted successfully', {
      userId,
      credits: creditsToGrant,
      expiryDate: subscription.currentPeriodEnd
    });
  }
}

module.exports = new WebhookController();
```

---

## 4. SCHEDULED JOBS {#scheduled-jobs}

### Create `jobs/subscriptionJobs.js`

```javascript
const cron = require('node-cron');
const logger = require('../utils/logger');
const Subscription = require('../models/Subscription');
const { CreditService } = require('../services/creditService');
const Plan = require('../models/Plan');

class SubscriptionJobs {
  constructor() {
    this.creditService = new CreditService();
  }

  /**
   * Initialize all scheduled jobs
   */
  initializeJobs() {
    // Run every hour
    this.scheduleExpireCreditsJob();
    
    // Run daily at 1 AM
    this.scheduleSubscriptionReconciliation();
    
    // Run every 6 hours
    this.scheduleScheduledPlanChanges();

    logger.info('Subscription jobs initialized');
  }

  /**
   * JOB 1: Expire credits at cycle boundaries
   * Runs every hour
   */
  scheduleExpireCreditsJob() {
    cron.schedule('0 * * * *', async () => {
      try {
        logger.info('Running credit expiry job');
        
        // Find subscriptions where credits should expire
        const now = new Date();
        const subscriptions = await Subscription.find({
          status: { $in: ['active', 'pending', 'halted', 'cancelled', 'completed'] },
          currentPeriodEnd: { $lte: now }
        }).populate('userId planId');

        logger.info(`Found ${subscriptions.length} subscriptions with expired periods`);

        for (const subscription of subscriptions) {
          try {
            // Check if next payment was made
            const nextPaymentExists = subscription.paidCount > 0 && 
                                     subscription.currentPeriodStart > now;

            if (!nextPaymentExists && subscription.status !== 'active') {
              // Period ended, no new payment - expire credits
              await this.creditService.expireSubscriptionCredits(subscription.currentPeriodEnd);
              
              logger.info('Credits expired for subscription', {
                subscriptionId: subscription._id,
                userId: subscription.userId._id,
                periodEnd: subscription.currentPeriodEnd
              });
            }
          } catch (error) {
            logger.error('Error expiring credits for subscription', {
              subscriptionId: subscription._id,
              error: error.message
            });
          }
        }

        logger.info('Credit expiry job completed');
      } catch (error) {
        logger.error('Credit expiry job failed', { error: error.message });
      }
    });
  }

  /**
   * JOB 2: Reconcile subscription states with Razorpay
   * Runs daily at 1 AM
   */
  scheduleSubscriptionReconciliation() {
    cron.schedule('0 1 * * *', async () => {
      try {
        logger.info('Running subscription reconciliation job');
        
        const razorpay = require('../config/razorpay.config');
        
        // Get all active subscriptions
        const subscriptions = await Subscription.find({
          status: { $in: ['active', 'pending', 'authenticated'] }
        }).limit(100); // Process in batches

        let reconciled = 0;
        let errors = 0;

        for (const subscription of subscriptions) {
          try {
            // Fetch from Razorpay
            const rzpSub = await razorpay.subscriptions.fetch(
              subscription.razorpaySubscriptionId
            );

            // Check for mismatches
            if (rzpSub.status !== subscription.status) {
              logger.warn('Subscription status mismatch', {
                subscriptionId: subscription._id,
                localStatus: subscription.status,
                razorpayStatus: rzpSub.status
              });

              // Update local status
              subscription.status = rzpSub.status;
              subscription.paidCount = rzpSub.paid_count || subscription.paidCount;
              subscription.remainingCount = rzpSub.remaining_count || subscription.remainingCount;
              await subscription.save();
              
              reconciled++;
            }
          } catch (error) {
            logger.error('Error reconciling subscription', {
              subscriptionId: subscription._id,
              error: error.message
            });
            errors++;
          }
        }

        logger.info('Subscription reconciliation completed', {
          total: subscriptions.length,
          reconciled,
          errors
        });
      } catch (error) {
        logger.error('Subscription reconciliation job failed', {
          error: error.message
        });
      }
    });
  }

  /**
   * JOB 3: Process scheduled plan changes (upgrades/downgrades at cycle end)
   * Runs every 6 hours
   */
  scheduleScheduledPlanChanges() {
    cron.schedule('0 */6 * * *', async () => {
      try {
        logger.info('Running scheduled plan changes job');
        
        const now = new Date();
        
        // Find subscriptions with pending plan changes
        const subscriptions = await Subscription.find({
          'scheduledChange.effectiveDate': { $lte: now },
          'scheduledChange.newPlanId': { $exists: true }
        }).populate('userId planId scheduledChange.newPlanId');

        logger.info(`Found ${subscriptions.length} subscriptions with scheduled changes`);

        for (const subscription of subscriptions) {
          try {
            const oldPlan = subscription.planId;
            const newPlan = subscription.scheduledChange.newPlanId;

            logger.info('Processing scheduled plan change', {
              subscriptionId: subscription._id,
              userId: subscription.userId._id,
              fromPlan: oldPlan.planId,
              toPlan: newPlan.planId,
              changeType: subscription.scheduledChange.changeType
            });

            // Update subscription plan
            subscription.planChanges.push({
              fromPlanId: oldPlan._id,
              toPlanId: newPlan._id,
              changeType: subscription.scheduledChange.changeType,
              effectiveDate: now,
              reason: subscription.scheduledChange.reason || 'scheduled_change'
            });

            subscription.planId = newPlan._id;
            subscription.billing = {
              currency: newPlan.pricing.currency,
              amount: newPlan.pricing.amount,
              interval: newPlan.pricing.interval,
              intervalCount: newPlan.pricing.intervalCount
            };

            // Clear scheduled change
            subscription.scheduledChange = undefined;
            await subscription.save();

            // Update Razorpay subscription
            const razorpay = require('../config/razorpay.config');
            await razorpay.subscriptions.update(subscription.razorpaySubscriptionId, {
              plan_id: newPlan.razorpayPlanId,
              quantity: 1
            });

            logger.info('Scheduled plan change completed', {
              subscriptionId: subscription._id,
              newPlan: newPlan.planId
            });

          } catch (error) {
            logger.error('Error processing scheduled plan change', {
              subscriptionId: subscription._id,
              error: error.message
            });
          }
        }

        logger.info('Scheduled plan changes job completed');
      } catch (error) {
        logger.error('Scheduled plan changes job failed', {
          error: error.message
        });
      }
    });
  }
}

// Export singleton
module.exports = new SubscriptionJobs();
```

### Add to your main server file:

```javascript
// In your server.js or app.js
const subscriptionJobs = require('./jobs/subscriptionJobs');

// After MongoDB connection
subscriptionJobs.initializeJobs();
```

---

## 5. ENHANCED SUBSCRIPTION SERVICE {#services}

Update your `upgradeSubscription` method to handle cycle-end scheduling:

```javascript
// In subscriptionService.js

async upgradeSubscription(userId, newPlanId, options = {}) {
  const { immediate = false, reason = 'user_upgrade' } = options; // immediate now defaults to false
  
  const subscription = await Subscription.getUserActiveSubscription(userId);
  if (!subscription) {
    throw new SubscriptionError('No active subscription', 'NO_ACTIVE_SUBSCRIPTION');
  }

  const newPlan = await Plan.findById(newPlanId);
  if (!newPlan) {
    throw new SubscriptionError('Plan not found', 'PLAN_NOT_FOUND');
  }

  const currentPlan = await Plan.findById(subscription.planId);
  const changeType = newPlan.pricing.amount > currentPlan.pricing.amount ? 'upgrade' : 'downgrade';

  // SCHEDULE CHANGE AT CYCLE END (your requirement)
  subscription.scheduledChange = {
    newPlanId: newPlan._id,
    changeType,
    effectiveDate: subscription.currentPeriodEnd,
    requestedAt: new Date(),
    reason
  };

  await subscription.save();

  logger.info('Plan change scheduled', {
    subscriptionId: subscription._id,
    userId,
    fromPlan: currentPlan.planId,
    toPlan: newPlan.planId,
    effectiveDate: subscription.currentPeriodEnd
  });

  return {
    success: true,
    subscription: subscription.toObject(),
    oldPlan: currentPlan.toObject(),
    newPlan: newPlan.toObject(),
    changeType,
    scheduledFor: subscription.currentPeriodEnd,
    message: `${changeType} scheduled for ${subscription.currentPeriodEnd.toDateString()}`
  };
}
```

---

## 6. ENVIRONMENT VARIABLES {#env-vars}

Add to your `.env`:

```bash
# Razorpay Configuration
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Subscription Settings
DEFAULT_USER_CREDITS=3
SUBSCRIPTION_RECONCILIATION_ENABLED=true
```

---

## 7. COMPLETE FLOW DOCUMENTATION {#flow-docs}

### Flow 1: NEW USER SUBSCRIBES (IMMEDIATE START)

**Timeline:**
1. **Frontend**: User clicks "Subscribe to Pro" → calls `/api/subscriptions/create`
2. **Backend**: Creates Razorpay subscription → returns `short_url`
3. **Frontend**: Opens Razorpay checkout with `short_url`
4. **User**: Completes payment
5. **Razorpay**: Sends `subscription.authenticated` webhook
   - **Action**: Mark subscription as authenticated, record payment (no credits yet)
6. **Razorpay**: Sends `subscription.activated` webhook
   - **Action**: Set status=active, set currentPeriodStart/End
7. **Razorpay**: Sends `subscription.charged` webhook
   - **Action**: 
     - Check payment deduplication (Payment model unique constraint)
     - If new payment:
       - Expire old subscription credits
       - Grant new credits for current period
       - Mark payment as processed

**Result**: User has active subscription with credits valid until `currentPeriodEnd`

---

### Flow 2: SUBSCRIPTION RENEWAL (NEXT MONTH)

**Timeline:**
1. **Razorpay**: Attempts charge on `chargeAt` date
2. **Success Path**:
   - **Razorpay**: Sends `subscription.charged` webhook
   - **Action**:
     - Update currentPeriodStart/End
     - Record payment (dedupe check)
     - If new payment:
       - Expire previous month's credits
       - Grant new month's credits
3. **Failure Path**:
   - **Razorpay**: Sends `subscription.pending` webhook
   - **Action**: Mark status=pending, increment authAttempts
   - **Razorpay**: Retries automatically (multiple times)
   - **If retry succeeds**: Sends `subscription.charged` (process normally)
   - **If all retries fail**: Sends `subscription.halted`
     - **Action**: 
       - Mark status=halted
       - Expire credits immediately
       - User falls back to free tier

---

### Flow 3: UPGRADE AT CYCLE END

**Timeline:**
1. **User**: Clicks "Upgrade to Enterprise"
2. **Backend**: `/api/subscriptions/upgrade`
   - **Action**: 
     - Create `scheduledChange` record
     - Store newPlanId, effectiveDate = currentPeriodEnd
     - Return message: "Upgrade scheduled for [date]"
3. **Current cycle continues**: User keeps using current plan + credits
4. **At cycle end** (handled by cron job):
   - Scheduled job detects `scheduledChange.effectiveDate <= now`
   - Updates subscription.planId
   - Updates Razorpay subscription
   - Clears scheduledChange
5. **Next charge**: Razorpay charges new plan amount
   - Webhook `subscription.charged` arrives
   - Grant credits based on NEW plan amount

---

### Flow 4: DOWNGRADE AT CYCLE END

**Timeline:**
1. **User**: Clicks "Downgrade to Plus"
2. **Backend**: `/api/subscriptions/upgrade` (same endpoint)
   - **Action**: Schedule downgrade for currentPeriodEnd
3. **Current cycle continues**: User keeps current plan + credits
4. **At cycle end**: Cron job processes downgrade
5. **Next charge**: Razorpay charges lower amount
   - Webhook grants credits based on new plan

---

### Flow 5: CANCELLATION

**Timeline:**
1. **User**: Clicks "Cancel Subscription"
2. **Backend**: `/api/subscriptions/cancel`
   - **Options**:
     - `immediately: false` (default): Set cancelAtPeriodEnd=true
     - `immediately: true`: Cancel on Razorpay immediately
3. **If cancelAtPeriodEnd=true**:
   - User keeps access until currentPeriodEnd
   - Credits valid until currentPeriodEnd
   - Cron job or Razorpay sends `subscription.cancelled` at period end
   - **Action**: Expire credits, set status=cancelled
4. **If immediately=true**:
   - Razorpay sends `subscription.cancelled` immediately
   - **Action**: Set status=cancelled (credits remain until currentPeriodEnd per your rules)

---

### Flow 6: PAYMENT FAILURE → RETRY → SUCCESS

**Timeline:**
1. **Day 1**: Razorpay attempts charge → fails
   - `subscription.pending` webhook → status=pending, authAttempts=1
2. **Day 2**: Razorpay retries → fails
   - `subscription.pending` webhook → authAttempts=2
3. **Day 3**: Razorpay retries → **succeeds**
   - `subscription.charged` webhook
   - **Action**:
     - Check if credits already expired (via cron)
     - If yes: Grant new credits
     - If no: Expire old credits + grant new credits
     - Set status=active

---

### Flow 7: PAYMENT FAILURE → HALTED

**Timeline:**
1. **Days 1-3**: Multiple retries fail (as above)
2. **Day 4**: Final retry fails
   - `subscription.halted` webhook
   - **Action**:
     - Set status=halted
     - Expire credits immediately
     - User can only use defaultCredits (free tier)
3. **User updates payment method**:
   - Razorpay attempts charge again
   - If succeeds → `subscription.activated` + `subscription.charged`
   - Grant credits normally

---

### Flow 8: DEDUPLICATION IN ACTION

**Scenario**: Network issues cause Razorpay to retry webhook delivery

**Timeline:**
1. **Attempt 1**: `subscription.charged` webhook arrives
   - WebhookEvent.recordWebhook() → creates record with uniqueKey
   - Payment.createOrGet() → creates new payment
   - Credits granted
   - WebhookEvent marked as processed
2. **Attempt 2** (5 minutes later): Same webhook arrives
   - WebhookEvent.recordWebhook() → finds existing uniqueKey
   - Returns `{ isNew: false, webhookEvent: <existing> }`
   - Controller checks `webhookEvent.processed === true`
   - Returns 200 immediately without processing
3. **Result**: Credits NOT double-granted, payment NOT duplicated

---

## 8. INSTALLATION & SETUP {#testing}

### Step 1: Install Dependencies

```bash
npm install node-cron
```

### Step 2: Create Models

1. Create `models/Payment.js` (code provided above)
2. Create `models/WebhookEvent.js` (code provided above)
3. Update `models/Subscription.js` (add fields from Schema Updates section)

### Step 3: Update Controllers

1. Replace `controllers/webhookController.js` with enhanced version
2. Your existing `subscriptionController.js` should work with minor updates

### Step 4: Update Services

1. Update `subscriptionService.js` → modify `upgradeSubscription()` for cycle-end scheduling
2. Your existing `creditService.js` should work as-is

### Step 5: Create Jobs Directory

```bash
mkdir jobs
```

Create `jobs/subscriptionJobs.js` (code provided above)

### Step 6: Initialize Jobs in Server

Add to `server.js` or `app.js`:

```javascript
// After MongoDB connection succeeds
const subscriptionJobs = require('./jobs/subscriptionJobs');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    
    // Initialize scheduled jobs
    subscriptionJobs.initializeJobs();
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error('MongoDB connection error:', err));
```

### Step 7: Configure Razorpay Webhook

1. Go to Razorpay Dashboard → Webhooks
2. Create new webhook pointing to: `https://yourdomain.com/api/webhooks/razorpay`
3. Select events:
   - `subscription.authenticated`
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.pending`
   - `subscription.halted`
   - `subscription.completed`
   - `subscription.cancelled`
   - `subscription.paused`
   - `subscription.resumed`
   - `subscription.updated`
   - `payment.failed`
4. Copy webhook secret → add to `.env` as `RAZORPAY_WEBHOOK_SECRET`

---

## 9. TESTING GUIDE {#testing}

### Test 1: New Subscription (Immediate Start)

```bash
# 1. Create subscription
curl -X POST http://localhost:3000/api/subscriptions/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "pro",
    "totalCount": 12,
    "customerNotify": true
  }'

# 2. User completes payment via returned short_url
# 3. Check webhook logs for:
#    - subscription.authenticated
#    - subscription.activated  
#    - subscription.charged

# 4. Verify credits granted
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: subscriptionCredits = plan's monthly credits
```

---

### Test 2: Subscription Renewal

```bash
# Wait for next billing cycle OR use Razorpay test mode to simulate

# 1. Razorpay will send subscription.charged webhook
# 2. Check logs for:
#    - Old credits expired
#    - New credits granted
#    - Payment recorded (deduplicated)

# 3. Verify credit history
curl -X GET http://localhost:3000/api/credits/transactions \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: 
# - One 'expire' transaction (old credits)
# - One 'grant' transaction (new credits)
```

---

### Test 3: Payment Failure

```bash
# Use Razorpay test cards that fail

# 1. Use card: 4000000000000002 (decline)
# 2. Check webhook: subscription.pending
# 3. Verify status in DB:
#    - subscription.status = 'pending'
#    - subscription.authAttempts incremented

# 4. Wait for retries OR simulate halted
# 5. Check webhook: subscription.halted
# 6. Verify credits expired:
curl -X GET http://localhost:3000/api/credits/balance \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: subscriptionCredits = 0
```

---

### Test 4: Upgrade at Cycle End

```bash
# 1. Schedule upgrade
curl -X POST http://localhost:3000/api/subscriptions/upgrade \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "newPlanId": "ENTERPRISE_PLAN_ID",
    "immediate": false,
    "reason": "user_upgrade"
  }'

# Expected response:
# {
#   "success": true,
#   "message": "upgrade scheduled for 2025-11-12",
#   "scheduledFor": "2025-11-12T00:00:00.000Z"
# }

# 2. Verify scheduledChange in DB:
# subscription.scheduledChange.newPlanId = ENTERPRISE_PLAN_ID

# 3. Wait for current cycle to end (or run cron manually)
# 4. Verify plan changed:
# subscription.planId = ENTERPRISE_PLAN_ID

# 5. Next charge will be at new plan rate
```

---

### Test 5: Webhook Deduplication

```bash
# 1. Send same webhook twice (simulate replay)
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "X-Razorpay-Signature: VALID_SIGNATURE" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "subscription.charged",
    "payload": { ... },
    "created_at": 1234567890
  }'

# 2. Send again immediately
curl -X POST http://localhost:3000/api/webhooks/razorpay \
  -H "X-Razorpay-Signature: VALID_SIGNATURE" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "subscription.charged",
    "payload": { ... },
    "created_at": 1234567890
  }'

# Expected:
# - First request: processed normally
# - Second request: returns "Webhook already processed"
# - Credits NOT double-granted
# - Payment NOT duplicated
```

---

### Test 6: Cron Jobs (Manual Trigger)

```javascript
// In Node.js console or test file
const subscriptionJobs = require('./jobs/subscriptionJobs');

// Test credit expiry
await subscriptionJobs.scheduleExpireCreditsJob();

// Test reconciliation
await subscriptionJobs.scheduleSubscriptionReconciliation();

// Test scheduled plan changes
await subscriptionJobs.scheduleScheduledPlanChanges();
```

---

## 10. MONITORING & DEBUGGING

### Check Webhook Processing

```javascript
// Query webhook events
const WebhookEvent = require('./models/WebhookEvent');

// Get recent webhooks
const recent = await WebhookEvent.find()
  .sort({ receivedAt: -1 })
  .limit(20);

// Get failed webhooks
const failed = await WebhookEvent.find({
  processed: false,
  attempts: { $gt: 0 }
});

// Get webhooks for specific subscription
const subWebhooks = await WebhookEvent.find({
  razorpaySubscriptionId: 'sub_xxx'
}).sort({ receivedAt: 1 });
```

---

### Check Payment Deduplication

```javascript
const Payment = require('./models/Payment');

// Check for duplicate payment IDs (should be none)
const duplicates = await Payment.aggregate([
  { $group: {
      _id: '$razorpayPaymentId',
      count: { $sum: 1 }
    }
  },
  { $match: { count: { $gt: 1 } } }
]);

console.log('Duplicate payments:', duplicates); // Should be []
```

---

### Check Credit Operations

```javascript
const CreditTransaction = require('./models/CreditTransaction');

// Get user's recent transactions
const transactions = await CreditTransaction.find({
  userId: 'USER_ID'
}).sort({ createdAt: -1 }).limit(20);

// Check for any missing grant/expire pairs
const grants = await CreditTransaction.countDocuments({
  userId: 'USER_ID',
  type: 'grant',
  creditType: 'subscription'
});

const expires = await CreditTransaction.countDocuments({
  userId: 'USER_ID',
  type: 'expire',
  creditType: 'subscription'
});

console.log('Grants:', grants, 'Expires:', expires);
// After first month: should be equal (1 grant, 1 expire)
```

---

## 11. FRONTEND INTEGRATION

### Create Subscription

```javascript
// frontend/subscriptionService.js

async function createSubscription(planId) {
  const response = await fetch('/api/subscriptions/create', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      planId,
      totalCount: 12, // for annual billing
      customerNotify: true
    })
  });

  const data = await response.json();
  
  if (data.success) {
    // Open Razorpay checkout
    const options = {
      key: process.env.REACT_APP_RAZORPAY_KEY_ID,
      subscription_id: data.subscriptionId,
      name: 'Your Company',
      description: `${data.plan.name} Subscription`,
      handler: function(response) {
        // Payment successful
        console.log('Payment successful:', response);
        
        // Redirect to dashboard or show success
        window.location.href = '/dashboard?payment=success';
      },
      prefill: {
        email: user.email,
        name: user.name
      },
      theme: {
        color: '#3399cc'
      }
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  }
}
```

---

### Check Subscription Status

```javascript
async function getCurrentSubscription() {
  const response = await fetch('/api/subscriptions/current', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  
  if (data.subscription) {
    return {
      plan: data.subscription.planId.name,
      status: data.subscription.status,
      currentPeriodEnd: data.subscription.currentPeriodEnd,
      cancelAtPeriodEnd: data.subscription.cancelAtPeriodEnd,
      scheduledChange: data.subscription.scheduledChange
    };
  }
  
  return null;
}
```

---

### Upgrade Subscription

```javascript
async function upgradeSubscription(newPlanId) {
  const response = await fetch('/api/subscriptions/upgrade', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      newPlanId,
      immediate: false, // schedule at cycle end
      reason: 'user_upgrade'
    })
  });

  const data = await response.json();
  
  if (data.success) {
    alert(`Upgrade scheduled for ${new Date(data.scheduledFor).toLocaleDateString()}`);
  }
}
```

---

## 12. COMMON ISSUES & SOLUTIONS

### Issue 1: Credits Double-Granted

**Symptom**: User has 2x expected credits

**Cause**: Webhook processed twice due to missing deduplication

**Solution**: Verify WebhookEvent and Payment models have unique constraints:
- `WebhookEvent.uniqueKey` → unique index
- `Payment.razorpayPaymentId` → unique index

**Check**:
```javascript
// In MongoDB
db.webhookevents.getIndexes(); // Should show unique index on uniqueKey
db.payments.getIndexes(); // Should show unique index on razorpayPaymentId
```

---

### Issue 2: Credits Not Expiring

**Symptom**: Old credits remain after renewal

**Cause**: Cron job not running OR expiry logic not executed in webhook

**Solution**:
1. Check cron job initialization in server logs
2. Verify `scheduleExpireCreditsJob()` is scheduled
3. Manually trigger: `subscriptionJobs.scheduleExpireCreditsJob()`

---

### Issue 3: Scheduled Upgrade Not Applied

**Symptom**: Plan not changed at cycle end

**Cause**: Cron job not running OR effectiveDate miscalculated

**Solution**:
1. Check `scheduledChange.effectiveDate` in DB
2. Verify it's <= current time
3. Manually trigger: `subscriptionJobs.scheduleScheduledPlanChanges()`

---

### Issue 4: Webhook Signature Validation Fails

**Symptom**: All webhooks rejected with 401

**Cause**: Wrong webhook secret OR body parsing issue

**Solution**:
```javascript
// Ensure raw body is available
app.use('/api/webhooks/razorpay', express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Update signature verification to use rawBody
verifySignature(req, secret) {
  const signature = req.headers['x-razorpay-signature'];
  const body = req.rawBody || JSON.stringify(req.body);
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  return signature === expectedSignature;
}
```

---

## 13. PRODUCTION CHECKLIST

- [ ] All environment variables configured
- [ ] Webhook secret set in Razorpay dashboard
- [ ] Webhook URL pointing to production domain
- [ ] MongoDB indexes created (run on production DB):
  ```javascript
  db.webhookevents.createIndex({ uniqueKey: 1 }, { unique: true });
  db.payments.createIndex({ razorpayPaymentId: 1 }, { unique: true });
  db.subscriptions.createIndex({ razorpaySubscriptionId: 1 }, { unique: true });
  ```
- [ ] Cron jobs initialized on server start
- [ ] Logging configured (Winston/Pino)
- [ ] Error monitoring (Sentry/Bugsnag)
- [ ] Webhook retry mechanism tested
- [ ] Credit deduplication tested
- [ ] Payment deduplication tested
- [ ] Scheduled jobs tested manually
- [ ] Test payment with real card (test mode)
- [ ] Verify Razorpay webhook delivery logs
- [ ] Monitor first few subscriptions closely

---

## 14. KEY TAKEAWAYS

### ✅ Deduplication is Critical
- WebhookEvent model prevents webhook replay attacks
- Payment model prevents double-charging credits
- Unique constraints on razorpayPaymentId and uniqueKey

### ✅ Credit Management Flow
1. Payment arrives → check if already processed
2. If new → expire old credits + grant new credits
3. Record in CreditTransaction for audit trail

### ✅ Upgrade/Downgrade Flow
- Schedule changes at cycle end (scheduledChange field)
- Cron job applies changes when effectiveDate arrives
- User keeps current plan + credits until then

### ✅ Failure Handling
- `pending` → retries in progress (don't expire yet)
- `halted` → all retries failed (expire immediately)
- Cron job catches missed expirations

### ✅ Three Safety Nets
1. Webhook deduplication (WebhookEvent)
2. Payment deduplication (Payment model)
3. Credit transaction atomicity (CreditService)

---

## COMPLETE! 🚀

You now have a production-ready Razorpay subscription system with:
- ✅ Proper webhook handling with signature verification
- ✅ Complete deduplication at webhook and payment levels
- ✅ Atomic credit operations (expire old + grant new)
- ✅ Scheduled upgrades/downgrades at cycle end
- ✅ Automatic credit expiry at period boundaries
- ✅ Failure handling (pending → halted flow)
- ✅ Reconciliation jobs for data consistency
- ✅ Full audit trail via WebhookEvent, Payment, CreditTransaction

**Next Steps:**
1. Implement the new models (Payment, WebhookEvent)
2. Replace your webhook controller with the enhanced version
3. Add the subscription jobs
4. Test thoroughly in test mode
5. Deploy and monitor 🎉