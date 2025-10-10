import { DEFAULT_SERVER_BASE_URL, API_TIMEOUT_MS } from "./config.js";
import { generateIdentity, encryptPayload, decryptPayload, serializeCipher, deserializeCipher } from "./lib/crypto.js";

const DEFAULT_SETTINGS = {
  serverBaseUrl: DEFAULT_SERVER_BASE_URL,
  currentUsername: "",
  ttlSeconds: 600,
  directDelivery: "off",
  acceptPrompt: "on"
};

const LOCAL_STATE_DEFAULT = {
  identityPrivateKey: null,
  identityPublicKey: null,
  authSecret: null,
  registeredUsername: null
};

const processedTokens = new Set();
const processedInboxIds = new Set();

async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

async function getLocalState() {
  return chrome.storage.local.get(LOCAL_STATE_DEFAULT);
}

async function saveLocalState(partial) {
  return chrome.storage.local.set(partial);
}

async function ensureIdentity() {
  const state = await getLocalState();
  if (state.identityPrivateKey && state.identityPublicKey) {
    return state;
  }
  const keys = await generateIdentity();
  const nextState = {
    identityPrivateKey: keys.privateJwk,
    identityPublicKey: keys.publicJwk,
    registeredUsername: state.registeredUsername || null,
    authSecret: state.authSecret || null
  };
  await saveLocalState(nextState);
  return nextState;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise
  ]);
}

async function apiFetch(baseUrl, path, options = {}) {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const mergedOptions = Object.assign(
    {
      headers: {
        "Content-Type": "application/json"
      }
    },
    options
  );

  const response = await withTimeout(fetch(url, mergedOptions), API_TIMEOUT_MS, "API request timed out.");
  const contentType = response.headers.get("content-type") || "";
  const parseJson = () => (contentType.includes("application/json") ? response.json() : response.text());

  if (!response.ok) {
    const errorPayload = await parseJson();
    const message = typeof errorPayload === "string"
      ? errorPayload
      : (errorPayload?.error || errorPayload?.message || (Array.isArray(errorPayload?.errors) ? errorPayload.errors.join(", ") : undefined));
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return parseJson();
}

async function registerIdentityIfNeeded() {
  const settings = await getSettings();
  const username = settings.currentUsername?.trim();
  if (!username) {
    throw new Error("Set your username in extension options.");
  }
  const state = await ensureIdentity();
  if (state.registeredUsername === username && state.authSecret) {
    return state;
  }
  const baseUrl = settings.serverBaseUrl || DEFAULT_SERVER_BASE_URL;
  const body = {
    publicKey: state.identityPublicKey,
  };
  if (state.authSecret && state.registeredUsername === username) {
    body.authSecret = state.authSecret;
  }
  const response = await apiFetch(baseUrl, `/v1/users/${encodeURIComponent(username)}`, {
    method: "POST",
    body: JSON.stringify(body)
  });

  const nextState = {
    identityPrivateKey: state.identityPrivateKey,
    identityPublicKey: state.identityPublicKey,
    registeredUsername: username,
    authSecret: response.authSecret || state.authSecret || null
  };
  await saveLocalState(nextState);
  return nextState;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/capture.js"]
    });
  } catch (error) {
    if (error?.message && !/Loading of script failed or timed out/i.test(error.message)) {
      throw error;
    }
  }
}

async function collectStorage(tabId) {
  await ensureContentScript(tabId);
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "collect-storage" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error("No response from content script."));
        return;
      }
      if (!response.ok) {
        reject(new Error(response.error || "Failed to collect storage."));
        return;
      }
      resolve({
        localStorage: response.localStorage || [],
        sessionStorage: response.sessionStorage || []
      });
    });
  });
}

async function captureSessionData(tab) {
  if (!tab?.url || !tab.url.startsWith("http")) {
    throw new Error("Active tab must be an http(s) page.");
  }
  const url = new URL(tab.url);
  const cookies = await chrome.cookies.getAll({ url: url.origin + url.pathname });
  const storage = await collectStorage(tab.id);

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    targetOrigin: url.origin,
    targetPath: url.pathname || "/",
    url: tab.url,
    cookies,
    localStorage: storage.localStorage,
    sessionStorage: storage.sessionStorage
  };
}

async function handleShareRequest(payload) {
  const settings = await getSettings();
  const baseUrl = settings.serverBaseUrl || DEFAULT_SERVER_BASE_URL;
  const username = settings.currentUsername?.trim();
  if (!username) {
    throw new Error("Set your username in extension options.");
  }

  const state = await registerIdentityIfNeeded();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found.");
  }

  const sessionData = await captureSessionData(tab);

  const recipientRecord = await apiFetch(baseUrl, `/v1/users/${encodeURIComponent(payload.recipientUsername)}`);
  const cipherBundle = await encryptPayload({
    payload: sessionData,
    senderPrivateJwk: state.identityPrivateKey,
    senderPublicJwk: state.identityPublicKey,
    recipientPublicJwk: recipientRecord.publicKey,
    targetOrigin: sessionData.targetOrigin
  });

  const body = {
    recipient: payload.recipientUsername,
    cipher: serializeCipher(cipherBundle),
    alg: cipherBundle.alg,
    cmp: cipherBundle.cmp,
    ttlSec: Number(settings.ttlSeconds) || 600,
    meta: {
      targetOrigin: sessionData.targetOrigin,
      targetPath: sessionData.targetPath,
      comment: payload.comment?.trim() || "",
      sender: username,
      sessionDurationSec: Number(payload.sessionDurationSec) || 0
    }
  };

  // Always use direct inbox delivery
  {
    await apiFetch(baseUrl, "/v1/inbox", {
      method: "POST",
      body: JSON.stringify(body)
    });
    return { sent: true };
  }
}

async function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for tab to load."));
    }, 20000);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function setCookies(cookies, referenceOrigin) {
  if (!Array.isArray(cookies)) {
    return;
  }
  const referenceUrl = referenceOrigin ? new URL(referenceOrigin) : null;
  for (const cookie of cookies) {
    try {
      const domain = cookie.domain ? cookie.domain.replace(/^\./, "") : referenceUrl?.hostname;
      const path = cookie.path || "/";
      const scheme = cookie.secure ? "https" : "http";
      const host = domain || referenceUrl?.hostname;
      if (!host) {
        console.warn("Skipping cookie without resolvable host", cookie?.name);
        continue;
      }
      const url = `${scheme}://${host}${path.startsWith("/") ? path : `/${path}`}`;
      const setOptions = {
        url,
        name: cookie.name,
        value: cookie.value,
        path: path,
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly)
      };
      if (cookie.domain) {
        setOptions.domain = cookie.domain;
      }
      if (cookie.expirationDate) {
        setOptions.expirationDate = cookie.expirationDate;
      }
      if (cookie.sameSite && cookie.sameSite !== "unspecified") {
        setOptions.sameSite = cookie.sameSite;
      }
      if (cookie.storeId) {
        setOptions.storeId = cookie.storeId;
      }
      await chrome.cookies.set(setOptions);
    } catch (error) {
      console.warn("Failed to set cookie", cookie?.name, error);
    }
  }
}

async function restoreStorage(tabId, storageData) {
  if (!storageData) {
    return;
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    func: ({ localEntries, sessionEntries }) => {
      if (Array.isArray(localEntries)) {
        localEntries.forEach(([key, value]) => {
          try {
            window.localStorage.setItem(key, value);
          } catch (error) {
            console.warn("Failed to set localStorage", key, error);
          }
        });
      }
      if (Array.isArray(sessionEntries)) {
        sessionEntries.forEach(([key, value]) => {
          try {
            window.sessionStorage.setItem(key, value);
          } catch (error) {
            console.warn("Failed to set sessionStorage", key, error);
          }
        });
      }
    },
    args: [{
      localEntries: storageData.localStorage || [],
      sessionEntries: storageData.sessionStorage || []
    }]
  });
}

async function notify(title, message) {
  try {
    const iconUrl = chrome.runtime.getURL("icons/icon128.png");
    await chrome.notifications.create({
      type: "basic",
      iconUrl,
      title,
      message
    });
  } catch (error) {
    console.info("Notifications unavailable", error);
  }
}

async function logoutOriginNow(targetOrigin) {
  try {
    const u = new URL(targetOrigin);
    const host = u.hostname;
    // Remove all cookies for the domain
    const all = await chrome.cookies.getAll({ domain: host });
    for (const c of all) {
      const scheme = c.secure ? 'https' : 'http';
      const url = `${scheme}://${(c.domain || host).replace(/^\./,'')}${c.path || '/'}`;
      try { await chrome.cookies.remove({ url, name: c.name }); } catch (_) {}
    }
    // Clear storages by opening a temporary tab
    const temp = await chrome.tabs.create({ url: targetOrigin, active: false });
    await waitForTabComplete(temp.id);
    await chrome.scripting.executeScript({
      target: { tabId: temp.id },
      func: () => { try { localStorage.clear(); } catch(_){} try { sessionStorage.clear(); } catch(_){} }
    });
    await chrome.tabs.remove(temp.id);
  } catch (e) {
    console.warn('Immediate logout failed', e);
  }
}

async function handleSessionAcceptance(details) {
  const settings = await getSettings();
  // Derive API base from the link itself to avoid mismatches with configured server URL
  let baseUrl;
  try {
    baseUrl = new URL(details.url).origin;
  } catch (_) {
    baseUrl = settings.serverBaseUrl || DEFAULT_SERVER_BASE_URL;
  }
  const username = settings.currentUsername?.trim();
  if (!username) {
  await notify("PublicPass", "Set your username in extension options before accepting sessions.");
    return;
  }

  const state = await ensureIdentity();
  const url = new URL(details.url);
  const token = url.pathname.split("/").pop();
  if (!token || processedTokens.has(token)) {
    return;
  }

  try {
    processedTokens.add(token);
  const shareResponse = await apiFetch(baseUrl, `/v1/shares/${encodeURIComponent(token)}`);
    const bundle = deserializeCipher(shareResponse.cipher);
    const sessionData = await decryptPayload({
      bundle,
      recipientPrivateJwk: state.identityPrivateKey,
      targetOrigin: shareResponse.meta?.targetOrigin || bundle.targetOrigin
    });

    if (sessionData.targetOrigin) {
      const originUrl = new URL(sessionData.targetOrigin);
      if (originUrl.protocol === 'https:' && !sessionData.cookies.every((c) => !c.secure || originUrl.protocol === 'https:')) {
        // best-effort logging, still proceed.
        console.debug('Applying secure cookies on HTTPS origin');
      }
    }

    await setCookies(sessionData.cookies, sessionData.targetOrigin || sessionData.url);

    const targetUrl = sessionData.url || `${sessionData.targetOrigin}${sessionData.targetPath || '/'}`;
    const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
    await waitForTabComplete(newTab.id);
    try {
      await restoreStorage(newTab.id, {
        localStorage: sessionData.localStorage,
        sessionStorage: sessionData.sessionStorage
      });
    } catch (e) {
      console.warn('Restore storage failed; proceeding with cookies-only session', e);
      try { await notify('PublicPass', 'Storage restore failed; cookies applied'); } catch (_) {}
    }

  await apiFetch(baseUrl, `/v1/shares/${encodeURIComponent(token)}/consume`, { method: "POST" });
    await maybeScheduleLogout(bundle, sessionData);
    await notify("PublicPass", "Session accepted. You should be logged in.");
    try {
      await chrome.tabs.remove(details.tabId);
    } catch (error) {
  console.info("Unable to close PublicPass tab", error);
    }
  } catch (error) {
    console.error("Failed to accept session share", error);
  await notify("PublicPass", `Failed to accept session: ${error.message}`);
    processedTokens.delete(token);
  }
}

// Keep track of pending link accept prompts by token
const pendingAccepts = new Map();

function showAcceptNotification(token, fromUrl) {
  const iconUrl = chrome.runtime.getURL("icons/icon128.png");
  const title = "PublicPass";
  const message = "Incoming session link detected. Accept to open and import session.";
  return chrome.notifications.create(`accept:${token}`, {
    type: "basic",
    iconUrl,
    title,
    message,
    buttons: [
      { title: "Accept" },
      { title: "Dismiss" }
    ]
  });
}

async function maybeScheduleLogout(bundle, sessionData, idOverride) {
  const duration = Number(bundle?.meta?.sessionDurationSec || bundle?.sessionDurationSec || 0);
  if (!duration || duration <= 0) return;
  const jobId = idOverride || (bundle?.token || `${Date.now()}`);
  const cleanup = {
    id: jobId,
    targetOrigin: sessionData.targetOrigin || new URL(sessionData.url).origin,
    cookies: (sessionData.cookies || []).map(c => ({ name: c.name, domain: c.domain, path: c.path || '/' , secure: !!c.secure })),
    localStorageKeys: (sessionData.localStorage || []).map(([k]) => k),
    sessionStorageKeys: (sessionData.sessionStorage || []).map(([k]) => k)
  };
  const key = `logoutJobs`;
  const stored = (await chrome.storage.local.get({ [key]: [] }))[key] || [];
  stored.push(cleanup);
  await chrome.storage.local.set({ [key]: stored });
  const when = Date.now() + duration * 1000;
  await chrome.alarms.create(`logout:${jobId}`, { when });
}

async function pollInboxOnce() {
  const settings = await getSettings();
  const baseUrl = settings.serverBaseUrl || DEFAULT_SERVER_BASE_URL;
  const username = settings.currentUsername?.trim();
  if (!username) return;
  try {
    const res = await apiFetch(baseUrl, `/v1/inbox/poll?recipient=${encodeURIComponent(username)}&limit=10`);
    const toAck = [];
    for (const item of res.items || []) {
      if (processedInboxIds.has(item.id)) continue;
      try {
        const type = (item.meta?.type || 'share');
        if (type === 'revoke') {
          const origin = item.meta?.targetOrigin;
          if (origin) {
            await logoutOriginNow(origin);
            await notify('PublicPass', 'Session revoked by admin. You have been logged out.');
          }
          processedInboxIds.add(item.id);
          toAck.push(item.id);
          continue;
        }
        // Default: share
        const bundle = deserializeCipher(item.cipher);
        const state = await ensureIdentity();
        const sessionData = await decryptPayload({ bundle, recipientPrivateJwk: state.identityPrivateKey, targetOrigin: item.meta?.targetOrigin || bundle.targetOrigin });
        await setCookies(sessionData.cookies, sessionData.targetOrigin || sessionData.url);
        const targetUrl = sessionData.url || `${sessionData.targetOrigin}${sessionData.targetPath || '/'}`;
        const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
        await waitForTabComplete(newTab.id);
        await restoreStorage(newTab.id, { localStorage: sessionData.localStorage, sessionStorage: sessionData.sessionStorage });
        await maybeScheduleLogout({ meta: { sessionDurationSec: item.meta?.sessionDurationSec || 0 } , token: `inbox:${item.id}` }, sessionData, `inbox:${item.id}`);
        // Inform server that this session was accepted if sessionId provided
        if (item.meta?.sessionId) {
          try { await apiFetch(baseUrl, `/v1/sessions/${encodeURIComponent(item.meta.sessionId)}/accepted`, { method: 'POST' }); } catch(_){}
        }
        processedInboxIds.add(item.id);
        toAck.push(item.id);
        await notify('PublicPass', `Session received from ${item.meta?.sender || 'someone'}`);
      } catch (e) {
        console.warn('Failed to process inbox item', item.id, e);
      }
    }
    if (toAck.length) {
      await apiFetch(baseUrl, '/v1/inbox/ack', { method: 'POST', body: JSON.stringify({ recipient: username, ids: toAck }) });
    }
  } catch (e) {
    console.warn('Inbox poll failed', e);
  }
}

// Auto polling removed; calls to pollInboxOnce are on-demand only.

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('logout:')) {
    const id = alarm.name.substring('logout:'.length);
    const key = 'logoutJobs';
    const stored = (await chrome.storage.local.get({ [key]: [] }))[key] || [];
    const job = stored.find(j => j.id === id);
    const remaining = stored.filter(j => j.id !== id);
    await chrome.storage.local.set({ [key]: remaining });
    if (!job) return;
    try {
      // Remove cookies
      for (const c of job.cookies || []) {
        const scheme = c.secure ? 'https' : 'http';
        const host = c.domain ? c.domain.replace(/^\./, '') : new URL(job.targetOrigin).hostname;
        const url = `${scheme}://${host}${c.path || '/'}`;
        try { await chrome.cookies.remove({ url, name: c.name }); } catch (e) { /* noop */ }
      }
      // Clear storage by opening a temporary tab
      const temp = await chrome.tabs.create({ url: job.targetOrigin, active: false });
      await waitForTabComplete(temp.id);
      await chrome.scripting.executeScript({
        target: { tabId: temp.id },
        func: ({ localKeys, sessionKeys }) => {
          try { localKeys.forEach(k => window.localStorage.removeItem(k)); } catch (_) {}
          try { sessionKeys.forEach(k => window.sessionStorage.removeItem(k)); } catch (_) {}
        },
        args: [{ localKeys: job.localStorageKeys || [], sessionKeys: job.sessionStorageKeys || [] }]
      });
      await chrome.tabs.remove(temp.id);
      await notify('PublicPass', 'Session auto-logout complete');
    } catch (e) {
      console.warn('Auto-logout failed', e);
    }
    return;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "share-session") {
    handleShareRequest(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "reset-identity") {
    generateIdentity()
      .then(async (keys) => {
        const current = await getLocalState();
        await saveLocalState({
          identityPrivateKey: keys.privateJwk,
          identityPublicKey: keys.publicJwk,
          authSecret: current.authSecret || null,
          registeredUsername: current.registeredUsername || null
        });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === "register-identity") {
    registerIdentityIfNeeded()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  return undefined;
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }
  getSettings()
    .then(async (settings) => {
      let targetUrl;
      try { targetUrl = new URL(details.url); } catch (_) { return; }
      if (!/^https?:$/.test(targetUrl.protocol)) return;
      if (!targetUrl.pathname.startsWith("/session/")) return;

      const token = targetUrl.pathname.split("/").pop();
      if (!token || processedTokens.has(token)) return;

      if (settings.acceptPrompt === 'on') {
        pendingAccepts.set(token, details);
        try { await showAcceptNotification(token, details.url); } catch (_) {}
      } else {
        handleSessionAcceptance(details).catch((error) => console.error(error));
      }
    })
    .catch((error) => console.error("Failed to evaluate navigation", error));
}, {
  url: [{ urlMatches: ".*" }]
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (!notificationId.startsWith('accept:')) return;
  const token = notificationId.substring('accept:'.length);
  const details = pendingAccepts.get(token);
  pendingAccepts.delete(token);
  chrome.notifications.clear(notificationId);
  if (!details) return;
  if (buttonIndex === 0) {
    handleSessionAcceptance(details).catch((e) => console.error('Accept failed', e));
  } else {
    // Dismissed; do nothing and allow manual accept via extension popup if desired
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.currentUsername || changes.serverBaseUrl)) {
    registerIdentityIfNeeded().catch((error) => console.warn('Auto-registration failed', error));
  }
  // No auto-polling; nothing to adjust here for inbox.
});

// Expose on-demand inbox check
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'check-inbox-now') {
    pollInboxOnce()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  return undefined;
});
