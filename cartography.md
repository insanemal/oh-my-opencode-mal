# 🗺️ Cartography Skill

**Objective**: Provide AI agents with a high-fidelity, hierarchical "mental map" of a codebase to enable precise context preparation and flow understanding.

## 🏛️ Core Architecture

Cartography operates through an orchestrated "bottom-up" analysis pattern, combining deterministic hashing with LLM reasoning.

### 1. The Helper Script (`cartography-helper`)
A lightweight utility designed for the Orchestrator to handle deterministic file operations.
- **Scanning**: Discovers directory structures while respecting `.gitignore` and default excludes (node_modules, .git, etc.).
- **Hashing**: Calculates MD5 hashes for individual files and a composite "Folder Hash" (hash of all valid file hashes in that directory).
- **Compact Frontmatter**: Manages a minimal YAML block in `codemap.md` to track state:
  ```yaml
  ---
  h: [folder_hash]
  f: [{p: path, h: file_hash}, ...]
  ---
  ```
- **Lifecycle**: If `codemap.md` doesn't exist, it scaffolds it. If it exists but hashes match, it skips processing.

### 2. Orchestration Strategy
The Orchestrator acts as the "Surveyor General," determining the scope and sequence of the map.
- **Importance Filtering**: Categorizes folders by project relevance (e.g., `src/`, `app/` are High; `tests/`, `docs/` are Low).
- **Extension Selection**: Dynamically decides which extensions to track based on the project language (e.g., `.ts` for TypeScript projects, `.py` for Python).
- **Parallel Execution**: Spawns multiple **Explorer** agents to analyze folders in parallel.
- **Dependency Chaining**: Ensures sub-folders are mapped *before* parent folders so the parent analysis can reference sub-folder summaries.

### 3. Analysis Pattern (The Explorer)
Explorers are tasked with generating the human/AI-readable body of the `codemap.md`.

**Capture Requirements:**
- **Purpose**: 1-2 sentence high-level role of the file.
- **Key Exports**: Critical components, classes, or functions (excluding signatures).
- **Dependencies**: Internal project imports that define the relationship between files.
- **Data Flow**: The narrative journey of data (e.g., `Webhook -> Validator -> Queue`).

**Constraint**: Avoid volatile information like function parameters or line numbers that change frequently.

## 🔄 Operational Workflow

1.  **Discovery Phase**: Orchestrator runs the helper script to scan the root and identifies "High Importance" directories.
2.  **Initial Hash Check**: The script identifies which folders are "Dirty" (hash mismatch or missing `codemap.md`).
3.  **Leaf-Node Analysis**: Explorers are dispatched to the deepest sub-folders first.
4.  **Incremental Update**: 
    - If a file hash changes, the Explorer re-analyzes only that file and updates the Folder Summary.
    - If no hashes change, the file is skipped entirely.
5.  **Hierarchy Assembly**: As sub-folders finish, parent Explorers synthesize those results into higher-level summaries until the Root Codemap is reached.

## 🤖 LLM Prompting Goal
The resulting `codemap.md` files serve as a "Pre-flight Checklist" for any future agent task. Instead of reading 100 files, an agent reads 1-5 `codemap.md` files to understand exactly where logic lives and how systems interact.

---

## 💬 Design Q&A (Decisions & Logic)

**Q: What is the primary use case?**
**A:** LLM context preparation. It provides agents with a structured map of the codebase before they begin work, reducing token waste and improving accuracy.

**Q: How are folders prioritized?**
**A:** Via "Code vs Non-Code" classification. Orchestrator identifies source directories (`src`, `lib`, `app`) as high priority and ignores noise (`tests`, `docs`, `dist`).

**Q: Why MD5 for hashing?**
**A:** Speed. The goal is rapid change detection to determine if an LLM needs to re-analyze a file, not cryptographic security.

**Q: What is the "Folder Hash" logic?**
**A:** It is a hash of all hashes of the "allowed" files within that folder. If any tracked file changes, the folder hash changes, triggering a re-map.

**Q: Why avoid function parameters in the codemap?**
**A:** They change too often. The codemap focuses on stable architectural "flows" and "purposes" rather than volatile signatures.

**Q: How does the hierarchy work?**
**A:** One `codemap.md` per folder. Sub-folders must be mapped before their parents so the parent can synthesize the sub-folder's high-level purpose into its own map.

**Q: What is the script's specific responsibility?**
**A:** The script is deterministic. It calculates hashes, manages the compact frontmatter, and scaffolds the file. It *never* generates the descriptive body; that is reserved for the Explorer agents.

**Q: How is parallelism handled?**
**A:** Explorers run in parallel for all "leaf" folders (folders with no sub-folders). Once a layer is complete, the Orchestrator moves up the tree.
