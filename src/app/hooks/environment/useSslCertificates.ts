import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySslCertificate,
  deleteSslCertificate,
  issueSslCertificate,
  listSslCertificates,
  renewSslCertificate,
  syncSslCertificateStatus,
  upsertSslCertificate
} from '../../api/ssl';
import { sftpDownloadFile } from '../../api/sftp';
import { buildAuthFromProfile, formatInvokeError } from '../../helpers';
import type { ConnectionProfile, SslCertificate, SslDnsEnvVar, SslChallengeType, UpsertSslCertificateRequest } from '../../../types';

type SslFormDraft = {
  domain: string;
  email: string;
  challengeType: SslChallengeType;
  webrootPath: string;
  dnsProvider: string;
  dnsEnvText: string;
  keyFile: string;
  fullchainFile: string;
  reloadCommand: string;
  autoRenewEnabled: boolean;
  renewBeforeDays: number;
  renewAt: string;
};

type SslOperationType = 'issue' | 'renew';
type SslOperationMode = 'issue_only' | 'issue_deploy' | 'renew_deploy';
type SslFlowStepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

type SslFlowStep = {
  key: string;
  title: string;
  description: string;
  status: SslFlowStepStatus;
};

type SslOperationLog = {
  operation: SslOperationType;
  mode: SslOperationMode;
  domain: string;
  success: boolean;
  exitStatus: number;
  stdout: string;
  stderr: string;
  message: string;
  timestamp: number;
  steps: SslFlowStep[];
};

function createInitialDraft(): SslFormDraft {
  return {
    domain: '',
    email: '',
    challengeType: 'http',
    webrootPath: '/var/www/html',
    dnsProvider: 'dns_cf',
    dnsEnvText: '',
    keyFile: '',
    fullchainFile: '',
    reloadCommand: '',
    autoRenewEnabled: true,
    renewBeforeDays: 30,
    renewAt: '03:00'
  };
}

function toDnsEnvText(env: SslDnsEnvVar[]): string {
  return env.map((item) => `${item.key}=${item.value}`).join('\n');
}

function parseDnsEnvText(source: string): SslDnsEnvVar[] {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const result: SslDnsEnvVar[] = [];
  for (const line of lines) {
    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1);
    if (!key) {
      continue;
    }
    result.push({ key, value });
  }

  return result;
}

function formatStatusLabel(status: SslCertificate['status']) {
  if (status === 'active') {
    return '生效中';
  }
  if (status === 'expiring') {
    return '即将到期';
  }
  if (status === 'failed') {
    return '失败';
  }
  return '待处理';
}

function createFlowTemplate(mode: SslOperationMode): SslFlowStep[] {
  if (mode === 'issue_only') {
    return [
      {
        key: 'client_ready',
        title: '准备 ACME 客户端',
        description: '检查并安装 acme.sh（如缺失）',
        status: 'pending'
      },
      {
        key: 'request_done',
        title: '域名验证并申请证书',
        description: '执行 HTTP-01 / DNS-01 验证与签发',
        status: 'pending'
      },
      {
        key: 'deploy_skipped',
        title: '跳过部署',
        description: '仅签发，不安装到业务证书路径',
        status: 'pending'
      }
    ];
  }

  if (mode === 'renew_deploy') {
    return [
      {
        key: 'client_ready',
        title: '准备 ACME 客户端',
        description: '检查并安装 acme.sh（如缺失）',
        status: 'pending'
      },
      {
        key: 'request_done',
        title: '执行证书续期',
        description: '按策略检查并续签证书',
        status: 'pending'
      },
      {
        key: 'deploy_done',
        title: '安装证书到目标路径',
        description: '写入 key/fullchain，执行可选后置命令',
        status: 'pending'
      },
      {
        key: 'renew_plan_done',
        title: '配置自动续期任务',
        description: '写入或更新远端 crontab',
        status: 'pending'
      },
      {
        key: 'metadata_done',
        title: '同步证书元信息',
        description: '回填 issuer / 有效期 / 状态',
        status: 'pending'
      }
    ];
  }

  return [
    {
      key: 'client_ready',
      title: '准备 ACME 客户端',
      description: '检查并安装 acme.sh（如缺失）',
      status: 'pending'
    },
    {
      key: 'request_done',
      title: '域名验证并申请证书',
      description: '执行 HTTP-01 / DNS-01 验证与签发',
      status: 'pending'
    },
    {
      key: 'deploy_done',
      title: '安装证书到目标路径',
      description: '写入 key/fullchain，执行可选后置命令',
      status: 'pending'
    },
    {
      key: 'renew_plan_done',
      title: '配置自动续期任务',
      description: '写入或更新远端 crontab',
      status: 'pending'
    },
    {
      key: 'metadata_done',
      title: '同步证书元信息',
      description: '回填 issuer / 有效期 / 状态',
      status: 'pending'
    }
  ];
}

function parseStepMarkers(stdout: string, stderr: string): Set<string> {
  const markers = new Set<string>();
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('__CASTOR_STEP__')) {
      continue;
    }
    const marker = line.replace('__CASTOR_STEP__', '').trim();
    if (marker) {
      markers.add(marker);
    }
  }
  return markers;
}

function resolveFlowSteps(
  mode: SslOperationMode,
  success: boolean,
  stdout: string,
  stderr: string
): SslFlowStep[] {
  const markers = parseStepMarkers(stdout, stderr);
  const template = createFlowTemplate(mode);

  const next = template.map((step) => {
    if (step.key === 'renew_plan_done') {
      if (markers.has('renew_plan_failed')) {
        return { ...step, status: 'failed' as const };
      }
      if (markers.has('renew_plan_done')) {
        return { ...step, status: 'completed' as const };
      }
      if (markers.has('renew_plan_skipped')) {
        return { ...step, status: 'skipped' as const };
      }
      return step;
    }

    if (markers.has(step.key)) {
      return { ...step, status: 'completed' as const };
    }
    return step;
  });

  if (!success) {
    const failedIndex = next.findIndex((step) => step.status === 'pending');
    if (failedIndex >= 0) {
      next[failedIndex] = { ...next[failedIndex], status: 'failed' };
    } else if (next.length > 0 && next.every((step) => step.status !== 'failed')) {
      next[next.length - 1] = { ...next[next.length - 1], status: 'failed' };
    }
  }

  return next;
}

function createInProgressFlow(mode: SslOperationMode): SslFlowStep[] {
  const steps = createFlowTemplate(mode);
  if (steps.length > 0) {
    steps[0] = { ...steps[0], status: 'active' };
  }
  return steps;
}

export function useSslCertificates(profiles: ConnectionProfile[]) {
  const loadRequestIdRef = useRef<string | null>(null);

  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.id ?? '');
  const [editingCertificateId, setEditingCertificateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SslFormDraft>(createInitialDraft());
  const [certificates, setCertificates] = useState<SslCertificate[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [lastOperationLog, setLastOperationLog] = useState<SslOperationLog | null>(null);

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedProfileId('');
      setCertificates([]);
      setEditingCertificateId(null);
      setDraft(createInitialDraft());
      setMessage('暂无服务器配置，请先新增服务器。');
      setMessageIsError(false);
      return;
    }

    if (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const onLoadCertificates = useCallback(async () => {
    if (!selectedProfileId) {
      setCertificates([]);
      return;
    }

    const requestId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    loadRequestIdRef.current = requestId;
    setListBusy(true);

    try {
      const result = await listSslCertificates({ profile_id: selectedProfileId });
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setCertificates(result);
      setEditingCertificateId((current) => (current && !result.some((item) => item.id === current) ? null : current));
      setMessage(result.length === 0 ? '暂无证书配置。' : `已加载 ${result.length} 条证书记录。`);
      setMessageIsError(false);
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) {
        return;
      }
      setMessage(`加载证书列表失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      if (loadRequestIdRef.current === requestId) {
        loadRequestIdRef.current = null;
        setListBusy(false);
      }
    }
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId) {
      return;
    }
    setMessage('正在加载证书列表...');
    setMessageIsError(false);
    void onLoadCertificates();
  }, [onLoadCertificates, selectedProfileId]);

  const onPatchDraft = useCallback((patch: Partial<SslFormDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const onResetDraft = useCallback(() => {
    setEditingCertificateId(null);
    setDraft(createInitialDraft());
    setMessage('已重置表单。');
    setMessageIsError(false);
  }, []);

  const onPickCertificate = useCallback((item: SslCertificate) => {
    setEditingCertificateId(item.id);
    setDraft({
      domain: item.domain,
      email: item.email ?? '',
      challengeType: item.challenge_type,
      webrootPath: item.webroot_path ?? '/var/www/html',
      dnsProvider: item.dns_provider ?? 'dns_cf',
      dnsEnvText: toDnsEnvText(item.dns_env),
      keyFile: item.key_file,
      fullchainFile: item.fullchain_file,
      reloadCommand: item.reload_command ?? '',
      autoRenewEnabled: item.auto_renew_enabled,
      renewBeforeDays: item.renew_before_days,
      renewAt: item.renew_at
    });
    setMessage(`已载入证书配置：${item.domain}`);
    setMessageIsError(false);
  }, []);

  const replaceCertificate = useCallback((nextItem: SslCertificate) => {
    setCertificates((prev) => {
      const index = prev.findIndex((item) => item.id === nextItem.id);
      if (index < 0) {
        return [nextItem, ...prev];
      }
      const next = [...prev];
      next[index] = nextItem;
      return next;
    });
  }, []);

  const removeCertificate = useCallback((targetId: string) => {
    setCertificates((prev) => prev.filter((item) => item.id !== targetId));
  }, []);

  const buildUpsertRequest = useCallback((): UpsertSslCertificateRequest | null => {
    if (!selectedProfileId) {
      setMessage('请选择目标服务器。');
      setMessageIsError(true);
      return null;
    }

    const domain = draft.domain.trim().toLowerCase();
    if (!domain) {
      setMessage('请填写域名。');
      setMessageIsError(true);
      return null;
    }

    const keyFile = draft.keyFile.trim();
    const fullchainFile = draft.fullchainFile.trim();
    if (!keyFile || !fullchainFile) {
      setMessage('请填写证书输出路径（key/fullchain）。');
      setMessageIsError(true);
      return null;
    }

    const request: UpsertSslCertificateRequest = {
      id: editingCertificateId ?? undefined,
      profile_id: selectedProfileId,
      domain,
      email: draft.email.trim() || undefined,
      challenge_type: draft.challengeType,
      webroot_path: draft.challengeType === 'http' ? draft.webrootPath.trim() || undefined : undefined,
      dns_provider: draft.challengeType === 'dns' ? draft.dnsProvider.trim() || undefined : undefined,
      dns_env: draft.challengeType === 'dns' ? parseDnsEnvText(draft.dnsEnvText) : [],
      key_file: keyFile,
      fullchain_file: fullchainFile,
      reload_command: draft.reloadCommand.trim() || undefined,
      auto_renew_enabled: draft.autoRenewEnabled,
      renew_before_days: Number(draft.renewBeforeDays),
      renew_at: draft.renewAt
    };

    return request;
  }, [draft, editingCertificateId, selectedProfileId]);

  const onSaveDraft = useCallback(async () => {
    const request = buildUpsertRequest();
    if (!request) {
      return null;
    }

    setActionBusy(true);
    setMessage('正在保存证书配置...');
    setMessageIsError(false);

    try {
      const saved = await upsertSslCertificate(request);
      setEditingCertificateId(saved.id);
      replaceCertificate(saved);
      setMessage(`已保存证书配置：${saved.domain}`);
      setMessageIsError(false);
      return saved;
    } catch (error) {
      setMessage(`保存证书配置失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
      return null;
    } finally {
      setActionBusy(false);
    }
  }, [buildUpsertRequest, replaceCertificate]);

  const onApplyCertificate = useCallback(async (certificateId?: string) => {
    const targetId = certificateId ?? editingCertificateId;
    if (!targetId) {
      setMessage('请先保存证书配置。');
      setMessageIsError(true);
      return;
    }
    const targetDomain = certificates.find((item) => item.id === targetId)?.domain ?? targetId;

    setActionBusy(true);
    setMessage('正在申请并部署证书...');
    setMessageIsError(false);
    setLastOperationLog({
      operation: 'issue',
      mode: 'issue_deploy',
      domain: targetDomain,
      success: false,
      exitStatus: -1,
      stdout: '',
      stderr: '',
      message: '正在申请并部署证书...',
      timestamp: Date.now(),
      steps: createInProgressFlow('issue_deploy')
    });

    try {
      const result = await applySslCertificate({ id: targetId });
      replaceCertificate(result.certificate);
      setMessage(result.message);
      setMessageIsError(!result.success);
      setLastOperationLog({
        operation: 'issue',
        mode: 'issue_deploy',
        domain: result.certificate.domain,
        success: result.success,
        exitStatus: result.exit_status,
        stdout: result.stdout,
        stderr: result.stderr,
        message: result.message,
        timestamp: Date.now(),
        steps: resolveFlowSteps('issue_deploy', result.success, result.stdout, result.stderr)
      });
    } catch (error) {
      const errorMessage = formatInvokeError(error);
      setMessage(`申请证书失败：${errorMessage}`);
      setMessageIsError(true);
      setLastOperationLog({
        operation: 'issue',
        mode: 'issue_deploy',
        domain: targetId,
        success: false,
        exitStatus: -1,
        stdout: '',
        stderr: errorMessage,
        message: `申请证书失败：${errorMessage}`,
        timestamp: Date.now(),
        steps: resolveFlowSteps('issue_deploy', false, '', errorMessage)
      });
    } finally {
      setActionBusy(false);
    }
  }, [certificates, editingCertificateId, replaceCertificate]);

  const onIssueCertificate = useCallback(async (certificateId?: string) => {
    const targetId = certificateId ?? editingCertificateId;
    if (!targetId) {
      setMessage('请先保存证书配置。');
      setMessageIsError(true);
      return;
    }
    const targetDomain = certificates.find((item) => item.id === targetId)?.domain ?? targetId;

    setActionBusy(true);
    setMessage('正在申请证书（不部署）...');
    setMessageIsError(false);
    setLastOperationLog({
      operation: 'issue',
      mode: 'issue_only',
      domain: targetDomain,
      success: false,
      exitStatus: -1,
      stdout: '',
      stderr: '',
      message: '正在申请证书（不部署）...',
      timestamp: Date.now(),
      steps: createInProgressFlow('issue_only')
    });

    try {
      const result = await issueSslCertificate({ id: targetId });
      replaceCertificate(result.certificate);
      setMessage(result.message);
      setMessageIsError(!result.success);
      setLastOperationLog({
        operation: 'issue',
        mode: 'issue_only',
        domain: result.certificate.domain,
        success: result.success,
        exitStatus: result.exit_status,
        stdout: result.stdout,
        stderr: result.stderr,
        message: result.message,
        timestamp: Date.now(),
        steps: resolveFlowSteps('issue_only', result.success, result.stdout, result.stderr)
      });
    } catch (error) {
      const errorMessage = formatInvokeError(error);
      setMessage(`申请证书失败：${errorMessage}`);
      setMessageIsError(true);
      setLastOperationLog({
        operation: 'issue',
        mode: 'issue_only',
        domain: targetId,
        success: false,
        exitStatus: -1,
        stdout: '',
        stderr: errorMessage,
        message: `申请证书失败：${errorMessage}`,
        timestamp: Date.now(),
        steps: resolveFlowSteps('issue_only', false, '', errorMessage)
      });
    } finally {
      setActionBusy(false);
    }
  }, [certificates, editingCertificateId, replaceCertificate]);

  const onSaveAndApply = useCallback(async () => {
    const saved = await onSaveDraft();
    if (!saved) {
      return;
    }
    await onApplyCertificate(saved.id);
  }, [onApplyCertificate, onSaveDraft]);

  const onSaveAndIssue = useCallback(async () => {
    const saved = await onSaveDraft();
    if (!saved) {
      return;
    }
    await onIssueCertificate(saved.id);
  }, [onIssueCertificate, onSaveDraft]);

  const onRenewCertificate = useCallback(async (certificateId: string) => {
    const targetDomain = certificates.find((item) => item.id === certificateId)?.domain ?? certificateId;
    setActionBusy(true);
    setMessage('正在执行证书续期...');
    setMessageIsError(false);
    setLastOperationLog({
      operation: 'renew',
      mode: 'renew_deploy',
      domain: targetDomain,
      success: false,
      exitStatus: -1,
      stdout: '',
      stderr: '',
      message: '正在执行证书续期...',
      timestamp: Date.now(),
      steps: createInProgressFlow('renew_deploy')
    });

    try {
      const result = await renewSslCertificate({ id: certificateId });
      replaceCertificate(result.certificate);
      setMessage(result.message);
      setMessageIsError(!result.success);
      setLastOperationLog({
        operation: 'renew',
        mode: 'renew_deploy',
        domain: result.certificate.domain,
        success: result.success,
        exitStatus: result.exit_status,
        stdout: result.stdout,
        stderr: result.stderr,
        message: result.message,
        timestamp: Date.now(),
        steps: resolveFlowSteps('renew_deploy', result.success, result.stdout, result.stderr)
      });
    } catch (error) {
      const errorMessage = formatInvokeError(error);
      setMessage(`证书续期失败：${errorMessage}`);
      setMessageIsError(true);
      setLastOperationLog({
        operation: 'renew',
        mode: 'renew_deploy',
        domain: certificateId,
        success: false,
        exitStatus: -1,
        stdout: '',
        stderr: errorMessage,
        message: `证书续期失败：${errorMessage}`,
        timestamp: Date.now(),
        steps: resolveFlowSteps('renew_deploy', false, '', errorMessage)
      });
    } finally {
      setActionBusy(false);
    }
  }, [certificates, replaceCertificate]);

  const onClearLastOperationLog = useCallback(() => {
    setLastOperationLog(null);
  }, []);

  const onSyncCertificate = useCallback(async (certificateId: string) => {
    setActionBusy(true);
    setMessage('正在同步证书状态...');
    setMessageIsError(false);

    try {
      const result = await syncSslCertificateStatus({ id: certificateId });
      replaceCertificate(result);
      setMessage(`已同步证书状态：${result.domain}`);
      setMessageIsError(false);
    } catch (error) {
      setMessage(`同步证书状态失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      setActionBusy(false);
    }
  }, [replaceCertificate]);

  const onDeleteCertificate = useCallback(async (certificateId: string) => {
    setActionBusy(true);
    setMessage('正在删除证书配置...');
    setMessageIsError(false);

    try {
      await deleteSslCertificate({ id: certificateId });
      if (editingCertificateId === certificateId) {
        setEditingCertificateId(null);
        setDraft(createInitialDraft());
      }
      removeCertificate(certificateId);
      setMessage('证书配置已删除。');
      setMessageIsError(false);
    } catch (error) {
      setMessage(`删除证书配置失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      setActionBusy(false);
    }
  }, [editingCertificateId, removeCertificate]);

  const onDownloadCertificateFile = useCallback(
    async (certificateId: string, fileType: 'fullchain' | 'key') => {
      const certificate = certificates.find((item) => item.id === certificateId);
      if (!certificate) {
        setMessage('目标证书不存在。');
        setMessageIsError(true);
        return;
      }

      const profile = profiles.find((item) => item.id === certificate.profile_id);
      if (!profile) {
        setMessage('未找到证书对应的服务器配置。');
        setMessageIsError(true);
        return;
      }

      const auth = buildAuthFromProfile(profile);
      if (!auth) {
        setMessage(`服务器 ${profile.name} 缺少可用凭据，请先编辑并保存。`);
        setMessageIsError(true);
        return;
      }

      const remotePath = fileType === 'fullchain' ? certificate.fullchain_file : certificate.key_file;
      const label = fileType === 'fullchain' ? '证书链' : '私钥';
      setActionBusy(true);
      setMessage(`正在下载${label}文件...`);
      setMessageIsError(false);

      try {
        const result = await sftpDownloadFile({
          host: profile.host,
          port: profile.port,
          username: profile.username,
          auth,
          remote_path: remotePath
        });
        setMessage(`${label}下载完成：${result.local_path}`);
        setMessageIsError(false);
      } catch (error) {
        setMessage(`${label}下载失败：${formatInvokeError(error)}`);
        setMessageIsError(true);
      } finally {
        setActionBusy(false);
      }
    },
    [certificates, profiles]
  );

  return {
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    certificates,
    listBusy,
    actionBusy,
    message,
    messageIsError,
    lastOperationLog,
    editingCertificateId,
    draft,
    formatStatusLabel,
    onPatchDraft,
    onResetDraft,
    onLoadCertificates,
    onPickCertificate,
    onSaveDraft,
    onSaveAndIssue,
    onSaveAndApply,
    onIssueCertificate,
    onApplyCertificate,
    onRenewCertificate,
    onSyncCertificate,
    onDeleteCertificate,
    onClearLastOperationLog,
    onDownloadCertificateFile
  };
}
