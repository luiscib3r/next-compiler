import { cacheLife, cacheTag } from "next/cache";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Simulates a slow data source. Cached for a few seconds and tagged, so the
// cache page can revalidate it on demand.
export async function getQuote() {
  "use cache";
  cacheLife("seconds");
  cacheTag("quote");
  await sleep(200);
  return {
    id: crypto.randomUUID().slice(0, 8),
    generatedAt: new Date().toISOString(),
  };
}

export async function getItem(slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(`item-${slug}`);
  await sleep(100);
  return { slug, generatedAt: new Date().toISOString() };
}
