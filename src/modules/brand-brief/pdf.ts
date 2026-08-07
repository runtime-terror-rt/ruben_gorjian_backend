import PDFDocument from "pdfkit";

type BrandBriefPdfInput = {
  id: string;
  referenceCode: string;
  planCode: string;
  planName: string;
  submittedByName: string;
  submittedByEmail: string;
  createdAt: Date;
  
  brandName: string;
  businessType: string;
  primaryLocation: string;
  websiteUrl?: string | null;
  industryCategory: string;

  brandStory: string;
  brandVoiceDescriptors: string[];
  targetAudience: string;
  taglines?: string | null;
  brandsYouAdmire?: string | null;
  whatToAvoid?: string | null;

  aestheticDirection: string[];
  preferredColorPalette?: string | null;
  stagingPreferences?: string | null;
  visualReferences?: string | null;

  productFocus: string[];
  typicalPriceRange?: string | null;
  keyCollections?: string | null;
  materialsCertifications: string;
  seasonalCalendar?: string | null;
  birthstoneTheming: string;

  sampleCaptions: string;
  captionTargeting: string;
  language: string;
  hashtagStyle: string;
  sensitiveTopics?: string | null;

  platforms: string[];
  timezone: string;
  preferredPostingDays: string[];
  preferredTimeWindows: string[];
  additionalPostingNotes?: string | null;
  timeCriticalDates?: string | null;
  platformAuthorizationContact?: string | null;

  googleDriveEmails: string;
  skuFilenameConvention?: string | null;
  productIdentificationNotes?: string | null;

  primaryContactName: string;
  primaryContactEmail: string;
  secondaryContactName?: string | null;
  secondaryContactEmail?: string | null;
  preferredCommunication: string;
  whatsappNumber?: string | null;

  authSignedAs: string;
  authOnBehalfOf: string;
  authSubmissionDate: Date;
  authTalexiaPlan: string;
  authIHaveReadAndAgree: boolean;
  agreedAuthorizationText: string;
};

type TableRow = {
  label: string;
  value: string;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LABEL_WIDTH = 168;
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH;
const CELL_PADDING = 8;
const ROW_MIN_HEIGHT = 28;

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatLongDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short'
  }).format(date);
  // Optional: Convert EST/EDT to ET
  return formatted.replace(/(EST|EDT)$/, "ET");
}

function valueOrNA(value?: string | null): string {
  return value?.trim() ? value.trim() : "N/A";
}

function formatList(values?: string[] | null): string {
  return values && values.length ? values.join(", ") : "N/A";
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  const titleHeight = 20;
  const boxTop = doc.y;
  doc.save();
  doc.rect(MARGIN, boxTop, CONTENT_WIDTH, titleHeight).fill("#0f172a");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(11);
  doc.text(title, MARGIN + 12, boxTop + 5, { width: CONTENT_WIDTH - 24, align: "left" });
  doc.restore();
  doc.moveDown(1.4);
}

function drawTableRow(doc: PDFKit.PDFDocument, row: TableRow, index: number) {
  const rowY = doc.y;
  const valueText = row.value || "N/A";
  const valueHeight = doc.heightOfString(valueText, {
    width: VALUE_WIDTH - CELL_PADDING * 2,
    align: "left",
  });
  const rowHeight = Math.max(ROW_MIN_HEIGHT, valueHeight + CELL_PADDING * 2);

  if (rowY + rowHeight > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
  }

  const currentY = doc.y;
  const alternate = index % 2 === 0;
  const labelFill = alternate ? "#f8fafc" : "#eef2f7";
  const valueFill = alternate ? "#ffffff" : "#f8fafc";

  doc.save();
  doc.rect(MARGIN, currentY, LABEL_WIDTH, rowHeight).fillAndStroke(labelFill, "#dbe3ee");
  doc.rect(MARGIN + LABEL_WIDTH, currentY, VALUE_WIDTH, rowHeight).fillAndStroke(valueFill, "#dbe3ee");
  doc.restore();

  doc.fillColor("#334155").font("Helvetica-Bold").fontSize(10);
  doc.text(row.label, MARGIN + CELL_PADDING, currentY + CELL_PADDING, {
    width: LABEL_WIDTH - CELL_PADDING * 2,
    height: rowHeight - CELL_PADDING * 2,
    align: "left",
  });

  doc.fillColor("#0f172a").font("Helvetica").fontSize(10);
  doc.text(valueText, MARGIN + LABEL_WIDTH + CELL_PADDING, currentY + CELL_PADDING, {
    width: VALUE_WIDTH - CELL_PADDING * 2,
    height: rowHeight - CELL_PADDING * 2,
    align: "left",
  });

  doc.y = currentY + rowHeight;
}

function drawTable(doc: PDFKit.PDFDocument, rows: TableRow[]) {
  rows.forEach((row, index) => drawTableRow(doc, row, index));
  doc.moveDown(0.7);
}

function drawSummaryBlock(doc: PDFKit.PDFDocument, input: BrandBriefPdfInput) {
  drawSectionTitle(doc, "Submission Summary");
  drawTable(doc, [
    { label: "Reference Code", value: input.referenceCode },
    { label: "Plan", value: input.planName },
    { label: "Submitted By", value: input.submittedByName === input.submittedByEmail ? input.submittedByEmail : `${input.submittedByName} <${input.submittedByEmail}>` },
    { label: "Created At", value: formatLongDate(input.createdAt) },
  ]);
}

export async function buildBrandBriefPdf(input: BrandBriefPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN });
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("Brand Brief Submission", { align: "left" });
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(`Reference Code: ${input.referenceCode}`, { align: "left" });
    doc.moveDown(0.35);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Prepared for Talexia internal review and client record keeping.");
    doc.moveDown(0.8);

    drawSummaryBlock(doc, input);

    drawSectionTitle(doc, "01. The Basics");
    drawTable(doc, [
      { label: "Brand Name", value: input.brandName },
      { label: "Business Type", value: input.businessType },
      { label: "Primary Location", value: input.primaryLocation },
      { label: "Website URL", value: valueOrNA(input.websiteUrl) },
      { label: "Industry Category", value: input.industryCategory },
    ]);

    drawSectionTitle(doc, "02. About Your Brand");
    drawTable(doc, [
      { label: "Brand Story", value: input.brandStory },
      { label: "Brand Voice", value: formatList(input.brandVoiceDescriptors) },
      { label: "Target Audience", value: input.targetAudience },
      { label: "Taglines", value: valueOrNA(input.taglines) },
      { label: "Brands You Admire", value: valueOrNA(input.brandsYouAdmire) },
      { label: "What To Avoid", value: valueOrNA(input.whatToAvoid) },
    ]);

    drawSectionTitle(doc, "03. Your Aesthetic");
    drawTable(doc, [
      { label: "Aesthetic Direction", value: formatList(input.aestheticDirection) },
      { label: "Preferred Color Palette", value: valueOrNA(input.preferredColorPalette) },
      { label: "Staging Preferences", value: valueOrNA(input.stagingPreferences) },
      { label: "Visual References", value: valueOrNA(input.visualReferences) },
    ]);

    drawSectionTitle(doc, "04. Your Product");
    drawTable(doc, [
      { label: "Product Focus", value: formatList(input.productFocus) },
      { label: "Typical Price Range", value: valueOrNA(input.typicalPriceRange) },
      { label: "Key Collections", value: valueOrNA(input.keyCollections) },
      { label: "Materials & Certs", value: input.materialsCertifications },
      { label: "Seasonal Calendar", value: valueOrNA(input.seasonalCalendar) },
      { label: "Birthstone Theming", value: input.birthstoneTheming },
    ]);

    drawSectionTitle(doc, "05. Captions & Voice");
    drawTable(doc, [
      { label: "Sample Captions", value: input.sampleCaptions },
      { label: "Caption Targeting", value: input.captionTargeting },
      { label: "Language", value: input.language },
      { label: "Hashtag Style", value: input.hashtagStyle },
      { label: "Sensitive Topics", value: valueOrNA(input.sensitiveTopics) },
    ]);

    drawSectionTitle(doc, "06. Publishing");
    drawTable(doc, [
      { label: "Platforms", value: formatList(input.platforms) },
      { label: "Timezone", value: input.timezone },
      { label: "Preferred Posting Days", value: formatList(input.preferredPostingDays) },
      { label: "Preferred Time Windows", value: formatList(input.preferredTimeWindows) },
      { label: "Additional Posting Notes", value: valueOrNA(input.additionalPostingNotes) },
      { label: "Time Critical Dates", value: valueOrNA(input.timeCriticalDates) },
      { label: "Platform Auth Contact", value: valueOrNA(input.platformAuthorizationContact) },
    ]);

    drawSectionTitle(doc, "07. Catalog & Source");
    drawTable(doc, [
      { label: "Google Drive Emails", value: input.googleDriveEmails },
      { label: "SKU/Filename Conv.", value: valueOrNA(input.skuFilenameConvention) },
      { label: "Product ID Notes", value: valueOrNA(input.productIdentificationNotes) },
    ]);

    drawSectionTitle(doc, "08. Operational");
    drawTable(doc, [
      { label: "Primary Contact Name", value: input.primaryContactName },
      { label: "Primary Contact Email", value: input.primaryContactEmail },
      { label: "Secondary Contact Name", value: valueOrNA(input.secondaryContactName) },
      { label: "Secondary Contact Email", value: valueOrNA(input.secondaryContactEmail) },
      { label: "Preferred Comm Method", value: input.preferredCommunication },
      { label: "WhatsApp Number", value: valueOrNA(input.whatsappNumber) },
    ]);

    drawSectionTitle(doc, "09. Publishing Authorization");
    drawTable(doc, [
      { label: "Signed As", value: input.authSignedAs },
      { label: "On Behalf Of Brand", value: input.authOnBehalfOf },
      { label: "Submission Date", value: formatDate(input.authSubmissionDate) },
      { label: "Talexia Plan", value: input.authTalexiaPlan },
      { label: "Has Read & Agreed", value: input.authIHaveReadAndAgree ? "Yes" : "No" },
    ]);

    doc.end();
  });
}
