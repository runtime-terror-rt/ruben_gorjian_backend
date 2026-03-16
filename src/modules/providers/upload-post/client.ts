import { env } from "../../../config/env";

type UploadPostStatus = "processing" | "scheduled" | "posted" | "partially_posted" | "failed";

export type UploadPostJobResult = {
  identifierType: "JOB_ID" | "REQUEST_ID";
  identifier: string;
  status: UploadPostStatus | "unknown";
  message?: string;
  raw: unknown;
};

class UploadPostApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "UploadPostApiError";
    this.status = status;
  }
}

export class UploadPostClient {
  private baseUrl = this.resolveBaseUrl(env.UPLOAD_POST_BASE_URL);
  private jwtToken: string | null = null;
  private jwtExpiresAt = 0;

  private resolveBaseUrl(configured?: string) {
    const value = (configured || "").trim();
    if (!value) return "https://api.upload-post.com/api";
    if (value === "https://upload-post.com" || value === "https://www.upload-post.com") {
      return "https://api.upload-post.com/api";
    }
    if (value.endsWith("/api")) return value.replace(/\/$/, "");
    return value.replace(/\/$/, "");
  }

  private normalizePlatform(platform: "INSTAGRAM" | "FACEBOOK" | "LINKEDIN") {
    return platform.toLowerCase();
  }

  private async getJwtToken() {
    if (this.jwtToken && Date.now() < this.jwtExpiresAt - 30_000) {
      return this.jwtToken;
    }

    if (!env.UPLOAD_POST_CLIENT_ID || !env.UPLOAD_POST_CLIENT_SECRET) {
      throw new Error("UPLOAD_POST credentials are not configured");
    }

    const url = `${this.baseUrl}/generate-jwt-token`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.UPLOAD_POST_CLIENT_ID,
        client_secret: env.UPLOAD_POST_CLIENT_SECRET,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok || !data?.token) {
      throw new Error(data?.message || "Failed to generate Upload-Post token");
    }

    this.jwtToken = data.token;
    this.jwtExpiresAt = Date.now() + 55 * 60 * 1000;
    return this.jwtToken;
  }

  private async authHeaders() {
    const headers = new Headers();
    const apiKey = env.UPLOAD_POST_API_KEY?.trim();
    if (apiKey) {
      if (/^apikey\s+/i.test(apiKey) || /^bearer\s+/i.test(apiKey)) {
        headers.set("Authorization", apiKey);
      } else {
        headers.set("Authorization", `ApiKey ${apiKey}`);
      }
      return headers;
    }

    const token = await this.getJwtToken();
    headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  private async api(path: string, options: RequestInit = {}, retry = true): Promise<any> {
    const headers = await this.authHeaders();
    const mergedHeaders = new Headers(options.headers);
    headers.forEach((value, key) => {
      mergedHeaders.set(key, value);
    });

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: mergedHeaders,
    });

    if (res.status === 401 && retry && !env.UPLOAD_POST_API_KEY) {
      this.jwtToken = null;
      return this.api(path, options, false);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) throw new UploadPostApiError(data?.message || `Upload-Post API failed: ${res.status}`, res.status);
    return data;
  }

  async ensureProfile(username: string) {
    try {
      return await this.api(`/uploadposts/users/${encodeURIComponent(username)}`, {
        method: "GET",
      });
    } catch (error) {
      if (!(error instanceof UploadPostApiError) || error.status !== 404) {
        throw error;
      }
      return this.api("/uploadposts/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
    }
  }

  /** Optional branding params per https://docs.upload-post.com/api/user-profiles/ */
  getConnectUrl(
    username: string,
    platform: "INSTAGRAM" | "FACEBOOK" | "LINKEDIN",
    redirectUrl: string,
    options?: {
      logo_image?: string;
      connect_title?: string;
      connect_description?: string;
      redirect_button_text?: string;
    }
  ) {
    const body: Record<string, unknown> = {
      username,
      platforms: [this.normalizePlatform(platform)],
      redirect_url: redirectUrl,
      show_calendar: false,
    };
    if (options?.logo_image?.trim()) body.logo_image = options.logo_image.trim();
    if (options?.connect_title?.trim()) body.connect_title = options.connect_title.trim();
    if (options?.connect_description?.trim()) body.connect_description = options.connect_description.trim();
    if (options?.redirect_button_text?.trim()) body.redirect_button_text = options.redirect_button_text.trim();
    return this.api("/uploadposts/users/generate-jwt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async getUserProfile(username: string) {
    return this.api(`/uploadposts/users/${encodeURIComponent(username)}`, {
      method: "GET",
    });
  }

  async publish(params: {
    username: string;
    platform: "INSTAGRAM" | "FACEBOOK" | "LINKEDIN";
    text: string;
    mediaUrls: Array<{ url: string; type: "image" | "video" }>;
  }): Promise<UploadPostJobResult> {
    const { username, platform, text, mediaUrls } = params;
    const normalized = this.normalizePlatform(platform);
    const cleanedMediaUrls = mediaUrls
      .map((item) => ({ url: item.url.trim(), type: item.type }))
      .filter((item) => item.url.length > 0);
    const imageUrls = cleanedMediaUrls.filter((item) => item.type === "image").map((item) => item.url);
    const videoUrls = cleanedMediaUrls.filter((item) => item.type === "video").map((item) => item.url);

    const form = new FormData();
    form.append("user", username);
    form.append("platform[]", normalized);
    form.append("title", text);
    form.append("status", "active");
    form.append("async_upload", "true");

    // Upload-Post Core Upload APIs: /api/upload_photos, /api/upload_videos, /api/upload_text (not under uploadposts/)
    // See https://docs.upload-post.com/api/reference
    let endpoint: string;
    if (videoUrls.length > 0) {
      endpoint = "/upload_videos";
      form.append("video", videoUrls[0]);
    } else if (imageUrls.length > 0) {
      endpoint = "/upload_photos";
      for (const imageUrl of imageUrls) {
        // Upload-Post supports URL values in file params for remote fetch.
        form.append("photos[]", imageUrl);
      }
    } else {
      endpoint = "/upload_text";
      form.append("text", text);
    }

    const payload = await this.api(endpoint, {
      method: "POST",
      body: form,
    });
    return this.extractJobResult(payload);
  }

  async getJobStatus(identifierType: "JOB_ID" | "REQUEST_ID", identifier: string) {
    const url = new URL("/uploadposts/status", this.baseUrl);
    if (identifierType === "REQUEST_ID") {
      url.searchParams.set("request_id", identifier);
    } else {
      url.searchParams.set("job_id", identifier);
    }
    const payload = await this.api(`${url.pathname}${url.search}`, {
      method: "GET",
    });
    return this.extractJobResult(payload);
  }

  async getMe() {
    return this.api("/uploadposts/me", { method: "GET" });
  }

  private extractJobResult(payload: any): UploadPostJobResult {
    const identifier =
      payload?.job_id ||
      payload?.request_id ||
      payload?.data?.job_id ||
      payload?.data?.request_id ||
      payload?.id;
    const identifierType: "JOB_ID" | "REQUEST_ID" = payload?.job_id || payload?.data?.job_id
      ? "JOB_ID"
      : "REQUEST_ID";
    const status = (payload?.status ||
      payload?.data?.status ||
      payload?.post_status ||
      "unknown") as UploadPostJobResult["status"];

    if (!identifier) {
      throw new Error("Upload-Post response did not include job/request identifier");
    }
    return {
      identifierType,
      identifier: String(identifier),
      status,
      message: payload?.message || payload?.data?.message,
      raw: payload,
    };
  }
}
