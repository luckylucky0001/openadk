import { SPEC_PHASES, advanceSpec, checkSpec, createSpec, exportSpec, readSpec, recoverSpec } from "./spec-engine.js";
import { applyProjectUpgrade, inspectProject, recoverProjectAssets } from "./project-assets.js";
import { inspectProtectedFiles, protectProjectFiles } from "./project-policy.js";
import { runVerification } from "./verification.js";
import { diagnoseProject, renderDoctor } from "./doctor.js";
import { auditRepository } from "./repository-audit.js";

function parseFlag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasConfirmation(args) {
  return args.includes("--yes") || args.includes("-y");
}

export async function runSpecCommand(args) {
  const action = args[0];
  const id = parseFlag(args, "--id");
  if (!action) throw new Error("Missing Spec action. Try: openadk spec status");
  if (action === "init") {
    const title = args.slice(1).filter((value, index, all) => value !== "--id" && all[index - 1] !== "--id").join(" ").trim();
    const state = await createSpec(process.cwd(), title, id);
    console.log(`Created or recovered draft Spec: ${state.id} (revision ${state.revision})`);
    return;
  }
  if (action === "status") {
    const state = await readSpec(process.cwd(), id);
    const next = SPEC_PHASES[SPEC_PHASES.indexOf(state.phase) + 1] || "none";
    console.log(`Spec: ${state.id}\nTitle: ${state.title}\nPhase: ${state.phase}\nRevision: ${state.revision}\nNext: ${next}`);
    return;
  }
  if (action === "check") {
    const result = await checkSpec(process.cwd(), id);
    console.log(`Spec: ${result.state.id}\nCurrent phase: ${result.state.phase}\nNext phase: ${result.next || "none"}\nGate: ${result.valid ? "PASS" : "FAIL"}`);
    for (const error of result.errors) console.log(`- ${error}`);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (action === "advance") {
    const target = args.slice(1).find((value, index, all) => !value.startsWith("--") && all[index - 1] !== "--id");
    const state = await advanceSpec(process.cwd(), id, target);
    console.log(`Advanced ${state.id} to ${state.phase} (revision ${state.revision})`);
    return;
  }
  if (action === "export") {
    console.log(`Exported ${await exportSpec(process.cwd(), id)}`);
    return;
  }
  if (action === "recover") {
    if (!hasConfirmation(args)) throw new Error("E_SPEC_RECOVERY_CONFIRM_REQUIRED: Spec recovery requires --yes.");
    const state = await recoverSpec(process.cwd(), id);
    console.log(`Recovered ${state.id} to ${state.phase} (revision ${state.revision})`);
    return;
  }
  throw new Error(`Unknown Spec action: ${action}`);
}

export async function runProjectCommand(args) {
  const action = args[0];
  if (action === "protect") {
    if (args[1] === "status" || !args[1]) {
      const result = await inspectProtectedFiles(process.cwd());
      console.log(`Protected files: ${result.files.length}\nProtection state: ${result.ok ? "healthy" : "blocked"}`);
      for (const record of result.files) console.log(`- ${record.path}`);
      for (const reason of result.reasons) console.log(`- ${reason}`);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const paths = args.slice(1).filter((value) => !value.startsWith("--"));
    const policy = await protectProjectFiles(process.cwd(), paths);
    console.log(`Protected files: ${policy.files.length}`);
    for (const record of policy.files) console.log(`- ${record.path}`);
    return;
  }
  if (action === "status" || (action === "upgrade" && (!args[1] || args[1] === "status"))) {
    const inspection = await inspectProject(process.cwd());
    console.log(`Project state: ${inspection.state}\nMethod version: ${inspection.methodVersion || "not adopted"}`);
    if (inspection.targetVersion) console.log(`Available version: ${inspection.targetVersion}`);
    for (const reason of inspection.reasons) console.log(`- ${reason}`);
    if (inspection.state === "blocked") process.exitCode = 1;
    return;
  }
  if (action === "upgrade" && args[1] === "apply") {
    const inspection = await applyProjectUpgrade(process.cwd(), { confirmed: hasConfirmation(args) });
    console.log(`Project state: ${inspection.state}\nMethod version: ${inspection.methodVersion}`);
    return;
  }
  if (action === "upgrade" && args[1] === "recover") {
    if (!hasConfirmation(args)) throw new Error("E_PROJECT_RECOVERY_CONFIRM_REQUIRED: Project recovery requires --yes.");
    const inspection = await recoverProjectAssets(process.cwd());
    console.log(`Project state: ${inspection.state}\nMethod version: ${inspection.methodVersion}`);
    return;
  }
  throw new Error("Unknown project action. Try: openadk project status");
}

export async function runVerifyCommand(args) {
  if (args[0] !== "run") throw new Error("Unknown verify action. Try: openadk verify run --kind test --covers AC-001 -- npm test");
  const separator = args.indexOf("--");
  if (separator === -1 || !args[separator + 1]) throw new Error("E_VERIFY_COMMAND_REQUIRED: Put the command after --.");
  const kind = parseFlag(args.slice(0, separator), "--kind");
  const covers = parseFlag(args.slice(0, separator), "--covers");
  const state = await readSpec(process.cwd());
  const result = await runVerification(process.cwd(), state, {
    kind,
    covers,
    command: args[separator + 1],
    args: args.slice(separator + 2)
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`Verification receipt: ${result.receipt.id} (${result.receipt.kind}, ${result.receipt.passed ? "PASS" : "FAIL"})`);
  if (!result.receipt.passed) process.exitCode = result.receipt.exitCode || 1;
}

export async function runDoctorCommand(args) {
  const result = await diagnoseProject(process.cwd());
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : renderDoctor(result));
  if (!result.ok) process.exitCode = 1;
}

export async function runAuditCommand(args) {
  if (args[0] && args[0] !== "repo") throw new Error("Unknown audit action. Try: openadk audit repo");
  const result = await auditRepository(process.cwd());
  if (result.ok) console.log("OpenADK repository audit passed.");
  else for (const blocker of result.blockers) console.error(`- ${blocker}`);
  if (!result.ok) process.exitCode = 1;
}
