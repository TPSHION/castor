import type {
  SftpCreateDirRequest,
  SftpDeleteRequest,
  SftpDownloadRequest,
  SftpDownloadResult,
  SftpEntry,
  SftpListRequest,
  SftpRenameRequest,
  SftpSetPermissionsRequest,
  SftpUploadRequest,
  SftpUploadResult
} from '../../types';
import { invokeTauriWithRequest } from './tauri';

export type CancelSftpTransferRequest = {
  transfer_id: string;
};

export function sftpListDir(request: SftpListRequest) {
  return invokeTauriWithRequest<SftpEntry[], SftpListRequest>('sftp_list_dir', request);
}

export function sftpRenameEntry(request: SftpRenameRequest) {
  return invokeTauriWithRequest<void, SftpRenameRequest>('sftp_rename_entry', request);
}

export function sftpDeleteEntry(request: SftpDeleteRequest) {
  return invokeTauriWithRequest<void, SftpDeleteRequest>('sftp_delete_entry', request);
}

export function sftpCreateDir(request: SftpCreateDirRequest) {
  return invokeTauriWithRequest<void, SftpCreateDirRequest>('sftp_create_dir', request);
}

export function sftpSetPermissions(request: SftpSetPermissionsRequest) {
  return invokeTauriWithRequest<void, SftpSetPermissionsRequest>('sftp_set_permissions', request);
}

export function sftpUploadPath(request: SftpUploadRequest) {
  return invokeTauriWithRequest<SftpUploadResult, SftpUploadRequest>('sftp_upload_path', request);
}

export function sftpDownloadFile(request: SftpDownloadRequest) {
  return invokeTauriWithRequest<SftpDownloadResult, SftpDownloadRequest>('sftp_download_file', request);
}

export function cancelSftpTransfer(request: CancelSftpTransferRequest) {
  return invokeTauriWithRequest<void, CancelSftpTransferRequest>('cancel_sftp_transfer', request);
}
