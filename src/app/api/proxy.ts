import type {
  ApplyMihomoProxyNodeRequest,
  ApplyServerProxyNodeRequest,
  CancelServerProxyApplyRequest,
  DeleteServerProxyConfigRequest,
  GetMihomoRuntimeStatusRequest,
  GetServerProxyRuntimeConfigRequest,
  GetServerProxyRuntimeStatusRequest,
  ListServerProxyConfigsRequest,
  MihomoProxyApplyResult,
  MihomoRuntimeStatusResult,
  ServerProxyApplyResult,
  ServerProxyCancelResult,
  ServerProxyConfig,
  ServerProxyConnectivityResult,
  ServerProxyRuntimeConfigResult,
  ServerProxyRuntimeStatusResult,
  SyncServerProxySubscriptionRequest,
  TestServerProxyConnectivityRequest
} from '../../types';
import { invokeTauriWithRequest } from './tauri';

export function listServerProxyConfigs(request: ListServerProxyConfigsRequest) {
  return invokeTauriWithRequest<ServerProxyConfig[], ListServerProxyConfigsRequest>('list_server_proxy_configs', request);
}

export function syncServerProxySubscription(request: SyncServerProxySubscriptionRequest) {
  return invokeTauriWithRequest<ServerProxyConfig, SyncServerProxySubscriptionRequest>(
    'sync_server_proxy_subscription',
    request
  );
}

export function deleteServerProxyConfig(request: DeleteServerProxyConfigRequest) {
  return invokeTauriWithRequest<void, DeleteServerProxyConfigRequest>('delete_server_proxy_config', request);
}

export function applyServerProxyNode(request: ApplyServerProxyNodeRequest) {
  return invokeTauriWithRequest<ServerProxyApplyResult, ApplyServerProxyNodeRequest>('apply_server_proxy_node', request);
}

export function applyMihomoProxyNode(request: ApplyMihomoProxyNodeRequest) {
  return invokeTauriWithRequest<MihomoProxyApplyResult, ApplyMihomoProxyNodeRequest>('apply_mihomo_proxy_node', request);
}

export function testServerProxyConnectivity(request: TestServerProxyConnectivityRequest) {
  return invokeTauriWithRequest<ServerProxyConnectivityResult, TestServerProxyConnectivityRequest>(
    'test_server_proxy_connectivity',
    request
  );
}

export function getServerProxyRuntimeStatus(request: GetServerProxyRuntimeStatusRequest) {
  return invokeTauriWithRequest<ServerProxyRuntimeStatusResult, GetServerProxyRuntimeStatusRequest>(
    'get_server_proxy_runtime_status',
    request
  );
}

export function getMihomoRuntimeStatus(request: GetMihomoRuntimeStatusRequest) {
  return invokeTauriWithRequest<MihomoRuntimeStatusResult, GetMihomoRuntimeStatusRequest>(
    'get_mihomo_runtime_status',
    request
  );
}

export function getServerProxyRuntimeConfig(request: GetServerProxyRuntimeConfigRequest) {
  return invokeTauriWithRequest<ServerProxyRuntimeConfigResult, GetServerProxyRuntimeConfigRequest>(
    'get_server_proxy_runtime_config',
    request
  );
}

export function cancelServerProxyApply(request: CancelServerProxyApplyRequest) {
  return invokeTauriWithRequest<ServerProxyCancelResult, CancelServerProxyApplyRequest>(
    'cancel_server_proxy_apply',
    request
  );
}
