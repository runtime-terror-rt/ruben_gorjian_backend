import { PostService } from "../modules/posts/service";
import { logger } from "../lib/logger";
import { enqueuePostPublish } from "../modules/jobs/post-queue";
import { UploadPostService } from "../modules/providers/upload-post/service";

const postService = new PostService();
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
    this.checkAndPublishDuePosts();
    
    this.intervalId = setInterval(() => {
      this.checkAndPublishDuePosts();
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

  private async checkAndPublishDuePosts() {
    try {
      logger.debug("Checking for due scheduled posts...");
      
      const duePostIds = await postService.getDueScheduledPosts();
      
      if (duePostIds.length === 0) {
        logger.debug("No due posts found");
      } else {
        logger.info(`Found ${duePostIds.length} due posts, enqueueing...`);

        for (const postId of duePostIds) {
          try {
            const enqueued = await enqueuePostPublish(postId);
            if (!enqueued) {
              // Fallback if queue is not configured
              logger.warn("Queue enqueue failed, publishing inline", { postId });
              const result = await postService.publishPost(postId);
              logger.info("Post published inline", { 
                postId, 
                allSuccessful: result.allSuccessful,
                anySuccessful: result.anySuccessful,
                targetCount: result.results.length
              });
            } else {
              logger.info("Post enqueued for publishing", { postId });
            }
          } catch (error) {
            logger.error("Error processing due post", { 
              postId, 
              error: error instanceof Error ? error.message : "Unknown error",
              stack: error instanceof Error ? error.stack : undefined
            });
          }
        }

        logger.info("Finished processing due posts", { 
          total: duePostIds.length,
          processed: duePostIds.length
        });
      }

      await uploadPostService.reconcilePendingJobs(100);
    } catch (error) {
      logger.error("Error in scheduler worker", error);
    }
  }
}

// Create singleton instance
export const schedulerWorker = new SchedulerWorker();
