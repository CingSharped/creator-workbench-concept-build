const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearAllSavedYouTubeCredentials,
  persistSavedYouTubeClientId,
  persistSavedYouTubeClientSecret,
  persistStoredYouTubeSession,
  readSavedYouTubeClientSecret,
  readStoredYouTubeSession
} = require("../dist/electron/services/youtubeCredentialStore.js");

function createSettingsStore(initialValues = {}) {
  const settings = new Map(Object.entries(initialValues));

  return {
    getAppSetting(key) {
      return settings.has(key) ? settings.get(key) : null;
    },
    setAppSetting(key, value) {
      settings.set(key, value);
    },
    clearAppSetting(key) {
      settings.delete(key);
    }
  };
}

function createProtectedStorage(isAvailable = true) {
  return {
    isEncryptionAvailable() {
      return isAvailable;
    },
    encryptString(value) {
      return Buffer.from(`enc:${value}`, "utf8");
    },
    decryptString(value) {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith("enc:")) {
        throw new Error("Invalid protected payload.");
      }

      return decoded.slice(4);
    }
  };
}

function buildSession() {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-07-27T09:00:00.000Z",
    channelId: "channel-123",
    channelTitle: "Channel Title",
    connectedAt: "2026-07-27T08:00:00.000Z",
    scopes: ["scope-a", "scope-b"]
  };
}

test("persists client secrets outside the legacy plaintext key", () => {
  const store = createSettingsStore();
  const protectedStorage = createProtectedStorage();

  persistSavedYouTubeClientSecret(store, protectedStorage, "client-secret");

  assert.equal(store.getAppSetting("youtube.oauth_client_secret"), null);
  assert.notEqual(store.getAppSetting("youtube.oauth_client_secret_protected"), null);
  assert.notEqual(store.getAppSetting("youtube.oauth_client_secret_protected"), "client-secret");
  assert.equal(readSavedYouTubeClientSecret(store, protectedStorage), "client-secret");
});

test("migrates a legacy plaintext client secret on first read", () => {
  const store = createSettingsStore({
    "youtube.oauth_client_secret": "legacy-secret"
  });
  const protectedStorage = createProtectedStorage();

  assert.equal(readSavedYouTubeClientSecret(store, protectedStorage), "legacy-secret");
  assert.equal(store.getAppSetting("youtube.oauth_client_secret"), null);
  assert.notEqual(store.getAppSetting("youtube.oauth_client_secret_protected"), null);
});

test("migrates a legacy plaintext session only after it validates", () => {
  const session = buildSession();
  const store = createSettingsStore({
    "youtube.oauth_session": JSON.stringify(session)
  });
  const protectedStorage = createProtectedStorage();

  assert.deepEqual(readStoredYouTubeSession(store, protectedStorage), session);
  assert.equal(store.getAppSetting("youtube.oauth_session"), null);
  assert.notEqual(store.getAppSetting("youtube.oauth_session_protected"), null);
});

test("drops an invalid legacy plaintext session instead of encrypting it", () => {
  const store = createSettingsStore({
    "youtube.oauth_session": JSON.stringify({
      refreshToken: 42,
      channelId: "channel-123"
    })
  });
  const protectedStorage = createProtectedStorage();

  assert.equal(readStoredYouTubeSession(store, protectedStorage), null);
  assert.equal(store.getAppSetting("youtube.oauth_session"), null);
  assert.equal(store.getAppSetting("youtube.oauth_session_protected"), null);
});

test("clears client id, protected secret, and protected session together", () => {
  const store = createSettingsStore();
  const protectedStorage = createProtectedStorage();

  persistSavedYouTubeClientId(store, "client-id");
  persistSavedYouTubeClientSecret(store, protectedStorage, "client-secret");
  persistStoredYouTubeSession(store, protectedStorage, buildSession());

  clearAllSavedYouTubeCredentials(store);

  assert.equal(store.getAppSetting("youtube.oauth_client_id"), null);
  assert.equal(store.getAppSetting("youtube.oauth_client_secret"), null);
  assert.equal(store.getAppSetting("youtube.oauth_client_secret_protected"), null);
  assert.equal(store.getAppSetting("youtube.oauth_session"), null);
  assert.equal(store.getAppSetting("youtube.oauth_session_protected"), null);
});

test("refuses to write new protected data when OS-backed encryption is unavailable", () => {
  const store = createSettingsStore();
  const protectedStorage = createProtectedStorage(false);

  assert.throws(
    () => persistSavedYouTubeClientSecret(store, protectedStorage, "client-secret"),
    /Protected credential storage is unavailable/
  );
  assert.equal(store.getAppSetting("youtube.oauth_client_secret"), null);
  assert.equal(store.getAppSetting("youtube.oauth_client_secret_protected"), null);
});
