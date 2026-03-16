import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function authHeader() {
  const key = required("UPLOAD_POST_API_KEY");
  if (/^apikey\s+/i.test(key) || /^bearer\s+/i.test(key)) return key;
  return `ApiKey ${key}`;
}

function resolveBaseUrl() {
  const raw = (process.env.UPLOAD_POST_BASE_URL || "").trim();
  if (!raw) return "https://api.upload-post.com/api";
  if (raw === "https://upload-post.com" || raw === "https://www.upload-post.com") {
    return "https://api.upload-post.com/api";
  }
  if (raw.endsWith("/api")) return raw.replace(/\/$/, "");
  return raw.replace(/\/$/, "");
}

async function api(path: string, init: RequestInit = {}) {
  const base = resolveBaseUrl();
  const headers = new Headers(init.headers);
  headers.set("Authorization", authHeader());

  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // leave text
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  const command = process.argv[2] || "me";

  if (command === "me") {
    const data = await api("/uploadposts/me");
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "create-user") {
    const username = required("UPLOAD_POST_TEST_USERNAME");
    const data = await api("/uploadposts/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "connect-link") {
    const username = required("UPLOAD_POST_TEST_USERNAME");
    const redirectUrl = required("UPLOAD_POST_TEST_REDIRECT_URL");
    const platform = (process.env.UPLOAD_POST_TEST_PLATFORM || "instagram").toLowerCase();
    const data = await api("/uploadposts/users/generate-jwt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        platforms: [platform],
        redirect_url: redirectUrl,
        show_calendar: false,
      }),
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "publish-url") {
    const username = required("UPLOAD_POST_TEST_USERNAME");
    const mediaUrl = required("UPLOAD_POST_TEST_MEDIA_URL");
    const platform = (process.env.UPLOAD_POST_TEST_PLATFORM || "instagram").toLowerCase();
    const title = process.env.UPLOAD_POST_TEST_TITLE || "Talexia smoke test post";

    const form = new FormData();
    form.append("user", username);
    form.append("platform[]", platform);
    form.append("title", title);
    form.append("status", "active");
    form.append("video", mediaUrl);
    form.append("async_upload", "true");

    const data = await api("/uploadposts/upload", {
      method: "POST",
      body: form,
    });
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "status") {
    const jobId = process.env.UPLOAD_POST_TEST_JOB_ID;
    const requestId = process.env.UPLOAD_POST_TEST_REQUEST_ID;
    if (!jobId && !requestId) {
      throw new Error("Set UPLOAD_POST_TEST_JOB_ID or UPLOAD_POST_TEST_REQUEST_ID");
    }
    const query = jobId ? `job_id=${encodeURIComponent(jobId)}` : `request_id=${encodeURIComponent(String(requestId))}`;
    const data = await api(`/uploadposts/status?${query}`);
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
