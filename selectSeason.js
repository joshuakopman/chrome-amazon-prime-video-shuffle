(function initTitlePicker() {
  if (window.__primeShuffleTitleHookInstalled) {
    return;
  }
  window.__primeShuffleTitleHookInstalled = true;
  const LOG = "[PrimeShuffle:title]";

  const STATE_KEY = "primeShuffleState";
  const WATCH_REDIRECT_SUPPRESS_KEY = "primeShuffleSuppressWatchRedirectUntil";
  const STATE_TTL_MS = 30000;

  function log(...args) {
    console.log(LOG, ...args);
  }

  function now() {
    return Date.now();
  }

  function readState() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.phase || !parsed.ts) {
        return null;
      }
      if (now() - parsed.ts > STATE_TTL_MS) {
        log("state expired", parsed);
        sessionStorage.removeItem(STATE_KEY);
        return null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeState(phase) {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ phase, ts: now() }));
  }

  function clearState() {
    sessionStorage.removeItem(STATE_KEY);
  }

  function isLikelyTitlePage() {
    const url = window.location.href;
    return /\/video\/detail\//i.test(url) || /\/gp\/video\/detail\//i.test(url);
  }

  function isEpisodePlaybackEntryUrl() {
    const url = window.location.href;
    return /atv_dp_btf_el_prime_hd_tv_/i.test(url) || /autoplay=1/i.test(url);
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
    const episodeRows = [...document.querySelectorAll('li[data-testid="episode-list-item"],#tab-content-episodes [href*="/detail/"]')];
    return episodeRows.some((node) => isElementVisible(node));
  }

  function isLikelyWatchContext() {
    const video = document.querySelector("video");
    return isPlayerDomPresent() && !hasTitlePageSeasonUi() && !hasEpisodeListUi() && Boolean(video);
  }

  function clickElement(element) {
    if (!element) {
      return false;
    }

    const target = element.closest("a,button,[role='button']") || element.querySelector("a,button,[role='button']") || element;
    if (!target) {
      return false;
    }

    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }

  function randomItem(items) {
    return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : null;
  }

  function setWatchRedirectSuppressed(ms) {
    const until = now() + ms;
    sessionStorage.setItem(WATCH_REDIRECT_SUPPRESS_KEY, String(until));
  }

  function ensureEpisodesTabActive() {
    const candidates = [
      ...document.querySelectorAll('[data-testid*="episodes-tab"],[data-automation-id*="episodes-tab"],[role="tab"],button,a')
    ].filter((node) => /episodes?/i.test((node.textContent || node.getAttribute("aria-label") || "").trim()));

    if (candidates.length === 0) {
      return false;
    }

    const active = candidates.find((node) => {
      const ariaSelected = (node.getAttribute("aria-selected") || "").toLowerCase();
      const className = node.className || "";
      return ariaSelected === "true" || /active|selected/i.test(className);
    });

    if (active) {
      return true;
    }

    const target = candidates[0];
    clickElement(target);
    return true;
  }

  function getEpisodeRoots() {
    const roots = [document];
    const tabPanels = [...document.querySelectorAll('[role="tabpanel"]')];
    roots.push(...tabPanels);

    const episodesHeading = [...document.querySelectorAll("h1,h2,h3,h4,span,div")].find((node) =>
      /^episodes?$/i.test((node.textContent || "").trim())
    );
    if (episodesHeading) {
      const section = episodesHeading.closest("section,article,main,div");
      if (section) {
        roots.push(section);
      }
    }

    return [...new Set(roots)];
  }

  function findSeasonPicker() {
    const selectors = [
      '#av-droplist-av-atf-season-selector',
      '#av-droplist-av-atf-season-selector + button',
      'button[aria-label*="Season"]',
      'button[aria-haspopup="listbox"][data-testid*="season"]',
      '[data-testid*="season"] button',
      '[data-automation-id*="season"] button',
      '[class*="episodeSelector"] button[aria-haspopup="true"]'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return null;
  }

  function findSeasonOptions() {
    const selectors = [
      '#av-droplist-av-atf-season-selector ~ ul li',
      'ul[role="listbox"] li[role="option"]',
      'ul[role="menu"] li[role="menuitemradio"]',
      'ul[role="menu"] li[role="menuitem"]',
      '[data-testid*="season"] li',
      '[data-automation-id*="season"] li'
    ];

    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter((node) => {
        const text = (node.textContent || "").trim();
        return /season\s*\d+/i.test(text) || /^\d+$/.test(text);
      });

      if (nodes.length > 0) {
        return nodes;
      }
    }

    return [];
  }

  function findEpisodeCandidates() {
    const directEpisodeLinks = [...document.querySelectorAll(
      '#tab-content-episodes a[href*="/gp/video/detail/"][href*="atv_dp_btf_el_prime_hd_tv_"],' +
      'li[data-testid="episode-list-item"] a[href*="/gp/video/detail/"][href*="atv_dp_btf_el_prime_hd_tv_"]'
    )].filter((a) => {
      const href = a.getAttribute("href") || "";
      return !/_dwld/i.test(href) && /(play|resume|wfb)/i.test(href);
    });

    if (directEpisodeLinks.length > 0) {
      const dedupedLinks = [...new Map(directEpisodeLinks.map((a) => [a.getAttribute("href"), a])).values()];
      return dedupedLinks;
    }

    const episodeRows = [...document.querySelectorAll('li[data-testid="episode-list-item"]')].filter((row) => {
      if (!row.id || !/^av-ep-episode-/i.test(row.id)) {
        return false;
      }
      if (!row.querySelector('[data-automation-id^="ep-title-episode-"]')) {
        return false;
      }
      const text = (row.textContent || "").toLowerCase();
      if (/buy|rent|purchase|subscribe to|with ads only|trial/.test(text)) {
        return false;
      }
      return true;
    });

    if (episodeRows.length > 0) {
      return episodeRows;
    }

    const selectors = [
      '.dv-episode-playback-title a',
      'a[href*="atv_dp_btf_el_prime_hd_tv_"][href*="/gp/video/detail/"]',
      'a[href*="/gp/video/detail/"][aria-label*="Episode"]',
      'a[href*="/detail/"][aria-label*="Episode"]',
      '#tab-content-episodes a[href*="/gp/video/detail/"]',
      '#tab-content-episodes a[href*="/video/detail/"]',
      '[data-testid*="episode"] a[href*="/detail/"]',
      '[data-testid*="episode"] a[href*="/gp/video/detail/"]',
      '[data-automation-id*="episode"] a[href*="/detail/"]',
      '[data-automation-id*="episode"] a[href*="/gp/video/detail/"]',
      '[data-testid*="episode"] a[href*="/gp/video/detail/"]',
      '[data-automation-id*="episode"] a[href*="/gp/video/detail/"]'
    ];

    const roots = getEpisodeRoots();
    for (const selector of selectors) {
      const nodes = roots.flatMap((root) => [...root.querySelectorAll(selector)]).filter((node) => {
        const text = (node.textContent || "").trim();
        const aria = (node.getAttribute("aria-label") || "").trim();
        const href = node.getAttribute("href") || "";
        const container = node.closest(
          '[data-testid*="episode"],[data-automation-id*="episode"],li,article,[role="listitem"],.dv-episode-playback,.dv-episode,.av-episode'
        );
        const containerText = (container?.textContent || "").trim();
        const combined = `${text} ${aria} ${containerText}`.toLowerCase();

        if (!href) {
          return false;
        }

        if (!/\/video\/detail\//i.test(href)) {
          return false;
        }

        if (/atv_dp_btf_el_.*_dwld/i.test(href)) {
          return false;
        }

        if (/season_select|continue|watchlist|more purchase|trailer/i.test(`${href} ${combined}`)) {
          return false;
        }

        if (/buy|rent|purchase|subscribe to|with ads only|trial/i.test(combined)) {
          return false;
        }

        if (/^\s*play\s*$/i.test(text) || /continue watching/i.test(combined)) {
          return false;
        }

        const isBtfEpisodeLink = /atv_dp_btf_el_prime_hd_tv_(play|resume|wfb)/i.test(href);
        const looksLikeEpisode =
          isBtfEpisodeLink ||
          /episode|\bs\d+\s*e\d+\b|\be\d+\b/i.test(combined) ||
          Boolean(node.closest('[data-testid*="episode"],[data-automation-id*="episode"],.dv-episode-playback,.dv-episode,.av-episode'));

        return looksLikeEpisode;
      });

      if (nodes.length > 0) {
        const deduped = [...new Map(nodes.map((node) => [
          node.getAttribute("href") ||
          `${(node.getAttribute("aria-label") || "").trim()}|${(node.textContent || "").trim().slice(0, 80)}`,
          node
        ])).values()];
        return deduped;
      }
    }

    return [];
  }

  function findPlayableActionInRow(row) {
    if (!row) {
      return null;
    }

    const preferredLink = row.querySelector(
      'a[href*="/gp/video/detail/"][href*="atv_dp_btf_el_prime_hd_tv_"]:not([href*="_dwld"])'
    );
    if (preferredLink) {
      return preferredLink;
    }

    const altLink = [...row.querySelectorAll('a[href*="/gp/video/detail/"],a[href*="/video/detail/"]')].find((a) => {
      const href = a.getAttribute("href") || "";
      return !/_dwld/i.test(href);
    });
    if (altLink) {
      return altLink;
    }

    const button = [...row.querySelectorAll('[role="button"],button,a')].find((node) => {
      const aria = (node.getAttribute("aria-label") || "").toLowerCase();
      const text = (node.textContent || "").toLowerCase();
      const combined = `${aria} ${text}`;
      return /episode\s*\d+.*(watch|play|resume)|s\d+\s*e\d+/i.test(combined) && !/download/.test(combined);
    });

    return button || null;
  }

  function navigateToNode(node) {
    const rawHref = node?.getAttribute?.("href") || "";
    if (!rawHref) {
      return false;
    }

    if (/^primevideo:\/\//i.test(rawHref) || /_dwld/i.test(rawHref)) {
      return false;
    }

    const decoded = rawHref.replace(/&amp;/g, "&");
    const candidate = decoded.startsWith("http") ? decoded : new URL(decoded, window.location.origin).toString();
    const urlObj = new URL(candidate);
    if (urlObj.searchParams.get("autoplay") !== "1") {
      urlObj.searchParams.set("autoplay", "1");
    }
    if (!urlObj.searchParams.has("t")) {
      urlObj.searchParams.set("t", "0");
    }
    const url = urlObj.toString();
    writeState("episode-picked");
    log("navigating via href", { url });
    window.location.href = url;
    return true;
  }

  function waitForSeasonPicker(onFound, onTimeout) {
    let attempts = 0;
    const maxAttempts = 20;

    const tick = setInterval(() => {
      attempts += 1;
      const picker = findSeasonPicker();
      if (picker) {
        clearInterval(tick);
        onFound(picker);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(tick);
        log("season picker timeout", { attempts });
        onTimeout();
      }
    }, 400);
  }

  function pickRandomEpisode(onDone) {
    let attempts = 0;
    const maxAttempts = 14;

    const retry = setInterval(() => {
      attempts += 1;
      if (attempts === 1) {
        ensureEpisodesTabActive();
      }
      const episodes = findEpisodeCandidates();
      if (episodes.length > 0) {
        clearInterval(retry);
        const picked = randomItem(episodes);
        if (picked) {
          if (picked.tagName === "A" && picked.getAttribute("href")) {
            log("episode link chosen", {
              count: episodes.length,
              href: picked.getAttribute("href"),
              text: (picked.textContent || picked.getAttribute("aria-label") || "").trim().slice(0, 120)
            });
            setWatchRedirectSuppressed(12000);
            if (!navigateToNode(picked)) {
              clickElement(picked);
            }
            onDone(true);
            return;
          }

          const episodeRow = picked;
          const rowText = (episodeRow.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
          const action = findPlayableActionInRow(episodeRow);
          log("episode row chosen", { count: episodes.length, rowText });
          if (action) {
            log("episode action chosen", {
              text: (action.textContent || action.getAttribute("aria-label") || "").trim().slice(0, 120),
              href: action.getAttribute("href") || null
            });
            setWatchRedirectSuppressed(12000);
            if (!navigateToNode(action)) {
              clickElement(action);
            }
          } else {
            log("no playable action in chosen row; clicking row fallback");
            clickElement(episodeRow);
          }
        }
        onDone(true);
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(retry);
        log("episode pick timeout", { attempts });
        onDone(false);
      }
    }, 500);
  }

  function runPicker() {
    const state = readState();
    log("runPicker start", { state, href: window.location.href, title: document.title });
    const initialHref = window.location.href;

    if (state?.phase === "season-picked") {
      pickRandomEpisode((success) => {
        if (success) {
          return;
        }
        log("episode selection failed; keeping season-picked state for next retry");
      });
      return;
    }

    if (state?.phase === "episode-picked") {
      clearState();
    }

    waitForSeasonPicker(
      (seasonPicker) => {
        clickElement(seasonPicker);

        setTimeout(() => {
          const seasons = findSeasonOptions();
          const season = randomItem(seasons);
          if (season) {
            writeState("season-picked");
            log("season chosen", { text: (season.textContent || "").trim() });
            clickElement(season);
            // Prime can switch seasons in-place without a page navigation.
            // If the URL is unchanged shortly after the click, continue to episode randomization now.
            setTimeout(() => {
              if (window.location.href !== initialHref) {
                log("season click triggered navigation; waiting for rerun");
                return;
              }

              log("season switched in-place; selecting random episode on current page");
              pickRandomEpisode((success) => {
                if (!success) {
                  log("episode selection failed after in-place season switch");
                }
              });
            }, 1200);
            return;
          }

          pickRandomEpisode((success) => {
            if (!success) {
              clearState();
              return;
            }
          });
        }, 700);
      },
      () => {
        log("fallback: no season picker, picking episode from current list");
        pickRandomEpisode((success) => {
          if (!success) {
            clearState();
            return;
          }
        });
      }
    );
  }

  function maybeRun() {
    if (!isLikelyTitlePage()) {
      log("skip maybeRun: not title page", { href: window.location.href });
      return;
    }

    if (isEpisodePlaybackEntryUrl()) {
      log("skip maybeRun: playback-entry url", { href: window.location.href });
      return;
    }

    if (isLikelyWatchContext()) {
      log("skip maybeRun: watch context detected on mixed detail route", { href: window.location.href });
      return;
    }

    chrome.runtime.sendMessage({ type: "consumeShufflePending" }, (response) => {
      if (chrome.runtime.lastError) {
        log("consumeShufflePending failed", chrome.runtime.lastError.message);
        return;
      }

      try {
        chrome.runtime.sendMessage({ type: "rememberTitleUrl", url: window.location.href });
      } catch (error) {
        log("rememberTitleUrl failed", error);
      }

      runPicker();
    });
  }

  log("title picker initialized", { href: window.location.href, path: window.location.pathname });
  maybeRun();
})();
