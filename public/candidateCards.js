"use strict";

(function attachCandidateCardRenderer(global) {
  function requiredFunction(dependencies, name) {
    const value = dependencies[name];
    if (typeof value !== "function") {
      throw new Error(`SheetifyIMG candidate card renderer missing dependency: ${name}`);
    }
    return value;
  }

  function createCandidateCardRenderer(dependencies = {}) {
    const t = (key, variables = {}) => global.sheetifyLocale?.t(key, variables) || key;
    const escapeHtml = requiredFunction(dependencies, "escapeHtml");
    const icon = requiredFunction(dependencies, "icon");
    const fileName = requiredFunction(dependencies, "fileName");
    const conceptLabel = requiredFunction(dependencies, "conceptLabel");
    const worksheetDepositActionLabel = requiredFunction(dependencies, "worksheetDepositActionLabel");
    const draftDisplayLabel = requiredFunction(dependencies, "draftDisplayLabel");
    const draftFilePrefix = requiredFunction(dependencies, "draftFilePrefix");
    const draftMetaLabel = requiredFunction(dependencies, "draftMetaLabel");

    function renderCandidateLineageBadges(candidate = {}, options = {}) {
      const showConceptTag = options.showConceptTag !== false;
      const badges = [showConceptTag ? candidate.conceptDisplayLabel : null].filter(Boolean);
      if (!badges.length) {
        return "";
      }
      return `
        <span class="candidate-lineage-badges">
          ${badges.map((badge) => `<span class="candidate-lineage-badge">${escapeHtml(badge)}</span>`).join("")}
        </span>
      `;
    }

    function renderCandidateHeaderTags(candidate = {}, options = {}) {
      const lineageBadges = renderCandidateLineageBadges(candidate, options);
      if (!lineageBadges) {
        return "";
      }
      return `
        <span class="candidate-card-tags">
          ${lineageBadges}
        </span>
      `;
    }

    function candidateImageDownloads(pages = [], fallbackPrefix = "candidate") {
      return pages
        .filter((page) => page.url)
        .map((page, index) => ({
          url: page.url,
          name: fileName(page.path || page.url || `${fallbackPrefix}_page_${index + 1}.png`)
        }));
    }

    function renderCandidateImageDownloadButton(downloads = []) {
      if (!downloads.length) {
        return "";
      }
      const label = global.sheetifyLocale?.current() === "en"
        ? (downloads.length > 1 ? "Download images" : "Download image")
        : (downloads.length > 1 ? "Bilder herunterladen" : "Bild herunterladen");
      return `
        <button class="secondary-button mini-button download-icon-button" type="button" data-card-action="download-candidate-images" data-download-pages="${escapeHtml(JSON.stringify(downloads))}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
          ${icon("download", "icon icon-small")}
        </button>
      `;
    }

    function candidateWorksheetDepositKey(runId = "", candidateId = "") {
      const normalizedRunId = String(runId || "").trim();
      const normalizedCandidateId = String(candidateId || "").trim();
      return normalizedRunId && normalizedCandidateId ? `${normalizedRunId}::${normalizedCandidateId}` : "";
    }

    function candidateWorksheetDeposits(candidate = {}, workspace = {}) {
      if (Array.isArray(candidate.worksheetDeposits) && candidate.worksheetDeposits.length) {
        return candidate.worksheetDeposits;
      }
      const key = candidateWorksheetDepositKey(candidate.runId, candidate.id);
      const byCandidateKey = workspace?.artifacts?.worksheetDeposits?.byCandidateKey || {};
      return key && Array.isArray(byCandidateKey[key]) ? byCandidateKey[key] : [];
    }

    function candidateHasWorksheetDeposit(candidate = {}, workspace = {}) {
      if (candidate.worksheetDeposited === true) {
        return true;
      }
      return candidateWorksheetDeposits(candidate, workspace).length > 0;
    }

    function candidateWorksheetDepositStatusLabel(pageCount = 1) {
      if (global.sheetifyLocale?.current() === "en") {
        return Number(pageCount || 0) > 1 ? "Worksheets have already been saved." : "Worksheet has already been saved.";
      }
      return Number(pageCount || 0) > 1
        ? "Arbeitsblätter wurden bereits abgelegt."
        : "Arbeitsblatt wurde bereits abgelegt.";
    }

    function scopedWorksheetActionLabel(baseLabel = "", candidate = {}) {
      const displayLabel = draftDisplayLabel(candidate);
      if (!displayLabel) {
        return baseLabel;
      }
      if (global.sheetifyLocale?.current() === "en") {
        return `${baseLabel} from ${displayLabel}`;
      }
      return String(baseLabel || "").replace(/\s+ablegen$/i, ` für ${displayLabel} ablegen`);
    }

    function candidateActionAttributes(candidate = {}) {
      const runId = String(candidate.runId || "").trim();
      const candidateId = String(candidate.id || "").trim();
      const displayLabel = draftDisplayLabel(candidate);
      const actionKey = candidateWorksheetDepositKey(runId, candidateId);
      return [
        `data-run-id="${escapeHtml(runId)}"`,
        `data-candidate-id="${escapeHtml(candidateId)}"`,
        `data-display-label="${escapeHtml(displayLabel)}"`,
        actionKey ? `data-card-action-key="${escapeHtml(actionKey)}"` : ""
      ].filter(Boolean).join(" ");
    }

    function renderCandidateWorksheetStoreAction(candidate = {}, pageCount = 1, workspace = {}) {
      if (!pageCount) {
        return "";
      }
      if (candidate.status === "technical_failed" || candidate.qc?.status === "error") {
        return `
          <div class="candidate-deposit-status candidate-deposit-status-error">
            <span>Formatprüfung fehlgeschlagen.</span>
          </div>
        `;
      }
      const deposits = candidateWorksheetDeposits(candidate, workspace);
      if (candidate.worksheetDeposited === true || deposits.length) {
        const worksheetId = deposits[0]?.worksheetId || "";
        const displayLabel = draftDisplayLabel(candidate);
        const openLabel = global.sheetifyLocale?.current() === "en"
          ? (displayLabel ? `Open worksheet from ${displayLabel}` : "Open worksheet")
          : (displayLabel ? `Zum Arbeitsblatt von ${displayLabel}` : "Zum Arbeitsblatt");
        return `
          <div class="candidate-deposit-status">
            <span>${escapeHtml(candidateWorksheetDepositStatusLabel(pageCount))}</span>
            ${worksheetId ? `
              <button class="secondary-button mini-button worksheet-open-button" type="button" data-card-action="open-deposited-worksheet" data-worksheet-id="${escapeHtml(worksheetId)}" ${candidateActionAttributes(candidate)} aria-label="${escapeHtml(openLabel)}" title="${escapeHtml(openLabel)}">
                ${icon("file-text", "icon icon-small")}
                <span>${global.sheetifyLocale?.current() === "en" ? "Open worksheet" : "Zum Arbeitsblatt"}</span>
              </button>
            ` : ""}
          </div>
        `;
      }
      const depositLabel = worksheetDepositActionLabel(pageCount);
      const scopedLabel = scopedWorksheetActionLabel(depositLabel, candidate);
      return `
        <button class="secondary-button mini-button worksheet-store-button" type="button" data-card-action="deposit-candidate-worksheet" ${candidateActionAttributes(candidate)} aria-label="${escapeHtml(scopedLabel)}" title="${escapeHtml(scopedLabel)}">
          ${icon("file-text", "icon icon-small")}
          <span>${escapeHtml(depositLabel)}</span>
        </button>
      `;
    }

    function renderCandidateRevisionAction(candidate = {}) {
      const label = t("app.draft.adjust");
      return `
        <button class="secondary-button mini-button candidate-revise-button" type="button" data-card-action="revise-candidate" ${candidateActionAttributes(candidate)} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
          ${icon("square-pen", "icon icon-small")}
          <span>${escapeHtml(label)}</span>
        </button>
      `;
    }

    function renderCandidateCard(candidate, workspace = {}, options = {}) {
      const pages = (candidate.pages || []).filter((page) => page.url);
      const firstPage = pages[0];
      const foundation = conceptLabel(candidate.concept || candidate);
      if (!firstPage) {
        return `<div class="missing-preview"><div><strong>${escapeHtml(draftDisplayLabel(candidate))}</strong><br>${escapeHtml(foundation || (global.sheetifyLocale?.current() === "en" ? "No image file found." : "Keine Bilddatei gefunden."))}</div></div>`;
      }
      const plannedPageCount = Number(candidate.generation?.pageCount || candidate.generation?.plannedPageCount || pages.length) || pages.length;
      const isBundle = plannedPageCount > 1 || pages.length > 1;
      const displayCandidateId = draftDisplayLabel(candidate);
      const viewerMeta = draftMetaLabel(candidate);
      const imageDownloads = candidateImageDownloads(pages, draftFilePrefix(candidate));
      return `
        <figure
          class="preview-card is-openable candidate-preview-card${isBundle ? " candidate-bundle-card" : ""}"
          data-open-url="${escapeHtml(firstPage.url)}"
          data-capture-kind="candidate"
          data-run-id="${escapeHtml(candidate.runId || "")}"
          data-candidate-id="${escapeHtml(candidate.id)}"
          data-display-label="${escapeHtml(displayCandidateId)}"
          data-page="${escapeHtml(firstPage.page || 1)}"
          data-page-role="${escapeHtml(firstPage.role || "worksheet")}"
          data-source-path="${escapeHtml(firstPage.path || "")}"
          data-source-url="${escapeHtml(firstPage.url)}"
          data-viewer-meta="${escapeHtml(viewerMeta)}"
        >
          <div class="preview-paper-meta candidate-card-header">
            <span class="preview-paper-left">
              <span class="preview-paper-id">
                <span class="preview-paper-id-label">${escapeHtml(displayCandidateId)}</span>
              </span>
            </span>
            <span class="preview-paper-middle">
              ${renderCandidateHeaderTags(candidate, options)}
            </span>
            <span class="preview-paper-actions">
              <button class="candidate-info-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id)}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="${escapeHtml(t("app.draft.info"))}" title="${escapeHtml(t("app.draft.info"))}">
                ${icon("info", "icon icon-small")}
              </button>
              ${renderCandidateImageDownloadButton(imageDownloads)}
            </span>
          </div>
          <div class="candidate-page-stack ${pages.length > 1 ? "multi" : ""}">
            ${pages.map((page, index) => `
              <div class="candidate-page-tile">
                <img
                  ${index === 0 ? "data-capture-image" : ""}
                  src="${escapeHtml(page.url)}"
                  alt="${escapeHtml(`${displayCandidateId} · ${t("common.page", { number: page.page || index + 1 })}`)}"
                  loading="lazy"
                >
              </div>
            `).join("")}
          </div>
          <div class="candidate-card-actions">
            ${renderCandidateRevisionAction(candidate)}
            ${renderCandidateWorksheetStoreAction(candidate, pages.length, workspace)}
          </div>
        </figure>
      `;
    }

    return {
      candidateImageDownloads,
      candidateWorksheetDepositKey,
      candidateWorksheetDeposits,
      candidateHasWorksheetDeposit,
      renderCandidateCard,
      renderCandidateImageDownloadButton,
      renderCandidateWorksheetStoreAction
    };
  }

  global.SheetifyIMGCandidateCards = {
    createCandidateCardRenderer
  };
})(window);
