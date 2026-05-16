#!/usr/bin/env node
import { run } from "./cli.js";

run().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`agentln: unexpected error: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
