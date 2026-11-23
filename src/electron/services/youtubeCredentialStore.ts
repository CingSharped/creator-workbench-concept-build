export interface StoredYouTubeSession {
  accessToken: string | null;
  refreshToken: string;
  expiresAt: string | null;
  channelId: string;
  channelTitle: string;
  connectedAt: string;
  scopes: string[];
}

export interface SettingsStore {
  getAppSetting(key: string): string | null;
  setAppSetting(key: string, value: string): void;
  clearAppSetting(key: string): void;
}

export interface ProtectedStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const YOUTUBE_CLIENT_ID_SETTING_KEY = "youtube.oauth_client_id";
const YOUTUBE_CLIENT_SECRET_LEGACY_SETTING_KEY = "youtube.oauth_client_secret";
const YOUTUBE_CLIENT_SECRET_PROTECTED_SETTING_KEY = "youtube.oauth_client_secret_protected";
const YOUTUBE_SESSION_LEGACY_SETTING_KEY = "youtube.oauth_session";
const YOUTUBE_SESSION_PROTECTED_SETTING_KEY = "youtube.oauth_session_protected";

export function readSavedYouTubeClientId(store: SettingsStore): string {
  return store.getAppSetting(YOUTUBE_CLIENT_ID_SETTING_KEY)?.trim() ?? "";
}

export function persistSavedYouTubeClientId(store: SettingsStore, clientId: string): void {
  store.setAppSetting(YOUTUBE_CLIENT_ID_SETTING_KEY, clientId);
}

export function readSavedYouTubeClientSecret(
  store: SettingsStore,
  protectedStorage: ProtectedStorage
): string | null {
  const protectedValue = readEncryptedSetting(
    store,
    protectedStorage,
    YOUTUBE_CLIENT_SECRET_PROTECTED_SETTING_KEY
  );
  if (protectedValue) {
    return protectedValue.trim();
  }

  const legacyValue = store.getAppSetting(YOUTUBE_CLIENT_SECRET_LEGACY_SETTING_KEY);
  if (!legacyValue) {
    return null;
  }

  writeProtectedSetting(
    store,
    protectedStorage,
    YOUTUBE_CLIENT_SECRET_PROTECTED_SETTING_KEY,
    YOUTUBE_CLIENT_SECRET_LEGACY_SETTING_KEY,
    legacyValue,
    "save the YouTube OAuth client secret"
  );

  return legacyValue.trim() || null;
}

export function persistSavedYouTubeClientSecret(
  store: SettingsStore,
  protectedStorage: ProtectedStorage,
  clientSecret: string | null
): void {
  const normalizedClientSecret = clientSecret?.trim() ?? "";
  if (!normalizedClientSecret) {
    clearSavedYouTubeClientSecret(store);
    return;
  }

  writeProtectedSetting(
    store,
    protectedStorage,
    YOUTUBE_CLIENT_SECRET_PROTECTED_SETTING_KEY,
    YOUTUBE_CLIENT_SECRET_LEGACY_SETTING_KEY,
    normalizedClientSecret,
    "save the YouTube OAuth client secret"
  );
}

export function clearSavedYouTubeClientSecret(store: SettingsStore): void {
  store.clearAppSetting(YOUTUBE_CLIENT_SECRET_PROTECTED_SETTING_KEY);
  store.clearAppSetting(YOUTUBE_CLIENT_SECRET_LEGACY_SETTING_KEY);
}

export function readStoredYouTubeSession(
  store: SettingsStore,
  protectedStorage: ProtectedStorage
): StoredYouTubeSession | null {
  const protectedValue = readEncryptedSetting(
    store,
    protectedStorage,
    YOUTUBE_SESSION_PROTECTED_SETTING_KEY
  );
  const protectedSession = parseStoredYouTubeSession(protectedValue);
  if (protectedSession) {
    return protectedSession;
  }

  if (protectedValue) {
    store.clearAppSetting(YOUTUBE_SESSION_PROTECTED_SETTING_KEY);
  }

  const legacyValue = store.getAppSetting(YOUTUBE_SESSION_LEGACY_SETTING_KEY);
  if (!legacyValue) {
    return null;
  }

  const legacySession = parseStoredYouTubeSession(legacyValue);
  if (!legacySession) {
    store.clearAppSetting(YOUTUBE_SESSION_LEGACY_SETTING_KEY);
    return null;
  }

  persistStoredYouTubeSession(store, protectedStorage, legacySession);
  return legacySession;
}

export function persistStoredYouTubeSession(
  store: SettingsStore,
  protectedStorage: ProtectedStorage,
  session: StoredYouTubeSession
): void {
  writeProtectedSetting(
    store,
    protectedStorage,
    YOUTUBE_SESSION_PROTECTED_SETTING_KEY,
    YOUTUBE_SESSION_LEGACY_SETTING_KEY,
    JSON.stringify(session),
    "save the YouTube OAuth session"
  );
}

export function clearStoredYouTubeSession(store: SettingsStore): void {
  store.clearAppSetting(YOUTUBE_SESSION_PROTECTED_SETTING_KEY);
  store.clearAppSetting(YOUTUBE_SESSION_LEGACY_SETTING_KEY);
}

export function clearAllSavedYouTubeCredentials(store: SettingsStore): void {
  store.clearAppSetting(YOUTUBE_CLIENT_ID_SETTING_KEY);
  clearSavedYouTubeClientSecret(store);
  clearStoredYouTubeSession(store);
}

function readEncryptedSetting(
  store: SettingsStore,
  protectedStorage: ProtectedStorage,
  protectedKey: string
): string | null {
  const encryptedValue = store.getAppSetting(protectedKey)?.trim() ?? "";
  if (encryptedValue) {
    try {
      return protectedStorage.decryptString(Buffer.from(encryptedValue, "base64"));
    } catch {
      store.clearAppSetting(protectedKey);
    }
  }

  return null;
}

function writeProtectedSetting(
  store: SettingsStore,
  protectedStorage: ProtectedStorage,
  protectedKey: string,
  legacyKey: string,
  value: string,
  description: string
): void {
  if (!protectedStorage.isEncryptionAvailable()) {
    throw new Error(
      `Protected credential storage is unavailable, so Creator Workspace cannot ${description}. Restart the app and try again.`
    );
  }

  const encryptedValue = protectedStorage.encryptString(value).toString("base64");
  store.setAppSetting(protectedKey, encryptedValue);
  store.clearAppSetting(legacyKey);
}

function parseStoredYouTubeSession(raw: string | null): StoredYouTubeSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredYouTubeSession>;
    if (
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.channelId !== "string" ||
      typeof parsed.channelTitle !== "string" ||
      typeof parsed.connectedAt !== "string"
    ) {
      return null;
    }

    return {
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : null,
      refreshToken: parsed.refreshToken,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : null,
      channelId: parsed.channelId,
      channelTitle: parsed.channelTitle,
      connectedAt: parsed.connectedAt,
      scopes: Array.isArray(parsed.scopes)
        ? parsed.scopes.filter((scope): scope is string => typeof scope === "string")
        : []
    };
  } catch {
    return null;
  }
}
