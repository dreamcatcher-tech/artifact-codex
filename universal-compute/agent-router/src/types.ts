export type User = {
  id: string;
};

export type AppStatus = 'ok' | 'maintenance' | 'invalid';

export type AppResolution = {
  app: string;
  status: AppStatus;
};

export type TargetLookup = {
  agentPath: string;
  machine: string;
};

