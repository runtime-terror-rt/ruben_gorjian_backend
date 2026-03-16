import express from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/requireAuth";

const router = express.Router();

router.use(requireAuth);

router.get("/overview", async (req, res) => {
  const userId = req.user!.id;

  const recentActivity = await prisma.recentActivity.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // Seed a minimal activity if none exists yet to avoid empty UI.
  const activity =
    recentActivity.length > 0
      ? recentActivity
      : [
          {
            id: "seed",
            userId,
            type: "login",
            title: "Welcome to Talexia",
            description: "Your workspace is ready.",
            createdAt: new Date(),
          },
        ];

  res.json({
    metrics: {
      leadsThisWeek: 0,
      conversionRate: 0,
    },
    recentActivity: activity.map((a: any) => ({
      id: a.id,
      type: a.type as any,
      title: a.title,
      description: a.description ?? "",
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

export { router as dashboardRouter };
