import prompts from "prompts";
import pc from "picocolors";

import {
  AGENTS_FILE,
  CLAUDE_FILE,
  type DirState,
  type SourceName,
} from "./types.js";

export type RootCase = "only-claude" | "only-agents" | "both" | "neither";

export interface RootDecision {
  source: SourceName;
  bootstrapRoot: boolean;
}

export function classifyRoot(root: DirState): RootCase {
  const hasClaude = root.claude.kind !== "missing";
  const hasAgents = root.agents.kind !== "missing";
  if (hasClaude && hasAgents) return "both";
  if (hasClaude) return "only-claude";
  if (hasAgents) return "only-agents";
  return "neither";
}

function cancel(): never {
  process.stdout.write(pc.dim("\nCancelled.\n"));
  process.exit(0);
}

const onCancel = () => cancel();

export async function decideRoot(
  rootState: DirState,
  options: {
    yes: boolean;
    sourceFlag?: SourceName;
  },
): Promise<RootDecision> {
  const rootCase = classifyRoot(rootState);

  // Honour explicit --source flag without prompting.
  if (options.sourceFlag) {
    return {
      source: options.sourceFlag,
      bootstrapRoot: rootCase === "neither",
    };
  }

  switch (rootCase) {
    case "only-claude": {
      if (options.yes) return { source: CLAUDE_FILE, bootstrapRoot: false };
      const { confirm } = await prompts(
        {
          type: "confirm",
          name: "confirm",
          message: `Found ${pc.bold(CLAUDE_FILE)} at repository root. Use ${pc.bold(CLAUDE_FILE)} as the source of truth across the repository?`,
          initial: true,
        },
        { onCancel },
      );
      if (!confirm) cancel();
      return { source: CLAUDE_FILE, bootstrapRoot: false };
    }

    case "only-agents": {
      if (options.yes) return { source: AGENTS_FILE, bootstrapRoot: false };
      const { confirm } = await prompts(
        {
          type: "confirm",
          name: "confirm",
          message: `Found ${pc.bold(AGENTS_FILE)} at repository root. Use ${pc.bold(AGENTS_FILE)} as the source of truth across the repository?`,
          initial: true,
        },
        { onCancel },
      );
      if (!confirm) cancel();
      return { source: AGENTS_FILE, bootstrapRoot: false };
    }

    case "both": {
      if (options.yes) {
        // Without an explicit choice, default to CLAUDE.md when both exist.
        return { source: CLAUDE_FILE, bootstrapRoot: false };
      }
      const { choice } = await prompts(
        {
          type: "select",
          name: "choice",
          message: `Both ${pc.bold(CLAUDE_FILE)} and ${pc.bold(AGENTS_FILE)} exist at repository root. Which one should be the source of truth for the repository?`,
          choices: [
            { title: `Keep ${CLAUDE_FILE}`, value: CLAUDE_FILE },
            { title: `Keep ${AGENTS_FILE}`, value: AGENTS_FILE },
            { title: "Cancel", value: "__cancel" },
          ],
          initial: 0,
        },
        { onCancel },
      );
      if (!choice || choice === "__cancel") cancel();
      return { source: choice as SourceName, bootstrapRoot: false };
    }

    case "neither": {
      if (options.yes) return { source: CLAUDE_FILE, bootstrapRoot: true };
      process.stdout.write(
        pc.dim(`No ${CLAUDE_FILE} or ${AGENTS_FILE} found at repository root.\n`),
      );
      const { choice } = await prompts(
        {
          type: "select",
          name: "choice",
          message: "Which file should become the repository standard?",
          choices: [
            { title: CLAUDE_FILE, value: CLAUDE_FILE },
            { title: AGENTS_FILE, value: AGENTS_FILE },
            { title: "Cancel", value: "__cancel" },
          ],
          initial: 0,
        },
        { onCancel },
      );
      if (!choice || choice === "__cancel") cancel();
      return { source: choice as SourceName, bootstrapRoot: true };
    }
  }
}

export async function confirmPlan(message: string): Promise<boolean> {
  const { ok } = await prompts(
    {
      type: "confirm",
      name: "ok",
      message,
      initial: true,
    },
    { onCancel },
  );
  return Boolean(ok);
}
