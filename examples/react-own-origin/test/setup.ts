import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount between tests so a screen's effects can't leak into the next one.
afterEach(cleanup);
