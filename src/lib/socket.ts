import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { verifyAccessToken } from "../utils/tokens";
import { logger } from "./logger";

type PostStatusPayload = {
  postId: string;
  status: "published" | "failed" | "scheduled" | "processing";
  platform?: string;
  error?: string;
  updatedAt?: string;
};

let io: Server | null = null;

function parseCookie(header?: string) {
  if (!header) return {};
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [key, ...value] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(value.join("="));
    return acc;
  }, {});
}

function getAllowedOrigins() {
  const raw = env.FRONTEND_URL || "http://localhost:3000";
  return raw.split(",").map((origin) => origin.trim());
}

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token as string | undefined;
    const cookies = parseCookie(socket.handshake.headers.cookie);
    const token = authToken || cookies.token || cookies["auth-token"];
    if (!token) return next(new Error("Unauthorised"));
    const user = verifyAccessToken(token);
    if (!user) return next(new Error("Unauthorised"));
    socket.data.userId = user.id;
    socket.join(`user:${user.id}`);
    return next();
  });

  io.on("connection", (socket) => {
    logger.info("Socket connected", {
      socketId: socket.id,
      userId: socket.data.userId,
    });
  });

  return io;
}

export function emitPostStatusChanged(userId: string, payload: PostStatusPayload) {
  if (!io) return;
  io.to(`user:${userId}`).emit("post:status_changed", payload);
}

export function emitNotification(
  userId: string,
  payload: { type: "success" | "error" | "info"; message: string }
) {
  if (!io) return;
  io.to(`user:${userId}`).emit("notification", payload);
}
