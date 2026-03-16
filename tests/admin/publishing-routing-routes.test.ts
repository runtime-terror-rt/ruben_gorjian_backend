import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

type RoutingMode = "FORCE_NATIVE" | "FORCE_UPLOAD_POST" | "AUTO";

type ConfigRow = {
  userId: string;
  mode: RoutingMode;
  useInstagram: boolean;
  useFacebook: boolean;
  useLinkedin: boolean;
};

type UserRow = {
  id: string;
  role: "USER" | "ADMIN" | "SUPER_ADMIN";
  status: "ACTIVE" | "BLOCKED" | "DELETED";
  deletedAt: Date | null;
};

const store = vi.hoisted(() => ({
  configs: [] as ConfigRow[],
  users: [] as UserRow[],
  globalConfig: {
    id: "global",
    mode: "FORCE_NATIVE" as RoutingMode,
    useInstagram: true,
    useFacebook: true,
    useLinkedin: true,
  },
}));

function matchUserWhere(user: UserRow, where: any) {
  if (!where) return true;
  if (where.role && user.role !== where.role) return false;
  if (where.deletedAt === null && user.deletedAt !== null) return false;
  if (where.status?.not && user.status === where.status.not) return false;
  return true;
}

const prismaMock = vi.hoisted(() => ({
  providerRoutingConfig: {
    findUnique: vi.fn(async ({ where }: any) => {
      const row = store.configs.find((cfg) => cfg.userId === where.userId);
      return row ? { id: `routing_${row.userId}`, ...row } : null;
    }),
    findMany: vi.fn(async ({ where, select }: any) => {
      let rows = [...store.configs];
      if (where?.userId?.in) {
        const ids = new Set<string>(where.userId.in);
        rows = rows.filter((row) => ids.has(row.userId));
      }
      if (select?.userId) {
        return rows.map((row) => ({ userId: row.userId }));
      }
      return rows.map((row) => ({ id: `routing_${row.userId}`, ...row }));
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const idx = store.configs.findIndex((cfg) => cfg.userId === where.userId);
      if (idx === -1) {
        const row: ConfigRow = {
          userId: create.userId,
          mode: create.mode,
          useInstagram: create.useInstagram,
          useFacebook: create.useFacebook,
          useLinkedin: create.useLinkedin,
        };
        store.configs.push(row);
        return { id: `routing_${row.userId}`, ...row };
      }
      store.configs[idx] = {
        ...store.configs[idx],
        ...update,
      };
      return { id: `routing_${store.configs[idx].userId}`, ...store.configs[idx] };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const ids = new Set<string>(where.userId.in);
      let count = 0;
      store.configs = store.configs.map((row) => {
        if (!ids.has(row.userId)) return row;
        count += 1;
        return { ...row, ...data };
      });
      return { count };
    }),
    createMany: vi.fn(async ({ data }: any) => {
      let count = 0;
      for (const row of data as ConfigRow[]) {
        const exists = store.configs.some((cfg) => cfg.userId === row.userId);
        if (exists) continue;
        store.configs.push({ ...row });
        count += 1;
      }
      return { count };
    }),
  },
  globalPublishingRoutingConfig: {
    findUnique: vi.fn(async () => ({ ...store.globalConfig })),
    upsert: vi.fn(async ({ create, update }: any) => {
      store.globalConfig = {
        ...store.globalConfig,
        ...(create ?? {}),
        ...(update ?? {}),
      };
      return { ...store.globalConfig };
    }),
  },
  user: {
    findMany: vi.fn(async ({ where, select }: any) => {
      const rows = store.users.filter((user) => matchUserWhere(user, where));
      return rows.map((user) => {
        if (select?.providerRoutingConfig) {
          const cfg = store.configs.find((row) => row.userId === user.id) ?? null;
          return { id: user.id, providerRoutingConfig: cfg ? { mode: cfg.mode } : null };
        }
        return { id: user.id };
      });
    }),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({ id: "audit_1" }),
  },
  $transaction: vi.fn(async (ops: Array<Promise<any>>) => Promise.all(ops)),
}));

vi.mock("../../src/middleware/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.user = { id: "admin_1", email: "admin@example.com", role };
    next();
  },
}));

vi.mock("../../src/lib/prisma", () => ({
  prisma: prismaMock,
}));

import { adminRouter } from "../../src/modules/admin/routes";

describe("admin publishing routing API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.configs = [];
    store.users = [
      { id: "user_1", role: "USER", status: "ACTIVE", deletedAt: null },
      { id: "user_2", role: "USER", status: "ACTIVE", deletedAt: null },
      { id: "admin_2", role: "ADMIN", status: "ACTIVE", deletedAt: null },
      { id: "deleted_1", role: "USER", status: "DELETED", deletedAt: new Date() },
    ];
    store.globalConfig = {
      id: "global",
      mode: "FORCE_NATIVE",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    };
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminRouter);
    return app;
  }

  it("requires admin authentication", async () => {
    const res = await request(buildApp()).get("/api/admin/users/user_1/publishing-routing");

    expect(res.status).toBe(401);
  });

  it("rejects invalid mode payload", async () => {
    const res = await request(buildApp())
      .put("/api/admin/users/user_1/publishing-routing")
      .set("x-test-role", "ADMIN")
      .send({ mode: "AUTO" });

    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toContain("Invalid payload");
  });

  it("persists routing config across PUT and subsequent GET", async () => {
    const app = buildApp();

    const putRes = await request(app)
      .put("/api/admin/users/user_1/publishing-routing")
      .set("x-test-role", "ADMIN")
      .send({
        mode: "FORCE_UPLOAD_POST",
        useInstagram: true,
        useFacebook: false,
        useLinkedin: true,
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.mode).toBe("FORCE_UPLOAD_POST");

    const getRes = await request(app)
      .get("/api/admin/users/user_1/publishing-routing")
      .set("x-test-role", "SUPER_ADMIN");

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: false,
      useLinkedin: true,
    });
  });

  it("normalizes legacy AUTO mode to FORCE_NATIVE on GET", async () => {
    store.configs.push({
      userId: "user_1",
      mode: "AUTO",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });

    const res = await request(buildApp())
      .get("/api/admin/users/user_1/publishing-routing")
      .set("x-test-role", "ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("FORCE_NATIVE");
  });

  it("applies global routing switch to general users only", async () => {
    store.configs.push({
      userId: "user_1",
      mode: "FORCE_NATIVE",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });

    const res = await request(buildApp())
      .put("/api/admin/publishing-routing/global")
      .set("x-test-role", "ADMIN")
      .send({
        mode: "FORCE_UPLOAD_POST",
        applyTo: "USERS_ONLY",
        useInstagram: true,
        useFacebook: false,
        useLinkedin: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.targetUsersCount).toBe(2);

    const user1 = store.configs.find((cfg) => cfg.userId === "user_1");
    const user2 = store.configs.find((cfg) => cfg.userId === "user_2");
    const admin2 = store.configs.find((cfg) => cfg.userId === "admin_2");

    expect(user1?.mode).toBe("FORCE_UPLOAD_POST");
    expect(user2?.mode).toBe("FORCE_UPLOAD_POST");
    expect(admin2).toBeUndefined();
    expect(user1?.useFacebook).toBe(false);
    expect(store.globalConfig.mode).toBe("FORCE_UPLOAD_POST");
  });

  it("returns global summary counts for users", async () => {
    store.configs.push({
      userId: "user_1",
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    });

    const res = await request(buildApp())
      .get("/api/admin/publishing-routing/global")
      .set("x-test-role", "ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(2);
    expect(res.body.modeCounts).toMatchObject({
      FORCE_UPLOAD_POST: 1,
      FORCE_NATIVE: 1,
    });
  });

  it("uses global default mode in summary for users without per-user config", async () => {
    store.globalConfig = {
      id: "global",
      mode: "FORCE_UPLOAD_POST",
      useInstagram: true,
      useFacebook: true,
      useLinkedin: true,
    };
    store.configs = [];

    const res = await request(buildApp())
      .get("/api/admin/publishing-routing/global")
      .set("x-test-role", "ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(2);
    expect(res.body.modeCounts).toMatchObject({
      FORCE_UPLOAD_POST: 2,
      FORCE_NATIVE: 0,
    });
  });
});
