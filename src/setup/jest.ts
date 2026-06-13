import { afterEach } from "@jest/globals";
import { flushPendingSaves } from "../core/cassette/registry";

// Registered via jest `setupFilesAfterEach`: in record mode, flush each test's cassette writes.
afterEach(async () => {
  await flushPendingSaves();
});
