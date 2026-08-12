import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import { defaultAgentCommand } from "./agents.js";
import { inspectProject } from "./project-assets.js";
import { pathExists } from "./runtime.js";
import { inspectProtectedFiles } from "./project-policy.js";

async function executableExists(command) {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env.PATH || "").split(delimiter).filter(Boolean).map((dir) => resolve(dir, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep searching PATH.
    }
  }
  return false;
}

export async function diagnoseProject(projectDir) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  add("runtime.node", nodeMajor >= 20 ? "pass" : "fail", `Node.js ${process.versions.node}; requires >=20`);

  const configPath = resolve(projectDir, ".openadk/config.yaml");
  if (!await pathExists(configPath)) {
    add("project.config", "fail", "Missing .openadk/config.yaml; run openadk start");
  } else {
    const config = await readFile(configPath, "utf8");
    const agent = config.match(/^defaultAgent:\s*(\S+)/m)?.[1] || "codex";
    const block = config.match(new RegExp(`${agent}:\\n((?:\\s{4}.+\\n?)*)`, "m"))?.[1] || "";
    const command = block.match(/^\s+command:\s*(\S+)/m)?.[1] || defaultAgentCommand(agent);
    const available = await executableExists(command);
    add("project.config", "pass", `Default Agent: ${agent}`);
    add("agent.command", available ? "pass" : "warn", `${command} ${available ? "is available" : "was not found on PATH"}`);
  }

  try {
    const inspection = await inspectProject(projectDir);
    add("project.assets", inspection.state === "blocked" ? "fail" : inspection.state === "upgrade-available" ? "warn" : "pass", `Project state: ${inspection.state}`);
    for (const reason of inspection.reasons) add("project.asset-detail", "fail", reason);
  } catch (error) {
    add("project.assets", "fail", error.message);
  }
  try {
    const protection = await inspectProtectedFiles(projectDir);
    add("project.protection", protection.ok ? "pass" : "fail", `${protection.files.length} protected file(s)`);
    for (const reason of protection.reasons) add("project.protection-detail", "fail", reason);
  } catch (error) {
    add("project.protection", "fail", error.message);
  }
  return { ok: !checks.some((check) => check.status === "fail"), checks };
}

export function renderDoctor(result) {
  return result.checks.map((check) => `${check.status.toUpperCase().padEnd(4)} ${check.id} - ${check.detail}`).join("\n");
}
