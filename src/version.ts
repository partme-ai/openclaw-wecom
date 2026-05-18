import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const findPackageJson = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = resolve(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("找不到 package.json");
};

const pkg = JSON.parse(readFileSync(findPackageJson(), "utf-8")) as { version: string };

export const PLUGIN_VERSION: string = pkg.version ?? "";
