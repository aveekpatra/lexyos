import { getGoogleConnection } from "@/app/actions/google-auth";

export async function GET() {
  try {
    return Response.json(await getGoogleConnection());
  } catch (err) {
    return Response.json({ connected: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
