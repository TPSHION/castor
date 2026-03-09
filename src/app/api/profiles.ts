import type {
  ConnectRequest,
  ConnectionProfile,
  DeleteConnectionProfileRequest,
  UpsertConnectionProfileRequest
} from '../../types';
import { invokeTauri, invokeTauriWithRequest } from './tauri';

export function listConnectionProfiles() {
  return invokeTauri<ConnectionProfile[]>('list_connection_profiles');
}

export function upsertConnectionProfile(request: UpsertConnectionProfileRequest) {
  return invokeTauriWithRequest<ConnectionProfile, UpsertConnectionProfileRequest>(
    'upsert_connection_profile',
    request
  );
}

export function testSshConnection(request: ConnectRequest) {
  return invokeTauriWithRequest<string, ConnectRequest>('test_ssh_connection', request);
}

export function deleteConnectionProfile(request: DeleteConnectionProfileRequest) {
  return invokeTauriWithRequest<void, DeleteConnectionProfileRequest>('delete_connection_profile', request);
}
