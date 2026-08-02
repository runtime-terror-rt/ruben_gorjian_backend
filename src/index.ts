import { app } from "./app";
import { createServer } from "http";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";
import { schedulerWorker } from "./workers/scheduler";
import { cleanupWorker } from "./workers/cleanup";
import { logger } from "./lib/logger";
import { startPostQueueWorker } from "./modules/jobs/post-queue";
import { startBrandBriefReminderWorker } from "./modules/jobs/brand-brief-reminder-queue";
import { startSchedulerEmailQueueWorker } from "./modules/jobs/scheduler-email-queue";
import { syncPlansFromStripe, syncPlansToStripeFromDatabase } from "./lib/sync-plans";
import { initSocket } from "./lib/socket";
import "dotenv/config";

async function start() {
  const port = Number(env.PORT) || 4000;

  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database connection: ok");
  } catch (err) {
    logger.error("Database connection: failed", err);
  }

  // Bootstrap canonical plan products/prices into Stripe first.
  await syncPlansToStripeFromDatabase();

  // Sync plans from Stripe to database on startup
  await syncPlansFromStripe();

  // Start the scheduler worker
  schedulerWorker.start(1); // Check every 1 minute
  startPostQueueWorker(2);
  startBrandBriefReminderWorker(1);
  startSchedulerEmailQueueWorker(3);

  // Start the cleanup worker (runs daily)
  cleanupWorker.start(24); // Run every 24 hours

  const server = createServer(app);
  initSocket(server);

  server.listen(port, () => {
    logger.info(`API listening on port ${port}`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down gracefully");
    schedulerWorker.stop();
    cleanupWorker.stop();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logger.info("SIGINT received, shutting down gracefully");
    schedulerWorker.stop();
    cleanupWorker.stop();
    process.exit(0);
  });
}

start().catch((err) => {
  logger.error("Failed to start server", err);
});
