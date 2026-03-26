export type DelegationToolConfig = {
  background_task: boolean;
  task: boolean;
};

/**
 * Only Oracle may retain delegation tools in child sessions for now.
 * Other subagents keep recursive delegation disabled.
 */
export function getDelegationToolConfig(agent: string): DelegationToolConfig {
  const enabled = agent === 'oracle';

  return {
    background_task: enabled,
    task: enabled,
  };
}
