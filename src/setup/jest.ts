import { afterEach } from "@jest/globals";
import { flushPendingSaves } from "../core/cassette/registry";

// Registered via jest `setupFilesAfterEnv`: in record mode, flush each test's cassette writes.
afterEach(async () => {
  await flushPendingSaves();
});
