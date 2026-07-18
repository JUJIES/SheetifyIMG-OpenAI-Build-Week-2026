"use strict";

(() => {
  const SPRITE = "/icons/lucide-sprite.svg?v=19";
  const YOUTUBE_API_ID = "sheetifyYoutubeIframeApi";
  const locale = window.sheetifyLocale;
  const triggers = [
    document.querySelector("#tutorialsButton"),
    document.querySelector("#workspaceMobileTutorialsButton")
  ].filter(Boolean);
  if (!locale || !triggers.length) return;

  let catalogue = null;
  let activeTrigger = null;
  let activeTutorial = null;
  let lastFocusedElement = null;
  let consentAccepted = false;
  let autoShowTimer = 0;
  let youtubeApiPromise = null;
  let youtubePlayer = null;

  const root = document.createElement("div");
  root.id = "tutorialCenterRoot";
  root.innerHTML = `
    <aside class="tutorial-menu hidden" id="tutorialMenu" role="menu" aria-labelledby="tutorialMenuTitle">
      <header class="tutorial-menu-header">
        <span class="tutorial-menu-eyebrow" data-i18n="tutorial.menu.eyebrow">Schnelle Hilfe</span>
        <strong id="tutorialMenuTitle" data-i18n="tutorial.menu.title">Anleitungen</strong>
        <p data-i18n="tutorial.menu.description">Kurze Videos für die wichtigsten Schritte.</p>
      </header>
      <div class="tutorial-menu-list" id="tutorialMenuList"></div>
    </aside>
    <div class="tutorial-modal-layer hidden" id="tutorialModalLayer" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="tutorialModalTitle">
      <button class="tutorial-modal-backdrop" id="tutorialModalBackdrop" type="button" aria-label="Anleitung schließen" data-i18n-aria-label="tutorial.close"></button>
      <section class="tutorial-modal-card">
        <header class="tutorial-modal-header">
          <div>
            <p class="tutorial-modal-eyebrow" id="tutorialModalEyebrow">Erste Schritte</p>
            <h2 id="tutorialModalTitle">Mein erstes Arbeitsblatt</h2>
            <p id="tutorialModalDescription"></p>
          </div>
          <button class="tutorial-modal-close" id="tutorialModalClose" type="button" aria-label="Anleitung schließen" title="Schließen" data-i18n-aria-label="tutorial.close" data-i18n-title="common.close">
            ${icon("x")}
          </button>
        </header>
        <div class="tutorial-video-stage">
          <div class="tutorial-youtube-host hidden" id="tutorialYoutubeHost"></div>
          <div class="tutorial-video-placeholder" id="tutorialVideoPlaceholder">
            <button class="tutorial-video-start hidden" id="tutorialVideoStart" type="button">
              <span class="tutorial-placeholder-icon">${icon("play", "icon tutorial-play-icon")}</span>
              <strong data-i18n="tutorial.start.title">Video starten</strong>
              <span data-i18n="tutorial.start.body">YouTube wird erst nach deinem Klick geladen.</span>
            </button>
            <div class="tutorial-video-pending" id="tutorialVideoPending">
              <span class="tutorial-placeholder-icon">${icon("play", "icon tutorial-play-icon")}</span>
              <strong id="tutorialPlaceholderTitle" data-i18n="tutorial.comingSoon.title">Video wird vorbereitet</strong>
              <span id="tutorialPlaceholderBody" data-i18n="tutorial.comingSoon.body">Die Anleitung ist bereits angelegt und erscheint hier, sobald das Video verfügbar ist.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
  document.body.append(root);

  const elements = {
    menu: root.querySelector("#tutorialMenu"),
    list: root.querySelector("#tutorialMenuList"),
    modal: root.querySelector("#tutorialModalLayer"),
    backdrop: root.querySelector("#tutorialModalBackdrop"),
    close: root.querySelector("#tutorialModalClose"),
    eyebrow: root.querySelector("#tutorialModalEyebrow"),
    title: root.querySelector("#tutorialModalTitle"),
    description: root.querySelector("#tutorialModalDescription"),
    youtubeHost: root.querySelector("#tutorialYoutubeHost"),
    placeholder: root.querySelector("#tutorialVideoPlaceholder"),
    start: root.querySelector("#tutorialVideoStart"),
    pending: root.querySelector("#tutorialVideoPending"),
    placeholderTitle: root.querySelector("#tutorialPlaceholderTitle"),
    placeholderBody: root.querySelector("#tutorialPlaceholderBody")
  };

  function icon(name, className = "icon icon-small") {
    return `<svg class="${className}" aria-hidden="true"><use href="${SPRITE}#${name}"></use></svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function t(key, variables = {}) {
    return locale.t(key, variables);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { "content-type": "application/json; charset=utf-8" } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || t("tutorial.error"));
    }
    return payload;
  }

  function tutorialById(id) {
    return catalogue?.items?.find((tutorial) => tutorial.id === id) || null;
  }

  function revealTriggers(visible) {
    triggers.forEach((trigger) => trigger.classList.toggle("hidden", !visible));
  }

  function renderMenu() {
    const items = Array.isArray(catalogue?.items) ? catalogue.items : [];
    elements.list.innerHTML = items.length
      ? items.map((tutorial) => {
        const status = tutorial.completed
          ? t("tutorial.completed")
          : tutorial.available
            ? t("tutorial.play")
            : t("tutorial.comingSoon.badge");
        return `
          <button class="tutorial-menu-item ${tutorial.available ? "is-available" : "is-pending"}" type="button" role="menuitem" data-tutorial-id="${escapeHtml(tutorial.id)}">
            <span class="tutorial-thumbnail" aria-hidden="true">
              <span class="tutorial-thumbnail-lines"></span>
              <span class="tutorial-thumbnail-play">${icon("play", "icon tutorial-play-icon")}</span>
            </span>
            <span class="tutorial-menu-copy">
              <small>${escapeHtml(tutorial.eyebrow)}</small>
              <strong>${escapeHtml(tutorial.title)}</strong>
              <span>${escapeHtml(tutorial.description)}</span>
              <em class="${tutorial.completed ? "is-complete" : ""}">${escapeHtml(status)}</em>
            </span>
          </button>
        `;
      }).join("")
      : `<p class="tutorial-menu-empty">${escapeHtml(t("tutorial.empty"))}</p>`;
  }

  function positionMenu(trigger) {
    const rect = trigger.getBoundingClientRect();
    const menuRect = elements.menu.getBoundingClientRect();
    const margin = 12;
    const left = Math.min(
      window.innerWidth - menuRect.width - margin,
      Math.max(margin, rect.right - menuRect.width)
    );
    let top = rect.bottom + 8;
    if (top + menuRect.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - menuRect.height - 8);
    }
    elements.menu.style.setProperty("--tutorial-menu-left", `${Math.round(left)}px`);
    elements.menu.style.setProperty("--tutorial-menu-top", `${Math.round(top)}px`);
  }

  function closeMenu({ restoreFocus = false } = {}) {
    elements.menu.classList.add("hidden");
    triggers.forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    if (restoreFocus) activeTrigger?.focus?.();
    activeTrigger = null;
  }

  async function openMenu(trigger) {
    if (!catalogue) await loadCatalogue({ allowAutoShow: false });
    if (!catalogue) return;
    if (!elements.menu.classList.contains("hidden") && activeTrigger === trigger) {
      closeMenu({ restoreFocus: true });
      return;
    }
    closeMenu();
    activeTrigger = trigger;
    renderMenu();
    elements.menu.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    positionMenu(trigger);
    elements.list.querySelector("[data-tutorial-id]")?.focus?.();
  }

  function clearYoutubePlayer() {
    try {
      youtubePlayer?.destroy?.();
    } catch {
      // The iframe can already be detached when the modal closes during loading.
    }
    youtubePlayer = null;
    elements.youtubeHost.replaceChildren();
    elements.youtubeHost.classList.add("hidden");
  }

  function showPending(titleKey = "tutorial.comingSoon.title", bodyKey = "tutorial.comingSoon.body") {
    clearYoutubePlayer();
    elements.placeholder.classList.remove("hidden");
    elements.start.classList.add("hidden");
    elements.pending.classList.remove("hidden");
    elements.placeholderTitle.textContent = t(titleKey);
    elements.placeholderBody.textContent = t(bodyKey);
  }

  function showYoutubeGate() {
    clearYoutubePlayer();
    elements.placeholder.classList.remove("hidden");
    elements.pending.classList.add("hidden");
    elements.start.classList.remove("hidden");
  }

  function loadYoutubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.();
        resolve(window.YT);
      };
      let script = document.querySelector(`#${YOUTUBE_API_ID}`);
      if (!script) {
        script = document.createElement("script");
        script.id = YOUTUBE_API_ID;
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.addEventListener("error", () => reject(new Error("YouTube API could not be loaded.")), { once: true });
        document.head.append(script);
      }
    });
    youtubeApiPromise.catch(() => {
      youtubeApiPromise = null;
    });
    return youtubeApiPromise;
  }

  function startYoutubeVideo() {
    const tutorial = activeTutorial;
    if (!tutorial?.available || tutorial.videoProvider !== "youtube" || !tutorial.youtubeVideoId) return;
    clearYoutubePlayer();
    elements.placeholder.classList.add("hidden");
    elements.youtubeHost.classList.remove("hidden");
    const iframe = document.createElement("iframe");
    const parameters = new URLSearchParams({
      autoplay: "1",
      controls: "1",
      enablejsapi: "1",
      origin: window.location.origin,
      playsinline: "1",
      rel: "0"
    });
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(tutorial.youtubeVideoId)}?${parameters}`;
    iframe.title = tutorial.title;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    elements.youtubeHost.append(iframe);
    loadYoutubeApi().then(() => {
      if (activeTutorial !== tutorial || !iframe.isConnected) return;
      youtubePlayer = new window.YT.Player(iframe, {
        events: {
          onStateChange(event) {
            if (event.data !== window.YT.PlayerState.ENDED || activeTutorial !== tutorial) return;
            tutorial.completed = true;
            recordEvent(tutorial, "completed");
          },
          onError() {
            if (activeTutorial === tutorial) {
              showPending("tutorial.videoError.title", "tutorial.videoError.body");
            }
          }
        }
      });
    }).catch(() => {
      // The privacy-enhanced iframe remains usable even if progress tracking cannot attach.
    });
  }

  async function recordEvent(tutorial, event) {
    try {
      const payload = await api(`/api/tutorials/${encodeURIComponent(tutorial.id)}/events`, {
        method: "POST",
        body: JSON.stringify({ event })
      });
      tutorial.autoShown = payload.progress?.autoShownIds?.includes(tutorial.id) || tutorial.autoShown;
      tutorial.completed = payload.progress?.completedIds?.includes(tutorial.id) || tutorial.completed;
      renderMenu();
    } catch {
      // A later app load retries non-critical tutorial progress updates.
    }
  }

  function openTutorial(tutorial, { automatic = false } = {}) {
    if (!tutorial) return;
    closeMenu();
    activeTutorial = tutorial;
    lastFocusedElement = document.activeElement;
    elements.eyebrow.textContent = tutorial.eyebrow;
    elements.title.textContent = tutorial.title;
    elements.description.textContent = tutorial.description;
    elements.modal.classList.remove("hidden");
    elements.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("tutorial-modal-open");
    if (tutorial.available && tutorial.videoProvider === "youtube" && tutorial.youtubeVideoId) {
      showYoutubeGate();
    } else {
      showPending();
    }
    elements.close.focus();
    if (automatic) {
      catalogue.autoShowId = null;
      tutorial.autoShown = true;
      recordEvent(tutorial, "auto_shown");
    }
  }

  function closeTutorial() {
    if (elements.modal.classList.contains("hidden")) return;
    clearYoutubePlayer();
    elements.modal.classList.add("hidden");
    elements.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("tutorial-modal-open");
    activeTutorial = null;
    lastFocusedElement?.focus?.();
    lastFocusedElement = null;
  }

  function anotherDialogIsOpen() {
    return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((dialog) => (
      dialog !== elements.modal
      && !dialog.classList.contains("hidden")
      && dialog.getClientRects().length > 0
    ));
  }

  function scheduleAutoTutorial() {
    clearTimeout(autoShowTimer);
    const tutorial = consentAccepted ? tutorialById(catalogue?.autoShowId) : null;
    if (!tutorial?.available) return;
    autoShowTimer = window.setTimeout(() => {
      if (anotherDialogIsOpen()) {
        scheduleAutoTutorial();
        return;
      }
      openTutorial(tutorial, { automatic: true });
    }, 650);
  }

  async function loadCatalogue({ allowAutoShow = false } = {}) {
    try {
      catalogue = await api("/api/tutorials");
      revealTriggers(true);
      renderMenu();
      if (allowAutoShow) scheduleAutoTutorial();
      return catalogue;
    } catch {
      catalogue = null;
      revealTriggers(false);
      return null;
    }
  }

  triggers.forEach((trigger) => trigger.addEventListener("click", () => openMenu(trigger)));
  elements.list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-tutorial-id]");
    if (item) openTutorial(tutorialById(item.dataset.tutorialId));
  });
  elements.start.addEventListener("click", startYoutubeVideo);
  elements.close.addEventListener("click", closeTutorial);
  elements.backdrop.addEventListener("click", closeTutorial);
  document.addEventListener("click", (event) => {
    if (elements.menu.classList.contains("hidden")) return;
    if (!elements.menu.contains(event.target) && !triggers.includes(event.target.closest?.("#tutorialsButton, #workspaceMobileTutorialsButton"))) {
      closeMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!elements.modal.classList.contains("hidden")) {
      event.preventDefault();
      closeTutorial();
    } else if (!elements.menu.classList.contains("hidden")) {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  });
  window.addEventListener("resize", () => {
    if (activeTrigger && !elements.menu.classList.contains("hidden")) positionMenu(activeTrigger);
  });
  window.addEventListener("sheetify:localechange", () => loadCatalogue({ allowAutoShow: false }));
  window.addEventListener("sheetify:betaexperience", (event) => {
    consentAccepted = Boolean(event.detail?.consent?.accepted);
    loadCatalogue({ allowAutoShow: consentAccepted });
  });
  window.addEventListener("sheetify:creditnoticeclosed", scheduleAutoTutorial);

  locale.apply(root);
  loadCatalogue({ allowAutoShow: false });
  window.sheetifyTutorialCenter = Object.freeze({ refresh: loadCatalogue });
})();
