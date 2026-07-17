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

if (!test.includes("demos:typecheck")) {
  fail(
    "`test` no longer runs `demos:typecheck`.\n" +
    "  #8 added it to `check`, and #10 collapsed `check` into `test` — so dropping it here silently\n" +
    "  undoes #8 and lets the examples' types rot again.",
  );
}

console.log("Test wiring intact: build precedes typecheck; demos are typechecked.");
