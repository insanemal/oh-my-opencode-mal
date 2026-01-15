// LSP Module - Explicit exports

export { lspManager } from "./client"
export {
  lsp_goto_definition,
  lsp_find_references,
  lsp_diagnostics,
  lsp_rename,
} from "./tools"

// Re-export types for external use
export type {
  LSPServerConfig,
  ResolvedServer,
  Diagnostic,
  Location,
  WorkspaceEdit,
} from "./types"
