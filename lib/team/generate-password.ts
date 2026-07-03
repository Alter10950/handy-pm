// Client-side convenience only — the server never generates or sees this
// value except as whatever the admin submits in the form. Excludes visually
// ambiguous characters (0/O, 1/l/I) since this is meant to be read aloud or
// typed by a human.
const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

export function generateTempPassword(length = 14): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]
  ).join("");
}
