import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const FORBIDDEN = [
  ["private npm scope", /@(?:byted|bytesso|agentbuddy)\//i],
  ["private registry or host", /(?:bnpm|code)\.byted\.org/i],
  ["private authentication token", new RegExp(["BYTEDANCE", "SSO", "TOKEN"].join("_") + "|" + ["x", "sso", "token"].join("-"), "i")],
  ["managed AI gateway", new RegExp(["LLM", "Box"].join("") + "|AI" + "PaaS|" + ["model", "proxy"].join("[_ -]"), "i")]
];

async function walk(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if ([".git", "node_modules", "coverage", "dist"].includes(entry.name)) continue;
    const target = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

export async function auditRepository(projectDir) {
  const root = resolve(projectDir);
  const blockers = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch (error) {
    blockers.push(`package.json is missing or invalid: ${error.message}`);
  }
  if (manifest) {
    if (manifest.name !== "openadk") blockers.push("package name must be openadk");
    if (manifest.private === true) blockers.push("open source package cannot be private");
    if (manifest.license !== "MIT") blockers.push("package license must be MIT");
    if (manifest.publishConfig !== undefined) blockers.push("publishConfig is not allowed");
    for (const script of ["preinstall", "install", "postinstall", "prepublishOnly"]) {
      if (manifest.scripts?.[script]) blockers.push(`lifecycle script is not allowed: ${script}`);
    }
  }
  for (const file of await walk(root)) {
    if (![".js", ".json", ".md", ".yaml", ".yml"].includes(extname(file))) continue;
    const text = await readFile(file, "utf8");
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(text)) blockers.push(`${label}: ${relative(root, file)}`);
    }
  }
  return { ok: blockers.length === 0, blockers: [...new Set(blockers)].sort() };
}
