import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Guards the gate itself.
//
// Every one of the 8 type errors #10 paid lived in a TEST file. vitest does not typecheck, and `test`
// never called tsc — so `pnpm typecheck` was the only thing that read those files, and it had been red
// long enough that nobody ran it, which is why it stayed red. #9 hit the same shape one level down:
// `test` filtered to ./packages/*, so examples never ran and 78 errors rotted there.
//
// vitest cannot guard tsc, so this guards the WIRING. The day someone speeds up CI by pulling typecheck
// back out of `test`, this fails loudly instead of quietly restarting the rot.

const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
const test = scripts.test ?? "";
const fail = (msg) => {
  console.error(`Test wiring: ${msg}`);
  process.exit(1);
};

if (!test.includes("pnpm typecheck")) {
  fail(
    "`test` no longer runs `pnpm typecheck`.\n" +
      "  vitest does not typecheck. Without this, a type error in any test file is invisible to every\n" +
      "  command anyone actually runs — which is exactly how 8 of them accrued before #10.",
  );
}

const build = test.indexOf("pnpm build");
const typecheck = test.indexOf("pnpm typecheck");
if (build < 0 || build > typecheck) {
  fail(
    "`test` must run `pnpm build` BEFORE `pnpm typecheck`.\n" +
      "  Cross-package types resolve through built dist/: tsc --traceResolution shows sdk-core reading\n" +
      "  @avokjs/evm-txengine from evm-txengine/dist/index.d.ts. There are no `paths` mappings, so the\n" +
      "  build is load-bearing. Without it typecheck passes on a warm machine and fails on a fresh clone.",
  );
}

// A `--filter` that matches nothing is the same bug one level up: `pnpm -r --filter X test` EXITS 0
// when X resolves to zero projects, so the step passes having run nothing. That is not hypothetical —
// CI carried `--filter "./design"` through a build and a test step while design/ was three markdown
// files with no package.json, and both reported green for as long as it was there. The demos hit the
// same shape: delete the folder and `demos:test` would have kept passing.
//
// So every filter in the gate must resolve to at least one project. Scans the root scripts AND the
// workflow, because a filter is just as dead in either, and a green CI step is the more expensive lie.

const workspace = JSON.parse(execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], { encoding: "utf8" }));
const projects = workspace.map((p) => ({
  name: p.name ?? "",
  path: `./${p.path.slice(process.cwd().length + 1)}`.replace(/^\.\/$/, "."),
}));

// pnpm treats a filter containing a path separator or leading `.` as a PATH glob, anything else as a
// package-NAME glob. Only `*` is used here; matching it as "anything but a separator" mirrors pnpm.
const matches = (pattern) => {
  const isPath = pattern.startsWith(".") || pattern.includes("/");
  const rx = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
  return projects.some((p) => rx.test(isPath && !pattern.startsWith("@") ? p.path : p.name));
};

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const sources = [...Object.entries(scripts).map(([n, body]) => [`package.json script \`${n}\``, body]), ["ci.yml", ci]];

for (const [where, body] of sources) {
  for (const [, pattern] of body.matchAll(/--filter\s+["']?([^"'\s]+)["']?/g)) {
    if (!matches(pattern)) {
      fail(
        `${where} filters on \`${pattern}\`, which matches no workspace project.\n` +
          "  `pnpm -r --filter` exits 0 on an empty match, so this runs nothing and still reports\n" +
          "  success. Either the filter is stale and should go, or the project it names is missing\n" +
          "  from pnpm-workspace.yaml.",
      );
    }
  }
}

console.log(`Test wiring intact: build precedes typecheck; every --filter resolves (${projects.length} projects).`);
