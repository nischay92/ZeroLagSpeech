import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sidecar = resolve(root, "apps/sidecar");
const tauriBinaries = resolve(root, "apps/desktop/src-tauri/binaries");
const windows = process.platform === "win32";

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

const rustc = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const target = /^host: (\S+)$/m.exec(rustc)?.[1];
if (!target) throw new Error("Could not determine the Rust host target");

// pkg's target triples use its own platform/arch naming, not Rust's.
const pkgPlatform = windows ? "win" : process.platform === "darwin" ? "macos" : "linux";
const pkgArch = process.arch === "arm64" ? "arm64" : "x64";
const pkgTarget = `node22-${pkgPlatform}-${pkgArch}`;

mkdirSync(tauriBinaries, { recursive: true });
const extension = windows ? ".exe" : "";
const destination = resolve(tauriBinaries, `zerolag-sidecar-${target}${extension}`);

run(
  "npx",
  ["@yao-pkg/pkg", "-t", pkgTarget, "-o", destination, "src/server.js"],
  sidecar,
);

console.log(`Prepared ${basename(destination)}`);
