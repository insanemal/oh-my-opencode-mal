import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin";
import type { BackgroundTaskManager } from "../features";
import { getAgentListDescription, getAgentNames } from "../agents";
import {
  POLL_INTERVAL_MS,
  MAX_POLL_TIME_MS,
  DEFAULT_TIMEOUT_MS,
  STABLE_POLLS_THRESHOLD,
} from "../config";
import { spawnTmuxPane, closeTmuxPane, type TmuxConfig } from "../utils/tmux";

const z = tool.schema;

type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

export function createBackgroundTools(
  ctx: PluginInput,
  manager: BackgroundTaskManager,
  tmuxConfig?: TmuxConfig
): Record<string, ToolDefinition> {
  const agentList = getAgentListDescription();
  const agentNames = getAgentNames().join(", ");

  const background_task = tool({
    description: `Run agent task. Use sync=true to wait for result, sync=false (default) to run in background.

Agents: ${agentList}.

Async mode returns task_id immediately - use \`background_output\` to get results.
Sync mode blocks until completion and returns the result directly.`,
    args: {
      description: z.string().describe("Short description of the task (5-10 words)"),
      prompt: z.string().describe("The task prompt for the agent"),
      agent: z.string().describe(`Agent to use: ${agentNames}`),
      sync: z.boolean().optional().describe("Wait for completion (default: false = async)"),
      session_id: z.string().optional().describe("Continue existing session (sync mode only)"),
    },
    async execute(args, toolContext) {
      const tctx = toolContext as ToolContext;
      const agent = String(args.agent);
      const prompt = String(args.prompt);
      const description = String(args.description);
      const isSync = args.sync === true;

      if (isSync) {
        return await executeSync(description, prompt, agent, tctx, ctx, tmuxConfig, args.session_id as string | undefined);
      }

      const task = await manager.launch({
        agent,
        prompt,
        description,
        parentSessionId: tctx.sessionID,
      });

      return `Background task launched.

Task ID: ${task.id}
Agent: ${agent}
Status: running

Use \`background_output\` with task_id="${task.id}" to get results.`;
    },
  });

  const background_output = tool({
    description: "Get output from background task.",
    args: {
      task_id: z.string().describe("Task ID from background_task"),
      block: z.boolean().optional().describe("Wait for completion (default: false)"),
      timeout: z.number().optional().describe("Timeout in ms (default: 120000)"),
    },
    async execute(args) {
      const taskId = String(args.task_id);
      const block = args.block === true;
      const timeout = typeof args.timeout === "number" ? args.timeout : DEFAULT_TIMEOUT_MS;

      const task = await manager.getResult(taskId, block, timeout);
      if (!task) {
        return `Task not found: ${taskId}`;
      }

      const duration = task.completedAt
        ? `${Math.floor((task.completedAt.getTime() - task.startedAt.getTime()) / 1000)}s`
        : "running";

      let output = `Task: ${task.id}
Description: ${task.description}
Status: ${task.status}
Duration: ${duration}

---

`;

      if (task.status === "completed" && task.result) {
        output += task.result;
      } else if (task.status === "failed") {
        output += `Error: ${task.error}`;
      } else {
        output += "(Task still running)";
      }

      return output;
    },
  });

  const background_cancel = tool({
    description: "Cancel running background task(s). Use all=true to cancel all.",
    args: {
      task_id: z.string().optional().describe("Specific task to cancel"),
      all: z.boolean().optional().describe("Cancel all running tasks"),
    },
    async execute(args) {
      if (args.all === true) {
        const count = manager.cancel();
        return `Cancelled ${count} running task(s).`;
      }

      if (typeof args.task_id === "string") {
        const count = manager.cancel(args.task_id);
        return count > 0 ? `Cancelled task ${args.task_id}.` : `Task ${args.task_id} not found or not running.`;
      }

      return "Specify task_id or use all=true.";
    },
  });

  return { background_task, background_output, background_cancel };
}

async function executeSync(
  description: string,
  prompt: string,
  agent: string,
  toolContext: ToolContext,
  ctx: PluginInput,
  tmuxConfig?: TmuxConfig,
  existingSessionId?: string
): Promise<string> {
  let sessionID: string;
  let paneId: string | undefined;

  // Helper to close pane and return result
  const closeAndReturn = async (result: string): Promise<string> => {
    if (paneId) {
      await closeTmuxPane(paneId);
    }
    return result;
  };

  if (existingSessionId) {
    const sessionResult = await ctx.client.session.get({ path: { id: existingSessionId } });
    if (sessionResult.error) {
      return `Error: Failed to get session: ${sessionResult.error}`;
    }
    sessionID = existingSessionId;
  } else {
    const parentSession = await ctx.client.session.get({ path: { id: toolContext.sessionID } }).catch(() => null);
    const parentDirectory = parentSession?.data?.directory ?? ctx.directory;

    const createResult = await ctx.client.session.create({
      body: {
        parentID: toolContext.sessionID,
        title: `${description} (@${agent})`,
      },
      query: { directory: parentDirectory },
    });

    if (createResult.error) {
      return `Error: Failed to create session: ${createResult.error}`;
    }
    sessionID = createResult.data.id;

    // Spawn tmux pane for sync task
    // IMPORTANT: We await here and add delay so TUI can start before we send prompt
    if (tmuxConfig?.enabled) {
      const serverUrl = ctx.serverUrl?.toString() ?? "http://localhost:4096";
      const paneResult = await spawnTmuxPane(
        sessionID,
        `@${agent}: ${description}`,
        tmuxConfig,
        serverUrl
      ).catch(() => ({ success: false, paneId: undefined }));
      
      // Store pane ID for auto-close when task completes
      if (paneResult.success && paneResult.paneId) {
        paneId = paneResult.paneId;
        // Give TUI time to initialize and subscribe to session events
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // Disable recursive delegation tools to prevent infinite loops
  try {
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent,
        tools: { background_task: false, task: false },
        parts: [{ type: "text", text: prompt }],
      },
    });
  } catch (error) {
    return closeAndReturn(`Error: Failed to send prompt: ${error instanceof Error ? error.message : String(error)}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`);
  }

  const pollStart = Date.now();
  let lastMsgCount = 0;
  let stablePolls = 0;

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    if (toolContext.abort?.aborted) {
      return closeAndReturn(`Task aborted.

<task_metadata>
session_id: ${sessionID}
</task_metadata>`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const statusResult = await ctx.client.session.status();
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>;
    const sessionStatus = allStatuses[sessionID];

    if (sessionStatus && sessionStatus.type !== "idle") {
      stablePolls = 0;
      lastMsgCount = 0;
      continue;
    }

    const messagesCheck = await ctx.client.session.messages({ path: { id: sessionID } });
    const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>;
    const currentMsgCount = msgs.length;

    if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
      stablePolls++;
      if (stablePolls >= STABLE_POLLS_THRESHOLD) break;
    } else {
      stablePolls = 0;
      lastMsgCount = currentMsgCount;
    }
  }

  if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
    return closeAndReturn(`Error: Agent timed out after 5 minutes.

<task_metadata>
session_id: ${sessionID}
</task_metadata>`);
  }

  const messagesResult = await ctx.client.session.messages({ path: { id: sessionID } });
  if (messagesResult.error) {
    return closeAndReturn(`Error: Failed to get messages: ${messagesResult.error}`);
  }

  const messages = messagesResult.data as Array<{ info?: { role: string }; parts?: Array<{ type: string; text?: string }> }>;
  const assistantMessages = messages.filter((m) => m.info?.role === "assistant");

  if (assistantMessages.length === 0) {
    return closeAndReturn(`Error: No response from agent.

<task_metadata>
session_id: ${sessionID}
</task_metadata>`);
  }

  const extractedContent: string[] = [];
  for (const message of assistantMessages) {
    for (const part of message.parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text);
      }
    }
  }

  const responseText = extractedContent.filter((t) => t.length > 0).join("\n\n");

  return closeAndReturn(`${responseText}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`);
}
