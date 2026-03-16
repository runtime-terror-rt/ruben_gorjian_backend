import { Queue, Worker, JobsOptions } from "bullmq";
import { getRedis } from "../../lib/redis";
import { PostService } from "../posts/service";
import { logger } from "../../lib/logger";

const redis = getRedis();

export const postQueue =
  redis &&
  new Queue("post-publish", {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

// Worker to process publish jobs
export function startPostQueueWorker(concurrency = 2) {
  if (!redis) {
    logger.warn("Redis not configured; post queue worker not started");
    return;
  }

  const postService = new PostService();

  const worker = new Worker(
    "post-publish",
    async (job) => {
      const postId = job.data.postId as string;
      const result = await postService.publishPost(postId);
      return result;
    },
    {
      connection: redis,
      concurrency,
    }
  );

  worker.on("completed", (job, result) => {
    logger.info(`Post publish job completed`, { 
      id: job.id, 
      name: job.name,
      postId: job.data.postId,
      allSuccessful: result?.allSuccessful,
      anySuccessful: result?.anySuccessful,
      targetCount: result?.results?.length
    });
  });
  worker.on("failed", (job, err) => {
    logger.error(`Post publish job failed`, { 
      id: job?.id, 
      postId: job?.data?.postId,
      error: err?.message || "Unknown error",
      stack: err?.stack
    });
  });

  logger.info("Post publish worker started");
}

export async function enqueuePostPublish(postId: string, opts?: JobsOptions) {
  if (!postQueue) {
    logger.warn("Redis not configured; skipping enqueue");
    return false;
  }
  await postQueue.add("publish", { postId }, opts);
  return true;
}
