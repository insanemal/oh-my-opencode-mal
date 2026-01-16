import { spawn } from "bun";
import { log } from "../shared/logger";

export interface TmuxConfig {
  enabled: boolean;
  split_direction?: "horizontal" | "vertical";
  pane_size?: number; // percentage 1-99
}

export const DEFAULT_TMUX_CONFIG: TmuxConfig = {
  enabled: false,
  split_direction: "horizontal",
  pane_size: 30,
};

let tmuxPath: string | null = null;
let tmuxChecked = false;

/**
 * Find tmux binary path
 */
async function findTmuxPath(): Promise<string | null> {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "where" : "which";

  try {
    const proc = spawn([cmd, "tmux"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log("[tmux] findTmuxPath: 'which tmux' failed", { exitCode });
      return null;
    }

    const stdout = await new Response(proc.stdout).text();
    const path = stdout.trim().split("\n")[0];
    if (!path) {
      log("[tmux] findTmuxPath: no path in output");
      return null;
    }

    // Verify it works
    const verifyProc = spawn([path, "-V"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const verifyExit = await verifyProc.exited;
    if (verifyExit !== 0) {
      log("[tmux] findTmuxPath: tmux -V failed", { path, verifyExit });
      return null;
    }

    log("[tmux] findTmuxPath: found tmux", { path });
    return path;
  } catch (err) {
    log("[tmux] findTmuxPath: exception", { error: String(err) });
    return null;
  }
}

/**
 * Get cached tmux path, initializing if needed
 */
export async function getTmuxPath(): Promise<string | null> {
  if (tmuxChecked) {
    return tmuxPath;
  }

  tmuxPath = await findTmuxPath();
  tmuxChecked = true;
  log("[tmux] getTmuxPath: initialized", { tmuxPath });
  return tmuxPath;
}

/**
 * Check if we're running inside tmux
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export interface SpawnPaneResult {
  success: boolean;
  paneId?: string; // e.g., "%42"
}

/**
 * Spawn a new tmux pane running `opencode attach <serverUrl> --session <sessionId>`
 * This connects the new TUI to the existing server so it receives streaming updates.
 * Returns the pane ID so it can be closed later.
 */
export async function spawnTmuxPane(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string
): Promise<SpawnPaneResult> {
  log("[tmux] spawnTmuxPane called", { sessionId, description, config, serverUrl });

  if (!config.enabled) {
    log("[tmux] spawnTmuxPane: config.enabled is false, skipping");
    return { success: false };
  }

  if (!isInsideTmux()) {
    log("[tmux] spawnTmuxPane: not inside tmux, skipping");
    return { success: false };
  }

  const tmux = await getTmuxPath();
  if (!tmux) {
    log("[tmux] spawnTmuxPane: tmux binary not found, skipping");
    return { success: false };
  }

  try {
    // Build split-window command
    const splitFlag = config.split_direction === "vertical" ? "-v" : "-h";
    const sizeFlag = config.pane_size ? ["-l", `${config.pane_size}%`] : [];

    // Use `opencode attach <url> --session <id>` to connect to the existing server
    // This ensures the TUI receives streaming updates from the same server handling the prompt
    const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`;

    // Use -P -F '#{pane_id}' to print the new pane's ID
    const args = [
      "split-window",
      splitFlag,
      ...sizeFlag,
      "-d", // Don't switch focus to new pane
      "-P", // Print pane info
      "-F", "#{pane_id}", // Format: just the pane ID
      opencodeCmd,
    ];

    log("[tmux] spawnTmuxPane: executing", { tmux, args, opencodeCmd });

    const proc = spawn([tmux, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const paneId = stdout.trim(); // e.g., "%42"

    log("[tmux] spawnTmuxPane: result", { exitCode, paneId, stderr: stderr.trim() });

    if (exitCode === 0 && paneId) {
      // Optionally rename the pane for visibility (target the new pane specifically)
      const renameProc = spawn(
        [tmux, "select-pane", "-t", paneId, "-T", description.slice(0, 30)],
        { stdout: "ignore", stderr: "ignore" }
      );
      await renameProc.exited;
      log("[tmux] spawnTmuxPane: SUCCESS, pane created", { paneId });
      return { success: true, paneId };
    }

    return { success: false };
  } catch (err) {
    log("[tmux] spawnTmuxPane: exception", { error: String(err) });
    return { success: false };
  }
}

/**
 * Close a tmux pane by its ID
 */
export async function closeTmuxPane(paneId: string): Promise<boolean> {
  log("[tmux] closeTmuxPane called", { paneId });

  if (!paneId) {
    log("[tmux] closeTmuxPane: no paneId provided");
    return false;
  }

  const tmux = await getTmuxPath();
  if (!tmux) {
    log("[tmux] closeTmuxPane: tmux binary not found");
    return false;
  }

  try {
    const proc = spawn([tmux, "kill-pane", "-t", paneId], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();

    log("[tmux] closeTmuxPane: result", { exitCode, stderr: stderr.trim() });

    if (exitCode === 0) {
      log("[tmux] closeTmuxPane: SUCCESS, pane closed", { paneId });
      return true;
    }

    // Pane might already be closed (user closed it manually, or process exited)
    log("[tmux] closeTmuxPane: failed (pane may already be closed)", { paneId });
    return false;
  } catch (err) {
    log("[tmux] closeTmuxPane: exception", { error: String(err) });
    return false;
  }
}

/**
 * Start background check for tmux availability
 */
export function startTmuxCheck(): void {
  if (!tmuxChecked) {
    getTmuxPath().catch(() => {});
  }
}
