import { connection } from "next/server";
import { sleep } from "../../lib/data";

export async function GET() {
  await connection();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < 5; i++) {
        controller.enqueue(encoder.encode(`chunk ${i}\n`));
        await sleep(200);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
