"use strict";

(() => {
  const REMINDER_KEY = "sheetifyimg.feedback-reminder.v2";
  const RENDER_NUDGE_KEY = "sheetifyimg.feedback-render-nudge.v1";
  const FEEDBACK_POSITION_KEY = "sheetifyimg.feedback-position.v1";
  const FEEDBACK_DRAG_THRESHOLD = 6;
  const locale = window.sheetifyLocale;
  let experience = null;
  let activeContext = {};
  let lastArtifactContext = {};
  let lastFocusedElement = null;
  let pendingCreditNotice = null;
  let creditPollRunning = false;
  let feedbackDrag = null;
  let suppressFeedbackClick = false;
  let feedbackResizeFrame = 0;
  let feedbackOpenedAt = 0;

  const root = document.createElement("div");
  root.id = "betaExperienceRoot";
  root.innerHTML = `
    <button class="beta-feedback-trigger hidden" id="betaFeedbackTrigger" type="button" aria-haspopup="dialog">
      <img class="beta-feedback-trigger-icon" src="/icons/lucide/message-square-plus.svg" aria-hidden="true" alt="">
      <span data-i18n="beta.feedback.trigger">Beta-Feedback</span>
    </button>
    <aside class="beta-feedback-reminder hidden" id="betaFeedbackReminder" aria-live="polite">
      <button class="beta-feedback-reminder-close" type="button" aria-label="Hinweis schließen" data-i18n-aria-label="beta.reminder.close">×</button>
      <strong id="betaFeedbackReminderTitle" data-i18n="beta.reminder.complete.title">Der Entwurf ist da.</strong>
      <span id="betaFeedbackReminderBody" data-i18n="beta.reminder.complete.body">Was ist dir aufgefallen?</span>
      <button class="beta-feedback-reminder-action" type="button" data-i18n="beta.reminder.action">Beta-Feedback geben</button>
    </aside>
    <div class="beta-experience-layer beta-consent-layer hidden" id="betaConsentLayer" role="dialog" aria-modal="true" aria-labelledby="betaConsentTitle">
      <section class="beta-experience-card beta-consent-card">
        <p class="beta-experience-eyebrow" data-i18n="beta.consent.eyebrow">Kleine Beta</p>
        <h2 id="betaConsentTitle" data-i18n="beta.consent.title">Gemeinsam SheetifyIMG verbessern</h2>
        <p data-i18n="beta.consent.body">Während dieser Beta dürfen deine Eingaben, Nutzungsschritte, erzeugten Entwürfe und dein freiwilliges Feedback gemeinsam ausgewertet und KI-gestützt zusammengefasst werden.</p>
        <p class="beta-consent-note"><span data-i18n="beta.consent.noteBefore">Bitte verwende keine sensiblen persönlichen Daten. Bei Fragen erreichst du uns unter</span> <a href="mailto:sheetify@jujies.app">sheetify@jujies.app</a>.</p>
        <p class="beta-experience-error hidden" id="betaConsentError"></p>
        <div class="beta-experience-actions">
          <button class="beta-primary-button" id="betaConsentAccept" type="button" data-i18n="beta.consent.accept">Zustimmen und Beta starten</button>
        </div>
      </section>
    </div>
    <div class="beta-experience-layer beta-credit-layer hidden" id="betaCreditLayer" role="dialog" aria-modal="true" aria-labelledby="betaCreditTitle">
      <section class="beta-experience-card beta-credit-card">
        <p class="beta-experience-eyebrow" data-i18n="beta.credit.eyebrow">Neues Entwurfsguthaben</p>
        <h2 id="betaCreditTitle">Neue Entwurfsseiten</h2>
        <p id="betaCreditBody"></p>
        <p class="beta-experience-error hidden" id="betaCreditError"></p>
        <div class="beta-experience-actions">
          <button class="beta-primary-button" id="betaCreditAccept" type="button" data-i18n="beta.credit.accept">Verstanden</button>
        </div>
      </section>
    </div>
    <div class="beta-experience-layer hidden" id="betaFeedbackLayer" role="dialog" aria-modal="true" aria-labelledby="betaFeedbackTitle">
      <section class="beta-experience-card beta-feedback-card">
        <header class="beta-feedback-header">
          <div>
            <p class="beta-experience-eyebrow" data-i18n="beta.feedback.eyebrow">Beta-Feedback</p>
            <h2 id="betaFeedbackTitle" data-i18n="beta.feedback.title">Was ist dir gerade aufgefallen?</h2>
            <p data-i18n="beta.feedback.description">Schreib es kurz auf. Hinweise direkt beim Arbeiten helfen uns am meisten.</p>
          </div>
          <button class="beta-feedback-close" id="betaFeedbackClose" type="button" aria-label="Feedback schließen" data-i18n-aria-label="beta.feedback.close">×</button>
        </header>
        <form id="betaFeedbackForm">
          <aside class="beta-feedback-guidance">
            <ul>
              <li data-i18n="beta.feedback.prompt.stuck">Ich komme gerade nicht weiter:</li>
              <li data-i18n="beta.feedback.prompt.cumbersome">Das war umständlich:</li>
              <li data-i18n="beta.feedback.prompt.unexpected">Die App hat gerade etwas anders gemacht als erwartet:</li>
              <li data-i18n="beta.feedback.prompt.improve">Das könnte besser funktionieren:</li>
            </ul>
          </aside>
          <label class="beta-feedback-label"><span data-i18n="beta.feedback.message">Dein Hinweis</span>
            <textarea name="message" rows="4" maxlength="4000" placeholder="Oder beschreibe einfach, was dir gerade aufgefallen ist." data-i18n-placeholder="beta.feedback.messagePlaceholder" required></textarea>
          </label>
          <p class="beta-feedback-note" data-i18n="beta.feedback.note">Bitte keine sensiblen persönlichen Daten eingeben.</p>
          <p class="beta-experience-error hidden" id="betaFeedbackError"></p>
          <div class="beta-experience-actions">
            <button class="beta-secondary-button" id="betaFeedbackCancel" type="button" data-i18n="beta.feedback.later">Später</button>
            <button class="beta-primary-button" id="betaFeedbackSubmit" type="submit" data-i18n="beta.feedback.submit">Feedback senden</button>
          </div>
        </form>
      </section>
    </div>
    <div class="beta-feedback-toast hidden" id="betaFeedbackToast" role="status" aria-live="polite" data-i18n="beta.feedback.thanks">Danke – dein Feedback ist angekommen.</div>
  `;
  document.body.append(root);

  const elements = {
    consentLayer: root.querySelector("#betaConsentLayer"),
    consentAccept: root.querySelector("#betaConsentAccept"),
    consentError: root.querySelector("#betaConsentError"),
    creditLayer: root.querySelector("#betaCreditLayer"),
    creditTitle: root.querySelector("#betaCreditTitle"),
    creditBody: root.querySelector("#betaCreditBody"),
    creditError: root.querySelector("#betaCreditError"),
    creditAccept: root.querySelector("#betaCreditAccept"),
    feedbackTrigger: root.querySelector("#betaFeedbackTrigger"),
    feedbackReminder: root.querySelector("#betaFeedbackReminder"),
    reminderClose: root.querySelector(".beta-feedback-reminder-close"),
    reminderAction: root.querySelector(".beta-feedback-reminder-action"),
    feedbackLayer: root.querySelector("#betaFeedbackLayer"),
    feedbackClose: root.querySelector("#betaFeedbackClose"),
    feedbackCancel: root.querySelector("#betaFeedbackCancel"),
    feedbackForm: root.querySelector("#betaFeedbackForm"),
    feedbackMessage: root.querySelector("#betaFeedbackForm textarea[name='message']"),
    reminderTitle: root.querySelector("#betaFeedbackReminderTitle"),
    reminderBody: root.querySelector("#betaFeedbackReminderBody"),
    feedbackError: root.querySelector("#betaFeedbackError"),
    feedbackSubmit: root.querySelector("#betaFeedbackSubmit"),
    feedbackToast: root.querySelector("#betaFeedbackToast")
  };

  function t(key, variables = {}) {
    return locale.t(key, variables);
  }

  function storedLocale() {
    try {
      return localStorage.getItem(locale.STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function readFeedbackPosition() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(FEEDBACK_POSITION_KEY) || "null");
      if (!stored || !Number.isFinite(stored.x) || !Number.isFinite(stored.y)) return null;
      return { x: clamp(stored.x, 0, 1), y: clamp(stored.y, 0, 1) };
    } catch {
      return null;
    }
  }

  let feedbackPosition = readFeedbackPosition();

  function feedbackViewport() {
    const visualViewport = window.visualViewport;
    return {
      width: visualViewport?.width || document.documentElement.clientWidth || window.innerWidth,
      height: visualViewport?.height || document.documentElement.clientHeight || window.innerHeight
    };
  }

  function feedbackEdgeMargin() {
    return window.innerWidth <= 700 ? 10 : 12;
  }

  function triggerBounds(left, top) {
    const rect = elements.feedbackTrigger.getBoundingClientRect();
    const viewport = feedbackViewport();
    const margin = feedbackEdgeMargin();
    return {
      left: clamp(left, margin, Math.max(margin, viewport.width - rect.width - margin)),
      top: clamp(top, margin, Math.max(margin, viewport.height - rect.height - margin)),
      width: rect.width,
      height: rect.height,
      viewport,
      margin
    };
  }

  function applyFeedbackPixelPosition(left, top) {
    const bounded = triggerBounds(left, top);
    elements.feedbackTrigger.classList.add("is-positioned");
    elements.feedbackTrigger.style.setProperty("--beta-feedback-left", `${Math.round(bounded.left)}px`);
    elements.feedbackTrigger.style.setProperty("--beta-feedback-top", `${Math.round(bounded.top)}px`);
    return bounded;
  }

  function normalizedFeedbackPosition(left, top) {
    const bounded = triggerBounds(left, top);
    const availableX = Math.max(0, bounded.viewport.width - bounded.width - (bounded.margin * 2));
    const availableY = Math.max(0, bounded.viewport.height - bounded.height - (bounded.margin * 2));
    return {
      x: availableX ? (bounded.left - bounded.margin) / availableX : 0,
      y: availableY ? (bounded.top - bounded.margin) / availableY : 0
    };
  }

  function persistFeedbackPosition(left, top) {
    feedbackPosition = normalizedFeedbackPosition(left, top);
    try {
      sessionStorage.setItem(FEEDBACK_POSITION_KEY, JSON.stringify(feedbackPosition));
    } catch {
      // The in-memory position remains stable when storage is unavailable.
    }
  }

  function applyStoredFeedbackPosition() {
    if (!feedbackPosition || elements.feedbackTrigger.classList.contains("hidden")) return;
    const rect = elements.feedbackTrigger.getBoundingClientRect();
    const viewport = feedbackViewport();
    const margin = feedbackEdgeMargin();
    const availableX = Math.max(0, viewport.width - rect.width - (margin * 2));
    const availableY = Math.max(0, viewport.height - rect.height - (margin * 2));
    applyFeedbackPixelPosition(
      margin + (feedbackPosition.x * availableX),
      margin + (feedbackPosition.y * availableY)
    );
  }

  function clearReminderPosition() {
    elements.feedbackReminder.classList.remove("is-positioned");
    elements.feedbackReminder.style.removeProperty("--beta-feedback-reminder-left");
    elements.feedbackReminder.style.removeProperty("--beta-feedback-reminder-top");
  }

  function positionFeedbackReminder() {
    if (elements.feedbackReminder.classList.contains("hidden")) return;
    if (!elements.feedbackTrigger.classList.contains("is-positioned")) {
      clearReminderPosition();
      return;
    }
    const triggerRect = elements.feedbackTrigger.getBoundingClientRect();
    const reminderRect = elements.feedbackReminder.getBoundingClientRect();
    const viewport = feedbackViewport();
    const margin = feedbackEdgeMargin();
    const gap = 10;
    const left = clamp(
      triggerRect.left + ((triggerRect.width - reminderRect.width) / 2),
      margin,
      Math.max(margin, viewport.width - reminderRect.width - margin)
    );
    const above = triggerRect.top - reminderRect.height - gap;
    const top = clamp(
      above >= margin ? above : triggerRect.bottom + gap,
      margin,
      Math.max(margin, viewport.height - reminderRect.height - margin)
    );
    elements.feedbackReminder.classList.add("is-positioned");
    elements.feedbackReminder.style.setProperty("--beta-feedback-reminder-left", `${Math.round(left)}px`);
    elements.feedbackReminder.style.setProperty("--beta-feedback-reminder-top", `${Math.round(top)}px`);
  }

  function showFeedbackTrigger() {
    elements.feedbackTrigger.classList.remove("hidden");
    requestAnimationFrame(() => {
      applyStoredFeedbackPosition();
      positionFeedbackReminder();
    });
  }

  function scheduleFeedbackPositionRefresh() {
    cancelAnimationFrame(feedbackResizeFrame);
    feedbackResizeFrame = requestAnimationFrame(() => {
      applyStoredFeedbackPosition();
      positionFeedbackReminder();
    });
  }

  function applyLocale() {
    locale.apply(root);
  }

  function localizedError(payload) {
    const betaKey = `beta.error.${payload.error || "default"}`;
    const betaMessage = t(betaKey);
    if (betaMessage !== betaKey) return betaMessage;
    const passKey = `pass.error.${payload.error || "default"}`;
    const passMessage = t(passKey);
    if (passMessage !== passKey) return passMessage;
    if (locale.current() === "de" && payload.message) return payload.message;
    return t("beta.error.default");
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
      throw new Error(localizedError(payload));
    }
    return payload;
  }

  function setError(element, message = "") {
    element.textContent = message;
    element.classList.toggle("hidden", !message);
  }

  function deviceClass() {
    if (window.innerWidth < 640) return "mobile";
    if (window.innerWidth < 1024) return "tablet";
    return "desktop";
  }

  function providerContext() {
    try {
      return window.sheetifyBetaFeedbackContext?.() || {};
    } catch {
      return {};
    }
  }

  function feedbackContext() {
    const provided = providerContext();
    const current = {
      ...provided,
      projectId: provided.projectId || lastArtifactContext.projectId || null,
      runId: provided.runId || lastArtifactContext.runId || null,
      candidateId: provided.candidateId || lastArtifactContext.candidateId || null,
      page: provided.page || lastArtifactContext.page || null
    };
    return Object.fromEntries(Object.entries({
      projectId: current.projectId || null,
      runId: current.runId || null,
      candidateId: current.candidateId || null,
      page: current.page || null,
      uiView: current.uiView || window.location.pathname,
      deviceClass: deviceClass()
    }).filter(([, value]) => value !== null && value !== ""));
  }

  function showFeedbackToast() {
    elements.feedbackToast.classList.remove("hidden");
    clearTimeout(showFeedbackToast.timer);
    showFeedbackToast.timer = setTimeout(() => elements.feedbackToast.classList.add("hidden"), 3200);
  }

  function renderCreditNotice() {
    if (!pendingCreditNotice) return;
    elements.creditTitle.textContent = t(pendingCreditNotice.amount === 1
      ? "beta.credit.titleOne"
      : "beta.credit.title", { count: pendingCreditNotice.amount });
    elements.creditBody.textContent = t(pendingCreditNotice.balance === 1
      ? "beta.credit.bodyOne"
      : "beta.credit.body", { count: pendingCreditNotice.balance });
  }

  function maybeShowCreditNotice() {
    if (!pendingCreditNotice || !experience?.consent?.accepted) return;
    if (!elements.consentLayer.classList.contains("hidden") || !elements.feedbackLayer.classList.contains("hidden")) return;
    renderCreditNotice();
    setError(elements.creditError);
    elements.creditLayer.classList.remove("hidden");
    document.body.classList.add("beta-credit-open");
    elements.creditAccept.focus();
  }

  async function pollCreditNotice() {
    if (creditPollRunning) return;
    creditPollRunning = true;
    try {
      const payload = await api("/api/pass/credit-notice");
      window.dispatchEvent(new CustomEvent("sheetify:balancechange", { detail: { balance: payload.balance } }));
      if (payload.notice) {
        pendingCreditNotice = payload.notice;
        maybeShowCreditNotice();
      }
    } catch {
      // The next scheduled or focus refresh retries silently.
    } finally {
      creditPollRunning = false;
    }
  }

  function hideReminder() {
    elements.feedbackReminder.classList.add("hidden");
  }

  function canNudgeFeedback() {
    return Boolean(experience?.consent?.accepted)
      && !experience.feedback?.count
      && elements.feedbackLayer.classList.contains("hidden");
  }

  function pulseFeedbackTrigger() {
    elements.feedbackTrigger.classList.remove("is-nudged");
    void elements.feedbackTrigger.offsetWidth;
    elements.feedbackTrigger.classList.add("is-nudged");
  }

  function showReminder(kind) {
    if (!canNudgeFeedback() || sessionStorage.getItem(REMINDER_KEY)) return;
    sessionStorage.setItem(REMINDER_KEY, kind);
    elements.reminderTitle.textContent = t(`beta.reminder.${kind}.title`);
    elements.reminderBody.textContent = t(`beta.reminder.${kind}.body`);
    elements.feedbackReminder.classList.remove("hidden");
    requestAnimationFrame(positionFeedbackReminder);
  }

  function beginFeedbackDrag(event) {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    suppressFeedbackClick = false;
    const rect = elements.feedbackTrigger.getBoundingClientRect();
    feedbackDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      left: rect.left,
      top: rect.top,
      pointerType: event.pointerType,
      dragging: false,
      reminderVisible: !elements.feedbackReminder.classList.contains("hidden")
    };
    elements.feedbackTrigger.setPointerCapture?.(event.pointerId);
  }

  function moveFeedbackDrag(event) {
    if (!feedbackDrag || feedbackDrag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - feedbackDrag.startX;
    const deltaY = event.clientY - feedbackDrag.startY;
    const dragThreshold = feedbackDrag.pointerType === "mouse" ? FEEDBACK_DRAG_THRESHOLD : 10;
    if (!feedbackDrag.dragging && Math.hypot(deltaX, deltaY) < dragThreshold) return;
    if (!feedbackDrag.dragging) {
      feedbackDrag.dragging = true;
      elements.feedbackTrigger.classList.remove("is-nudged");
      elements.feedbackTrigger.classList.add("is-dragging");
      if (feedbackDrag.reminderVisible) hideReminder();
    }
    event.preventDefault();
    const bounded = applyFeedbackPixelPosition(
      feedbackDrag.startLeft + deltaX,
      feedbackDrag.startTop + deltaY
    );
    feedbackDrag.left = bounded.left;
    feedbackDrag.top = bounded.top;
  }

  function finishFeedbackDrag(event) {
    if (!feedbackDrag || feedbackDrag.pointerId !== event.pointerId) return;
    const completed = feedbackDrag;
    feedbackDrag = null;
    elements.feedbackTrigger.classList.remove("is-dragging");
    try {
      elements.feedbackTrigger.releasePointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    if (!completed.dragging) {
      if (event.type === "pointerup" && event.pointerType !== "mouse") {
        suppressFeedbackClick = true;
        setTimeout(() => {
          suppressFeedbackClick = false;
          openFeedback();
        }, 0);
      }
      return;
    }
    event.preventDefault();
    suppressFeedbackClick = true;
    persistFeedbackPosition(completed.left, completed.top);
    if (completed.reminderVisible) {
      elements.feedbackReminder.classList.remove("hidden");
      requestAnimationFrame(positionFeedbackReminder);
    }
    setTimeout(() => {
      suppressFeedbackClick = false;
    }, 0);
  }

  function activateFeedbackTrigger(event) {
    if (suppressFeedbackClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressFeedbackClick = false;
      return;
    }
    openFeedback();
  }

  function openFeedback() {
    if (!experience?.consent?.accepted) return;
    activeContext = feedbackContext();
    setError(elements.feedbackError);
    lastFocusedElement = document.activeElement;
    elements.feedbackLayer.classList.remove("hidden");
    feedbackOpenedAt = Date.now();
    document.body.classList.add("beta-feedback-open");
    hideReminder();
    if (deviceClass() === "mobile") {
      requestAnimationFrame(() => elements.feedbackClose.focus({ preventScroll: true }));
    } else {
      elements.feedbackMessage.focus();
    }
  }

  function closeFeedback() {
    elements.feedbackLayer.classList.add("hidden");
    document.body.classList.remove("beta-feedback-open");
    lastFocusedElement?.focus?.();
    lastFocusedElement = null;
    maybeShowCreditNotice();
  }

  function resetFeedbackForm() {
    elements.feedbackForm.reset();
  }

  function firstVisible(selector) {
    return Array.from(document.querySelectorAll(selector)).find((element) => element.getClientRects().length > 0) || null;
  }

  function observeFeedbackMoments() {
    if (!canNudgeFeedback()) return;
    const rendering = firstVisible(".render-progress-steps, .candidate-rendering, .is-rendering-candidate");
    if (rendering && !sessionStorage.getItem(RENDER_NUDGE_KEY) && !observeFeedbackMoments.renderTimer) {
      observeFeedbackMoments.renderTimer = setTimeout(() => {
        observeFeedbackMoments.renderTimer = null;
        if (canNudgeFeedback() && firstVisible(".render-progress-steps, .candidate-rendering, .is-rendering-candidate")) {
          sessionStorage.setItem(RENDER_NUDGE_KEY, "shown");
          pulseFeedbackTrigger();
        }
      }, 12000);
    }
    if (!rendering && observeFeedbackMoments.renderTimer) {
      clearTimeout(observeFeedbackMoments.renderTimer);
      observeFeedbackMoments.renderTimer = null;
    }
    if (!firstVisible("[data-capture-kind='candidate'][data-candidate-id]")) return;
    if (observeFeedbackMoments.completeTimer || sessionStorage.getItem(REMINDER_KEY)) return;
    observeFeedbackMoments.completeTimer = setTimeout(() => {
      observeFeedbackMoments.completeTimer = null;
      showReminder("complete");
    }, 1200);
  }

  async function loadExperience() {
    try {
      experience = await api("/api/beta/experience");
      if (!experience.enabled) {
        root.remove();
        return;
      }
      const sessionLocale = experience.uiLocale;
      const selectedLocale = locale.resolve({
        stored: storedLocale(),
        session: sessionLocale,
        browser: navigator.languages
      });
      locale.set(selectedLocale);
      experience.uiLocale = selectedLocale;
      applyLocale();
      if (sessionLocale !== selectedLocale) {
        await api("/api/auth/session", {
          method: "PATCH",
          body: JSON.stringify({ uiLocale: selectedLocale })
        });
      }
      if (experience.consent?.accepted) {
        elements.consentLayer.classList.add("hidden");
        showFeedbackTrigger();
        observeFeedbackMoments();
        maybeShowCreditNotice();
      } else {
        elements.consentLayer.classList.remove("hidden");
        elements.consentAccept.focus();
      }
    } catch (error) {
      elements.consentLayer.classList.remove("hidden");
      setError(elements.consentError, `${error.message} ${t("beta.error.retrySuffix")}`);
      elements.consentAccept.textContent = t("beta.retry");
    }
  }

  elements.consentAccept.addEventListener("click", async () => {
    elements.consentAccept.disabled = true;
    setError(elements.consentError);
    try {
      const payload = await api("/api/beta/consent", {
        method: "POST",
        body: JSON.stringify({ accepted: true, uiLocale: locale.current() })
      });
      experience = {
        ...(experience || {}),
        enabled: true,
        consent: payload.consent,
        feedback: experience?.feedback || { count: 0, lastSubmittedAt: null }
      };
      elements.consentLayer.classList.add("hidden");
      showFeedbackTrigger();
      observeFeedbackMoments();
      maybeShowCreditNotice();
    } catch (error) {
      setError(elements.consentError, error.message);
    } finally {
      elements.consentAccept.disabled = false;
      elements.consentAccept.textContent = t("beta.consent.accept");
    }
  });

  elements.creditAccept.addEventListener("click", async () => {
    if (!pendingCreditNotice) return;
    elements.creditAccept.disabled = true;
    setError(elements.creditError);
    try {
      const payload = await api("/api/pass/credit-notice", {
        method: "POST",
        body: JSON.stringify({ grantIds: pendingCreditNotice.grantIds })
      });
      pendingCreditNotice = payload.notice || null;
      elements.creditLayer.classList.add("hidden");
      document.body.classList.remove("beta-credit-open");
      window.dispatchEvent(new CustomEvent("sheetify:balancechange", { detail: { balance: payload.balance } }));
      if (pendingCreditNotice) setTimeout(maybeShowCreditNotice, 0);
    } catch (error) {
      setError(elements.creditError, error.message);
    } finally {
      elements.creditAccept.disabled = false;
    }
  });

  elements.feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(elements.feedbackForm);
      const payload = {
        ...activeContext,
        category: "general",
        rating: null,
        tags: [],
        message: data.get("message")
    };
    elements.feedbackSubmit.disabled = true;
    setError(elements.feedbackError);
    try {
      await api("/api/beta/feedback", { method: "POST", body: JSON.stringify(payload) });
      experience.feedback = {
        count: Number(experience.feedback?.count || 0) + 1,
        lastSubmittedAt: new Date().toISOString()
      };
      hideReminder();
      closeFeedback();
      resetFeedbackForm();
      showFeedbackToast();
    } catch (error) {
      setError(elements.feedbackError, error.message);
    } finally {
      elements.feedbackSubmit.disabled = false;
    }
  });

  document.addEventListener("click", (event) => {
    const artifact = event.target.closest?.("[data-run-id], [data-candidate-id]");
    if (!artifact) return;
    lastArtifactContext = {
      projectId: artifact.dataset.projectId || null,
      runId: artifact.dataset.runId || null,
      candidateId: artifact.dataset.candidateId || null,
      page: Number(artifact.dataset.page || 0) || null
    };
  }, true);

  elements.feedbackTrigger.addEventListener("pointerdown", beginFeedbackDrag);
  elements.feedbackTrigger.addEventListener("pointermove", moveFeedbackDrag);
  elements.feedbackTrigger.addEventListener("pointerup", finishFeedbackDrag);
  elements.feedbackTrigger.addEventListener("pointercancel", finishFeedbackDrag);
  elements.feedbackTrigger.addEventListener("click", activateFeedbackTrigger);
  elements.reminderAction.addEventListener("click", openFeedback);
  elements.reminderClose.addEventListener("click", hideReminder);
  elements.feedbackClose.addEventListener("click", closeFeedback);
  elements.feedbackCancel.addEventListener("click", closeFeedback);
  elements.feedbackLayer.addEventListener("click", (event) => {
    if (event.target === elements.feedbackLayer && Date.now() - feedbackOpenedAt > 450) closeFeedback();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.feedbackLayer.classList.contains("hidden")) {
      event.preventDefault();
      closeFeedback();
    }
  });

  window.addEventListener("sheetify:localechange", () => {
    applyLocale();
    renderCreditNotice();
  });

  window.addEventListener("focus", pollCreditNotice);
  window.addEventListener("resize", scheduleFeedbackPositionRefresh);
  window.visualViewport?.addEventListener("resize", scheduleFeedbackPositionRefresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollCreditNotice();
  });

  new MutationObserver(observeFeedbackMoments).observe(document.querySelector(".app-shell") || document.body, {
    childList: true,
    subtree: true
  });

  locale.set(locale.resolve({ stored: storedLocale(), browser: navigator.languages }), { persistLocal: false });
  applyLocale();
  loadExperience().then(pollCreditNotice);
  setInterval(() => {
    if (document.visibilityState === "visible") pollCreditNotice();
  }, 12000);
})();
