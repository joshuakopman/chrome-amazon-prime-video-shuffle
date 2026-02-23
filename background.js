const LOG = "[PrimeShuffle:bg]";
let shuffleEnabled = true;

function log(...args) {
  console.log(LOG, ...args);
}

function applyEnabledState(enabled) {
  shuffleEnabled = Boolean(enabled);
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

chrome.storage.local.get({ shuffleEnabled: true }, ({ shuffleEnabled: enabled }) => {
  log("startup state", { enabled: Boolean(enabled) });
  applyEnabledState(Boolean(enabled));
});

chrome.action.onClicked.addListener(() => {
  const nextEnabled = !shuffleEnabled;
  log("action clicked", { previous: shuffleEnabled, next: nextEnabled });
  applyEnabledState(nextEnabled);
  chrome.storage.local.set({ shuffleEnabled: nextEnabled });
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
