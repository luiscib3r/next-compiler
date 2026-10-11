// Runs every check from `app/lib/tests.ts` against a running server.
//
//   bun run smoke                         # http://localhost:8080 (the binary)
//   bun run smoke http://localhost:3000   # e.g. `next start`
import { groups, type Check } from "../app/lib/tests";

const base = process.argv[2] ?? "http://localhost:8080";

type Result = { check: Check; ok: boolean; reason?: string };

async function run(check: Check): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(new URL(check.path, base), {
      method: check.method ?? "GET",
      headers: check.headers,
      body: check.body,
      redirect: "manual",
    });
  } catch (error) {
    return { check, ok: false, reason: String(error) };
  }
  const body = await response.text();
  if (response.status !== check.status) {
    return {
      check,
      ok: false,
      reason: `status ${response.status}, se esperaba ${check.status}`,
    };
  }
  if (check.contains && !body.includes(check.contains)) {
    return { check, ok: false, reason: `el body no contiene ${JSON.stringify(check.contains)}` };
  }
  for (const [name, expected] of Object.entries(check.header ?? {})) {
    const actual = response.headers.get(name);
    if (actual === null || !actual.includes(expected)) {
      return {
        check,
        ok: false,
        reason: `header ${name}: ${JSON.stringify(actual)}, se esperaba ${JSON.stringify(expected)}`,
      };
    }
  }
  return { check, ok: true };
}

let failed = 0;
console.log(`smoke → ${base}\n`);
for (const group of groups) {
  console.log(group.name);
  for (const test of group.tests) {
    for (const check of test.checks) {
      const result = await run(check);
      const label = `${check.method ?? "GET"} ${check.path}`;
      if (result.ok) {
        console.log(`  ✓ ${label}`);
      } else {
        failed++;
        console.log(`  ✗ ${label} — ${result.reason}`);
      }
    }
  }
}
console.log(failed ? `\n${failed} check(s) fallaron` : "\ntodo ok");
process.exit(failed ? 1 : 0);
