import { DEFAULT_SERVER_BASE_URL } from "../config.js";

const DEFAULT_SETTINGS = {
  serverBaseUrl: DEFAULT_SERVER_BASE_URL,
  currentUsername: '',
  acceptPrompt: 'on'
};

const LOCAL_DEFAULT = {
  identityPrivateKey: null,
  identityPublicKey: null,
  registeredUsername: null
};

function setStatus(message, isError = false) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  if (message) setTimeout(() => { if (statusEl.textContent === message) { statusEl.textContent = ''; statusEl.classList.remove('error'); } }, 3000);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  document.getElementById('current-username').value = stored.currentUsername;
  document.getElementById('accept-prompt').value = stored.acceptPrompt || 'on';
}

async function loadIdentity() {
  const state = await chrome.storage.local.get(LOCAL_DEFAULT);
  const el = document.getElementById('identity-status');
  el.textContent = state.identityPublicKey ? `Identity ready (${state.registeredUsername || 'not registered'})` : 'Identity not yet generated.';
}

async function saveSettings(e) {
  e.preventDefault();
  // Preserve stored serverBaseUrl; field removed from UI
  const prev = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const currentUsername = document.getElementById('current-username').value.trim();
  const acceptPrompt = document.getElementById('accept-prompt').value;
  await chrome.storage.sync.set({ serverBaseUrl: prev.serverBaseUrl, currentUsername, acceptPrompt });
  setStatus('Settings saved.');
  chrome.runtime.sendMessage({ type: 'register-identity' }, () => {});
}

window.addEventListener('DOMContentLoaded', () => {
  loadSettings().catch(console.error);
  loadIdentity().catch(console.error);
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
});
