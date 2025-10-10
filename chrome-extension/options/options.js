import { DEFAULT_SERVER_BASE_URL } from "../config.js";

const DEFAULT_SETTINGS = {
  serverBaseUrl: DEFAULT_SERVER_BASE_URL,
  currentUsername: "",
  ttlSeconds: 600,
  acceptPrompt: "on"
};

const LOCAL_DEFAULT = {
  identityPrivateKey: null,
  identityPublicKey: null,
  registeredUsername: null
};

function setStatus(message, isError = false) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  if (message) {
    setTimeout(() => {
      if (statusEl.textContent === message) {
        statusEl.textContent = "";
        statusEl.classList.remove("error");
      }
    }, 3000);
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById("server-url").value = stored.serverBaseUrl;
  document.getElementById("current-username").value = stored.currentUsername;
  document.getElementById("ttl-seconds").value = Number(stored.ttlSeconds) || 600;
  document.getElementById("accept-prompt").value = stored.acceptPrompt || "on";
}

async function loadIdentity() {
  const state = await chrome.storage.local.get(LOCAL_DEFAULT);
  const statusEl = document.getElementById("identity-status");

  if (state.identityPublicKey) {
    const username = state.registeredUsername || "not registered";
    statusEl.textContent = `Identity ready (${username}).`;
  } else {
    statusEl.textContent = "Identity not yet generated.";
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const serverBaseUrl = document.getElementById("server-url").value.trim();
  const currentUsername = document.getElementById("current-username").value.trim();
  const ttlSeconds = Math.max(60, Math.min(3600, Number(document.getElementById("ttl-seconds").value) || 600));
  const acceptPrompt = document.getElementById("accept-prompt").value;

  await chrome.storage.sync.set({ serverBaseUrl, currentUsername, ttlSeconds, acceptPrompt });
  setStatus("Settings saved.");

  chrome.runtime.sendMessage({ type: "register-identity" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (response?.error) {
      setStatus(response.error, true);
      return;
    }
    setStatus("Identity registered.");
    loadIdentity().catch((error) => console.error("Failed to refresh identity", error));
  });
}

function handleRegisterIdentity() {
  setStatus("Registering identity…");
  chrome.runtime.sendMessage({ type: "register-identity" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (response?.error) {
      setStatus(response.error, true);
      return;
    }
    setStatus("Identity registered.");
    loadIdentity().catch((error) => console.error("Failed to refresh identity", error));
  });
}

function handleResetIdentity() {
  if (!confirm("Reset identity? Existing shares won't be decryptable.")) {
    return;
  }
  setStatus("Generating new identity…");
  chrome.runtime.sendMessage({ type: "reset-identity" }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message, true);
      return;
    }
    if (response?.error) {
      setStatus(response.error, true);
      return;
    }
    setStatus("Identity reset. Register again to sync.");
    loadIdentity().catch((error) => console.error("Failed to refresh identity", error));
  });
}

window.addEventListener("DOMContentLoaded", () => {
  loadSettings().catch((error) => console.error("Failed to load settings", error));
  loadIdentity().catch((error) => console.error("Failed to load identity", error));
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
});
