"use strict";

(() => {
  const REMINDER_KEY = "sheetifyimg.feedback-reminder.v1";
  const locale = window.sheetifyLocale;
  let experience = null;
  let activeContext = {};
  let lastArtifactContext = {};
  let lastFocusedElement = null;

  const root = document.createElement("div");
  root.id = "betaExperienceRoot";
  root.innerHTML = `
    <button class="beta-feedback-trigger hidden" id="betaFeedbackTrigger" type="button" aria-haspopup="dialog">
      <span aria-hidden="true">✦</span>
      <span data-i18n="beta.feedback.trigger">Feedback</span>
    </button>
    <aside class="beta-feedback-reminder hidden" id="betaFeedbackReminder" aria-live="polite">
      <button class="beta-feedback-reminder-close" type="button" aria-label="Hinweis schließen" data-i18n-aria-label="beta.reminder.close">×</button>
      <strong data-i18n="beta.reminder.title">Wie war dein Entwurf?</strong>
      <span data-i18n="beta.reminder.body">Eine kurze Rückmeldung hilft uns sehr.</span>
      <button class="beta-feedback-reminder-action" type="button" data-i18n="beta.reminder.action">Feedback geben</button>
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
    <div class="beta-experience-layer hidden" id="betaFeedbackLayer" role="dialog" aria-modal="true" aria-labelledby="betaFeedbackTitle">
      <section class="beta-experience-card beta-feedback-card">
        <header class="beta-feedback-header">
          <div>
            <p class="beta-experience-eyebrow" data-i18n="beta.feedback.eyebrow">Beta-Feedback</p>
            <h2 id="betaFeedbackTitle" data-i18n="beta.feedback.title">Wie war deine Erfahrung?</h2>
            <p id="betaFeedbackContext" data-i18n="beta.feedback.contextGeneral">Allgemeines Feedback zu SheetifyIMG</p>
          </div>
          <button class="beta-feedback-close" id="betaFeedbackClose" type="button" aria-label="Feedback schließen" data-i18n-aria-label="beta.feedback.close">×</button>
        </header>
        <form id="betaFeedbackForm">
          <fieldset class="beta-rating-fieldset">
            <legend data-i18n="beta.feedback.overall">Gesamteindruck</legend>
            <div class="beta-rating-options" aria-label="Bewertung von 1 bis 5" data-i18n-aria-label="beta.feedback.rating">
              ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" data-beta-rating="${rating}" aria-label="${rating} von 5" data-rating-label>${rating}</button>`).join("")}
            </div>
            <input type="hidden" name="rating" value="">
          </fieldset>
          <label class="beta-feedback-label"><span data-i18n="beta.feedback.category">Worum geht es?</span>
            <select name="category">
              <option value="result" data-i18n="beta.feedback.category.result">Ergebnis / Entwurf</option>
              <option value="usability" data-i18n="beta.feedback.category.usability">Bedienung</option>
              <option value="problem" data-i18n="beta.feedback.category.problem">Technisches Problem</option>
              <option value="idea" data-i18n="beta.feedback.category.idea">Idee oder Wunsch</option>
              <option value="general" data-i18n="beta.feedback.category.general">Allgemein</option>
            </select>
          </label>
          <fieldset class="beta-tag-fieldset">
            <legend data-i18n="beta.feedback.tags">Passt etwas davon?</legend>
            <div class="beta-tag-options">
              <label><input type="checkbox" name="tags" value="helpful"><span data-i18n="beta.feedback.tag.helpful">Hilfreich</span></label>
              <label><input type="checkbox" name="tags" value="unclear"><span data-i18n="beta.feedback.tag.unclear">Unklar</span></label>
              <label><input type="checkbox" name="tags" value="incorrect"><span data-i18n="beta.feedback.tag.incorrect">Inhaltlich falsch</span></label>
              <label><input type="checkbox" name="tags" value="design"><span data-i18n="beta.feedback.tag.design">Design</span></label>
              <label><input type="checkbox" name="tags" value="technical"><span data-i18n="beta.feedback.tag.technical">Technik</span></label>
            </div>
          </fieldset>
          <label class="beta-feedback-label"><span data-i18n="beta.feedback.message">Was möchtest du uns sagen?</span>
            <textarea name="message" rows="4" maxlength="4000" placeholder="Kurz und ehrlich reicht völlig." data-i18n-placeholder="beta.feedback.messagePlaceholder"></textarea>
          </label>
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
    feedbackTrigger: root.querySelector("#betaFeedbackTrigger"),
    feedbackReminder: root.querySelector("#betaFeedbackReminder"),
    reminderClose: root.querySelector(".beta-feedback-reminder-close"),
    reminderAction: root.querySelector(".beta-feedback-reminder-action"),
    feedbackLayer: root.querySelector("#betaFeedbackLayer"),
    feedbackClose: root.querySelector("#betaFeedbackClose"),
    feedbackCancel: root.querySelector("#betaFeedbackCancel"),
    feedbackForm: root.querySelector("#betaFeedbackForm"),
    feedbackContext: root.querySelector("#betaFeedbackContext"),
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

  function applyLocale() {
    locale.apply(root);
    root.querySelectorAll("[data-rating-label]").forEach((button) => {
      button.setAttribute("aria-label", t("beta.feedback.ratingItem", { rating: button.dataset.betaRating }));
    });
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

  function contextLabel(context) {
    if (context.candidateId) return t("beta.feedback.contextDraft");
    if (context.projectId) return t("beta.feedback.contextProject");
    return t("beta.feedback.contextGeneral");
  }

  function showFeedbackToast() {
    elements.feedbackToast.classList.remove("hidden");
    clearTimeout(showFeedbackToast.timer);
    showFeedbackToast.timer = setTimeout(() => elements.feedbackToast.classList.add("hidden"), 3200);
  }

  function hideReminder() {
    elements.feedbackReminder.classList.add("hidden");
  }

  function openFeedback() {
    if (!experience?.consent?.accepted) return;
    activeContext = feedbackContext();
    elements.feedbackContext.textContent = contextLabel(activeContext);
    elements.feedbackForm.elements.category.value = activeContext.candidateId ? "result" : "general";
    setError(elements.feedbackError);
    lastFocusedElement = document.activeElement;
    elements.feedbackLayer.classList.remove("hidden");
    document.body.classList.add("beta-feedback-open");
    hideReminder();
    elements.feedbackForm.querySelector("[data-beta-rating='5']")?.focus();
  }

  function closeFeedback() {
    elements.feedbackLayer.classList.add("hidden");
    document.body.classList.remove("beta-feedback-open");
    lastFocusedElement?.focus?.();
    lastFocusedElement = null;
  }

  function resetFeedbackForm() {
    elements.feedbackForm.reset();
    elements.feedbackForm.elements.rating.value = "";
    elements.feedbackForm.querySelectorAll("[data-beta-rating]").forEach((button) => button.classList.remove("selected"));
  }

  function maybeShowReminder() {
    if (!experience?.consent?.accepted || experience.feedback?.count || sessionStorage.getItem(REMINDER_KEY)) return;
    if (!document.querySelector("[data-capture-kind='candidate'][data-candidate-id]")) return;
    sessionStorage.setItem(REMINDER_KEY, "shown");
    setTimeout(() => {
      if (elements.feedbackLayer.classList.contains("hidden")) {
        elements.feedbackReminder.classList.remove("hidden");
      }
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
        elements.feedbackTrigger.classList.remove("hidden");
        maybeShowReminder();
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
      elements.feedbackTrigger.classList.remove("hidden");
      maybeShowReminder();
    } catch (error) {
      setError(elements.consentError, error.message);
    } finally {
      elements.consentAccept.disabled = false;
      elements.consentAccept.textContent = t("beta.consent.accept");
    }
  });

  elements.feedbackForm.querySelectorAll("[data-beta-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.feedbackForm.elements.rating.value = button.dataset.betaRating;
      elements.feedbackForm.querySelectorAll("[data-beta-rating]").forEach((entry) => {
        entry.classList.toggle("selected", entry === button);
      });
    });
  });

  elements.feedbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(elements.feedbackForm);
    const payload = {
      ...activeContext,
      rating: data.get("rating") ? Number(data.get("rating")) : null,
      category: data.get("category"),
      tags: data.getAll("tags"),
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

  elements.feedbackTrigger.addEventListener("click", openFeedback);
  elements.reminderAction.addEventListener("click", openFeedback);
  elements.reminderClose.addEventListener("click", hideReminder);
  elements.feedbackClose.addEventListener("click", closeFeedback);
  elements.feedbackCancel.addEventListener("click", closeFeedback);
  elements.feedbackLayer.addEventListener("click", (event) => {
    if (event.target === elements.feedbackLayer) closeFeedback();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.feedbackLayer.classList.contains("hidden")) {
      event.preventDefault();
      closeFeedback();
    }
  });

  window.addEventListener("sheetify:localechange", () => {
    applyLocale();
    elements.feedbackContext.textContent = contextLabel(activeContext);
  });

  new MutationObserver(maybeShowReminder).observe(document.querySelector(".app-shell") || document.body, {
    childList: true,
    subtree: true
  });

  locale.set(locale.resolve({ stored: storedLocale(), browser: navigator.languages }), { persistLocal: false });
  applyLocale();
  loadExperience();
})();
