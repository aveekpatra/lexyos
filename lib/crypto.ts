import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-GCM at rest, keyed from AGENT_SECRET. Used for the personal API key. */
function key(): Buffer {
  const secret = process.env.AGENT_SECRET;
  if (!secret) throw new Error("AGENT_SECRET is not set");
  return createHash("sha256").update(`mindbook-seal:${secret}` /* historical label; changing it would orphan sealed keys */).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function open(blob: string): string {
  const [ver, ivB, tagB, encB] = blob.split(".");
  if (ver !== "v1" || !ivB || !tagB || !encB) throw new Error("Unrecognised sealed value");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  d.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([d.update(Buffer.from(encB, "base64url")), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
