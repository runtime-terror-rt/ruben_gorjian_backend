import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

/**
 * Cleanup worker for stale data
 * Runs periodic cleanup tasks like clearing stale pendingPlanCode values
 */
export class CleanupWorker {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the cleanup worker
   * @param intervalHours - How often to run cleanup (in hours). Default: 24 hours (daily)
   */
  start(intervalHours = 24) {
    if (this.isRunning) {
      logger.warn("Cleanup worker already running");
      return;
    }

    logger.info(`Starting cleanup worker (running every ${intervalHours} hours)`);
    this.isRunning = true;

    // Run immediately, then on interval
    this.runCleanup();
    
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, intervalHours * 60 * 60 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info("Cleanup worker stopped");
  }

  private async runCleanup() {
    try {
      logger.debug("Running cleanup tasks...");
      
      // Cleanup stale pendingPlanCode values (older than 30 days)
      await this.cleanupStalePendingPlanCodes();
      
      logger.debug("Cleanup tasks completed");
    } catch (error) {
      logger.error("Error in cleanup worker", error);
    }
  }

  /**
   * Clean up stale pendingPlanCode values
   * Removes pendingPlanCode from users who:
   * - Have had it for more than 30 days without completing checkout
   * - Have an active subscription (shouldn't have pendingPlanCode)
   */
  private async cleanupStalePendingPlanCodes() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Find users with pendingPlanCode who:
      // 1. Have an active subscription (shouldn't have pendingPlanCode)
      // 2. Have had pendingPlanCode set for more than 30 days without completing checkout
      const usersToCleanup = await prisma.user.findMany({
        where: {
          pendingPlanCode: { not: null },
          OR: [
            // Users with active subscriptions shouldn't have pendingPlanCode
            {
              subscriptions: {
                some: {
                  status: { in: ["ACTIVE", "TRIALING"] },
                },
              },
            },
            // Users where pendingPlanCode was set more than 30 days ago
            {
              pendingPlanCodeSetAt: { lt: thirtyDaysAgo },
            },
          ],
        },
        select: {
          id: true,
          email: true,
          pendingPlanCode: true,
          pendingPlanCodeSetAt: true,
        },
      });

      if (usersToCleanup.length === 0) {
        logger.debug("No stale pendingPlanCode values to clean up");
        return;
      }

      logger.info(`Found ${usersToCleanup.length} users with stale pendingPlanCode, cleaning up...`);

      const result = await prisma.user.updateMany({
        where: {
          id: { in: usersToCleanup.map((u) => u.id) },
        },
        data: {
          pendingPlanCode: null,
          pendingPlanCodeSetAt: null,
        },
      });

      logger.info(`Cleaned up ${result.count} stale pendingPlanCode values`, {
        cleanedCount: result.count,
        userIds: usersToCleanup.map((u) => u.id),
      });
    } catch (error) {
      logger.error("Error cleaning up stale pendingPlanCode values", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Create singleton instance
export const cleanupWorker = new CleanupWorker();



