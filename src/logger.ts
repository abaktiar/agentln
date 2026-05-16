import pc from "picocolors";

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  raw(msg: string): void;
  step(label: string, detail?: string): void;
}

export function createLogger(verbose: boolean): Logger {
  return {
    info(msg) {
      process.stdout.write(`${pc.cyan("›")} ${msg}\n`);
    },
    success(msg) {
      process.stdout.write(`${pc.green("✓")} ${msg}\n`);
    },
    warn(msg) {
      process.stderr.write(`${pc.yellow("!")} ${msg}\n`);
    },
    error(msg) {
      process.stderr.write(`${pc.red("✗")} ${msg}\n`);
    },
    debug(msg) {
      if (verbose) process.stdout.write(`${pc.dim("·")} ${pc.dim(msg)}\n`);
    },
    raw(msg) {
      process.stdout.write(`${msg}\n`);
    },
    step(label, detail) {
      const head = pc.magenta(label);
      process.stdout.write(detail ? `${head} ${pc.dim(detail)}\n` : `${head}\n`);
    },
  };
}
