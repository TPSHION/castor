import type {
  ApplyServerProxyNodeRequest,
  DeleteServerProxyConfigRequest,
  GetServerProxyRuntimeStatusRequest,
  ListServerProxyConfigsRequest,
  ServerProxyApplyResult,
  ServerProxyConfig,
  ServerProxyConnectivityResult,
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
