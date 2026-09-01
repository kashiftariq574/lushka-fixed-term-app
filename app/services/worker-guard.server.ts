import crypto from "node:crypto";

export function verifyInternalJobSecret(authHeader: string | null, secret: string) {
  if (!secret) return false;
  const prefix = "Bearer ";
  if (!authHeader?.startsWith(prefix)) return false;
  const provided = Buffer.from(authHeader.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
