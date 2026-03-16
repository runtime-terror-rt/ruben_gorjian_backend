import { AuthUser } from "./auth";
import type { Subscription, Plan } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      subscription?: Subscription & { plan: Plan };
    }
  }
}

export {};
