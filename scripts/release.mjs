// One-command release: `npm run release 1.2.0`
//
// Bumps the version in package.json, Cargo.toml, tauri.conf.json and both
// lockfiles (edited in place - no npm/cargo resolve, so it works offline), commits,
// tags v1.2.0 and pushes. The tag push triggers .github/workflows/release.yml,
// which builds, signs and publishes the release - installed copies pick it up
// on their next launch.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: npm run release <major.minor.patch>   e.g. npm run release 1.2.0");
  process.exit(1);
}

const run = cmd => execSync(cmd, { stdio: "inherit" });

if (execSync("git status --porcelain").toString().trim()) {
  console.error("Working tree is not clean - commit or stash your changes first.");
  process.exit(1);
}

const bump = (path, from, to) => {
  const before = readFileSync(path, "utf8");
  const after = before.replace(from, to);
  if (after === before) throw new Error(`Couldn't find the version in ${path}`);
  writeFileSync(path, after);
};

bump("package.json", /"version": "[^"]+"/, `"version": "${version}"`);
bump("src-tauri/tauri.conf.json", /"version": "[^"]+"/, `"version": "${version}"`);
bump("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
bump("src-tauri/Cargo.lock", /(name = "onevone-timer"\r?\nversion = )"[^"]+"/, `$1"${version}"`);

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
lock.version = version;
lock.packages[""].version = version;
writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
run("git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
run(`git commit -m "Release ${version}"`);
run(`git tag v${version}`);
run("git push");
run(`git push origin v${version}`);

console.log(`\nv${version} pushed. Follow the build under the repo's Actions tab.`);
