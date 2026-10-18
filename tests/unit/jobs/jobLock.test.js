const subscriptionJobs = require('../../../src/jobs/subscriptionJobs');

// With the HPA running 2-4 replicas, every pod fires the same cron schedule.
// These tests pin down that only one of them actually runs the job.
describe('subscription job lock', () => {
  it('lets only one replica take the lock for a run', async () => {
    const results = await Promise.all([
      subscriptionJobs.acquireJobLock('test-job'),
      subscriptionJobs.acquireJobLock('test-job'),
      subscriptionJobs.acquireJobLock('test-job')
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('can be taken again once the previous lock has expired', async () => {
    expect(await subscriptionJobs.acquireJobLock('expiring-job', 1)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await subscriptionJobs.acquireJobLock('expiring-job', 1)).toBe(true);
  });

  it('skips the run when another replica holds the lock', async () => {
    const run = jest.fn();
    await subscriptionJobs.acquireJobLock('held-job');

    await subscriptionJobs.runIfLockAcquired('held-job', run);

    expect(run).not.toHaveBeenCalled();
  });

  it('runs the job when the lock is free', async () => {
    const run = jest.fn();

    await subscriptionJobs.runIfLockAcquired('free-job', run);

    expect(run).toHaveBeenCalledTimes(1);
  });
});
