#!/usr/bin/env node
// Copy the patch module and shim sources from the repo root into the
// extension dir so the packaged .vsix is self-contained. Run before packaging.

import { cpSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

copyFileSync(join(root, "patch.mjs"), join(here, "patch.mjs"));
copyFileSync(join(root, "LICENSE"), join(here, "LICENSE"));

const dest = join(here, "src");
if (existsSync(dest)) rmSync(dest, { recursive: true });
cpSync(join(root, "src"), dest, { recursive: true });

console.log("synced patch.mjs + src/ into ext/");
