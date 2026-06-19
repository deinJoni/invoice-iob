import { PDFDocument } from '@cantoo/pdf-lib';
import type { Color, PDFFont, PDFPage } from '@cantoo/pdf-lib';
import type { CanonicalInvoice, Party } from '@invoice-iob/core';
import { COLORS, FS, LABELS, PAGE, unitLabel, type Locale } from './theme.ts';
import { embedFonts } from './fonts.ts';
import { sanitize, wrapText } from './text.ts';

export interface RenderPdfOptions {
  /** Document language for labels and number formatting. Defaults from the seller's country. */
  locale?: Locale;
}

interface TextOpts {
  size?: number;
  font?: PDFFont;
  color?: Color;
}

function addressLines(p: Party): string[] {
  const lines: string[] = [];
  if (p.address.line1) lines.push(p.address.line1);
  if (p.address.line2) lines.push(p.address.line2);
  const cityLine = [p.address.postalCode, p.address.city].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  return lines;
}

function formatDate(iso: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return locale === 'de' ? `${d}.${mo}.${y}` : `${y}-${mo}-${d}`;
}

/** Render the canonical invoice to a visual PDF (Uint8Array). Amounts come from the model. */
export async function renderInvoicePdf(
  model: CanonicalInvoice,
  options: RenderPdfOptions = {},
): Promise<Uint8Array> {
  const locale: Locale = options.locale ?? (model.seller.address.countryCode === 'DE' ? 'de' : 'en');
  const L = LABELS[locale];
  const intlLocale = locale === 'de' ? 'de-DE' : 'en-US';
  const currency = model.currency;

  const num = new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cur = new Intl.NumberFormat(intlLocale, { style: 'currency', currency });
  const qtyFmt = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 3 });
  const rateFmt = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 });
  const fmtNum = (n: number) => num.format(n);
  const fmtCur = (n: number) => cur.format(n);
  const fmtQty = (n: number) => qtyFmt.format(n);
  const fmtRate = (n: number) => rateFmt.format(n);

  const doc = await PDFDocument.create();
  const { regular, bold } = await embedFonts(doc);

  doc.setTitle(`${L.invoice} ${model.invoiceNumber}`);
  doc.setAuthor(model.seller.name);
  doc.setSubject(`${L.invoice} ${model.invoiceNumber}`);
  doc.setProducer('invoice-iob');
  doc.setCreator('invoice-iob');
  const created = new Date(`${model.issueDate}T00:00:00Z`);
  if (!Number.isNaN(created.getTime())) {
    doc.setCreationDate(created);
    doc.setModificationDate(created);
  }

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const top = PAGE.height - PAGE.margin;
  const contentW = right - left;
  const bottomLimit = PAGE.margin + 46; // reserve space for the footer

  let page: PDFPage = doc.addPage([PAGE.width, PAGE.height]);
  let y = top;

  const text = (s: string, x: number, yy: number, o: TextOpts = {}): void => {
    page.drawText(sanitize(s), {
      x,
      y: yy,
      size: o.size ?? FS.body,
      font: o.font ?? regular,
      color: o.color ?? COLORS.text,
    });
  };
  const textRight = (s: string, xRight: number, yy: number, o: TextOpts = {}): void => {
    const font = o.font ?? regular;
    const size = o.size ?? FS.body;
    const w = font.widthOfTextAtSize(sanitize(s), size);
    text(s, xRight - w, yy, o);
  };
  const hline = (yy: number, x1: number = left, x2: number = right, thickness = 0.7): void => {
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color: COLORS.line });
  };
  const newPage = (): void => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = top;
    text(`${L.invoice} ${model.invoiceNumber} — ${L.page}`, left, y, { size: FS.tiny, color: COLORS.muted });
    y -= 22;
  };
  const ensure = (space: number, redrawTableHeader = false): void => {
    if (y - space < bottomLimit) {
      newPage();
      if (redrawTableHeader) tableHeader();
    }
  };

  // ---- Header: sender one-liner + recipient (left); title + meta (right) ----
  const senderOneLine = [
    model.seller.name,
    model.seller.address.line1,
    [model.seller.address.postalCode, model.seller.address.city].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(' · ');
  text(senderOneLine, left, y, { size: FS.tiny, color: COLORS.muted });

  let ry = y - 24;
  text(L.billedTo, left, ry, { size: FS.label, color: COLORS.muted });
  ry -= 14;
  text(model.buyer.name, left, ry, { font: bold, size: FS.body });
  ry -= 13;
  for (const ln of addressLines(model.buyer)) {
    text(ln, left, ry, { size: FS.small, color: COLORS.muted });
    ry -= 12;
  }

  textRight(L.invoice.toUpperCase(), right, top - 2, { font: bold, size: FS.title, color: COLORS.accent });
  let my = top - 36;
  const metaRows: Array<[string, string]> = [
    [L.invoiceNo, model.invoiceNumber],
    [L.issueDate, formatDate(model.issueDate, locale)],
  ];
  if (model.dueDate) metaRows.push([L.dueDate, formatDate(model.dueDate, locale)]);
  if (model.delivery?.date) {
    metaRows.push([L.deliveryDate, formatDate(model.delivery.date, locale)]);
  } else if (model.delivery?.periodStart || model.delivery?.periodEnd) {
    const a = model.delivery.periodStart ? formatDate(model.delivery.periodStart, locale) : '';
    const b = model.delivery.periodEnd ? formatDate(model.delivery.periodEnd, locale) : '';
    metaRows.push([L.deliveryPeriod, [a, b].filter(Boolean).join(' – ')]);
  }
  if (model.buyerReference) metaRows.push([L.buyerRef, model.buyerReference]);
  for (const [k, v] of metaRows) {
    text(k, right - 210, my, { size: FS.small, color: COLORS.muted });
    textRight(v, right, my, { size: FS.small, font: bold });
    my -= 13;
  }

  y = Math.min(ry, my) - 16;
  hline(y);
  y -= 16;

  // ---- Seller tax identifiers ----
  const taxBits: string[] = [];
  if (model.seller.vatId) taxBits.push(`${L.vatId} ${model.seller.vatId}`);
  if (model.seller.taxNumber) taxBits.push(`${L.taxNo} ${model.seller.taxNumber}`);
  if (taxBits.length) {
    text(taxBits.join('     '), left, y, { size: FS.small, color: COLORS.muted });
    y -= 20;
  }

  // ---- Line-item table ----
  const COL = { pos: left, desc: left + 26, qtyR: 358, priceR: 432, vatR: 476, netR: right };
  const descWidth = COL.qtyR - 72 - COL.desc;

  function tableHeader(): void {
    page.drawRectangle({ x: left, y: y - 13, width: contentW, height: 17, color: COLORS.headerBg });
    const ty = y - 9;
    text(L.pos, COL.pos + 4, ty, { size: FS.label, font: bold });
    text(L.description, COL.desc, ty, { size: FS.label, font: bold });
    textRight(L.qty, COL.qtyR, ty, { size: FS.label, font: bold });
    textRight(L.unitPrice, COL.priceR, ty, { size: FS.label, font: bold });
    textRight(L.vatRate, COL.vatR, ty, { size: FS.label, font: bold });
    textRight(L.lineNet, COL.netR, ty, { size: FS.label, font: bold });
    y -= 20;
  }

  ensure(40);
  tableHeader();

  for (const line of model.lines) {
    const nameLines = wrapText(line.name, regular, FS.body, descWidth);
    const descLines = line.description ? wrapText(line.description, regular, FS.small, descWidth) : [];
    const rowH = Math.max(16, nameLines.length * 12 + descLines.length * 10 + 6);
    ensure(rowH + 2, true);

    const baseY = y - 10;
    text(line.id, COL.pos + 4, baseY, { size: FS.small, color: COLORS.muted });
    let dy = baseY;
    for (const nl of nameLines) {
      text(nl, COL.desc, dy, { size: FS.body });
      dy -= 12;
    }
    for (const dl of descLines) {
      text(dl, COL.desc, dy, { size: FS.small, color: COLORS.muted });
      dy -= 10;
    }
    textRight(`${fmtQty(line.quantity)} ${unitLabel(locale, line.unitCode)}`.trim(), COL.qtyR, baseY, { size: FS.small });
    textRight(fmtNum(line.netUnitPrice), COL.priceR, baseY, { size: FS.small });
    textRight(`${fmtRate(line.vatRate)} %`, COL.vatR, baseY, { size: FS.small });
    textRight(fmtNum(line.lineNetAmount), COL.netR, baseY, { size: FS.body });

    y -= rowH;
    hline(y + 2, left, right, 0.5);
  }

  // ---- Totals (right) + per-rate VAT + exemption notes ----
  ensure(30 + model.vatBreakdown.length * 14 + 40);
  y -= 10;
  const totLabelR = right - 96;
  const totRow = (label: string, value: string, opts: { strong?: boolean; size?: number } = {}): void => {
    const size = opts.size ?? FS.body;
    const f = opts.strong ? bold : regular;
    textRight(label, totLabelR, y, { size, font: opts.strong ? bold : regular, color: opts.strong ? COLORS.text : COLORS.muted });
    textRight(value, right, y, { size, font: f });
    y -= size + 6;
  };

  totRow(L.subtotalNet, fmtCur(model.totals.taxExclusiveAmount));
  for (const v of model.vatBreakdown) {
    const ratePart = `${L.vatRate} ${fmtRate(v.rate)} %`;
    totRow(`${ratePart}`, fmtCur(v.taxAmount));
  }
  hline(y + 4, totLabelR - 4, right, 0.7);
  y -= 4;
  totRow(L.payable, fmtCur(model.totals.payableAmount), { strong: true, size: 12 });

  // exemption notes (BR-E/AE/IC/G/O)
  const exemptions = model.vatBreakdown.filter((v) => v.exemptionReason);
  if (exemptions.length) {
    y -= 6;
    for (const v of exemptions) {
      const note = `${L.vatRate} ${v.category}: ${v.exemptionReason}`;
      for (const nl of wrapText(note, regular, FS.tiny, contentW)) {
        ensure(12);
        text(nl, left, y, { size: FS.tiny, color: COLORS.muted });
        y -= 11;
      }
    }
  }

  // ---- Payment ----
  const pay = model.payment;
  if (pay && (pay.iban || pay.terms)) {
    ensure(70);
    y -= 16;
    text(L.paymentTitle, left, y, { font: bold, size: FS.h2, color: COLORS.accent });
    y -= 15;
    if (pay.iban) {
      text(`${L.iban}: ${pay.iban}${pay.bic ? `    ${L.bic}: ${pay.bic}` : ''}`, left, y, { size: FS.small });
      y -= 12;
    }
    if (pay.accountName) {
      text(`${L.account}: ${pay.accountName}`, left, y, { size: FS.small, color: COLORS.muted });
      y -= 12;
    }
    if (pay.terms) {
      for (const tl of wrapText(pay.terms, regular, FS.small, contentW)) {
        ensure(12);
        text(tl, left, y, { size: FS.small, color: COLORS.muted });
        y -= 11;
      }
    }
  }

  // ---- Note (BT-22) ----
  if (model.notes?.length) {
    ensure(40);
    y -= 12;
    for (const note of model.notes) {
      for (const nl of wrapText(note, regular, FS.small, contentW)) {
        ensure(12);
        text(nl, left, y, { size: FS.small, color: COLORS.muted });
        y -= 11;
      }
    }
  }

  // ---- Footer on every page (with final page count) ----
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((pg, i) => {
    const fy = PAGE.margin + 22;
    pg.drawLine({ start: { x: left, y: fy + 10 }, end: { x: right, y: fy + 10 }, thickness: 0.6, color: COLORS.line });
    const bits = [model.seller.name];
    if (model.seller.contactPhone) bits.push(model.seller.contactPhone);
    if (model.seller.contactEmail) bits.push(model.seller.contactEmail);
    if (model.seller.vatId) bits.push(`${L.vatId} ${model.seller.vatId}`);
    pg.drawText(sanitize(bits.join('   ·   ')), { x: left, y: fy, size: FS.tiny, font: regular, color: COLORS.muted });
    const pn = `${L.page} ${i + 1} ${L.of} ${total}`;
    const w = regular.widthOfTextAtSize(pn, FS.tiny);
    pg.drawText(pn, { x: right - w, y: fy, size: FS.tiny, font: regular, color: COLORS.muted });
  });

  return doc.save({ useObjectStreams: false });
}
