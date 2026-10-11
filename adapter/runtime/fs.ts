import fs from "node:fs";
import { Readable } from "node:stream";

const original = fs.createReadStream;

// Files in `/$bunfs` have no file descriptor: `open` fails with ENOENT, but
// `readFileSync` works. `send` (Next's static file server) streams files with
// `createReadStream`, so serve `$bunfs` files from memory.
fs.createReadStream = function (this: unknown, path, options) {
  if (typeof path !== "string" || !path.includes("$bunfs")) {
    return original.call(this, path, options);
  }
  const { start = 0, end = Infinity } =
    typeof options === "object" && options !== null ? options : {};
  const stream = Readable.from([], { objectMode: false });
  try {
    const data = fs.readFileSync(path);
    return Readable.from([data.subarray(start, end + 1)], {
      objectMode: false,
    }) as fs.ReadStream;
  } catch (error) {
    process.nextTick(() => stream.destroy(error as Error));
    return stream as fs.ReadStream;
  }
} as typeof fs.createReadStream;
