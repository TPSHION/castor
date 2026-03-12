import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applySslCertificate,
  deleteSslCertificate,
  listSslCertificates,
  renewSslCertificate,
  syncSslCertificateStatus,
  upsertSslCertificate
} from '../../api/ssl';
import { formatInvokeError } from '../../helpers';
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
    reloadCommand: 'systemctl reload nginx',
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
      reloadCommand: item.reload_command ?? 'systemctl reload nginx',
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

    setActionBusy(true);
    setMessage('正在申请并部署证书...');
    setMessageIsError(false);

    try {
      const result = await applySslCertificate({ id: targetId });
      replaceCertificate(result.certificate);
      setMessage(result.message);
      setMessageIsError(!result.success);
    } catch (error) {
      setMessage(`申请证书失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      setActionBusy(false);
    }
  }, [editingCertificateId, replaceCertificate]);

  const onSaveAndApply = useCallback(async () => {
    const saved = await onSaveDraft();
    if (!saved) {
      return;
    }
    await onApplyCertificate(saved.id);
  }, [onApplyCertificate, onSaveDraft]);

  const onRenewCertificate = useCallback(async (certificateId: string) => {
    setActionBusy(true);
    setMessage('正在执行证书续期...');
    setMessageIsError(false);

    try {
      const result = await renewSslCertificate({ id: certificateId });
      replaceCertificate(result.certificate);
      setMessage(result.message);
      setMessageIsError(!result.success);
    } catch (error) {
      setMessage(`证书续期失败：${formatInvokeError(error)}`);
      setMessageIsError(true);
    } finally {
      setActionBusy(false);
    }
  }, [replaceCertificate]);

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

  return {
    selectedProfileId,
    setSelectedProfileId,
    selectedProfile,
    certificates,
    listBusy,
    actionBusy,
    message,
    messageIsError,
    editingCertificateId,
    draft,
    formatStatusLabel,
    onPatchDraft,
    onResetDraft,
    onLoadCertificates,
    onPickCertificate,
    onSaveDraft,
    onSaveAndApply,
    onApplyCertificate,
    onRenewCertificate,
    onSyncCertificate,
    onDeleteCertificate
  };
}
