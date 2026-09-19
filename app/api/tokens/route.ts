import { randomBytes } from "node:crypto";
import { api } from "@/convex/_generated/api";
import { convexForCurrentUser } from "@/app/actions/google-auth";
import { seal, open, sha256 } from "@/lib/crypto";

/** The personal API key: GET returns it (creating one on first use), POST regenerates it. */

async function mint(convex: Awaited<ReturnType<typeof convexForCurrentUser>>) {
  const key = `mb_${randomBytes(32).toString("base64url")}`;
  await convex.mutation(api.apiTokens.replace, { prefix: key.slice(0, 8), hash: sha256(key), keyEnc: seal(key) });
  return key;
}

export async function GET() {
  try {
    const convex = await convexForCurrentUser();
    const row = await convex.query(api.apiTokens.current, {});
    if (row?.keyEnc) return Response.json({ key: open(row.keyEnc), createdAt: row.createdAt, lastUsedAt: row.lastUsedAt ?? null });
    const key = await mint(convex);
    return Response.json({ key, createdAt: Date.now(), lastUsedAt: null });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const convex = await convexForCurrentUser();
    const key = await mint(convex);
    return Response.json({ key, createdAt: Date.now(), lastUsedAt: null });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
