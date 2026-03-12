import type {
  ApplySslCertificateRequest,
  DeleteSslCertificateRequest,
  ListSslCertificatesRequest,
  RenewSslCertificateRequest,
  SslCertificate,
  SslCertificateOperationResult,
  SyncSslCertificateStatusRequest,
  UpsertSslCertificateRequest
} from '../../types';
import { invokeTauriWithRequest } from './tauri';

export function listSslCertificates(request: ListSslCertificatesRequest) {
  return invokeTauriWithRequest<SslCertificate[], ListSslCertificatesRequest>('list_ssl_certificates', request);
}

export function upsertSslCertificate(request: UpsertSslCertificateRequest) {
  return invokeTauriWithRequest<SslCertificate, UpsertSslCertificateRequest>('upsert_ssl_certificate', request);
}

export function deleteSslCertificate(request: DeleteSslCertificateRequest) {
  return invokeTauriWithRequest<void, DeleteSslCertificateRequest>('delete_ssl_certificate', request);
}

export function applySslCertificate(request: ApplySslCertificateRequest) {
  return invokeTauriWithRequest<SslCertificateOperationResult, ApplySslCertificateRequest>('apply_ssl_certificate', request);
}

export function renewSslCertificate(request: RenewSslCertificateRequest) {
  return invokeTauriWithRequest<SslCertificateOperationResult, RenewSslCertificateRequest>('renew_ssl_certificate', request);
}

export function syncSslCertificateStatus(request: SyncSslCertificateStatusRequest) {
  return invokeTauriWithRequest<SslCertificate, SyncSslCertificateStatusRequest>('sync_ssl_certificate_status', request);
}
