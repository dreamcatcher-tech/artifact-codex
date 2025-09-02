import type { TargetLookup } from '../types.ts';

// Stub for Registry MCP interactions
// - lookup_target(host, path, user): returns machine + normalized agent path

export const lookupTarget = async (
  _host: string,
  path: string,
  _userId?: string,
): Promise<TargetLookup> => {
  const clean = normalizeAgentPath(path);
  return { agentPath: clean, machine: 'local-dev' };
};

export const normalizeAgentPath = (path: string): string => {
  const p = path.replace(/^\/+/, '');
  if (p === '') return 'home-agent';
  return p;
};

