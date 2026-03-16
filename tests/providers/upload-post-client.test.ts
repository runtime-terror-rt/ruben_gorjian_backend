import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/env", () => ({
  env: {
    UPLOAD_POST_BASE_URL: "https://upload-post.test",
    UPLOAD_POST_CLIENT_ID: "client_id",
    UPLOAD_POST_CLIENT_SECRET: "client_secret",
  },
}));

import { UploadPostClient } from "../../src/modules/providers/upload-post/client";

describe("UploadPostClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends S3 media links to upload-posts endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ token: "jwt_token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job_id: "job_123", status: "processing" }),
      });
    vi.stubGlobal("fetch", fetchMock as any);

    const client = new UploadPostClient();
    const result = await client.publish({
      username: "talexia_user",
      platform: "FACEBOOK",
      text: "caption",
      mediaUrls: [
        { url: "https://bucket.s3.amazonaws.com/a.jpg", type: "image" },
        { url: "https://bucket.s3.amazonaws.com/b.jpg", type: "image" },
      ],
    });

    expect(result.identifier).toBe("job_123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const uploadCall = fetchMock.mock.calls[1];
    expect(uploadCall[0]).toContain("/uploadposts/upload_photos");
    const body = uploadCall[1]?.body as FormData;
    expect(body.get("user")).toBe("talexia_user");
    expect(body.get("platform[]")).toBe("facebook");
    expect(body.get("title")).toBe("caption");
    expect(body.get("photos[]")).toBe("https://bucket.s3.amazonaws.com/a.jpg");
  });
});
