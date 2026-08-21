import { prisma } from "./src/lib/prisma";

async function main() {
  const userId = "cmsiowxwz0021z610vpogbrs1";

  const draftPost = await prisma.post.count({ where: { userId, status: "DRAFT" } });
  const scheduledPost = await prisma.post.count({ where: { userId, status: "SCHEDULED" } });
  const publishingPost = await prisma.post.count({ where: { userId, status: "PUBLISHING" } });
  const failedPost = await prisma.post.count({ where: { userId, status: "FAILED" } });
  const postedTarget = await prisma.postTarget.count({ where: { post: { userId }, status: "POSTED" } });

  const scheduledOnlinePost = await prisma.scheduledPost.count({ where: { userId, status: "PENDING" } });
  const failedOnlinePost = await prisma.scheduledPost.count({ where: { userId, status: "FAILED" } });
  const postedOnlinePost = await prisma.scheduledPost.count({ where: { userId, status: "POSTED" } });

  console.log("=== EXACT COUNTS FOR USER: mas.ud.softvenceomega@gmail.com ===");
  console.log(`TOTAL DRAFTS: ${draftPost}`);
  console.log(`TOTAL SCHEDULED (Old Post + New ScheduledPost): ${scheduledPost} + ${scheduledOnlinePost} = ${scheduledPost + scheduledOnlinePost}`);
  console.log(`TOTAL PUBLISHING: ${publishingPost}`);
  console.log(`TOTAL FAILED (Old Post + New ScheduledPost): ${failedPost} + ${failedOnlinePost} = ${failedPost + failedOnlinePost}`);
  console.log(`TOTAL POSTED (All Time, PostTarget + New ScheduledPost): ${postedTarget} + ${postedOnlinePost} = ${postedTarget + postedOnlinePost}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
