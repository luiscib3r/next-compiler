import type { MetadataRoute } from "next";
import { groups } from "./lib/tests";

export default function sitemap(): MetadataRoute.Sitemap {
  return groups.flatMap((group) =>
    group.tests.map((test) => ({
      url: `http://localhost:8080${test.path.split("?")[0]}`,
    })),
  );
}
