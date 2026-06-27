"use strict";

(function attachMobilePreviewRenderer(global) {
  function requiredFunction(dependencies, name) {
    const value = dependencies[name];
    if (typeof value !== "function") {
      throw new Error(`SheetifyIMG mobile preview renderer missing dependency: ${name}`);
    }
    return value;
  }

  function createMobilePreviewRenderer(dependencies = {}) {
    const escapeHtml = requiredFunction(dependencies, "escapeHtml");
    const icon = requiredFunction(dependencies, "icon");
    const renderIcon = requiredFunction(dependencies, "renderIcon");
    const fileName = requiredFunction(dependencies, "fileName");
    const conceptLabel = requiredFunction(dependencies, "conceptLabel");
    const sourceFilesFrom = requiredFunction(dependencies, "sourceFilesFrom");
    const sourceFileUrl = requiredFunction(dependencies, "sourceFileUrl");
    const projectIdFromItemId = requiredFunction(dependencies, "projectIdFromItemId");
    const conceptSectionsFromContent = requiredFunction(dependencies, "conceptSectionsFromContent");
    const renderConceptDocumentHeader = requiredFunction(dependencies, "renderConceptDocumentHeader");
    const renderConceptSections = requiredFunction(dependencies, "renderConceptSections");
    const proposalForMode = requiredFunction(dependencies, "proposalForMode");
    const buttonActionForCommand = requiredFunction(dependencies, "buttonActionForCommand");
    const isBusyGenerateCandidateAction = requiredFunction(dependencies, "isBusyGenerateCandidateAction");
    const shouldDisableGenerateCandidateAction = requiredFunction(dependencies, "shouldDisableGenerateCandidateAction");
    const renderCandidateImageDownloadButton = requiredFunction(dependencies, "renderCandidateImageDownloadButton");
    const candidateImageDownloads = requiredFunction(dependencies, "candidateImageDownloads");
    const draftDisplayLabel = requiredFunction(dependencies, "draftDisplayLabel");
    const draftFilePrefix = requiredFunction(dependencies, "draftFilePrefix");
    const annotateCandidateDisplayList = requiredFunction(dependencies, "annotateCandidateDisplayList");
    const teachingContextNote = requiredFunction(dependencies, "teachingContextNote");
    const teachingContextFieldRows = requiredFunction(dependencies, "teachingContextFieldRows");
    const buildStatusRows = requiredFunction(dependencies, "buildStatusRows");
    const countPreviewCandidates = requiredFunction(dependencies, "countPreviewCandidates");
    const candidateCountLabel = requiredFunction(dependencies, "candidateCountLabel");
    const inputArtifactMeta = requiredFunction(dependencies, "inputArtifactMeta");
    const worksheetConceptSubtitle = requiredFunction(dependencies, "worksheetConceptSubtitle");

    function mobileSheetCommand(workspace = {}, ids = []) {
      return ids.map((id) => {
        const command = (workspace.commands || []).find((entry) => entry.id === id) || null;
        if (command?.enabled) {
          return command;
        }
        if (id === "generate_image_candidate" && command && shouldDisableGenerateCandidateAction(workspace, command)) {
          return command;
        }
        return null;
      }).find(Boolean) || null;
    }

    function mobileCommandButton(command, label = null, primary = false, workspace = {}) {
      const action = buttonActionForCommand(command, workspace, label ? { label } : {});
      if (!action || isBusyGenerateCandidateAction(action)) {
        return "";
      }
      return `
        <button class="${primary ? "primary-button" : "secondary-button"} mobile-footer-button" type="button" data-command="${escapeHtml(action.id)}" data-payload="${escapeHtml(JSON.stringify(action.payload || {}))}"${action.reason ? ` title="${escapeHtml(action.reason)}"` : ""}${action.disabled ? " disabled" : ""}>
          ${escapeHtml(action.label)}
        </button>
      `;
    }

    function mobileFocusChatButton(label = "Konzept ändern") {
      return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-focus-chat>${escapeHtml(label)}</button>`;
    }

    function mobileMinimizeButton(label = "Kleinmachen") {
      return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-minimize>${escapeHtml(label)}</button>`;
    }

    function mobileCloseButton(label = "Schließen") {
      return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-close>${escapeHtml(label)}</button>`;
    }

    function mobilePreviewStatusLabel(workspace = {}, mode = "") {
      if (mode === "candidates") {
        const count = workspace.preview?.candidates?.length || workspace.latestRun?.candidateCount || 0;
        return count ? candidateCountLabel(count) : "Noch keine Entwürfe";
      }
      return workspace.approval?.canGenerate ? "Bereit für Entwürfe" : "In Arbeit";
    }

    function mobileConceptData(workspace = {}, mode = "") {
      if (mode === "lessonbrief_proposal") {
        const proposal = proposalForMode(workspace, mode);
        return {
          brief: proposal?.data || workspace.proposals?.latestLessonBrief?.data || {},
          content: {},
          status: proposal?.status === "adopted" ? "übernommen" : "Rahmen prüfen",
          eyebrow: proposal?.status === "adopted" ? "Arbeitsblatt-Konzept" : "Konzept-Vorschlag"
        };
      }
      if (mode === "content_proposal") {
        const proposal = proposalForMode(workspace, mode);
        return {
          brief: workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {},
          content: proposal?.data || workspace.proposals?.latestContentMirror?.data || {},
          status: proposal?.status === "adopted" ? "übernommen" : "Konzept prüfen",
          eyebrow: proposal?.status === "adopted" ? "Arbeitsblatt-Konzept" : "Konzept-Vorschlag"
        };
      }
      if (mode === "brief") {
        return {
          brief: workspace.documents?.brief?.data || {},
          content: {},
          status: "Rahmen steht",
          eyebrow: "Arbeitsblatt-Konzept"
        };
      }
      return {
        brief: workspace.documents?.brief?.data || {},
        content: workspace.documents?.content?.data || {},
        status: mobilePreviewStatusLabel(workspace, mode),
        eyebrow: "Arbeitsblatt-Konzept"
      };
    }

    function renderMobileConceptBody(workspace = {}, mode = "") {
      const concept = mobileConceptData(workspace, mode);
      const sections = conceptSectionsFromContent(concept.content, {
        brief: concept.brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      });
      return `
        ${renderConceptDocumentHeader({
          project: workspace.project || {},
          brief: concept.brief,
          content: concept.content,
          teachingContext: workspace.teachingContext || {},
          label: concept.eyebrow || (mode.includes("proposal") ? "Konzept-Vorschlag" : "Arbeitsblatt-Konzept"),
          titleTag: "h3",
          statusLabel: concept.status,
          eyebrow: concept.eyebrow || (mode.includes("proposal") ? "Konzept-Vorschlag" : "Arbeitsblatt-Konzept")
        })}
        <div class="mobile-ready-strip ${workspace.approval?.canGenerate ? "done" : ""}">
          <span>${renderIcon(workspace.approval?.canGenerate ? "check" : "circle", "mobile-ready-icon")}</span>
          <strong>${escapeHtml(concept.status)}</strong>
        </div>
        ${renderConceptSections(sections, { compact: false })}
      `;
    }

    function renderMobileConceptFooter(workspace = {}, mode = "") {
      const primary = mobileSheetCommand(workspace, [
        "adopt_content_mirror_proposal",
        "adopt_lessonbrief_proposal",
        "approve_current_content",
        "generate_image_candidate",
        "generate_content_mirror_proposal"
      ]);
      const primaryLabel = primary?.id === "generate_image_candidate"
        ? "Entwurf erstellen"
        : primary?.id === "approve_current_content"
          ? "Freigeben"
          : primary ? null : "";
      return `
        ${mobileCommandButton(primary, primaryLabel, true, workspace)}
        ${mobileFocusChatButton(mode === "brief" || mode === "lessonbrief_proposal" ? "Rahmen ändern" : "Konzept ändern")}
        ${mobileMinimizeButton()}
      `;
    }

    function firstCandidatePage(candidate = {}) {
      return (candidate.pages || []).find((page) => page.url) || null;
    }

    function renderMobileCandidateRow(candidate = {}, index = 0) {
      const page = firstCandidatePage(candidate);
      const pages = (candidate.pages || []).filter((entry) => entry.url);
      const pageCount = pages.length || Number(candidate.generation?.pageCount || 0) || 1;
      const foundation = conceptLabel(candidate.concept || candidate);
      const displayCandidateId = draftDisplayLabel(candidate, index + 1);
      const lineageText = candidate.conceptDisplayLabel || "";
      const imageDownloads = candidateImageDownloads(pages, draftFilePrefix(candidate, index + 1));
      if (!page) {
        return `
          <article class="mobile-preview-row">
            <div class="mobile-preview-thumb missing-preview">?</div>
            <div class="mobile-preview-row-copy">
              <strong>${escapeHtml(displayCandidateId)}</strong>
              <small>Keine Vorschau vorhanden</small>
            </div>
          </article>
        `;
      }
      return `
        <article
          class="mobile-preview-row mobile-candidate-row"
          data-open-url="${escapeHtml(page.url)}"
          data-capture-kind="candidate"
          data-run-id="${escapeHtml(candidate.runId || "")}"
          data-candidate-id="${escapeHtml(candidate.id || "")}"
          data-display-label="${escapeHtml(displayCandidateId)}"
          data-page="${escapeHtml(page.page || 1)}"
          data-page-role="${escapeHtml(page.role || "worksheet")}"
          data-source-path="${escapeHtml(page.path || "")}"
          data-source-url="${escapeHtml(page.url)}"
        >
          <img class="mobile-preview-thumb" data-capture-image src="${escapeHtml(page.url)}" alt="${escapeHtml(displayCandidateId)}" loading="lazy">
          <div class="mobile-preview-row-copy">
            <strong>${escapeHtml(displayCandidateId)}</strong>
            <small>${escapeHtml([`${pageCount} Seite${pageCount === 1 ? "" : "n"}`, lineageText || foundation].filter(Boolean).join(" · "))}</small>
            <div class="mobile-preview-row-actions">
              ${renderCandidateImageDownloadButton(imageDownloads)}
              <button class="secondary-button mini-button" type="button" data-mobile-open-candidate>Vorschau</button>
              <button class="secondary-button mini-button icon-mini-button" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id || "")}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="Info">i</button>
            </div>
          </div>
        </article>
      `;
    }

    function renderMobileCandidatesBody(workspace = {}) {
      const candidates = annotateCandidateDisplayList(workspace.preview?.candidates || []);
      if (!candidates.length) {
        return '<div class="mobile-empty-state">Noch keine Entwürfe vorhanden.</div>';
      }
      return `<div class="mobile-preview-list">${candidates.map((candidate, index) => renderMobileCandidateRow(candidate, index)).join("")}</div>`;
    }

    function renderMobileInputBody(workspace = {}, ui = {}) {
      const source = workspace.documents?.source || {};
      const userMessages = (workspace.chat?.messages || []).filter((message) => message.role === "user" && String(message.content || "").trim());
      const files = sourceFilesFrom(source);
      const projectId = workspace.project?.projectId || projectIdFromItemId(ui.selectedId);
      const fileRows = files.map((file, index) => {
        const displayName = fileName(file.path || file.url || `Datei ${index + 1}`);
        const openUrl = file.url || sourceFileUrl(projectId, file);
        return `
          <article class="mobile-preview-row">
            <div class="mobile-preview-thumb mobile-file-thumb">${escapeHtml(displayName.split(".").pop()?.toUpperCase() || "FILE")}</div>
            <div class="mobile-preview-row-copy">
              <strong>${escapeHtml(displayName)}</strong>
              <small>${escapeHtml(file.kind || "Input")}</small>
              ${openUrl ? `<div class="mobile-preview-row-actions"><button class="secondary-button mini-button" type="button" data-mobile-open-url="${escapeHtml(openUrl)}">Öffnen</button></div>` : ""}
            </div>
          </article>
        `;
      }).join("");
      const transferCard = String(source.transferCard || "").trim();
      const transferCardRow = transferCard
        ? `
          <article class="mobile-input-message">
            <span>Importierter Input</span>
            <p>${escapeHtml(transferCard)}</p>
          </article>
        `
        : "";
      const messageRows = userMessages.slice(-6).map((message, index) => `
        <article class="mobile-input-message">
          <span>Nachricht ${index + 1}</span>
          <p>${escapeHtml(message.content)}</p>
        </article>
      `).join("");
      return fileRows || transferCardRow || messageRows
        ? `<div class="mobile-preview-list">${fileRows}${transferCardRow}${messageRows}</div>`
        : '<div class="mobile-empty-state">Noch kein Input vorhanden.</div>';
    }

    function renderMobileContextBody(workspace = {}) {
      const context = workspace.teachingContext || {};
      return `
        <div class="mobile-ready-strip ${context.readiness?.conceptAllowed ? "done" : ""}">
          <span>${renderIcon(context.readiness?.conceptAllowed ? "check" : "circle", "mobile-ready-icon")}</span>
          <strong>${escapeHtml(teachingContextNote(context))}</strong>
        </div>
        <ul class="mobile-context-list">${teachingContextFieldRows(context)}</ul>
      `;
    }

    function mobileProjectStepMode(stepId) {
      const modes = {
        input: "input",
        concept: "concept",
        candidates: "candidates"
      };
      return modes[stepId] || "project";
    }

    function mobileProjectStepMeta(item = {}, row = {}) {
      if (row.id === "concept") {
        return item.documents?.brief?.data || item.documents?.content?.data || item.proposals?.latestLessonBrief || item.proposals?.latestContentMirror
          ? "Rahmen · Aufbau · Logik"
          : row.state;
      }
      if (row.id === "candidates") {
        const count = countPreviewCandidates(item.preview) || item.project?.derivedStatus?.runs?.at?.(-1)?.candidateCount || 0;
        return count ? `${count} Entwurf${count === 1 ? "" : "en"}` : row.state;
      }
      return row.state;
    }

    function renderMobileProjectStepPills(item = {}) {
      return buildStatusRows(item).map((row) => {
        const mode = mobileProjectStepMode(row.id);
        return `
          <button class="mobile-project-step ${escapeHtml(row.tone)}" type="button" data-mobile-open-preview="${escapeHtml(mode)}">
            <span class="mobile-project-step-marker">${row.icon ? renderIcon(row.icon, "mobile-step-icon") : row.tone === "done" ? renderIcon("check", "mobile-step-icon") : row.number}</span>
            <span class="mobile-project-step-copy">
              <strong>${escapeHtml(row.title)}</strong>
              <small>${escapeHtml(mobileProjectStepMeta(item, row))}</small>
            </span>
            ${renderIcon("chevron-right", "mobile-project-step-arrow")}
          </button>
        `;
      }).join("");
    }

    function renderMobileProjectBody(workspace = {}, ui = {}) {
      const item = ui.selectedItem;
      if (!item) {
        return '<div class="mobile-empty-state">Kein Projekt ausgewählt.</div>';
      }
      return `
        <div class="mobile-project-summary">
          <div class="mobile-project-steps">${renderMobileProjectStepPills(item)}</div>
        </div>
      `;
    }

    function renderMobileProjectFooter(workspace = {}, ui = {}) {
      const projectId = workspace.project?.projectId || projectIdFromItemId(ui.selectedId);
      return `
        <button class="primary-button mobile-footer-button" type="button" data-mobile-open-workspace="${escapeHtml(projectId || "")}">Projekt öffnen</button>
      `;
    }

    function renderMobileWorksheetBody(workspace = {}) {
      const worksheet = workspace.worksheet || {};
      const pdf = worksheet.pdf || null;
      const pageCount = Number(worksheet.pageCount || worksheet.pages?.length || 0);
      return `
        <div class="mobile-preview-list">
          <article class="mobile-preview-row mobile-pdf-row" ${pdf?.url ? `data-open-url="${escapeHtml(pdf.url)}"` : ""}>
            <div class="mobile-preview-thumb mobile-pdf-thumb">PDF</div>
            <div class="mobile-preview-row-copy">
              <strong>${escapeHtml(worksheet.title || "Arbeitsblatt")}</strong>
              <small>${escapeHtml([worksheet.kindLabel, pageCount ? `${pageCount} Seite${pageCount === 1 ? "" : "n"}` : null].filter(Boolean).join(" · "))}</small>
              <div class="mobile-preview-row-actions">
                ${pdf?.url ? `<button class="primary-button mini-button" type="button" data-mobile-open-url="${escapeHtml(pdf.url)}">Öffnen</button>` : ""}
                ${pdf?.url ? `<button class="secondary-button mini-button download-icon-button" type="button" data-mobile-download-url="${escapeHtml(pdf.url)}" data-mobile-download-name="${escapeHtml(fileName(pdf.path || pdf.url))}" aria-label="PDF herunterladen" title="PDF herunterladen">${icon("download", "icon icon-small")}</button>` : ""}
              </div>
            </div>
          </article>
        </div>
      `;
    }

    function renderMobileWorksheetFooter(workspace = {}) {
      const projectId = workspace.worksheet?.source?.projectId || workspace.project?.projectId || "";
      return `
        ${projectId ? `<button class="primary-button mobile-footer-button" type="button" data-mobile-open-workspace="${escapeHtml(projectId)}">Zum Projekt</button>` : ""}
        ${mobileMinimizeButton()}
        ${mobileCloseButton()}
      `;
    }

    function mobileSheetTitleForMode(workspace = {}, mode = "", ui = {}) {
      if (mode === "worksheet") {
        const worksheet = workspace.worksheet || {};
        return {
          eyebrow: worksheet.kindLabel || "Arbeitsblatt",
          title: worksheet.title || "Arbeitsblatt",
          subtitle: worksheet.pageCount ? `${worksheet.pageCount} Seite${worksheet.pageCount === 1 ? "" : "n"}` : ""
        };
      }
      if (mode === "project") {
        return {
          eyebrow: "Projekt",
          title: workspace.project?.title || ui.selectedItem?.project?.title || "Projekt",
          subtitle: ""
        };
      }
      if (mode === "candidates") {
        return { eyebrow: "Vorschau", title: "Entwürfe", subtitle: mobilePreviewStatusLabel(workspace, mode) };
      }
      if (mode === "input") {
        return { eyebrow: "Input", title: "Input", subtitle: inputArtifactMeta(workspace) };
      }
      if (mode === "context") {
        return { eyebrow: "Rahmen", title: "Unterrichtsrahmen", subtitle: workspace.teachingContext?.readiness?.conceptAllowed ? "bereit" : "wird geklärt" };
      }
      const concept = mobileConceptData(workspace, mode);
      return {
        eyebrow: concept.eyebrow || (mode.includes("proposal") ? "Konzept-Vorschlag" : "Arbeitsblatt-Konzept"),
        title: "Arbeitsblatt-Konzept",
        subtitle: worksheetConceptSubtitle(concept.brief, concept.content, workspace.teachingContext || {})
          || mobilePreviewStatusLabel(workspace, mode)
      };
    }

    function renderMobilePreviewFooter(workspace = {}, mode = "", ui = {}) {
      if (mode === "worksheet") {
        return renderMobileWorksheetFooter(workspace);
      }
      if (mode === "project") {
        return renderMobileProjectFooter(workspace, ui);
      }
      if (mode === "candidates") {
        const next = mobileSheetCommand(workspace, ["generate_image_candidate"]);
        const hasCandidates = Boolean(workspace.preview?.candidates?.length || workspace.latestRun?.candidateCount);
        return `${mobileCommandButton(next, hasCandidates ? "Weiterer Entwurf" : "Entwurf erstellen", true, workspace)}${mobileMinimizeButton()}${mobileCloseButton()}`;
      }
      if (mode === "input" || mode === "context") {
        return `${mobileMinimizeButton()}${mobileCloseButton()}`;
      }
      return `${renderMobileConceptFooter(workspace, mode)}${mobileCloseButton()}`;
    }

    function renderMobilePreviewBodyForMode(workspace = {}, mode = "", ui = {}) {
      if (mode === "worksheet") {
        return renderMobileWorksheetBody(workspace);
      }
      if (mode === "project") {
        return renderMobileProjectBody(workspace, ui);
      }
      if (mode === "candidates") {
        return renderMobileCandidatesBody(workspace);
      }
      if (mode === "input") {
        return renderMobileInputBody(workspace, ui);
      }
      if (mode === "context") {
        return renderMobileContextBody(workspace);
      }
      return renderMobileConceptBody(workspace, mode);
    }

    return {
      firstCandidatePage,
      mobileCloseButton,
      mobileCommandButton,
      mobileConceptData,
      mobileFocusChatButton,
      mobileMinimizeButton,
      mobilePreviewStatusLabel,
      mobileProjectStepMeta,
      mobileProjectStepMode,
      mobileSheetCommand,
      mobileSheetTitleForMode,
      renderMobileCandidatesBody,
      renderMobileCandidateRow,
      renderMobileConceptBody,
      renderMobileConceptFooter,
      renderMobileContextBody,
      renderMobileInputBody,
      renderMobilePreviewBodyForMode,
      renderMobilePreviewFooter,
      renderMobileProjectBody,
      renderMobileProjectFooter,
      renderMobileProjectStepPills,
      renderMobileWorksheetBody,
      renderMobileWorksheetFooter
    };
  }

  global.SheetifyIMGMobilePreviewRenderer = {
    createMobilePreviewRenderer
  };
})(window);
