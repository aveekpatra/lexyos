import { protectedResourceMetadata, json, publicOrigin, CORS } from "@/lib/oauth/server";
export const GET = (req: Request) => json(protectedResourceMetadata(publicOrigin(req)), 200, { "cache-control": "public, max-age=300" });
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
