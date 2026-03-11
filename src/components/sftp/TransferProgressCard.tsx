import type { SftpTransferProgressPayload } from '../../types';
import { formatTransferEta } from './transferHelpers';

type TransferProgressCardProps = {
  payload: SftpTransferProgressPayload;
  kind: 'upload' | 'download';
  formatBytes: (value?: number) => string;
  onCancelUpload: (transferId: string) => void;
  onCancelDownload: (transferId: string) => void;
};

function getProgressTitle(payload: SftpTransferProgressPayload, kind: 'upload' | 'download') {
  if (payload.status === 'done') {
    return kind === 'upload' ? '上传完成' : '下载完成';
  }
  if (payload.status === 'error') {
    return kind === 'upload' ? '上传失败' : '下载失败';
  }
  if (payload.status === 'canceled') {
    return kind === 'upload' ? '上传已取消' : '下载已取消';
  }
  return kind === 'upload' ? '上传中' : '下载中';
}

export function TransferProgressCard({
  payload,
  kind,
  formatBytes,
  onCancelUpload,
  onCancelDownload
}: TransferProgressCardProps) {
  const title = getProgressTitle(payload, kind);

  return (
    <div className={payload.status === 'error' ? 'transfer-progress error' : 'transfer-progress'}>
      <p className="transfer-progress-path" title={payload.path}>
        {payload.path}
      </p>
      <div className="transfer-progress-meta">
        <span>
          {title} {payload.percent}%
        </span>
        <span>
          {formatBytes(payload.transferred_bytes)} / {formatBytes(payload.total_bytes)}
        </span>
      </div>
      <div className="transfer-progress-track">
        <div className="transfer-progress-bar" style={{ width: `${payload.percent}%` }} />
      </div>
      {kind === 'upload' && payload.status === 'running' && (
        <div className="transfer-progress-actions">
          <button
            type="button"
            className="transfer-progress-cancel"
            onClick={() => onCancelUpload(payload.transfer_id)}
          >
            取消上传
          </button>
        </div>
      )}
      {kind === 'download' && payload.status === 'running' && (
        <div className="transfer-progress-actions">
          <button
            type="button"
            className="transfer-progress-cancel"
            onClick={() => onCancelDownload(payload.transfer_id)}
          >
            取消下载
          </button>
        </div>
      )}
      {payload.status === 'running' && (
        <p className="transfer-progress-eta">
          预计剩余：{formatTransferEta(payload.eta_seconds)}
          {payload.speed_bps ? ` · ${formatBytes(payload.speed_bps)}/s` : ''}
        </p>
      )}
    </div>
  );
}
