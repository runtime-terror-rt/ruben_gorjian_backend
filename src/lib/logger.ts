type LogLevel = "debug" | "info" | "warn" | "error";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined) ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

function shouldLog(level: LogLevel) {
  return levelOrder[level] >= (levelOrder[configuredLevel] ?? levelOrder.info);
}

function formatError(meta: unknown) {
  if (meta instanceof Error) {
    return { message: meta.message, stack: meta.stack };
  }
  return meta;
}

function log(level: LogLevel, message: string, meta?: unknown) {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (meta !== undefined) {
    consoleFn(prefix, message, formatError(meta));
  } else {
    consoleFn(prefix, message);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => log("debug", message, meta),
  info: (message: string, meta?: unknown) => log("info", message, meta),
  warn: (message: string, meta?: unknown) => log("warn", message, meta),
  error: (message: string, meta?: unknown) => log("error", message, meta),
};
