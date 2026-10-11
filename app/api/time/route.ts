import { headers } from "next/headers";
import { after } from "next/server";

export async function GET() {
  const userAgent = (await headers()).get("user-agent");
  after(() => {
    console.log(`[after] /api/time respondió a ${userAgent}`);
  });
  return Response.json({ userAgent, now: new Date().toISOString() });
}
