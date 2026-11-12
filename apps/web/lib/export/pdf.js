import PDFDocument from "pdfkit";
import { periodTotals } from "../analytics";
import { balanceEffect } from "../money";
import {
  BRAND_NAME,
  INK,
  INK_MUTED,
  LOCKUP,
  MARK,
  RAMP,
  RULE as RULE_COLOUR,
  WORDMARK_INK_TEXT,
  WORDMARK_RAMP_TEXT,
  markRamp,
} from "../brand/identity.mjs";

// PDF reporting.
//
// This is a report, not a data dump: the CSV and XLSX paths exist for machine
// readable data. The job here is a document a person can read and file.
//
// Deliberately print-first. It is always light with dark text regardless of
// the theme the application is in, because a dark PDF wastes toner and reads
// badly on paper.
//
// Nothing here claims more than the application can support. It is a report
// generated from the user's own records -- not a bank statement, not certified
// and not audited -- and the footer says exactly that.

// The brand's colours, read from lib/brand/identity.mjs rather than restated
// here. The previous values were sampled from public/logo.png -- a navy and a
// cyan that belonged to the old raster logo and to nothing else in the app.
const RULE = RULE_COLOUR;
const MUTED = INK_MUTED;

const PAGE = { size: "A4", margins: { top: 48, bottom: 56, left: 48, right: 48 } };

// The wordmark's face in a PDF.
//
// Not Geist. pdfkit can only set type in a font it has embedded, and embedding
// a variable-weight subset for eight characters costs more than it is worth in
// a document that is mostly a table. Helvetica-Bold is one of the fourteen
// standard fonts every PDF reader already has, and at the lockup's tracking it
// is a close enough stand-in. The mark beside it is the real geometry, which
// is the part that carries the brand.
const WORDMARK_FONT = "Helvetica-Bold";

// The lockup, drawn as vector.
//
// Nothing is rasterised: the same path, gradient and metrics the browser
// renders are re-drawn here with pdfkit's own primitives, so the logo in an
// exported statement is resolution-independent and changes with the identity
// file like every other surface. This replaced reading public/logo.png off
// disk, which embedded the old brand at a fixed 890x460 and depended on cwd
// resolving differently under `next dev`, `next start` and a standalone build.
//
// Draws with the lockup's top-left at (x, y), `height` points tall, and
// returns the width it occupied so the caller can place what follows.
function drawLockup(doc, x, y, height) {
  const { viewBox, mark, word } = LOCKUP;
  const scale = height / viewBox.height;

  doc.save();
  // Maps the lockup's own coordinate system onto the page, exactly as a
  // viewBox does in SVG. Everything below is in lockup units.
  doc.translate(x, y).scale(scale).translate(-viewBox.x, -viewBox.y);

  doc.save();
  doc.translate(mark.x, mark.y).scale(mark.scale);
  // Built here, inside the mark's own space, rather than in lockup space and
  // used through a transform: a gradient's coordinates mean whatever the
  // matrix in force says they mean, and spanning the W is the whole point.
  const span = markRamp(MARK.ink);
  const paint = doc.linearGradient(span.x1, span.y1, span.x2, span.y2);
  for (const stop of RAMP) paint.stop(stop.offset, stop.color);
  // The letter, then the arrowhead that ends its final stroke. One paint
  // across both, so the ramp runs unbroken into the point of the arrow.
  doc.path(MARK.path).lineWidth(MARK.stroke).lineJoin("round").lineCap("round").stroke(paint);
  doc.path(MARK.arrowhead).fill(paint);
  doc.restore();

  // "Health" in ink, "OS" in the ramp -- the same split the screen and the
  // email raster use. Set in two runs because a PDF text run carries one
  // fill; the second starts exactly where the first measured out to, so the
  // join is as tight as a single string would be.
  doc.font(WORDMARK_FONT).fontSize(word.size);
  const options = {
    // y is the baseline, matching the <text y> of the SVG. Without this
    // pdfkit treats y as the top of the line box and the type sits low.
    baseline: "alphabetic",
    characterSpacing: word.tracking,
    lineBreak: false,
  };
  // Measured rather than assumed: Helvetica-Bold sets this wider than Geist
  // does, so the lockup is wider than its SVG viewBox and the caller must be
  // told the real figure or the title beside it collides.
  const measure = (text) => doc.widthOfString(text, { characterSpacing: word.tracking });
  const inkWidth = measure(WORDMARK_INK_TEXT);
  const rampWidth = measure(WORDMARK_RAMP_TEXT);

  doc.fillColor(INK).text(WORDMARK_INK_TEXT, word.x, word.baseline, options);

  const osX = word.x + inkWidth;
  const osPaint = doc.linearGradient(osX, 0, osX + rampWidth, 0);
  for (const stop of RAMP) osPaint.stop(stop.offset, stop.color);
  doc.fillColor(osPaint).text(WORDMARK_RAMP_TEXT, osX, word.baseline, options);

  doc.restore();

  return (word.x + inkWidth + rampWidth - viewBox.x) * scale;
}

// Amounts carry no currency symbol.
//
// pdfkit's standard fonts are WinAnsi-encoded and have no U+20B9 glyph: the
// rupee sign measures zero width in Helvetica, so printing it would both show
// nothing and corrupt the column layout that depends on measured widths.
// Rather than embed a font subset for one character, the currency is stated
// once in the column headers and the summary, where a formal statement wants
// it anyway. Grouping is Indian (1,23,456.00), matching the application.
const money = (value) => {
  const n = Number(value) || 0;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Column layout for the transaction table. Fixed widths rather than measured,
// so a long description wraps inside its cell instead of pushing the amount
// off the page.
const COLUMNS = [
  { key: "date", label: "Date", width: 60 },
  { key: "description", label: "Description", width: 141 },
  { key: "category", label: "Category", width: 76 },
  { key: "account", label: "Account", width: 86 },
  { key: "debit", label: "Debit (INR)", width: 68, align: "right" },
  { key: "credit", label: "Credit (INR)", width: 68, align: "right" },
];

// Adds a page with pdfkit's automatic text flow disabled.
//
// Every element here is positioned at an explicit y, so the automatic flow is
// not merely unnecessary -- it is harmful. A `.text()` call that lands below
// the bottom margin makes pdfkit insert a page and continue the text on it,
// which is how drawing the footers turned a three-row report into three pages.
// Zeroing the margin after the page exists disables that; the genuine bottom
// of the content area is enforced by the row loop, which is where the decision
// belongs. The margin is zeroed per page because addPage re-reads the options.
const addPage = (doc) => {
  doc.addPage();
  doc.page.margins.bottom = 0;
  return doc;
};

const dateLabel = (value, timeZone) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value instanceof Date ? value : new Date(value));

function drawHeader(doc, { title, range, generatedAt }) {
  const top = PAGE.margins.top;
  const right = doc.page.width - PAGE.margins.right;
  let x = PAGE.margins.left;

  // 22pt tall, the same optical size the lockup has in the application header.
  // The lockup already sets the name, so nothing types "WHealthOS" beside it.
  x += drawLockup(doc, x, top - 2, 22) + 14;

  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(10)
    .text(title, x, top + 7);

  doc
    .fillColor(MUTED)
    .fontSize(8.5)
    .text(`Period: ${range.from} to ${range.to}`, right - 200, top, {
      width: 200,
      align: "right",
    })
    .text(`Generated: ${generatedAt}`, right - 200, top + 12, {
      width: 200,
      align: "right",
    });

  // The rule under the masthead carries the brand ramp across the page, left
  // to right, which is the one place a gradient earns its keep in a document
  // that is otherwise deliberately monochrome and print-first.
  const ruleY = top + 40;
  const ramp = doc.linearGradient(PAGE.margins.left, ruleY, right, ruleY);
  for (const stop of RAMP) ramp.stop(stop.offset, stop.color);
  doc.moveTo(PAGE.margins.left, ruleY).lineTo(right, ruleY).lineWidth(1.5).stroke(ramp);
  return ruleY + 18;
}

// The figures, from periodTotals -- the same function Analytics and the XLSX
// summary use. No second income/expense formula exists anywhere.
function drawSummary(doc, rows, y) {
  const totals = periodTotals(rows);
  const right = doc.page.width - PAGE.margins.right;
  const width = (right - PAGE.margins.left) / 4;

  const cells = [
    ["Income (INR)", money(totals.income)],
    ["Expenses (INR)", money(totals.expenses)],
    ["Net cash flow (INR)", money(totals.net)],
    [
      "Savings rate",
      // Unanswerable without income, and said so rather than shown as 0%.
      totals.savingsRate === null ? "Not available" : `${totals.savingsRate.toFixed(1)}%`,
    ],
  ];

  cells.forEach(([label, value], i) => {
    const x = PAGE.margins.left + i * width;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(label.toUpperCase(), x, y);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(value, x, y + 12, {
      width: width - 8,
    });
  });

  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      `${rows.length} transaction${rows.length === 1 ? "" : "s"} in this period. ` +
        "All amounts in INR; WHealthOS stores a single currency, so no conversion is applied.",
      PAGE.margins.left,
      y + 36,
      { width: right - PAGE.margins.left }
    );

  return y + 56;
}

function drawTableHeader(doc, y) {
  let x = PAGE.margins.left;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK);
  for (const col of COLUMNS) {
    doc.text(col.label.toUpperCase(), x, y, { width: col.width, align: col.align ?? "left" });
    x += col.width;
  }
  const ruleY = y + 13;
  doc
    .moveTo(PAGE.margins.left, ruleY)
    .lineTo(doc.page.width - PAGE.margins.right, ruleY)
    .strokeColor(RULE)
    .lineWidth(0.75)
    .stroke();
  return ruleY + 7;
}

// The closing totals row.
//
// Summed from the same rows the table printed, so the figure at the foot of
// the statement cannot disagree with the lines above it. Debit and credit are
// totalled under their own columns, and the net is stated in words beneath --
// a reader should not have to subtract two numbers to learn whether the period
// was up or down.
function drawTotals(doc, rows, y, bottom, header) {
  const totals = periodTotals(rows);
  const needed = 46;

  // The totals belong with the table, so they move to a new page whole rather
  // than being split from the rule that introduces them.
  if (y + needed > bottom) {
    addPage(doc);
    y = drawHeader(doc, header);
    y = drawTableHeader(doc, y);
  }

  const right = doc.page.width - PAGE.margins.right;
  doc
    .moveTo(PAGE.margins.left, y)
    .lineTo(right, y)
    .strokeColor(INK)
    .lineWidth(0.75)
    .stroke();

  y += 7;

  let x = PAGE.margins.left;
  const cells = {
    date: "",
    description: "Total for this period",
    category: "",
    account: "",
    debit: money(totals.expenses),
    credit: money(totals.income),
  };
  for (const col of COLUMNS) {
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(cells[col.key], x, y, { width: col.width - 6, align: col.align ?? "left" });
    x += col.width;
  }

  y += 16;
  // Signed, and named, so "net" is never ambiguous about direction.
  const net = totals.net;
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `Net for this period: ${net < 0 ? "-" : ""}${money(Math.abs(net))} INR ` +
        `(${net < 0 ? "spent more than received" : "received more than spent"})`,
      PAGE.margins.left,
      y,
      { width: right - PAGE.margins.left, align: "right" }
    );

  return y + 14;
}

// Renders the statement. Returns a Buffer so the route can stream it.
export function transactionStatement({
  rows,
  range,
  generatedAt,
  timeZone,
  title = "Financial Statement",
  // Streams are flate-compressed in the delivered file. The tests turn this
  // off so they can read the page text back out of the buffer and assert on
  // what was actually drawn -- there is no PDF parser in the dependency tree,
  // and shipping one to check our own output is not worth it.
  compress = true,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      ...PAGE,
      autoFirstPage: false,
      bufferPages: true,
      compress,
      // The brand in the file's own properties, not just on the page. The
      // masthead draws the W rather than typing it, so a reader searching the
      // text layer for the product name would otherwise find it only in the
      // footer; this is what a PDF viewer shows in its title bar and what a
      // document manager indexes.
      info: {
        Title: `${BRAND_NAME} ${title}`,
        Author: BRAND_NAME,
        Creator: BRAND_NAME,
        Producer: BRAND_NAME,
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    addPage(doc);
    let y = drawHeader(doc, { title, range, generatedAt });
    y = drawSummary(doc, rows, y);
    y = drawTableHeader(doc, y);

    // From the configured margin, not doc.page.margins.bottom -- addPage
    // zeroes that to switch off the automatic flow.
    const bottom = doc.page.height - PAGE.margins.bottom;

    for (const row of rows) {
      // Which column the amount belongs in, decided by the sign the row
      // applies to its account rather than by testing for EXPENSE. A
      // TRANSFER_OUT is a debit on the statement and a TRANSFER_IN a credit,
      // which is exactly what balanceEffect already says; testing for EXPENSE
      // put every transfer out in the credit column.
      const debit = balanceEffect(row.type, row.amount) < 0;
      const cells = {
        date: dateLabel(row.date, timeZone),
        description: row.description || "—",
        category: row.category || "",
        account: row.accountName || "",
        debit: debit ? money(row.amount) : "",
        credit: debit ? "" : money(row.amount),
      };

      // Measured before drawing, so a wrapped description decides the row
      // height and nothing overlaps the row beneath it.
      doc.font("Helvetica").fontSize(8.5);
      const height = Math.max(
        ...COLUMNS.map((c) =>
          doc.heightOfString(String(cells[c.key]), { width: c.width - 6 })
        ),
        12
      );

      // Page break before drawing, never mid-row.
      if (y + height > bottom) {
        addPage(doc);
        y = drawHeader(doc, { title, range, generatedAt });
        y = drawTableHeader(doc, y);
      }

      let x = PAGE.margins.left;
      for (const col of COLUMNS) {
        doc
          .fillColor(INK)
          .font("Helvetica")
          .fontSize(8.5)
          .text(String(cells[col.key]), x, y, {
            width: col.width - 6,
            align: col.align ?? "left",
          });
        x += col.width;
      }
      y += height + 6;
    }

    y = drawTotals(doc, rows, y, bottom, { title, range, generatedAt });

    // Footers last, once the total page count is known. bufferPages keeps the
    // pages in memory so "Page X of Y" can be written retrospectively -- it
    // cannot be known while the first page is being drawn.
    const range_ = doc.bufferedPageRange();
    for (let i = 0; i < range_.count; i++) {
      doc.switchToPage(range_.start + i);
      const footY = doc.page.height - PAGE.margins.bottom + 16;
      doc
        .moveTo(PAGE.margins.left, footY - 8)
        .lineTo(doc.page.width - PAGE.margins.right, footY - 8)
        .strokeColor(RULE)
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7.5)
        // Neutral wording on purpose: this is generated from the user's own
        // records. It is not a bank statement, not certified, not audited.
        .text(
          "Financial report generated by WHealthOS from your own records. Not a certified or audited statement.",
          PAGE.margins.left,
          footY,
          { width: 380 }
        )
        .text(
          `Page ${i + 1} of ${range_.count}`,
          doc.page.width - PAGE.margins.right - 120,
          footY,
          { width: 120, align: "right" }
        );
    }

    doc.end();
  });
}
