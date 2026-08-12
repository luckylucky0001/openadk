export const AGENT_DEFINITIONS = Object.freeze({
  codex: Object.freeze({ command: "codex", displayName: "Codex" }),
  opencode: Object.freeze({ command: "opencode", displayName: "OpenCode" }),
  claude: Object.freeze({ command: "claude", displayName: "Claude Code" }),
  cursor: Object.freeze({ command: "cursor-agent", displayName: "Cursor Agent" })
});

export const AGENTS = Object.freeze(Object.keys(AGENT_DEFINITIONS));

export function defaultAgentCommand(agent) {
  return AGENT_DEFINITIONS[agent]?.command || agent;
}
