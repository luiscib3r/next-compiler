// Binary encoding for cache entries. Next's values mix JSON-friendly fields
// with bytes (`rscData`, image buffers), `Map`s (`segmentData`) and large
// strings (`html`). JSON would turn bytes into base64 or arrays of numbers;
// this keeps them raw.
//
// Layout: "NC1" | u32 meta length | meta (JSON) | u32 blob count | per blob: u32 length | bytes
//
// In the meta, a byte array is { "$b": index }, a long string is { "$s": index }
// (stored as UTF-8 bytes) and a Map is { "$m": [[key, value], ...] }.

const MAGIC = new TextEncoder().encode("NC1");
// Strings longer than this go to a blob instead of the JSON meta.
const LONG_STRING = 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encode(value: unknown): Uint8Array {
  const blobs: Uint8Array[] = [];
  const meta = encoder.encode(JSON.stringify(toMeta(value, blobs)));
  const size =
    MAGIC.length +
    4 +
    meta.length +
    4 +
    blobs.reduce((n, b) => n + 4 + b.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let offset = 0;
  out.set(MAGIC, offset);
  offset += MAGIC.length;
  view.setUint32(offset, meta.length);
  offset += 4;
  out.set(meta, offset);
  offset += meta.length;
  view.setUint32(offset, blobs.length);
  offset += 4;
  for (const blob of blobs) {
    view.setUint32(offset, blob.length);
    offset += 4;
    out.set(blob, offset);
    offset += blob.length;
  }
  return out;
}

export function decode(bytes: Uint8Array): unknown {
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("not a cache entry");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = MAGIC.length;
  const metaLength = view.getUint32(offset);
  offset += 4;
  const meta = JSON.parse(
    decoder.decode(bytes.subarray(offset, offset + metaLength)),
  );
  offset += metaLength;
  const count = view.getUint32(offset);
  offset += 4;
  const blobs: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(offset);
    offset += 4;
    blobs.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return fromMeta(meta, blobs);
}

function toMeta(value: unknown, blobs: Uint8Array[]): unknown {
  if (value instanceof Uint8Array) {
    blobs.push(value);
    return { $b: blobs.length - 1 };
  }
  if (typeof value === "string" && value.length > LONG_STRING) {
    blobs.push(encoder.encode(value));
    return { $s: blobs.length - 1 };
  }
  if (value instanceof Map) {
    return { $m: [...value].map(([k, v]) => [k, toMeta(v, blobs)]) };
  }
  if (Array.isArray(value)) return value.map((item) => toMeta(item, blobs));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = toMeta(v, blobs);
    }
    return out;
  }
  return value;
}

function fromMeta(value: unknown, blobs: Uint8Array[]): unknown {
  if (Array.isArray(value)) return value.map((item) => fromMeta(item, blobs));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Next expects Buffers (it calls `.toString()` and Buffer methods on them).
    if (typeof record.$b === "number") return Buffer.from(blobs[record.$b]);
    if (typeof record.$s === "number") return decoder.decode(blobs[record.$s]);
    if (Array.isArray(record.$m)) {
      return new Map(
        (record.$m as [unknown, unknown][]).map(([k, v]) => [
          k,
          fromMeta(v, blobs),
        ]),
      );
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) out[k] = fromMeta(v, blobs);
    return out;
  }
  return value;
}
