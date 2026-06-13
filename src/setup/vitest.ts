import { afterEach } from "vitest";
import { flushPendingSaves } from "../core/cassette/registry";

// Registered via vitest `setupFiles`: in record mode, flush each test's cassette writes.
afterEach(async () => {
  await flushPendingSaves();
});
