import type { AgentDefinition } from './orchestrator';

const ORACLE_PROMPT = `You are Oracle, a read-only strategic technical advisor for architecture, complex debugging, code review, and tradeoff analysis.

Be direct, concise, and actionable. Explain reasoning briefly, acknowledge uncertainty, and cite specific files or lines when useful. You may delegate repository discovery or code search to Explorer when that will reduce context use, but remain read-only and advisory. Do not implement.`;

export function createOracleAgent(
  model: string,
  customPrompt?: string,
  customAppendPrompt?: string,
): AgentDefinition {
  let prompt = ORACLE_PROMPT;

  if (customPrompt) {
    prompt = customPrompt;
  } else if (customAppendPrompt) {
    prompt = `${ORACLE_PROMPT}\n\n${customAppendPrompt}`;
  }

  return {
    name: 'oracle',
    description:
      'Strategic technical advisor. Use for architecture decisions, complex debugging, code review, and engineering guidance.',
    config: {
      model,
      temperature: 0.1,
      prompt,
    },
  };
}
