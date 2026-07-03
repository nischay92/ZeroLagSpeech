import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sidecar = resolve(root, "apps/sidecar");
const windows = process.platform === "win32";
const launcher = windows ? "py" : "python3.12";
const launcherArgs = windows ? ["-3.12"] : [];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(launcher, [...launcherArgs, "-m", "venv", ".venv"], sidecar);

const python = windows
  ? resolve(sidecar, ".venv/Scripts/python.exe")
  : resolve(sidecar, ".venv/bin/python");

run(python, ["-m", "pip", "install", "-r", "requirements-dev.txt"], sidecar);
