import type {
  LocalCreateDirRequest,
  LocalDeleteRequest,
  LocalListRequest,
  LocalListResponse,
  LocalRenameRequest
} from '../../types';
import { invokeTauriWithRequest } from './tauri';

export function listLocalDir(request: LocalListRequest) {
  return invokeTauriWithRequest<LocalListResponse, LocalListRequest>('list_local_dir', request);
}

export function localRenameEntry(request: LocalRenameRequest) {
  return invokeTauriWithRequest<void, LocalRenameRequest>('local_rename_entry', request);
}

export function localDeleteEntry(request: LocalDeleteRequest) {
  return invokeTauriWithRequest<void, LocalDeleteRequest>('local_delete_entry', request);
}

export function localCreateDir(request: LocalCreateDirRequest) {
  return invokeTauriWithRequest<void, LocalCreateDirRequest>('local_create_dir', request);
}
