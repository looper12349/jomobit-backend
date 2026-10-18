const cron = require('node-cron');
const os = require('os');
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const creditService = require('../services/creditService');
const razorpay = require('../config/razorpay.config');
const logger = require('../utils/logger');

// Every replica fires the same cron schedule at the same minute. The lock makes
// only one of them do the work; 10 minutes is far shorter than the shortest
// interval (hourly) and far longer than the gap between replicas firing.
const JOB_LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * SubscriptionJobs Class
 * Manages scheduled jobs for subscription and credit management
 */
class SubscriptionJobs {
  constructor() {
    this.jobs = [];
    this.isInitialized = false;
  }

  /**
   * Initialize all scheduled jobs
   * Starts all cron jobs for subscription management
   */
  initializeJobs() {
    if (this.isInitialized) {
      logger.warn('Subscription jobs already initialized');
      return;
    }

    logger.info('Initializing subscription jobs...');

    try {
      // Job 1: Credit expiry job (runs hourly)
      this.scheduleCreditExpiryJob();

      // Job 2: Subscription reconciliation job (runs daily at 1 AM)
      this.scheduleReconciliationJob();

      // Job 3: Scheduled plan change job (runs every 6 hours)
      this.scheduleScheduledPlanChangeJob();

      this.isInitialized = true;
      logger.info('All subscription jobs initialized successfully', {
        jobCount: this.jobs.length
      });
    } catch (error) {
      logger.error('Error initializing subscription jobs', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Schedule credit expiry job
   * Runs hourly to expire credits for subscriptions that have ended
   */
  scheduleCreditExpiryJob() {
    const job = cron.schedule('0 * * * *', async () => {
      await this.runIfLockAcquired('creditExpiry', () => this.runCreditExpiryJob());
    });

    this.jobs.push({ name: 'creditExpiry', job });
    logger.info('Credit expiry job scheduled (runs hourly)');
  }

  /**
   * Schedule subscription reconciliation job
   * Runs daily at 1 AM to reconcile local subscriptions with Razorpay
   */
  scheduleReconciliationJob() {
    const job = cron.schedule('0 1 * * *', async () => {
      await this.runIfLockAcquired('reconciliation', () => this.runReconciliationJob());
    });

    this.jobs.push({ name: 'reconciliation', job });
    logger.info('Subscription reconciliation job scheduled (runs daily at 1 AM)');
  }

  /**
   * Schedule scheduled plan change job
   * Runs every 6 hours to process scheduled plan changes
   */
  scheduleScheduledPlanChangeJob() {
    const job = cron.schedule('0 */6 * * *', async () => {
      await this.runIfLockAcquired('scheduledPlanChange', () => this.runScheduledPlanChangeJob());
    });

    this.jobs.push({ name: 'scheduledPlanChange', job });
    logger.info('Scheduled plan change job scheduled (runs every 6 hours)');
  }

  /**
   * Claim a cluster-wide lock for one run of a job.
   * Returns true if this replica got the lock, false if another replica holds it.
   * The upsert either takes an expired/missing lock or fails with a duplicate
   * key error (11000) because a live lock document already exists.
   */
  async acquireJobLock(jobName, ttlMs = JOB_LOCK_TTL_MS) {
    const now = new Date();
    try {
      await mongoose.connection.collection('job_locks').findOneAndUpdate(
        { _id: jobName, lockedUntil: { $lte: now } },
        { $set: { lockedUntil: new Date(now.getTime() + ttlMs), owner: os.hostname(), lockedAt: now } },
        { upsert: true }
      );
      return true;
    } catch (error) {
      if (error.code === 11000) return false;
      throw error;
    }
  }

  /**
   * Run a scheduled job only in the replica that wins the lock
   */
  async runIfLockAcquired(jobName, run) {
    let acquired;
    try {
      acquired = await this.acquireJobLock(jobName);
    } catch (error) {
      logger.error('Job lock check failed, skipping this run', { jobName, error: error.message });
      return;
    }

    if (!acquired) {
      logger.info('Job skipped: another replica holds the lock', { jobName, host: os.hostname() });
      return;
    }

    await run();
  }

  /**
   * Run credit expiry job
   * Finds subscriptions with expired periods and expires their credits
   */
  async runCreditExpiryJob() {
    const startTime = Date.now();
    const startTimeFormatted = new Date().toISOString();
    
    logger.info('Scheduled job started: credit expiry', {
      jobName: 'creditExpiry',
      startTime: startTimeFormatted,
      schedule: 'hourly'
    });

    let stats = {
      subscriptionsProcessed: 0,
      creditsExpired: 0,
      errors: 0,
      subscriptionsChecked: 0
    };

    try {
      // Find subscriptions with currentPeriodEnd <= now and status not active
      const now = new Date();
      const subscriptions = await Subscription.find({
        currentPeriodEnd: { $lte: now },
        status: { $nin: ['active', 'cancelled', 'completed'] }
      }).populate('userId');

      stats.subscriptionsChecked = subscriptions.length;

      logger.info('Scheduled job: credit expiry - found subscriptions to check', {
        jobName: 'creditExpiry',
        subscriptionsFound: subscriptions.length,
        checkDate: now.toISOString()
      });

      for (const subscription of subscriptions) {
        try {
          // Check if next payment was made by comparing paidCount and currentPeriodStart
          const nextPaymentMade = subscription.currentPeriodStart > subscription.currentPeriodEnd;

          if (!nextPaymentMade) {
            // Expire subscription credits
            const result = await creditService.expireSubscriptionCredits(
              subscription.currentPeriodEnd
            );

            stats.subscriptionsProcessed++;
            stats.creditsExpired += result.totalExpired || 0;

            logger.info('Scheduled job: credit expiry - credits expired for subscription', {
              jobName: 'creditExpiry',
              subscriptionId: subscription._id,
              userId: subscription.userId,
              creditsExpired: result.totalExpired,
              expiryDate: subscription.currentPeriodEnd,
              subscriptionStatus: subscription.status
            });
          }
        } catch (error) {
          stats.errors++;
          logger.error('Scheduled job: credit expiry - error processing subscription', {
            jobName: 'creditExpiry',
            subscriptionId: subscription._id,
            userId: subscription.userId,
            error: error.message,
            stack: error.stack
          });
        }
      }

      const executionTime = Date.now() - startTime;
      const endTimeFormatted = new Date().toISOString();
      
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

      return stats;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const endTimeFormatted = new Date().toISOString();
      
      logger.error('Scheduled job failed: credit expiry', {
        jobName: 'creditExpiry',
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        executionTimeMs: executionTime,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Run subscription reconciliation job
   * Fetches subscription status from Razorpay and updates local data
   */
  async runReconciliationJob() {
    const startTime = Date.now();
    const startTimeFormatted = new Date().toISOString();
    
    logger.info('Scheduled job started: subscription reconciliation', {
      jobName: 'reconciliation',
      startTime: startTimeFormatted,
      schedule: 'daily at 1 AM'
    });

    // Check if reconciliation is enabled
    const reconciliationEnabled = process.env.SUBSCRIPTION_RECONCILIATION_ENABLED !== 'false';
    if (!reconciliationEnabled) {
      logger.info('Scheduled job skipped: subscription reconciliation disabled', {
        jobName: 'reconciliation',
        reason: 'disabled_by_config'
      });
      return { skipped: true };
    }

    let stats = {
      totalChecked: 0,
      mismatchesFound: 0,
      errors: 0,
      batchesProcessed: 0
    };

    try {
      // Fetch active/pending subscriptions in batches of 100
      const batchSize = 100;
      let skip = 0;
      let hasMore = true;

      while (hasMore) {
        const subscriptions = await Subscription.find({
          status: { $in: ['active', 'pending', 'authenticated'] }
        })
          .limit(batchSize)
          .skip(skip)
          .exec();

        if (subscriptions.length === 0) {
          hasMore = false;
          break;
        }

        stats.batchesProcessed++;

        logger.info('Scheduled job: reconciliation - processing batch', {
          jobName: 'reconciliation',
          batchNumber: stats.batchesProcessed,
          batchSize: subscriptions.length,
          skip,
          limit: batchSize
        });

        for (const subscription of subscriptions) {
          try {
            // Fetch status from Razorpay API
            const razorpaySubscription = await razorpay.subscriptions.fetch(
              subscription.razorpaySubscriptionId
            );

            stats.totalChecked++;

            // Compare local status with Razorpay status
            const razorpayStatus = this.mapRazorpayStatus(razorpaySubscription.status);
            
            if (subscription.status !== razorpayStatus) {
              // Mismatch found - update local subscription
              logger.warn('Scheduled job: reconciliation - status mismatch detected', {
                jobName: 'reconciliation',
                subscriptionId: subscription._id,
                razorpaySubscriptionId: subscription.razorpaySubscriptionId,
                userId: subscription.userId,
                localStatus: subscription.status,
                razorpayStatus: razorpayStatus,
                mismatchType: 'status'
              });

              subscription.status = razorpayStatus;
              
              // Update other fields from Razorpay
              if (razorpaySubscription.paid_count !== undefined) {
                subscription.paidCount = razorpaySubscription.paid_count;
              }
              if (razorpaySubscription.remaining_count !== undefined) {
                subscription.remainingCount = razorpaySubscription.remaining_count;
              }
              if (razorpaySubscription.charge_at) {
                subscription.chargeAt = new Date(razorpaySubscription.charge_at * 1000);
              }
              if (razorpaySubscription.start_at) {
                subscription.startAt = new Date(razorpaySubscription.start_at * 1000);
              }
              if (razorpaySubscription.end_at) {
                subscription.endAt = new Date(razorpaySubscription.end_at * 1000);
              }
              if (razorpaySubscription.ended_at) {
                subscription.endedAt = new Date(razorpaySubscription.ended_at * 1000);
              }

              await subscription.save();
              stats.mismatchesFound++;

              logger.info('Scheduled job: reconciliation - subscription reconciled', {
                jobName: 'reconciliation',
                subscriptionId: subscription._id,
                userId: subscription.userId,
                oldStatus: subscription.status,
                newStatus: razorpayStatus
              });
            }
          } catch (error) {
            stats.errors++;
            logger.error('Scheduled job: reconciliation - error processing subscription', {
              jobName: 'reconciliation',
              subscriptionId: subscription._id,
              razorpaySubscriptionId: subscription.razorpaySubscriptionId,
              userId: subscription.userId,
              error: error.message,
              stack: error.stack
            });
          }
        }

        skip += batchSize;
      }

      const executionTime = Date.now() - startTime;
      const endTimeFormatted = new Date().toISOString();
      
      logger.info('Scheduled job completed: subscription reconciliation', {
        jobName: 'reconciliation',
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        executionTimeMs: executionTime,
        batchesProcessed: stats.batchesProcessed,
        totalChecked: stats.totalChecked,
        mismatchesFound: stats.mismatchesFound,
        errors: stats.errors,
        success: stats.errors === 0
      });

      return stats;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const endTimeFormatted = new Date().toISOString();
      
      logger.error('Scheduled job failed: subscription reconciliation', {
        jobName: 'reconciliation',
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        executionTimeMs: executionTime,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Run scheduled plan change job
   * Processes scheduled plan changes that are due
   * 
   * @deprecated This job is now redundant. Razorpay handles scheduled changes
   * via schedule_change_at: 'cycle_end' parameter. This job is kept for
   * backward compatibility with any existing scheduledChange records that
   * were created before the Razorpay integration was implemented.
   * 
   * New scheduled changes are handled directly by Razorpay and processed
   * via subscription.updated webhook.
   */
  async runScheduledPlanChangeJob() {
    const startTime = Date.now();
    const startTimeFormatted = new Date().toISOString();
    
    logger.info('Scheduled job started: plan changes', {
      jobName: 'scheduledPlanChange',
      startTime: startTimeFormatted,
      schedule: 'every 6 hours'
    });

    let stats = {
      planChangesProcessed: 0,
      errors: 0,
      changesFound: 0
    };

    try {
      // Find subscriptions with scheduledChange.effectiveDate <= now
      const now = new Date();
      const subscriptions = await Subscription.find({
        'scheduledChange.effectiveDate': { $lte: now },
        'scheduledChange.newPlanId': { $exists: true }
      }).populate('planId scheduledChange.newPlanId');

      stats.changesFound = subscriptions.length;

      logger.info('Scheduled job: plan changes - found changes to process', {
        jobName: 'scheduledPlanChange',
        changesFound: subscriptions.length,
        checkDate: now.toISOString()
      });

      for (const subscription of subscriptions) {
        try {
          const oldPlan = subscription.planId;
          const newPlan = subscription.scheduledChange.newPlanId;

          // Fetch full plan details if not populated
          const newPlanDetails = newPlan._id ? newPlan : await Plan.findById(newPlan);

          if (!newPlanDetails) {
            throw new Error(`New plan not found: ${newPlan}`);
          }

          logger.info('Scheduled job: plan changes - processing change', {
            jobName: 'scheduledPlanChange',
            subscriptionId: subscription._id,
            razorpaySubscriptionId: subscription.razorpaySubscriptionId,
            userId: subscription.userId,
            oldPlanId: oldPlan._id,
            oldPlanName: oldPlan.name,
            newPlanId: newPlanDetails._id,
            newPlanName: newPlanDetails.name,
            changeType: subscription.scheduledChange.changeType,
            effectiveDate: subscription.scheduledChange.effectiveDate
          });

          // Update subscription.planId to scheduledChange.newPlanId
          subscription.planId = newPlanDetails._id;

          // Update billing details from new plan
          subscription.billing = {
            amount: newPlanDetails.pricing.amount,
            currency: newPlanDetails.pricing.currency,
            interval: newPlanDetails.pricing.interval,
            intervalCount: newPlanDetails.pricing.intervalCount
          };

          // Update Razorpay subscription with new plan_id
          try {
            await razorpay.subscriptions.update(
              subscription.razorpaySubscriptionId,
              {
                plan_id: newPlanDetails.razorpayPlanId,
                quantity: 1
              }
            );

            logger.info('Scheduled job: plan changes - Razorpay updated', {
              jobName: 'scheduledPlanChange',
              razorpaySubscriptionId: subscription.razorpaySubscriptionId,
              newRazorpayPlanId: newPlanDetails.razorpayPlanId
            });
          } catch (razorpayError) {
            logger.error('Scheduled job: plan changes - Razorpay update failed', {
              jobName: 'scheduledPlanChange',
              razorpaySubscriptionId: subscription.razorpaySubscriptionId,
              error: razorpayError.message,
              note: 'Continuing with local update'
            });
            // Continue with local update even if Razorpay update fails
          }

          // Record change in planChanges array
          subscription.planChanges.push({
            fromPlanId: oldPlan._id || oldPlan,
            toPlanId: newPlanDetails._id,
            changeType: subscription.scheduledChange.changeType,
            effectiveDate: new Date(),
            reason: subscription.scheduledChange.reason || 'Scheduled plan change'
          });

          // Clear scheduledChange field
          subscription.scheduledChange = undefined;

          await subscription.save();
          stats.planChangesProcessed++;

          logger.info('Scheduled job: plan changes - change completed', {
            jobName: 'scheduledPlanChange',
            subscriptionId: subscription._id,
            userId: subscription.userId,
            oldPlanName: oldPlan.name,
            newPlanName: newPlanDetails.name,
            changeType: subscription.scheduledChange?.changeType
          });
        } catch (error) {
          stats.errors++;
          logger.error('Scheduled job: plan changes - error processing change', {
            jobName: 'scheduledPlanChange',
            subscriptionId: subscription._id,
            userId: subscription.userId,
            error: error.message,
            stack: error.stack
          });
        }
      }

      const executionTime = Date.now() - startTime;
      const endTimeFormatted = new Date().toISOString();
      
      logger.info('Scheduled job completed: plan changes', {
        jobName: 'scheduledPlanChange',
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        executionTimeMs: executionTime,
        changesFound: stats.changesFound,
        planChangesProcessed: stats.planChangesProcessed,
        errors: stats.errors,
        success: stats.errors === 0
      });

      return stats;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const endTimeFormatted = new Date().toISOString();
      
      logger.error('Scheduled job failed: plan changes', {
        jobName: 'scheduledPlanChange',
        startTime: startTimeFormatted,
        endTime: endTimeFormatted,
        executionTimeMs: executionTime,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Map Razorpay subscription status to local status
   * @param {string} razorpayStatus - Razorpay subscription status
   * @returns {string} Local subscription status
   */
  mapRazorpayStatus(razorpayStatus) {
    const statusMap = {
      'created': 'created',
      'authenticated': 'authenticated',
      'active': 'active',
      'pending': 'pending',
      'halted': 'halted',
      'cancelled': 'cancelled',
      'completed': 'completed',
      'expired': 'expired',
      'paused': 'paused'
    };

    return statusMap[razorpayStatus] || razorpayStatus;
  }

  /**
   * Stop all scheduled jobs
   * Useful for graceful shutdown
   */
  stopAllJobs() {
    logger.info('Stopping all subscription jobs');

    for (const { name, job } of this.jobs) {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    }

    this.isInitialized = false;
    this.jobs = [];
  }

  /**
   * Get job status
   * @returns {Object} Status of all jobs
   */
  getJobStatus() {
    return {
      initialized: this.isInitialized,
      jobCount: this.jobs.length,
      jobs: this.jobs.map(({ name }) => ({ name }))
    };
  }
}

// Export singleton instance
const subscriptionJobs = new SubscriptionJobs();
module.exports = subscriptionJobs;
