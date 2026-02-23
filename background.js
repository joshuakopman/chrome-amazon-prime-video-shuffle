const LOG = "[PrimeShuffle:bg]";

function log(...args) {
  console.log(LOG, ...args);
}

function applyEnabledState(enabled) {
  chrome.action.setBadgeText({ text: enabled ? "On" : "Off" });
  log("apply enabled state", { enabled });
}

function deriveTitleFromWatchUrl(url) {
  const match = (url || "").match(/^https:\/\/[^/]+\/gp\/video\/detail\/([^/?]+)/i)
    || (url || "").match(/^https:\/\/[^/]+\/video\/detail\/([^/?]+)/i);

  if (!match) {
    return "";
  }

  // Preserve domain when possible.
  const urlObj = new URL(url);
  return `${urlObj.origin}/gp/video/detail/${match[1]}`;
}

function rememberTitleUrl(url) {
  if (!url) {
    log("rememberTitleUrl skipped: no url");
    return;
  }

  const titleUrl = /\/video\/detail\//i.test(url) ? url : deriveTitleFromWatchUrl(url);
  if (!titleUrl) {
    log("rememberTitleUrl skipped: no derived title", { url });
    return;
  }

  log("rememberTitleUrl set", { titleUrl });
  chrome.storage.local.set({ lastTitleUrl: titleUrl });
}

chrome.storage.local.set({ shuffleEnabled: true }, () => {
  log("startup forced enabled", { enabled: true });
  applyEnabledState(true);
});

chrome.action.onClicked.addListener(() => {
  log("action clicked: always-on mode", { enabled: true });
  applyEnabledState(true);
  chrome.storage.local.set({ shuffleEnabled: true });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "rememberTitleUrl" && request.url) {
    rememberTitleUrl(request.url);
  }

  if (request.type === "setShufflePending") {
    log("setShufflePending", { value: Boolean(request.value) });
    chrome.storage.local.set({ shufflePending: Boolean(request.value) });
  }

  if (request.type === "consumeShufflePending") {
    chrome.storage.local.get({ shufflePending: false }, ({ shufflePending }) => {
      log("consumeShufflePending read", { shufflePending });
      if (shufflePending) {
        chrome.storage.local.set({ shufflePending: false }, () => {
          log("consumeShufflePending returning true and clearing");
          sendResponse({ pending: true });
        });
        return;
      }

      log("consumeShufflePending returning false");
      sendResponse({ pending: false });
    });
    return true;
  }

  if (request.type === "getTitleUrl") {
    chrome.storage.local.get({ lastTitleUrl: "" }, ({ lastTitleUrl }) => {
      log("getTitleUrl response", { lastTitleUrl });
      sendResponse({ titleUrl: lastTitleUrl || "" });
    });
    return true;
  }

  return false;
});
