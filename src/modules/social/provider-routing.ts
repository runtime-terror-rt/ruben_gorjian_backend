import { ProviderRoutingMode, PublishingProvider, SocialPlatform } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { UploadPostService } from "../providers/upload-post/service";

const uploadPostService = new UploadPostService();

export async function getProviderRoutingConfig(userId: string) {
  return prisma.providerRoutingConfig.findUnique({ where: { userId } });
}

export async function getGlobalPublishingRoutingConfig() {
  return prisma.globalPublishingRoutingConfig.findUnique({
    where: { id: "global" },
  });
}

export type EffectiveProviderRoutingMode =
  | "FORCE_NATIVE"
  | "FORCE_UPLOAD_POST";

export type EffectiveProviderRoutingConfig = {
  mode: EffectiveProviderRoutingMode;
  useInstagram: boolean;
  useFacebook: boolean;
  useLinkedin: boolean;
};

export class ProviderRoutingError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code = "PROVIDER_ROUTING_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.name = "ProviderRoutingError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeProviderRoutingMode(
  mode?: ProviderRoutingMode | null
): EffectiveProviderRoutingMode {
  if (mode === "FORCE_UPLOAD_POST") {
    return "FORCE_UPLOAD_POST";
  }
  return "FORCE_NATIVE";
}

export async function getEffectiveProviderRoutingConfig(
  userId: string
): Promise<EffectiveProviderRoutingConfig> {
  const [config, globalConfig] = await Promise.all([
    getProviderRoutingConfig(userId),
    getGlobalPublishingRoutingConfig(),
  ]);
  return {
    mode: normalizeProviderRoutingMode(config?.mode ?? globalConfig?.mode),
    useInstagram: config?.useInstagram ?? globalConfig?.useInstagram ?? true,
    useFacebook: config?.useFacebook ?? globalConfig?.useFacebook ?? true,
    useLinkedin: config?.useLinkedin ?? globalConfig?.useLinkedin ?? true,
  };
}

export async function ensureUserProviderRoutingConfig(userId: string) {
  const existing = await getProviderRoutingConfig(userId);
  if (existing) {
    return existing;
  }

  const globalConfig = await getGlobalPublishingRoutingConfig();
  return prisma.providerRoutingConfig.create({
    data: {
      userId,
      mode: normalizeProviderRoutingMode(globalConfig?.mode),
      useInstagram: globalConfig?.useInstagram ?? true,
      useFacebook: globalConfig?.useFacebook ?? true,
      useLinkedin: globalConfig?.useLinkedin ?? true,
    },
  });
}

export function isUploadPostEnabledForPlatform(
  platform: SocialPlatform,
  config?: {
    useInstagram: boolean;
    useFacebook: boolean;
    useLinkedin: boolean;
  } | null
) {
  if (!config) return true;
  if (platform === "INSTAGRAM") return config.useInstagram;
  if (platform === "FACEBOOK") return config.useFacebook;
  if (platform === "LINKEDIN") return config.useLinkedin;
  return false;
}

async function hasUploadPostPlatformConnection(userId: string, platform: SocialPlatform) {
  const placeholderPrefix = `upload-post:${platform.toLowerCase()}:`;
  const account = await prisma.socialAccount.findFirst({
    where: {
      userId,
      platform,
      externalAccountId: { startsWith: placeholderPrefix },
    },
    select: { id: true },
  });
  if (!account) return false;

  try {
    const verified = await uploadPostService.verifyPlatformConnected(userId, platform);
    return verified.confident && verified.connected;
  } catch {
    return false;
  }
}

export async function decidePublishingProvider(params: {
  userId: string;
  platform: SocialPlatform;
  nativeAllowed: boolean;
}): Promise<PublishingProvider> {
  const { userId, platform, nativeAllowed } = params;
  const config = await getEffectiveProviderRoutingConfig(userId);
  const uploadPostEnabled = isUploadPostEnabledForPlatform(platform, config);
  const uploadPostConnected = uploadPostEnabled
    ? await hasUploadPostPlatformConnection(userId, platform)
    : false;

  if (config.mode === "FORCE_NATIVE") {
    if (!nativeAllowed) {
      throw new ProviderRoutingError(
        `Publishing channel is locked to Default for ${platform}. Connect this platform via Default OAuth in Social Connections or ask an admin to switch posting channel.`,
        "ROUTING_MODE_INCOMPATIBLE",
        { mode: config.mode, platform }
      );
    }
    return PublishingProvider.NATIVE;
  }

  if (!uploadPostEnabled) {
    throw new ProviderRoutingError(
      `Publishing channel is locked to Upload-Post, but ${platform} is disabled in routing settings. Ask an admin to enable this platform.`,
      "ROUTING_MODE_INCOMPATIBLE",
      { mode: config.mode, platform }
    );
  }
  if (!uploadPostConnected) {
    throw new ProviderRoutingError(
      `Publishing channel is locked to Upload-Post for ${platform}, but no Upload-Post connection exists. Connect this platform from Social Connections or ask an admin to switch posting channel.`,
      "ROUTING_MODE_INCOMPATIBLE",
      { mode: config.mode, platform }
    );
  }

  return PublishingProvider.UPLOAD_POST;
}
