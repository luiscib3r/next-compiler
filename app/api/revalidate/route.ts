import { revalidateTag } from "next/cache";

// POST /api/revalidate?tag=item-a          stale-while-revalidate ("max")
// POST /api/revalidate?tag=item-a&expire   expire now: the next read renders
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const tag = params.get("tag");
  if (!tag) {
    return Response.json({ error: "missing ?tag" }, { status: 400 });
  }
  revalidateTag(tag, params.has("expire") ? { expire: 0 } : "max");
  return Response.json({ revalidated: tag });
}
