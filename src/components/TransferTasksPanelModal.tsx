import type { SftpTransferProgressPayload } from '../types';

type TransferTasksPanelModalProps = {
  isOpen: boolean;
  title: string;
  kind: 'upload' | 'download';
  runningTasks: SftpTransferProgressPayload[];
  completedTasks: SftpTransferProgressPayload[];
  formatBytes: (value?: number) => string;
  formatEta: (value?: number | null) => string;
  onCancelTask: (transferId: string) => void;
  onClearCompleted: () => void;
  onClose: () => void;
};

function taskStatusLabel(kind: 'upload' | 'download', status: SftpTransferProgressPayload['status']) {
  if (status === 'done') {
    return kind === 'upload' ? '上传完成' : '下载完成';
  }
  if (status === 'error') {
    return kind === 'upload' ? '上传失败' : '下载失败';
  }
  if (status === 'canceled') {
    return kind === 'upload' ? '上传已取消' : '下载已取消';
  }
  return kind === 'upload' ? '上传中' : '下载中';
}

export function TransferTasksPanelModal({
  isOpen,
  title,
  kind,
  runningTasks,
  completedTasks,
  formatBytes,
  formatEta,
  onCancelTask,
  onClearCompleted,
  onClose
}: TransferTasksPanelModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="editor-modal-overlay" onClick={onClose}>
      <section
        className="editor-modal transfer-tasks-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="editor-modal-header">
          <h3>{title}</h3>
          <button type="button" className="header-action" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="editor-modal-body transfer-tasks-modal-body">
          <section className="transfer-task-section">
            <h4>进行中（{runningTasks.length}）</h4>
            {runningTasks.length === 0 ? (
              <p className="status-line">暂无进行中任务</p>
            ) : (
              <div className="transfer-task-list">
                {runningTasks.map((task) => (
                  <div key={task.transfer_id} className="transfer-progress">
                    <p className="transfer-progress-path" title={task.path}>
                      {task.path}
                    </p>
                    <div className="transfer-progress-meta">
                      <span>
                        {taskStatusLabel(kind, task.status)} {task.percent}%
                      </span>
                      <span>
                        {formatBytes(task.transferred_bytes)} / {formatBytes(task.total_bytes)}
                      </span>
                    </div>
                    <div className="transfer-progress-track">
                      <div className="transfer-progress-bar" style={{ width: `${task.percent}%` }} />
                    </div>
                    <div className="transfer-progress-actions">
                      <button
                        type="button"
                        className="transfer-progress-cancel"
                        onClick={() => onCancelTask(task.transfer_id)}
                      >
                        {kind === 'upload' ? '取消上传' : '取消下载'}
                      </button>
                    </div>
                    <p className="transfer-progress-eta">
                      预计剩余：{formatEta(task.eta_seconds)}
                      {task.speed_bps ? ` · ${formatBytes(task.speed_bps)}/s` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="transfer-task-section">
            <h4>已完成（{completedTasks.length}）</h4>
            {completedTasks.length === 0 ? (
              <p className="status-line">暂无已完成任务</p>
            ) : (
              <div className="transfer-task-list">
                {completedTasks.map((task) => (
                  <div key={task.transfer_id} className={task.status === 'error' ? 'transfer-progress error' : 'transfer-progress'}>
                    <p className="transfer-progress-path" title={task.path}>
                      {task.path}
                    </p>
                    <div className="transfer-progress-meta">
                      <span>
                        {taskStatusLabel(kind, task.status)} {task.percent}%
                      </span>
                      <span>
                        {formatBytes(task.transferred_bytes)} / {formatBytes(task.total_bytes)}
                      </span>
                    </div>
                    <div className="transfer-progress-track">
                      <div className="transfer-progress-bar" style={{ width: `${task.percent}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="editor-modal-footer">
          <button type="button" onClick={onClearCompleted} disabled={completedTasks.length === 0}>
            清空已完成
          </button>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
