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
      const referenceCount = Array.isArray(candidate.generation?.referenceImages)
        ? candidate.generation.referenceImages.length
        : 0;
      const referenceBadge = referenceCount
        ? `${referenceCount} Referenz${referenceCount === 1 ? "" : "en"}`
        : null;
      const allBadges = [...badges, referenceBadge].filter(Boolean);
      if (!allBadges.length) {
        return "";
      }
      return `
        <span class="candidate-lineage-badges">
          ${allBadges.map((badge) => `<span class="candidate-lineage-badge">${escapeHtml(badge)}</span>`).join("")}
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
      const label = downloads.length > 1 ? "Bilder herunterladen" : "Bild herunterladen";
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
      return Number(pageCount || 0) > 1
        ? "Arbeitsblätter wurden bereits abgelegt."
        : "Arbeitsblatt wurde bereits abgelegt.";
    }

    function scopedWorksheetActionLabel(baseLabel = "", candidate = {}) {
      const displayLabel = draftDisplayLabel(candidate);
      if (!displayLabel) {
        return baseLabel;
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
        const openLabel = displayLabel ? `Zum Arbeitsblatt von ${displayLabel}` : "Zum Arbeitsblatt";
        return `
          <div class="candidate-deposit-status">
            <span>${escapeHtml(candidateWorksheetDepositStatusLabel(pageCount))}</span>
            ${worksheetId ? `
              <button class="secondary-button mini-button worksheet-open-button" type="button" data-card-action="open-deposited-worksheet" data-worksheet-id="${escapeHtml(worksheetId)}" ${candidateActionAttributes(candidate)} aria-label="${escapeHtml(openLabel)}" title="${escapeHtml(openLabel)}">
                ${icon("file-text", "icon icon-small")}
                <span>Zum Arbeitsblatt</span>
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

    function renderCandidateCard(candidate, workspace = {}, options = {}) {
      const pages = (candidate.pages || []).filter((page) => page.url);
      const firstPage = pages[0];
      const foundation = conceptLabel(candidate.concept || candidate);
      if (!firstPage) {
        return `<div class="missing-preview"><div><strong>${escapeHtml(draftDisplayLabel(candidate))}</strong><br>${escapeHtml(foundation || "Keine Bilddatei gefunden.")}</div></div>`;
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
              <button class="candidate-info-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id)}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="Generierungsinfo anzeigen" title="Generierungsinfo anzeigen">
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
                  alt="${escapeHtml(`${displayCandidateId} Seite ${page.page || index + 1}`)}"
                  loading="lazy"
                >
              </div>
            `).join("")}
          </div>
          <div class="candidate-card-actions">
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
