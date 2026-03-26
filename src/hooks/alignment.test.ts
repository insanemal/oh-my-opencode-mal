import { describe, expect, test } from 'bun:test';
import { createOrchestratorAgent } from '../agents/orchestrator';
import { createPhaseReminderHook } from './phase-reminder';
import { createPostReadNudgeHook } from './post-read-nudge';

describe('prompt and hook alignment', () => {
  test('orchestrator prompt uses routing-first workflow wording', () => {
    const agent = createOrchestratorAgent('test-model');

    expect(agent.config.prompt).toContain('You are an AI coding orchestrator.');
    expect(agent.config.prompt).toContain('<Routing>');
    expect(agent.config.prompt).toContain(
      'Need to find files, patterns, or map the codebase → @explorer',
    );
    expect(agent.config.prompt).toContain(
      'Routine implementation, known fixes, refactors, and multi-file code edits with a clear outcome → @fixer',
    );
    expect(agent.config.prompt).toContain(
      '1. Assess — parse the request and identify unknowns.',
    );
    expect(agent.config.prompt).toContain(
      '3. Execute & Verify — run the work, integrate results, and verify requirements.',
    );
    expect(agent.config.prompt).toContain(
      "Do not parallelize dependent delegations; if one agent needs another agent's output, wait and chain them sequentially",
    );
    expect(agent.config.prompt).toContain(
      'Discovery before strategy: use @explorer first when another specialist needs repository facts or file locations',
    );
    expect(agent.config.prompt).toContain(
      'Never call @oracle in parallel with @explorer when Oracle depends on repository discovery; wait for Explorer results first',
    );
    expect(agent.config.prompt).toContain(
      '@explorer is for discovery only: never ask it for implementation plans, change recommendations, or code edits',
    );
  });

  test('phase reminder uses aligned workflow text', async () => {
    const hook = createPhaseReminderHook();
    const messages = [
      {
        info: { role: 'user' },
        parts: [{ type: 'text', text: 'Implement the change' }],
      },
    ];

    await hook['experimental.chat.messages.transform']({}, { messages });

    expect(messages[0].parts[0].text).toContain(
      '<reminder>Assess → Route → Execute & Verify. Parallelize only independent tasks. If strategy depends on repository discovery, use @explorer first and wait before calling @oracle. Use @explorer for discovery only, not recommendations. For implementation-heavy tasks with clear scope, prefer @fixer over doing the coding yourself unless the change is tiny. Specialists: @explorer @librarian @oracle @designer @fixer.</reminder>',
    );
  });

  test('post-read nudge points to explorer or fixer', async () => {
    const hook = createPostReadNudgeHook();
    const output = {
      title: 'Read result',
      output: 'file contents',
      metadata: {},
    };

    await hook['tool.execute.after']({ tool: 'read' }, output);

    expect(output.output).toContain(
      'Reminder: if you need more discovery, use @explorer for discovery only. If the next step is clear implementation, prefer @fixer unless the change is tiny.',
    );
  });
});
