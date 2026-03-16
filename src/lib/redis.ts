import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (client) return client;
  if (!env.REDIS_URL) {
    logger.warn("REDIS_URL not set; queues will be disabled");
    return null;
  }
  client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  client.on("error", (err) => logger.error("Redis error", err));
  client.on("connect", () => logger.info("Redis connected"));
  return client;
}
