/**
 * Validates and parses a route parameter into a positive safe integer.
 * Strictly accepts canonical positive decimal integers (e.g. "1", "42").
 * Rejects decimal-formatted strings (e.g. "1.0", "1.5"), leading zeros (e.g. "01"),
 * zero ("0"), negative numbers ("-5"), non-numeric strings, and values exceeding
 * JavaScript's safe integer boundary (2^53 - 1).
 */
export function parsePositiveIntegerParam(val: string | undefined): number | null {
  if (!val || !/^[1-9]\d*$/.test(val)) {
    return null
  }
  const num = Number(val)
  if (!Number.isSafeInteger(num)) {
    return null
  }
  return num
}
