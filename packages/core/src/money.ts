/**
 * Money & rounding helpers.
 *
 * EN 16931 business rules (BR-CO-10..16, BR-S/E/Z/AE-08..10) compare the *printed*
 * 2-decimal values, so the totals must be internally consistent to the cent. To avoid
 * binary-float drift we compute in integer minor units (cents) and only convert back for
 * display. Item net prices (BT-146) may carry more than 2 decimals and are handled separately.
 */

/** Round a major-unit number to integer minor units (cents), half away from zero. */
export function toCents(amountMajor: number): number {
  // +EPSILON nudges values like 1.005 (stored as 1.00499999…) to round up correctly.
  const scaled = amountMajor * 100;
  return scaled >= 0 ? Math.round(scaled + Number.EPSILON) : -Math.round(-scaled + Number.EPSILON);
}

/** Convert integer minor units back to a major-unit number rounded to 2 decimals. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Round a major-unit number to 2 decimals (half away from zero). */
export function round2(amountMajor: number): number {
  return fromCents(toCents(amountMajor));
}

/** Format integer minor units as a fixed 2-decimal string ("1234" -> "12.34"). */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Format a major-unit money amount as a fixed 2-decimal string. */
export function formatMoney(amountMajor: number): string {
  return formatCents(toCents(amountMajor));
}

/**
 * Format a unit price / quantity that may legitimately carry more than 2 decimals.
 * Trims trailing zeros but always keeps at least 2 decimal places (EN 16931 amount style).
 */
export function formatDecimal(value: number, maxDecimals = 4): string {
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite numeric value: ${value}`);
  const fixed = value.toFixed(maxDecimals);
  // Strip trailing zeros but keep a minimum of 2 decimals.
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const [intPart, fracPart = ''] = trimmed.split('.');
  if (fracPart.length >= 2) return trimmed;
  return `${intPart}.${fracPart.padEnd(2, '0')}`;
}

/**
 * Compute a line's net amount (BT-131) in cents from quantity, unit price and base quantity.
 * lineNet = round( quantity / baseQuantity * netUnitPrice ).
 */
export function lineNetCents(quantity: number, netUnitPrice: number, baseQuantity = 1): number {
  if (baseQuantity <= 0) throw new RangeError('baseQuantity must be > 0');
  return toCents((quantity / baseQuantity) * netUnitPrice);
}

/** Compute the VAT amount in cents for a taxable base (in cents) at a percentage rate. */
export function vatCents(taxableCents: number, ratePercent: number): number {
  return Math.round((taxableCents * ratePercent) / 100);
}
