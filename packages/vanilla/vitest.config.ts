import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://localhost/",
      },
    },
    // Disable Node.js 22+'s built-in global localStorage in test workers.
    // Without this flag, accessing globalThis.localStorage emits a warning
    // ("--localstorage-file was provided without a valid path"). Disabling
    // it allows vitest's jsdom environment to expose jsdom's own localStorage
    // on globalThis instead, giving pristine test output.
    execArgv: ["--no-experimental-webstorage"],
  },
});
