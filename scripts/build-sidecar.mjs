import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sidecar = resolve(root, "apps/sidecar");
const tauriBinaries = resolve(root, "apps/desktop/src-tauri/binaries");
const windows = process.platform === "win32";
const python = windows
  ? resolve(sidecar, ".venv/Scripts/python.exe")
  : resolve(sidecar, ".venv/bin/python");

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

run(python, ["-m", "pip", "install", "-r", "requirements-build.txt"], sidecar);
run(
  python,
  [
    "-m",
    "PyInstaller",
    "--clean",
    "--noconfirm",
    "--onefile",
    "--name",
    "zerolag-sidecar",
    "src/zerolag_sidecar/__main__.py",
  ],
  sidecar,
);

const rustc = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const target = /^host: (\S+)$/m.exec(rustc)?.[1];
if (!target) throw new Error("Could not determine the Rust host target");

mkdirSync(tauriBinaries, { recursive: true });
const extension = windows ? ".exe" : "";
const source = resolve(sidecar, "dist", `zerolag-sidecar${extension}`);
const destination = resolve(
  tauriBinaries,
  `zerolag-sidecar-${target}${extension}`,
);
copyFileSync(source, destination);
if (!windows) chmodSync(destination, 0o755);
console.log(`Prepared ${basename(destination)}`);
