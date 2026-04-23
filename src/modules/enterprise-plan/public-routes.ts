import express from "express";
import { prisma } from "../../lib/prisma";

const enterprisePlanPublicRouter = express.Router();

enterprisePlanPublicRouter.get("/enterprise-plan/invites/:planCode/details", async (req, res) => {
  const planCode = req.params.planCode.trim().toUpperCase();

  const invite = await prisma.enterprisePlanInvite.findFirst({
    where: { planCode },
    orderBy: { createdAt: "desc" },
    include: {
      proposal: true,
      createdUser: {
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          createdAt: true,
        },
      },
    },
  });

  if (!invite) {
    return res.status(404).json({ error: "Invite not found" });
  }

  const latestSubscription = invite.createdUserId
    ? await prisma.subscription.findFirst({
      where: {
        userId: invite.createdUserId,
        planCode: invite.planCode,
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        status: true,
        billingCycle: true,
        priceType: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    : null;

  return res.json({
    invite: {
      id: invite.id,
      email: invite.email,
      fullName: invite.fullName,
      companyName: invite.companyName,
      socialPlatforms: invite.socialPlatforms,
      planCode: invite.planCode,
      status: invite.status,
      expiresAt: invite.expiresAt,
      viewedAt: invite.viewedAt,
      signedUpAt: invite.signedUpAt,
      paidAt: invite.paidAt,
      sentByAdminEmail: invite.sentByAdminEmail,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
    },
    proposal: invite.proposal
      ? {
        id: invite.proposal.id,
        planName: invite.proposal.planName,
        amount: Number(invite.proposal.amount),
        billingCycle: invite.proposal.billingCycle,
        currency: invite.proposal.currency,
        status: invite.proposal.status,
        expiresAt: invite.proposal.expiresAt,
        viewedAt: invite.proposal.viewedAt,
        signedUpAt: invite.proposal.signedUpAt,
        paidAt: invite.proposal.paidAt,
      }
      : null,
    user: invite.createdUser,
    subscription: latestSubscription,
  });
});

export { enterprisePlanPublicRouter };
