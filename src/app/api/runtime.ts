import type {
  CancelRuntimeDeployRequest,
  CancelServerRuntimeProbeRequest,
  ListRuntimeDeployVersionsRequest,
  PreflightServerRuntimeProbeRequest,
  RuntimeDeployApplyRequest,
  RuntimeDeployApplyResult,
  RuntimeDeployPlanRequest,
  RuntimeDeployPlanResult,
  RuntimeDeployVersionsResult,
  ProbeServerRuntimesRequest,
  RuntimeProbeResult
} from '../../types';
import { invokeTauriWithRequest } from './tauri';

export function probeServerRuntimes(request: ProbeServerRuntimesRequest) {
  return invokeTauriWithRequest<RuntimeProbeResult[], ProbeServerRuntimesRequest>('probe_server_runtimes', request);
}

export function preflightServerRuntimeProbe(request: PreflightServerRuntimeProbeRequest) {
  return invokeTauriWithRequest<void, PreflightServerRuntimeProbeRequest>('preflight_server_runtime_probe', request);
}

export function cancelServerRuntimeProbe(request: CancelServerRuntimeProbeRequest) {
  return invokeTauriWithRequest<void, CancelServerRuntimeProbeRequest>('cancel_server_runtime_probe', request);
}

export function planRuntimeDeploy(request: RuntimeDeployPlanRequest) {
  return invokeTauriWithRequest<RuntimeDeployPlanResult, RuntimeDeployPlanRequest>('plan_runtime_deploy', request);
}

export function applyRuntimeDeploy(request: RuntimeDeployApplyRequest) {
  return invokeTauriWithRequest<RuntimeDeployApplyResult, RuntimeDeployApplyRequest>('apply_runtime_deploy', request);
}

export function cancelRuntimeDeploy(request: CancelRuntimeDeployRequest) {
  return invokeTauriWithRequest<void, CancelRuntimeDeployRequest>('cancel_runtime_deploy', request);
}

export function listRuntimeDeployVersions(request: ListRuntimeDeployVersionsRequest) {
  return invokeTauriWithRequest<RuntimeDeployVersionsResult, ListRuntimeDeployVersionsRequest>(
    'list_runtime_deploy_versions',
    request
  );
}
