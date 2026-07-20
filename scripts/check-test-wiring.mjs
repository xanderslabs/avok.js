import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

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

/** Does ONE project match ONE filter? `matches` above asks "does anything match"; this asks which. */
const projectMatches = (pattern, project) => {
  const isPath = pattern.startsWith(".") || pattern.includes("/");
  const rx = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
  return rx.test(isPath && !pattern.startsWith("@") ? project.path : project.name);
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

// The `--filter` check above closes one instance of a shape this repo keeps hitting: a SELECTOR that
// silently narrows to nothing while the command over it still exits 0. Absence is indistinguishable
// from success. Three instances landed before anyone noticed — a stale --filter, a deleted demos
// folder, and `No test files found, exiting with code 0` from a package whose suite had gone empty.
//
// The two below cover the remaining selectors the gate leans on. Neither is hypothetical: rename
// packages/ and biome's globs match nothing, so `format:check` and `lint` — the gate this repo just
// adopted — would both pass having read zero files, which is the exact defect they exist to prevent.

const IGNORED_DIRS = new Set(["node_modules", "dist", "out", "cache", "lib", "app-dist", "app-inlined"]);
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};
const repoFiles = walk(".").map((f) => f.slice(2)); // strip the leading "./"

// Order matters: `**/` must be consumed before a bare `*`, or the second rule eats the first's stars.
const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("**/", "\u0000")
      .replaceAll("**", "\u0001")
      .replace(/\*/g, "[^/]*")
      .replaceAll("\u0000", "(?:[^/]+/)*")
      .replaceAll("\u0001", ".*")}$`,
  );

// 1. Every positive glob in biome's `files.includes` must match a real file. A negated pattern (`!`)
//    matching nothing is harmless — it only ever removes — so those are skipped.
const biome = JSON.parse(readFileSync("biome.json", "utf8"));
for (const glob of biome.files?.includes ?? []) {
  if (glob.startsWith("!")) continue;
  const rx = globToRegExp(glob);
  if (!repoFiles.some((f) => rx.test(f))) {
    fail(
      `biome.json includes \`${glob}\`, which matches no file.\n` +
        "  biome exits 0 having checked nothing, so `format:check` and `lint` would report success\n" +
        "  over an empty set. Drop the glob, or fix the path it was meant to cover.",
    );
  }
}

// 2. Every package claiming a `test` script must own at least one test file. vitest prints
//    "No test files found, exiting with code 0" and passes — which is how an empty suite reads as a
//    green suite. Matched on filename rather than a fixed directory because the layout varies:
//    packages/* keep tests in test/, contracts keeps them beside the source in src-ts/.
for (const project of projects) {
  if (project.path === ".") continue; // the root's `test` script is the gate itself, not a suite
  const { scripts: own = {} } = JSON.parse(readFileSync(`${project.path}/package.json`, "utf8"));
  if (!own.test) continue;
  const dir = project.path.slice(2); // "./packages/core" -> "packages/core"
  const tests = repoFiles.filter((f) => f.startsWith(`${dir}/`) && /\.test\.(ts|tsx|mts)$/.test(f));
  if (tests.length === 0) {
    fail(
      `${project.name} defines a \`test\` script but owns no *.test.ts file.\n` +
        "  vitest reports `No test files found, exiting with code 0` — an empty suite is\n" +
        "  indistinguishable from a passing one. Add the tests back, or drop the script.",
    );
  }
}

// 3. A `--filter` that resolves is not enough: `pnpm -r --filter X <script>` SKIPS any matched
//    project that does not define <script>, and exits 0 having done so. A package that quietly loses
//    its `typecheck` is then never typechecked again, and the gate keeps reporting success — the same
//    absence-reads-as-success shape as an empty filter, one level in.
for (const [where, body] of sources) {
  for (const [, line] of body.matchAll(/pnpm -r ([^\n&|]*)/g)) {
    const filters = [...line.matchAll(/--filter\s+["']?([^"'\s]+)["']?/g)].map((m) => m[1]);
    if (filters.length === 0) continue;
    // The script is the trailing bare word: everything else is a flag or a flag's value.
    const tail = line.trim().split(/\s+/).pop();
    if (!tail || tail.startsWith("-") || tail.startsWith('"') || tail.startsWith("'")) continue;
    if (tail === "exec") continue; // `pnpm -r exec <cmd>` runs a binary, not a package script

    for (const project of projects) {
      if (project.path === ".") continue;
      if (!filters.some((f) => matches(f) && projectMatches(f, project))) continue;
      const { scripts: own = {} } = JSON.parse(readFileSync(`${project.path}/package.json`, "utf8"));
      if (!own[tail]) {
        fail(
          `${where} runs \`${tail}\` over ${project.name}, which does not define that script.\n` +
            "  pnpm SKIPS a project missing the script and still exits 0, so this step silently does\n" +
            "  less than it claims. Add the script, or narrow the filter so it stops matching.",
        );
      }
    }
  }
}

// 4. `forge test` passes when there are no tests to run. The contracts carry the custody logic, so a
//    suite that silently emptied would be the most expensive green in the repo.
const forgeTests = repoFiles.filter((f) => f.startsWith("contracts/test/") && f.endsWith(".t.sol"));
if (ci.includes("forge test") && forgeTests.length === 0) {
  fail(
    "CI runs `forge test` but contracts/test/ holds no *.t.sol files.\n" +
      "  forge exits 0 with nothing to run, so the custody contracts would be reported as passing\n" +
      "  while going entirely unexercised.",
  );
}

console.log(
  `Test wiring intact: build precedes typecheck; every --filter resolves (${projects.length} projects); ` +
    "biome globs and test suites are non-empty.",
);
