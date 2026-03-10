import type {
  RuntimeDeployLanguage,
  RuntimeDeployVersionItem,
  RuntimeDeployVersionsResult
} from '../../../types';

const CACHE_STORAGE_KEY = 'castor.runtime_deploy_versions_cache.v1';

type RuntimeVersionCacheEntry = {
  profile_id: string;
  language: RuntimeDeployLanguage;
  manager: string;
  versions: RuntimeDeployVersionItem[];
  updated_at: number;
};

type RuntimeVersionCacheStore = Record<string, RuntimeVersionCacheEntry>;

function buildCacheKey(profileId: string, language: RuntimeDeployLanguage): string {
  return `${profileId}::${language}`;
}

function readStore(): RuntimeVersionCacheStore {
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as RuntimeVersionCacheStore;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeStore(store: RuntimeVersionCacheStore) {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore cache write failures to avoid blocking main flow.
  }
}

export function readRuntimeVersionCache(
  profileId: string,
  language: RuntimeDeployLanguage
): RuntimeDeployVersionsResult | null {
  if (!profileId) {
    return null;
  }
  const store = readStore();
  const key = buildCacheKey(profileId, language);
  const entry = store[key];
  if (!entry || !Array.isArray(entry.versions) || entry.versions.length === 0) {
    return null;
  }
  return {
    language: entry.language,
    manager: entry.manager,
    versions: entry.versions
  };
}

export function writeRuntimeVersionCache(profileId: string, result: RuntimeDeployVersionsResult) {
  if (!profileId || result.versions.length === 0) {
    return;
  }
  const store = readStore();
  const key = buildCacheKey(profileId, result.language);
  store[key] = {
    profile_id: profileId,
    language: result.language,
    manager: result.manager,
    versions: result.versions,
    updated_at: Date.now()
  };
  writeStore(store);
}
