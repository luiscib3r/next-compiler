import { ImageResponse } from "next/og";
import { connection } from "next/server";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Adapter tests";

// Rendered per request (not at build time), so next/og loads its WASM inside
// the binary.
export default async function Image() {
  await connection();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #18181b, #3f3f46)",
          color: "white",
          fontSize: 96,
        }}
      >
        {`Adapter tests · ${new Date().toISOString().slice(11, 19)}`}
      </div>
    ),
    size,
  );
}
