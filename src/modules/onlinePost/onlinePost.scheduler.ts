import { SocialMediaService } from "./onlinePost.service";

export function startOnlinePostScheduler(service = new SocialMediaService()) {
  const intervalMs = 60_000;

  const timer = setInterval(() => {
    service.processDueScheduledPosts().catch(() => {
      // Swallow errors here; the service should persist failures and/or log upstream.
    });
  }, intervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}
