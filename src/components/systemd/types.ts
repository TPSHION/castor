import type { SystemdLogOutputMode, SystemdScope } from '../../types';

export type SystemdServiceType = 'node' | 'python' | 'java' | 'go' | 'dotnet' | 'docker' | 'custom';

export type SystemdFormState = {
  id?: string;
  profileId: string;
  name: string;
  serviceName: string;
  serviceType: SystemdServiceType;
  scope: SystemdScope;
  description: string;
  workingDir: string;
  execStart: string;
  execStop: string;
  serviceUser: string;
  environmentText: string;
  enableOnBoot: boolean;
  useSudo: boolean;
  logOutputMode: SystemdLogOutputMode;
  logOutputPath: string;
};

export type SystemdDeleteDialogState = {
  id: string;
  name: string;
  from: 'list' | 'detail';
  localOnly: boolean;
};
