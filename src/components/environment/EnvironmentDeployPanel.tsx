import { useEffect, useMemo, useState } from 'react';
import type { ConnectionProfile } from '../../types';
import { EnvironmentDeploySection } from './EnvironmentDeploySection';

export function EnvironmentDeployPanel({ profiles }: { profiles: ConnectionProfile[] }) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.id ?? '');

  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedProfileId('');
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

  return (
    <section className="environment-deploy-page">
      {profiles.length === 0 ? (
        <div className="empty-state">暂无服务器配置，请先新增服务器。</div>
      ) : (
        <>
          <div className="environment-profile-bar">
            <label className="field-label">
              目标服务器
              <select
                className="sftp-profile-select"
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.username}@{profile.host}:{profile.port})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="environment-deploy-page-body">
            <EnvironmentDeploySection selectedProfileId={selectedProfileId} selectedProfile={selectedProfile} />
          </div>
        </>
      )}
    </section>
  );
}
