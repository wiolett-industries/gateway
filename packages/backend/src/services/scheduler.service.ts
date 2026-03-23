import cron, { type ScheduledTask } from 'node-cron';
import { createChildLogger } from '@/lib/logger.js';

const logger = createChildLogger('SchedulerService');

interface ScheduledJob {
  name: string;
  schedule: string; // cron expression
  task: () => Promise<void>;
  handle?: ScheduledTask;
}

interface IntervalJob {
  name: string;
  intervalMs: number;
  task: () => Promise<void>;
  handle?: ReturnType<typeof setInterval>;
}

export class SchedulerService {
  private jobs: ScheduledJob[] = [];
  private intervals: IntervalJob[] = [];

  register(name: string, schedule: string, task: () => Promise<void>): void {
    this.jobs.push({ name, schedule, task });
  }

  registerInterval(name: string, intervalMs: number, task: () => Promise<void>): void {
    this.intervals.push({ name, intervalMs, task });
  }

  start(): void {
    for (const job of this.jobs) {
      logger.info(`Starting scheduled job: ${job.name} (${job.schedule})`);
      job.handle = cron.schedule(job.schedule, async () => {
        logger.debug(`Running job: ${job.name}`);
        try {
          await job.task();
        } catch (error) {
          logger.error(`Job ${job.name} failed`, { error });
        }
      });
    }

    for (const interval of this.intervals) {
      logger.info(`Starting interval job: ${interval.name} (every ${interval.intervalMs}ms)`);
      interval.handle = setInterval(async () => {
        logger.debug(`Running interval job: ${interval.name}`);
        try {
          await interval.task();
        } catch (error) {
          logger.error(`Interval job ${interval.name} failed`, { error });
        }
      }, interval.intervalMs);
    }
  }

  stop(): void {
    for (const job of this.jobs) {
      job.handle?.stop();
      logger.info(`Stopped job: ${job.name}`);
    }

    for (const interval of this.intervals) {
      if (interval.handle) {
        clearInterval(interval.handle);
      }
      logger.info(`Stopped interval job: ${interval.name}`);
    }
  }
}
