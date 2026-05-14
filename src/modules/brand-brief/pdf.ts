import PDFDocument from "pdfkit";

type BrandBriefPdfInput = {
  id: string;
  planCode: string;
  planName: string;
  submittedByName: string;
  submittedByEmail: string;
  restaurantName: string;
  location: string;
  businessType: string;
  cuisineType: string;
  dietaryCertifications: string[];
  websiteUrl?: string | null;
  instagramHandle: string;
  facebookPageUrl?: string | null;
  tiktokHandle?: string | null;
  onlineOrderingUrl?: string | null;
  foodDescription: string;
  uniqueSellingPoint: string;
  customerReviews: string;
  forbiddenPhrases?: string | null;
  preferredPhrases?: string | null;
  captionSample1: string;
  captionSample2: string;
  captionSample3: string;
  toneAndVoice: string[];
  captionTargeting: string;
  language: string;
  signatureDishes: string[];
  signatureDishDetails: string;
  excludedItems?: string | null;
  upcomingPromotions?: string | null;
  hashtagStyle: string;
  confirmMinDishes: string;
  actionShotsPossible?: string | null;
  preferredShootTime?: string | null;
  physicalConstraints?: string | null;
  specialNotes?: string | null;
  clientName: string;
  restaurantNameAuth: string;
  submissionDate: Date;
  talexiaPlan: string;
  createdAt: Date;
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
  return date.toISOString().slice(0, 10);
}

function formatLongDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
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
    { label: "Submission ID", value: input.id },
    { label: "Plan", value: `${input.planName} (${input.planCode})` },
    { label: "Submitted By", value: `${input.submittedByName} <${input.submittedByEmail}>` },
    { label: "Created At", value: formatLongDate(input.createdAt) },
    { label: "Submission Date", value: formatDate(input.submissionDate) },
    { label: "Talexia Plan", value: input.talexiaPlan },
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
    doc.moveDown(0.35);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Prepared for Talexia internal review and client record keeping.");
    doc.moveDown(0.8);

    drawSummaryBlock(doc, input);

    drawSectionTitle(doc, "01. Brand Identity");
    drawTable(doc, [
      { label: "Restaurant Name", value: input.restaurantName },
      { label: "Location", value: input.location },
      { label: "Business Type", value: input.businessType },
      { label: "Cuisine Type", value: input.cuisineType },
      { label: "Dietary Certifications", value: formatList(input.dietaryCertifications) },
    ]);

    drawSectionTitle(doc, "02. Online Presence");
    drawTable(doc, [
      { label: "Website URL", value: valueOrNA(input.websiteUrl) },
      { label: "Instagram Handle", value: input.instagramHandle },
      { label: "Facebook Page URL", value: valueOrNA(input.facebookPageUrl) },
      { label: "TikTok Handle", value: valueOrNA(input.tiktokHandle) },
      { label: "Online Ordering URL", value: valueOrNA(input.onlineOrderingUrl) },
    ]);

    drawSectionTitle(doc, "03. Brand Voice");
    drawTable(doc, [
      { label: "Food Description", value: input.foodDescription },
      { label: "Unique Selling Point", value: input.uniqueSellingPoint },
      { label: "Customer Reviews", value: input.customerReviews },
      { label: "Forbidden Phrases", value: valueOrNA(input.forbiddenPhrases) },
      { label: "Preferred Phrases", value: valueOrNA(input.preferredPhrases) },
      { label: "Caption Sample 1", value: input.captionSample1 },
      { label: "Caption Sample 2", value: input.captionSample2 },
      { label: "Caption Sample 3", value: input.captionSample3 },
      { label: "Tone And Voice", value: formatList(input.toneAndVoice) },
      { label: "Caption Targeting", value: input.captionTargeting },
      { label: "Language", value: input.language },
    ]);

    drawSectionTitle(doc, "04. Menu & Content Priorities");
    drawTable(doc, [
      { label: "Signature Dishes", value: formatList(input.signatureDishes) },
      { label: "Signature Dish Details", value: input.signatureDishDetails },
      { label: "Excluded Items", value: valueOrNA(input.excludedItems) },
      { label: "Upcoming Promotions", value: valueOrNA(input.upcomingPromotions) },
      { label: "Hashtag Style", value: input.hashtagStyle },
    ]);

    drawSectionTitle(doc, "05. Shoot Preparation");
    drawTable(doc, [
      { label: "Confirm Min Dishes", value: input.confirmMinDishes },
      { label: "Action Shots Possible", value: valueOrNA(input.actionShotsPossible) },
      { label: "Preferred Shoot Time", value: valueOrNA(input.preferredShootTime) },
      { label: "Physical Constraints", value: valueOrNA(input.physicalConstraints) },
    ]);

    drawSectionTitle(doc, "06. Sample Captions");
    drawTable(doc, [
      { label: "Sample Caption 1", value: input.captionSample1 },
      { label: "Sample Caption 2", value: input.captionSample2 },
      { label: "Sample Caption 3", value: input.captionSample3 },
      { label: "Special Notes", value: valueOrNA(input.specialNotes) },
    ]);

    drawSectionTitle(doc, "07. Brand Publishing Authorization");
    drawTable(doc, [
      { label: "Client Name", value: input.clientName },
      { label: "Restaurant Name (Authorization)", value: input.restaurantNameAuth },
      { label: "Submission Date", value: formatDate(input.submissionDate) },
      { label: "Talexia Plan", value: input.talexiaPlan },
    ]);

    doc.end();
  });
}
