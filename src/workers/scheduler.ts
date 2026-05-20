import { logger } from "../lib/logger";
import { UploadPostService } from "../modules/providers/upload-post/service";

const uploadPostService = new UploadPostService();

export class SchedulerWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMinutes = 1) {
    if (this.isRunning) {
      logger.warn("Scheduler already running");
      return;
    }

    logger.info(`Starting scheduler worker (checking every ${intervalMinutes} minutes)`);
    this.isRunning = true;

    // Run immediately, then on interval
    this.runSchedulerMaintenance();

    this.intervalId = setInterval(() => {
      this.runSchedulerMaintenance();
    }, intervalMinutes * 60 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info("Scheduler worker stopped");
  }

  private async runSchedulerMaintenance() {
    try {
      logger.debug("Running scheduler maintenance without auto-publishing due posts");
      await uploadPostService.reconcilePendingJobs(100);
    } catch (error) {
      logger.error("Error in scheduler worker", error);
    }
  }
}

// Create singleton instance
export const schedulerWorker = new SchedulerWorker();
