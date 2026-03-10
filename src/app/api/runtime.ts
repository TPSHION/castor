import type {
  CancelServerRuntimeProbeRequest,
  PreflightServerRuntimeProbeRequest,
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
