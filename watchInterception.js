(function initWatchInterception() {
  if (window.__primeShuffleWatchHookInstalled) {
    return;
  }
  window.__primeShuffleWatchHookInstalled = true;
  const LOG = "[PrimeShuffle:watch]";
  let cachedTitleUrl = "";
  let lastAutoRedirectAt = 0;
  let lastEndedRedirectAt = 0;
  let playbackKickAttempts = 0;
  let playbackKickTimer = null;

  function log(...args) {
    console.log(LOG, ...args);
  }

  function extensionAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (error) {
      return false;
    }
  }

  function isElementVisible(node) {
    if (!node) {
      return false;
    }
    if (node.offsetParent !== null) {
      return true;
    }
    return node.getClientRects().length > 0;
  }

  function isPlayerDomPresent() {
    return Boolean(
      document.querySelector(".atvwebplayersdk-infobar-container") ||
      document.querySelector(".atvwebplayersdk-seekbar-container") ||
      document.querySelector("button.atvwebplayersdk-nexttitle-button") ||
      document.querySelector("button.atvwebplayersdk-playpause-button") ||
      document.querySelector(".atvwebplayersdk-player-container") ||
      document.querySelector('[aria-label="Web Player"]')
    );
  }

  function hasTitlePageSeasonUi() {
    const nodes = [
      ...document.querySelectorAll(
        "#av-droplist-av-atf-season-selector,[aria-label*='Season Selector'],[href*='season_select'],button[aria-label*='Season']"
      )
    ];
    return nodes.some((node) => isElementVisible(node));
  }

  function hasEpisodeListUi() {
    const episodeNodes = [
      ...document.querySelectorAll('li[data-testid="episode-list-item"],#tab-content-episodes [href*="/detail/"]')
    ];
    return episodeNodes.some((node) => isElementVisible(node));
  }

  function isPlaybackIntentUrl() {
    return /autoplay=1|atv_dp_btf_el_prime_hd_tv_/i.test(window.location.href);
  }

  function isNearEndOfMainVideo() {
    const video = document.querySelector("video");
    if (!video) {
      return false;
    }

    const duration = Number(video.duration);
    const current = Number(video.currentTime);
    if (!Number.isFinite(duration) || !Number.isFinite(current) || duration <= 0) {
      return false;
    }

    if (duration < 120) {
      return false;
    }

    const remaining = duration - current;
    return video.ended || remaining <= 75;
  }

  function isNextUpOverlayVisible() {
    const classBased =
      document.querySelector(".atvwebplayersdk-nextupcard-show") ||
      document.querySelector(".atvwebplayersdk-nextupcard-wrapper .atvwebplayersdk-nextupcard-button") ||
      document.querySelector(".atvwebplayersdk-nextupcard-episode");
    if (classBased && isElementVisible(classBased)) {
      return true;
    }

    const nextUpLabel = [...document.querySelectorAll("div,span,h1,h2,h3,h4,p")].find((node) => {
      if (!isElementVisible(node)) {
        return false;
      }
      const text = (node.textContent || "").trim().toLowerCase();
      return text === "next up";
    });

    if (!nextUpLabel) {
      return false;
    }

    const container =
      nextUpLabel.closest("section,article,aside,div") ||
      nextUpLabel.parentElement;
    if (!container) {
      return false;
    }

    const contextText = (container.textContent || "").toLowerCase();
    return /\be\s*\d+\b|episode|hide/.test(contextText);
  }

  function getPlayControl(allowHidden = false) {
    const selectors = allowHidden
      ? [
          "button.atvwebplayersdk-playpause-button[aria-label='Play']",
          "button[aria-label='Play']",
          "[aria-label='Web Player'] button[aria-label='Play']"
        ]
      : [
          "button.atvwebplayersdk-playpause-button[aria-label='Play']:not(.atvwebplayersdk-visibility-hidden)",
          "button[aria-label='Play']:not(.atvwebplayersdk-visibility-hidden)",
          "[aria-label='Web Player'] button[aria-label='Play']"
        ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }
      if (allowHidden || isElementVisible(node)) {
        return node;
      }
    }
    return null;
  }

  function simulateUserClick(node) {
    if (!node) {
      return false;
    }
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  function clickPlayerSurface() {
    const surface =
      document.querySelector('[aria-label="Web Player"]') ||
      document.querySelector(".atvwebplayersdk-player-container");
    if (!surface) {
      return false;
    }
    return simulateUserClick(surface);
  }

  function fallbackKickPlayback(reason) {
    const playButton = getPlayControl(true);
    if (playButton) {
      if (playButton.classList.contains("atvwebplayersdk-visibility-hidden")) {
        clickPlayerSurface();
        log("autoplay kick: nudged player surface for hidden play control", { reason });
      }
      simulateUserClick(playButton);
      log("autoplay kick: clicked play control", {
        reason,
        hidden: playButton.classList.contains("atvwebplayersdk-visibility-hidden")
      });
      return;
    }

    if (clickPlayerSurface()) {
      log("autoplay kick: clicked player surface", { reason });
      return;
    }

    log("autoplay kick: no fallback target", { reason });
  }

  function shouldKickPlayback() {
    return isWatchRoute() || isPlaybackIntentUrl();
  }

  function attemptKickPlayback() {
    if (!shouldKickPlayback()) {
      return;
    }

    const video = document.querySelector("video");
    if (!video) {
      return;
    }

    if (!video.paused) {
      if (playbackKickTimer) {
        clearInterval(playbackKickTimer);
        playbackKickTimer = null;
      }
      return;
    }

    try {
      const wasMuted = video.muted;
      video.muted = true;
      const result = video.play();

      if (result && typeof result.then === "function") {
        result
          .then(() => {
            log("autoplay kick: video.play() resolved");
            setTimeout(() => {
              if (video.paused) {
                fallbackKickPlayback("video.play() resolved but still paused");
                return;
              }

              if (!wasMuted) {
                video.muted = false;
              }
            }, 350);
          })
          .catch(() => {
            fallbackKickPlayback("video.play() rejected");
          });
      } else {
        setTimeout(() => {
          if (video.paused) {
            fallbackKickPlayback("video.play() returned without promise and remained paused");
          }
        }, 350);
      }
    } catch (error) {
      fallbackKickPlayback("video.play() threw");
    }
  }

  function schedulePlaybackKick() {
    if (!shouldKickPlayback()) {
      return;
    }

    if (playbackKickTimer) {
      return;
    }

    playbackKickAttempts = 0;
    playbackKickTimer = setInterval(() => {
      playbackKickAttempts += 1;
      attemptKickPlayback();
      if (playbackKickAttempts >= 14) {
        clearInterval(playbackKickTimer);
        playbackKickTimer = null;
        log("autoplay kick: stopped retries");
      }
    }, 800);
  }

  function isWatchRoute() {
    const hasVideo = Boolean(document.querySelector("video"));
    const hasWatchControls = Boolean(
      document.querySelector(".atvwebplayersdk-seekbar-container") ||
      document.querySelector(".atvwebplayersdk-infobar-container") ||
      document.querySelector("button.atvwebplayersdk-playpause-button") ||
      document.querySelector("button.atvwebplayersdk-nexttitle-button")
    );

    const hasTitleUi = hasTitlePageSeasonUi() || hasEpisodeListUi();
    const watch = !hasTitleUi && isPlayerDomPresent() && (hasVideo || hasWatchControls);
    return watch;
  }

  function getTitleUrl() {
    const local = localStorage.getItem("primeShuffleTitleUrl") || "";
    if (local) {
      return local;
    }

    if (cachedTitleUrl) {
      return cachedTitleUrl;
    }

    return "";
  }

  function syncState() {
    if (!extensionAlive()) {
      log("extension context unavailable during sync");
      return;
    }

    chrome.storage.local.get({ lastTitleUrl: "" }, ({ lastTitleUrl }) => {
      cachedTitleUrl = lastTitleUrl || cachedTitleUrl;
    });
  }

  function isNextEpisodeButton(button) {
    if (!button) {
      return false;
    }

    const tag = (button.tagName || "").toLowerCase();
    const role = (button.getAttribute("role") || "").toLowerCase();
    const isInteractive = tag === "button" || tag === "a" || role === "button";
    if (!isInteractive) {
      return false;
    }

    const className = button.className || "";
    const aria = button.getAttribute("aria-label") || "";
    const text = (button.textContent || "").trim();
    const dataAction = button.getAttribute("data-testid") || "";
    const combined = `${className} ${aria} ${text} ${dataAction}`.toLowerCase();

    if (/playpause|play\/pause/.test(combined)) {
      return false;
    }
    if (/^\s*play\s*$/i.test(text) || /^\s*pause\s*$/i.test(text)) {
      return false;
    }
    if (/^\s*play\s*$/i.test(aria) || /^\s*pause\s*$/i.test(aria)) {
      return false;
    }

    return (
      className.includes("atvwebplayersdk-nexttitle-button") ||
      /next episode/i.test(aria) ||
      /next-?episode/i.test(dataAction)
    );
  }

  function resolveNextEpisodeControl(event) {
    const direct = event.target?.closest?.("button,[role='button'],a");
    if (isNextEpisodeButton(direct)) {
      return direct;
    }

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) {
        continue;
      }
      const candidate = node.closest?.("button,[role='button'],a");
      if (isNextEpisodeButton(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function redirectToTitle() {
    const titleUrl = getTitleUrl();
    if (!titleUrl) {
      log("redirect skipped: no title url");
      return;
    }

    log("redirecting to title", { from: window.location.href, to: titleUrl });

    if (extensionAlive()) {
      try {
        chrome.runtime.sendMessage({ type: "setShufflePending", value: true });
        log("set shuffle pending true");
      } catch (error) {
        log("set shuffle pending failed", error);
      }
    }

    window.location.href = titleUrl;
  }

  function handleOrganicCompletion() {
    const now = Date.now();
    if (now - lastEndedRedirectAt < 3000) {
      return;
    }

    const inWatchLikeContext = isWatchRoute() || isPlaybackIntentUrl() || isPlayerDomPresent();
    if (!inWatchLikeContext) {
      return;
    }

    lastEndedRedirectAt = now;
    log("organic completion detected; redirecting to title for rerandomization");
    redirectToTitle();
  }

  function bindCompletionListeners() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      if (video.dataset.primeShuffleCompletionBound === "1") {
        continue;
      }
      video.dataset.primeShuffleCompletionBound = "1";
      video.addEventListener("ended", handleOrganicCompletion, { capture: true });
    }
  }

  function maybeHandleUpNextOverlay() {
    const now = Date.now();
    if (now - lastAutoRedirectAt < 3000) {
      return;
    }

    const inWatchLikeContext = isWatchRoute() || isPlaybackIntentUrl() || isPlayerDomPresent();
    if (!inWatchLikeContext) {
      return;
    }

    const hasNextButton = (() => {
      const btn = document.querySelector("button.atvwebplayersdk-nexttitle-button");
      return Boolean(btn && isElementVisible(btn));
    })();
    const hasNextUpOverlay = isNextUpOverlayVisible();
    if (!hasNextButton && !hasNextUpOverlay) {
      return;
    }

    if (!isNearEndOfMainVideo()) {
      return;
    }

    lastAutoRedirectAt = now;
    log("up-next UI detected; redirecting to title for rerandomization");
    redirectToTitle();
  }

  function resolveNextUpCardControl(event) {
    const direct = event.target?.closest?.(
      ".atvwebplayersdk-nextupcard-button,.atvwebplayersdk-nextupcard-wrapper,.atvwebplayersdk-nextupcard-show"
    );
    if (direct) {
      return direct;
    }

    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) {
        continue;
      }
      const candidate = node.closest?.(
        ".atvwebplayersdk-nextupcard-button,.atvwebplayersdk-nextupcard-wrapper,.atvwebplayersdk-nextupcard-show"
      );
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  function handleNextInteraction(event) {
    const inWatchLikeContext = isWatchRoute() || isPlaybackIntentUrl() || isPlayerDomPresent();
    if (!inWatchLikeContext) {
      log("next interaction ignored", {
        isWatchRoute: isWatchRoute(),
        isPlaybackIntentUrl: isPlaybackIntentUrl(),
        path: window.location.pathname
      });
      return;
    }

    log("next interaction captured", { path: window.location.pathname, href: window.location.href });
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }

    redirectToTitle();
  }

  function onNextEpisodePointerDown(event) {
    const control = resolveNextEpisodeControl(event);
    if (!control) {
      return;
    }

    log("next button pointerdown detected", {
      className: control.className || "",
      aria: control.getAttribute("aria-label") || "",
      text: (control.textContent || "").trim()
    });
    handleNextInteraction(event);
  }

  function onNextEpisodeClick(event) {
    const control = resolveNextEpisodeControl(event);
    if (!control) {
      return;
    }
    handleNextInteraction(event);
  }

  function onNextUpCardInteraction(event) {
    const control = resolveNextUpCardControl(event);
    if (!control) {
      return;
    }

    log("next-up card interaction captured; redirecting to title");
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }
    redirectToTitle();
  }

  document.addEventListener("pointerdown", onNextEpisodePointerDown, true);
  document.addEventListener("click", onNextEpisodeClick, true);
  document.addEventListener("pointerdown", onNextUpCardInteraction, true);
  document.addEventListener("click", onNextUpCardInteraction, true);

  const observer = new MutationObserver(() => {
    if (isWatchRoute() || isPlaybackIntentUrl()) {
      bindCompletionListeners();
      maybeHandleUpNextOverlay();
      schedulePlaybackKick();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (extensionAlive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }

      if (changes.lastTitleUrl) {
        cachedTitleUrl = changes.lastTitleUrl.newValue || cachedTitleUrl;
        localStorage.setItem("primeShuffleTitleUrl", cachedTitleUrl);
      }
    });

    chrome.runtime.sendMessage({ type: "getTitleUrl" }, (response) => {
      if (chrome.runtime.lastError) {
        log("getTitleUrl failed", chrome.runtime.lastError.message);
        return;
      }
      cachedTitleUrl = response?.titleUrl || cachedTitleUrl;
      if (cachedTitleUrl) {
        localStorage.setItem("primeShuffleTitleUrl", cachedTitleUrl);
      }
    });
  }

  log("watch interception initialized", { href: window.location.href, path: window.location.pathname });
  syncState();
  bindCompletionListeners();
  maybeHandleUpNextOverlay();
  schedulePlaybackKick();
})();
