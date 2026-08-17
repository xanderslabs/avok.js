/**
 * The `avok-vault` entry point: argument parsing and dispatch, nothing else.
 *
 * Every subcommand lives in its own module so that the pure parts (config validation, header
 * generation) stay testable without a filesystem, and this file stays a table of contents.
 */

/** Injected so tests capture output instead of writing to the terminal. */
export interface CliIo {
  log: (line: string) => void;
}

const USAGE = [
  "avok-vault: build and serve the hardened Avok Vault page.",
  "",
  "  avok-vault init     write avok-origin.config.json",
  "  avok-vault build    emit the inlined page, the CSP, and the headers",
  "  avok-vault dev      serve the page locally with the real headers",
  "  avok-vault check    fetch a deployed Vault and confirm its CSP is live",
].join("\n");

export async function runCli(argv: string[], io: CliIo = { log: console.log }): Promise<number> {
  const [subcommand] = argv;

  if (!subcommand) {
    io.log(USAGE);
    return 1;
  }

  switch (subcommand) {
    case "init": {
      const { runInit } = await import("./init.js");
      return runInit(process.cwd(), io.log);
    }
    case "build": {
      const { buildVault, DEFAULT_OUT_DIR } = await import("./build.js");
      const out = `${process.cwd()}/${DEFAULT_OUT_DIR}`;
      await buildVault({ root: process.cwd(), out });
      io.log(`avok-vault: wrote ${DEFAULT_OUT_DIR}/index.html, _headers and csp-headers.txt`);
      return 0;
    }
    case "dev": {
      const { runDev } = await import("./dev.js");
      const { DEFAULT_OUT_DIR } = await import("./build.js");
      return runDev(`${process.cwd()}/${DEFAULT_OUT_DIR}`, 5173, io.log);
    }
    case "check": {
      const url = argv[1];
      if (!url) {
        io.log("avok-vault check: pass the deployed Vault URL, e.g. avok-vault check https://vault.example1.com");
        return 1;
      }
      const { runCheck } = await import("./check.js");
      return runCheck(url, io.log);
    }
    default:
      io.log(`avok-vault: unknown subcommand "${subcommand}".\n\n${USAGE}`);
      return 1;
  }
}
