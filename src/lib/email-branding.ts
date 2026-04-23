import fs from "fs";
import path from "path";

const logoFilePath = path.resolve(process.cwd(), "public/logo/Talexia_logo.png");
const logoCid = "talexia-logo-inline";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getTalexiaLogoAttachment() {
  if (!fs.existsSync(logoFilePath)) {
    return null;
  }

  return {
    filename: "Talexia_logo.png",
    path: logoFilePath,
    cid: logoCid,
    contentDisposition: "inline" as const,
  };
}

export function buildTalexiaEmailHeader(eyebrow: string, title?: string) {
  const logoMarkup = fs.existsSync(logoFilePath)
    ? `<img src="cid:${logoCid}" alt="Talexia" style="display:block;width:96px;max-width:100%;height:auto;" />`
    : `<div style="color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.04em;line-height:1;">Talexia</div>`;

  return `
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#111827 60%,#1f2937 100%);padding:28px 40px;text-align:left;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">${logoMarkup}</td>
                <td style="vertical-align:middle;text-align:right;">
                  <span style="display:inline-block;padding:6px 12px;border:1px solid rgba(148,163,184,0.35);border-radius:999px;color:#cbd5e1;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(eyebrow)}</span>
                </td>
              </tr>
            </table>
            ${title ? `<p style="margin:16px 0 0;color:#e2e8f0;font-size:15px;line-height:1.5;">${escapeHtml(title)}</p>` : ""}
          </td>
        </tr>`;
}