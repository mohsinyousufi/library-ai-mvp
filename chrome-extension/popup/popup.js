import { DEFAULT_SERVER_BASE_URL } from "../config.js";

const DEFAULT_SETTINGS = {
  serverBaseUrl: DEFAULT_SERVER_BASE_URL,
  currentUsername: ""
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setErrors(messages) {
  const errorsEl = document.getElementById("errors");
  if (!messages || messages.length === 0) {
    errorsEl.hidden = true;
    errorsEl.textContent = "";
    return;
  }
  const list = document.createElement("ul");
  messages.forEach((msg) => {
    const li = document.createElement("li");
    li.textContent = msg;
    list.appendChild(li);
  });
  errorsEl.innerHTML = "";
  errorsEl.appendChild(list);
  errorsEl.hidden = false;
}

function showResult({ url, expiresAt }) {
  const resultSection = document.getElementById("result");
  document.getElementById("share-url").textContent = url;
  const expiryEl = document.getElementById("expiry");
  if (expiresAt && expiryEl) {
    const expiryDate = new Date(expiresAt);
    expiryEl.textContent = `Expires at ${expiryDate.toLocaleString()}`;
  } else if (expiryEl) {
    expiryEl.textContent = "";
  }
  resultSection.hidden = false;
}

async function loadDefaults() {
  const activeTab = await getActiveTab();
  document.getElementById("active-host").textContent = activeTab?.url ?? "Unknown";
  document.getElementById("recipient-username").value = "";
}

async function handleShare(event) {
  event.preventDefault();
  setErrors([]);
  document.getElementById("result").hidden = true;

  const recipientUsername = document.getElementById("recipient-username").value.trim();
  const deliveryMethod = "direct";
  const sessionDurationSec = Number(document.getElementById("session-duration").value) || 0;

  // Basic UX validation to avoid 400s
  const isValidUsername = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,63})$/.test(recipientUsername);
  if (!isValidUsername) {
    setErrors(["Recipient username is invalid (allowed: A-Z a-z 0-9 _ . - up to 64 chars)"]); 
    return;
  }

  const activeTab = await getActiveTab();
  if (!activeTab?.url?.startsWith("http")) {
    setErrors(["Active tab is not a website (http/https). Open the site you want to share and try again."]);
    return;
  }

  if (!recipientUsername) {
    setErrors(["Recipient username is required."]);
    return;
  }

  const shareButton = document.getElementById("share-button");
  shareButton.disabled = true;
  shareButton.textContent = "Sharing…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "share-session",
      payload: {
        recipientUsername,
        deliveryMethod,
        sessionDurationSec
      }
    });

    if (response?.error) {
      setErrors([response.error]);
    } else if (response?.errors) {
      setErrors(response.errors);
    } else if (response?.shareUrl) {
      showResult({ url: response.shareUrl, expiresAt: response.expiresAt });
    } else if (response?.sent) {
      // direct delivery sent; close popup quickly
      window.close();
    } else {
      setErrors(["Unexpected response from background script."]);
    }
  } catch (error) {
    console.error(error);
    setErrors(["Failed to share session. Check console for details."]);
  } finally {
    shareButton.disabled = false;
    shareButton.textContent = "Encrypt & Share";
  }
}

document.getElementById("share-form").addEventListener("submit", handleShare);

document.getElementById("open-options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("copy-link").addEventListener("click", async (event) => {
  event.preventDefault();
  const url = document.getElementById("share-url").textContent;
  if (!url) {
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    const expiryEl = document.getElementById("expiry");
    if (expiryEl) {
      const previous = expiryEl.textContent;
      expiryEl.textContent = `${previous ? `${previous} – ` : ""}Copied!`;
      setTimeout(() => {
        expiryEl.textContent = previous;
      }, 2000);
    }
  } catch (error) {
    console.error("Copy failed", error);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "session-share-status") {
    setErrors(message.error ? [message.error] : []);
  }
});

loadDefaults().catch((error) => {
  console.error("Failed to initialise popup", error);
  setErrors(["Failed to load settings."]);
});

// On-demand inbox check
document.getElementById("check-inbox")?.addEventListener("click", () => {
  const btn = document.getElementById("check-inbox");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Checking…";
  chrome.runtime.sendMessage({ type: "check-inbox-now" }, (response) => {
    btn.disabled = false;
    btn.textContent = prev;
    if (chrome.runtime.lastError) {
      setErrors([chrome.runtime.lastError.message]);
      return;
    }
    if (response?.error) {
      setErrors([response.error]);
    }
  });
});
