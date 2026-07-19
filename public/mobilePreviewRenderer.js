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
    const t = (key, variables = {}) => global.sheetifyLocale?.t(key, variables) || key;
    const isEnglish = () => global.sheetifyLocale?.current() === "en";
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
    const renderWorksheetBlueprint = requiredFunction(dependencies, "renderWorksheetBlueprint");
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
    const workspaceConceptArtifacts = requiredFunction(dependencies, "workspaceConceptArtifacts");
    const currentConceptArtifact = requiredFunction(dependencies, "currentConceptArtifact");
    const conceptVersionDisplayName = requiredFunction(dependencies, "conceptVersionDisplayName");
    const conceptArtifactMeta = requiredFunction(dependencies, "conceptArtifactMeta");
    const statusWord = requiredFunction(dependencies, "statusWord");

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

    function mobileFocusChatButton(label = t("app.concept.revise")) {
      return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-focus-chat>${escapeHtml(label)}</button>`;
    }

    function mobileConceptRevisionButton(label = t("app.concept.revise"), target = {}) {
      const attrs = [
        target.proposalId ? `data-proposal-id="${escapeHtml(target.proposalId)}"` : "",
        target.contentMirrorId ? `data-content-mirror-id="${escapeHtml(target.contentMirrorId)}"` : "",
        target.conceptVersion ? `data-concept-version="${escapeHtml(target.conceptVersion)}"` : ""
      ].filter(Boolean).join(" ");
      return `<button class="secondary-button mobile-footer-button mobile-revision-button" type="button" data-mobile-revise-concept ${attrs}>${icon("square-pen", "icon icon-small")}<span>${escapeHtml(label)}</span></button>`;
    }

    function mobileCloseButton(label = t("common.close")) {
      return `<button class="secondary-button mobile-footer-button" type="button" data-mobile-close>${escapeHtml(label)}</button>`;
    }

    function mobilePreviewStatusLabel(workspace = {}, mode = "") {
      if (mode === "candidates") {
        const count = workspace.preview?.candidates?.length || workspace.latestRun?.candidateCount || 0;
        return count ? candidateCountLabel(count) : t("app.draft.none");
      }
      return workspace.approval?.canGenerate
        ? (isEnglish() ? "Ready for drafts" : "Bereit für Entwürfe")
        : t("common.inProgress");
    }

    function mobileConceptIsComplete(workspace = {}) {
      const conceptStep = (workspace.steps || []).find((step) => step.id === "concept") || null;
      return Boolean(
        conceptStep?.complete
        || workspace.approval?.canGenerate
        || workspace.documents?.content?.data
        || workspace.proposals?.latestContentMirror?.data
      );
    }

    function mobileConceptModeIsProposal(mode = "") {
      return mode === "lessonbrief_proposal" || mode === "content_proposal";
    }

    function selectedMobileConceptArtifact(workspace = {}, ui = {}) {
      const concepts = workspaceConceptArtifacts(workspace);
      const selection = ui.activeArtifactSelection;
      if (selection?.kind === "concept") {
        const selected = concepts.find((concept) => concept.id === selection.id)
          || concepts.find((concept) => String(concept.version || "") === String(selection.conceptVersion || ""));
        if (selected) {
          return selected;
        }
      }
      return currentConceptArtifact(workspace, concepts) || concepts[0] || null;
    }

    function mobileConceptStatusLabel(concept = null, workspace = {}, mode = "") {
      if (!concept) {
        return mobilePreviewStatusLabel(workspace, mode);
      }
      const rawStatus = concept.status || workspace.documents?.content?.status;
      const parts = [
        rawStatus === "adopted" ? null : statusWord(rawStatus),
        concept.current ? t("app.work.label") : null
      ].filter(Boolean);
      return parts.join(" · ") || mobilePreviewStatusLabel(workspace, mode);
    }

    function renderMobileConceptVersionSwitcher(workspace = {}, ui = {}, mode = "") {
      if (mobileConceptModeIsProposal(mode)) {
        return "";
      }
      const concepts = workspaceConceptArtifacts(workspace);
      if (concepts.length <= 1) {
        return "";
      }
      const selected = selectedMobileConceptArtifact(workspace, ui);
      const selectedId = selected?.id || "";
      return `
        <section class="mobile-concept-switcher" aria-label="${escapeHtml(isEnglish() ? "Concept versions" : "Konzeptversionen")}">
          <div class="mobile-concept-switcher-heading">
            <span>${isEnglish() ? "Concept versions" : "Konzeptversionen"}</span>
            <strong>${escapeHtml(concepts.length)} ${isEnglish() ? "versions" : "Versionen"}</strong>
          </div>
          <div class="mobile-concept-chip-row">
            ${concepts.map((concept) => {
              const selectedClass = concept.id === selectedId ? "selected" : "";
              const currentClass = concept.current ? "current" : "";
              const label = concept.version ? `V${concept.version}` : t("common.current");
              const visibleStatus = concept.status === "adopted" ? null : statusWord(concept.status);
              const meta = [
                concept.current ? t("app.work.label") : visibleStatus,
                concept.taskCount ? `${concept.taskCount} ${isEnglish() ? "tasks" : "Aufgaben"}` : null
              ].filter(Boolean).join(" · ") || conceptArtifactMeta(concept) || (isEnglish() ? "Concept" : "Konzept");
              return `
                <button class="mobile-concept-chip ${selectedClass} ${currentClass}" type="button" data-mobile-concept-version data-artifact-kind="concept" data-artifact-id="${escapeHtml(concept.id || "")}" data-concept-id="${escapeHtml(concept.id || "")}" data-concept-version="${escapeHtml(concept.version || "")}" aria-pressed="${concept.id === selectedId ? "true" : "false"}">
                  <strong>${escapeHtml(label)}</strong>
                  <small>${escapeHtml(meta)}</small>
                </button>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }

    function mobileConceptData(workspace = {}, mode = "", ui = {}) {
      if (mode === "lessonbrief_proposal") {
        const proposal = proposalForMode(workspace, mode);
        return {
          brief: proposal?.data || workspace.proposals?.latestLessonBrief?.data || {},
          content: {},
          status: proposal?.status === "adopted" ? "Konzept übernommen" : "Konzept intern",
          eyebrow: t("app.concept.title")
        };
      }
      if (mode === "content_proposal") {
        const proposal = proposalForMode(workspace, mode);
        return {
          brief: workspace.documents?.brief?.data || workspace.proposals?.latestLessonBrief?.data || {},
          content: proposal?.data || workspace.proposals?.latestContentMirror?.data || {},
          status: isEnglish() ? "ready" : "bereit",
          eyebrow: t("app.concept.title")
        };
      }
      if (mode === "brief") {
        return {
          brief: workspace.documents?.brief?.data || {},
          content: {},
          status: "Rahmen steht",
          eyebrow: t("app.concept.title")
        };
      }
      const selectedConcept = selectedMobileConceptArtifact(workspace, ui);
      return {
        brief: workspace.documents?.brief?.data || {},
        content: selectedConcept?.data || workspace.documents?.content?.data || {},
        status: mobileConceptStatusLabel(selectedConcept, workspace, mode),
        eyebrow: t("app.concept.title"),
        concept: selectedConcept
      };
    }

    function renderMobileConceptBody(workspace = {}, mode = "", ui = {}) {
      const concept = mobileConceptData(workspace, mode, ui);
      const hasBlueprintContent = [
        concept.content?.readingTexts,
        concept.content?.tasks,
        concept.content?.imageMaterials
      ].some((items) => Array.isArray(items) && items.length);
      const isContentConceptMode = mode === "content" || mode === "content_proposal" || mode === "concept";
      if (isContentConceptMode || hasBlueprintContent) {
        return `
          ${renderMobileConceptVersionSwitcher(workspace, ui, mode)}
          <div class="mobile-ready-strip ${mobileConceptIsComplete(workspace) ? "done" : ""}">
            <span>${renderIcon(mobileConceptIsComplete(workspace) ? "check" : "circle", "mobile-ready-icon")}</span>
            <strong>${escapeHtml(concept.status)}</strong>
          </div>
          ${renderWorksheetBlueprint({
            content: concept.content,
            brief: concept.brief,
            project: workspace.project || {},
            teachingContext: workspace.teachingContext || {},
            concept: concept.concept || null
          })}
        `;
      }
      const sections = conceptSectionsFromContent(concept.content, {
        brief: concept.brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      });
      const versionLabel = concept.concept?.version ? conceptVersionDisplayName(concept.concept.version) : null;
      return `
        ${renderMobileConceptVersionSwitcher(workspace, ui, mode)}
        ${renderConceptDocumentHeader({
          project: workspace.project || {},
          brief: concept.brief,
          content: concept.content,
          teachingContext: workspace.teachingContext || {},
          label: concept.eyebrow || t("app.concept.title"),
          titleTag: "h3",
          versionLabel,
          statusLabel: concept.status,
          eyebrow: concept.eyebrow || t("app.concept.title")
        })}
        <div class="mobile-ready-strip ${mobileConceptIsComplete(workspace) ? "done" : ""}">
          <span>${renderIcon(mobileConceptIsComplete(workspace) ? "check" : "circle", "mobile-ready-icon")}</span>
          <strong>${escapeHtml(concept.status)}</strong>
        </div>
        ${renderConceptSections(sections, { compact: false })}
      `;
    }

    function renderMobileConceptFooter(workspace = {}, mode = "", ui = {}) {
      const primary = mobileSheetCommand(workspace, [
        "adopt_content_mirror_proposal",
        "adopt_lessonbrief_proposal",
        "approve_current_content",
        "generate_image_candidate",
        "generate_content_mirror_proposal"
      ]);
      const primaryLabel = primary?.id === "generate_image_candidate"
        ? t("app.confirm.create")
        : primary?.id === "approve_current_content"
          ? (isEnglish() ? "Adopt" : "Übernehmen")
          : primary ? null : "";
      const proposal = mobileConceptModeIsProposal(mode) ? proposalForMode(workspace, mode) : null;
      const selectedConcept = !proposal ? selectedMobileConceptArtifact(workspace, ui) : null;
      const revisionTarget = proposal
        ? { proposalId: proposal.proposalId || proposal.id || "" }
        : {
            contentMirrorId: selectedConcept?.id || "",
            conceptVersion: selectedConcept?.version || ""
          };
      return `
        ${mobileCommandButton(primary, primaryLabel, true, workspace)}
        ${mobileConceptRevisionButton(mode === "brief" || mode === "lessonbrief_proposal" ? (isEnglish() ? "Complete framework" : "Rahmen ergänzen") : t("app.concept.revise"), revisionTarget)}
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
              <small>${escapeHtml(isEnglish() ? "No preview available" : "Keine Vorschau vorhanden")}</small>
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
            <small>${escapeHtml([t(pageCount === 1 ? "app.draft.pageCount" : "app.draft.pageCountPlural", { count: pageCount }), lineageText || foundation].filter(Boolean).join(" · "))}</small>
            <div class="mobile-preview-row-actions">
              <button class="primary-button mini-button mobile-revision-button" type="button" data-mobile-revise-draft aria-label="${escapeHtml(`${t("app.draft.adjust")}: ${displayCandidateId}`)}" title="${escapeHtml(t("app.draft.adjust"))}">${icon("square-pen", "icon icon-small")}<span>${escapeHtml(isEnglish() ? "Revise" : "Überarbeiten")}</span></button>
              ${renderCandidateImageDownloadButton(imageDownloads)}
              <button class="secondary-button mini-button mobile-preview-icon-action" type="button" data-mobile-open-candidate aria-label="${escapeHtml(t("app.preview.viewDraft"))}" title="${escapeHtml(t("app.preview.viewDraft"))}">${icon("eye", "icon icon-small")}</button>
              <button class="secondary-button mini-button mobile-preview-icon-action" type="button" data-card-action="candidate-info" data-candidate-id="${escapeHtml(candidate.id || "")}" data-run-id="${escapeHtml(candidate.runId || "")}" aria-label="${escapeHtml(t("app.draft.info"))}" title="${escapeHtml(t("app.draft.info"))}">${icon("info", "icon icon-small")}</button>
            </div>
          </div>
        </article>
      `;
    }

    function renderMobileCandidatesBody(workspace = {}) {
      const candidates = annotateCandidateDisplayList(workspace.preview?.candidates || []);
      if (!candidates.length) {
        return `<div class="mobile-empty-state">${escapeHtml(t("app.preview.noDrafts"))}</div>`;
      }
      return `<div class="mobile-preview-list">${candidates.map((candidate, index) => renderMobileCandidateRow(candidate, index)).join("")}</div>`;
    }

    function renderMobileInputBody(workspace = {}, ui = {}) {
      const source = workspace.documents?.source || {};
      const userMessages = (workspace.chat?.messages || []).filter((message) => message.role === "user" && String(message.content || "").trim());
      const files = sourceFilesFrom(source);
      const projectId = workspace.project?.projectId || projectIdFromItemId(ui.selectedId);
      const fileRows = files.map((file, index) => {
        const displayName = fileName(file.path || file.url || `${t("app.chat.file")} ${index + 1}`);
        const openUrl = file.url || sourceFileUrl(projectId, file);
        return `
          <article class="mobile-preview-row">
            <div class="mobile-preview-thumb mobile-file-thumb">${escapeHtml(displayName.split(".").pop()?.toUpperCase() || "FILE")}</div>
            <div class="mobile-preview-row-copy">
              <strong>${escapeHtml(displayName)}</strong>
              <small>${escapeHtml(file.kind || "Input")}</small>
              ${openUrl ? `<div class="mobile-preview-row-actions"><button class="secondary-button mini-button" type="button" data-mobile-open-url="${escapeHtml(openUrl)}">${escapeHtml(t("common.open"))}</button></div>` : ""}
            </div>
          </article>
        `;
      }).join("");
      const transferCard = String(source.transferCard || "").trim();
      const transferCardRow = transferCard
        ? `
          <article class="mobile-input-message">
            <span>${isEnglish() ? "Imported input" : "Importierter Input"}</span>
            <p>${escapeHtml(transferCard)}</p>
          </article>
        `
        : "";
      const messageRows = userMessages.slice(-6).map((message, index) => `
        <article class="mobile-input-message">
          <span>${isEnglish() ? "Message" : "Nachricht"} ${index + 1}</span>
          <p>${escapeHtml(message.content)}</p>
        </article>
      `).join("");
      if (fileRows || transferCardRow || messageRows) {
        return `<div class="mobile-preview-list">${fileRows}${transferCardRow}${messageRows}</div>`;
      }
      const inputStatusRow = buildStatusRows(ui.selectedItem || workspace)
        .find((row) => row.id === "input") || null;
      const inputStatusText = String(inputStatusRow?.state || inputArtifactMeta(workspace) || "").trim();
      const inputLooksPresent = inputStatusRow?.tone === "done"
        || /vorhanden|bereit|gespeichert|importiert|angelegt/i.test(inputStatusText);
      if (inputLooksPresent) {
        return `
          <div class="mobile-preview-list">
            <article class="mobile-preview-row">
              <div class="mobile-preview-thumb mobile-file-thumb">IN</div>
              <div class="mobile-preview-row-copy">
                <strong>${isEnglish() ? "Input available" : "Input vorhanden"}</strong>
                <small>${escapeHtml(inputStatusText || (isEnglish() ? "saved in the project" : "im Projekt gespeichert"))}</small>
              </div>
            </article>
          </div>
        `;
      }
      return `<div class="mobile-empty-state">${escapeHtml(isEnglish() ? "No input yet." : "Noch kein Input vorhanden.")}</div>`;
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
          ? (isEnglish() ? "Framework · structure · logic" : "Rahmen · Aufbau · Logik")
          : row.state;
      }
      if (row.id === "candidates") {
        const count = countPreviewCandidates(item.preview) || item.project?.derivedStatus?.runs?.at?.(-1)?.candidateCount || 0;
        return count
          ? `${count} ${isEnglish() ? (count === 1 ? "draft" : "drafts") : `Entwurf${count === 1 ? "" : "en"}`}`
          : row.state;
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
        return `<div class="mobile-empty-state">${escapeHtml(isEnglish() ? "No project selected." : "Kein Projekt ausgewählt.")}</div>`;
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
        <button class="primary-button mobile-footer-button" type="button" data-mobile-open-workspace="${escapeHtml(projectId || "")}">${escapeHtml(t("app.project.open"))}</button>
      `;
    }

    function renderMobileWorksheetBody(workspace = {}) {
      const worksheet = workspace.worksheet || {};
      const pdf = worksheet.pdf || null;
      const pageCount = Number(worksheet.pageCount || worksheet.pages?.length || 0);
      const firstPage = (worksheet.pages || []).find((page) => page.url) || null;
      const thumb = firstPage?.url
        ? `<img class="mobile-preview-thumb mobile-worksheet-thumb" src="${escapeHtml(firstPage.url)}" alt="${escapeHtml(`${worksheet.title || t("app.preview.worksheet")} · ${t("app.preview.eyebrow")}`)}" loading="lazy">`
        : '<div class="mobile-preview-thumb mobile-pdf-thumb">PDF</div>';
      return `
        <div class="mobile-preview-list">
          <article class="mobile-preview-row mobile-pdf-row" ${pdf?.url ? `data-open-url="${escapeHtml(pdf.url)}"` : ""}>
            ${thumb}
            <div class="mobile-preview-row-copy">
              <strong>${escapeHtml(worksheet.title || t("app.preview.worksheet"))}</strong>
              <small>${escapeHtml([worksheet.kindLabel, pageCount ? t(pageCount === 1 ? "app.draft.pageCount" : "app.draft.pageCountPlural", { count: pageCount }) : null].filter(Boolean).join(" · "))}</small>
              <div class="mobile-preview-row-actions">
                ${pdf?.url ? `<button class="secondary-button mini-button mobile-preview-icon-action" type="button" data-mobile-open-url="${escapeHtml(pdf.url)}" aria-label="${escapeHtml(isEnglish() ? "Open PDF" : "PDF öffnen")}" title="${escapeHtml(isEnglish() ? "Open PDF" : "PDF öffnen")}">${icon("eye", "icon icon-small")}</button>` : ""}
                ${pdf?.url ? `<button class="secondary-button mini-button mobile-preview-icon-action" type="button" data-mobile-share-url="${escapeHtml(pdf.url)}" data-mobile-share-name="${escapeHtml(fileName(pdf.path || pdf.url))}" data-mobile-share-title="${escapeHtml(worksheet.title || t("app.preview.worksheet"))}" aria-label="${escapeHtml(isEnglish() ? "Share PDF" : "PDF teilen")}" title="${escapeHtml(isEnglish() ? "Share PDF" : "PDF teilen")}">${icon("share-2", "icon icon-small")}</button>` : ""}
                ${pdf?.url ? `<button class="secondary-button mini-button download-icon-button" type="button" data-mobile-download-url="${escapeHtml(pdf.url)}" data-mobile-download-name="${escapeHtml(fileName(pdf.path || pdf.url))}" aria-label="${escapeHtml(isEnglish() ? "Download PDF" : "PDF herunterladen")}" title="${escapeHtml(isEnglish() ? "Download PDF" : "PDF herunterladen")}">${icon("download", "icon icon-small")}</button>` : ""}
              </div>
            </div>
          </article>
        </div>
      `;
    }

    function renderMobileWorksheetFooter(workspace = {}) {
      const projectId = workspace.worksheet?.source?.projectId || workspace.project?.projectId || "";
      return `
        ${projectId ? `<button class="primary-button mobile-footer-button" type="button" data-mobile-open-workspace="${escapeHtml(projectId)}">${escapeHtml(isEnglish() ? "Go to project" : "Zum Projekt")}</button>` : ""}
      `;
    }

    function mobileSheetTitleForMode(workspace = {}, mode = "", ui = {}) {
      if (mode === "worksheet") {
        const worksheet = workspace.worksheet || {};
        return {
          eyebrow: worksheet.kindLabel || t("app.preview.worksheet"),
          title: worksheet.title || t("app.preview.worksheet"),
          subtitle: worksheet.pageCount ? t(worksheet.pageCount === 1 ? "app.draft.pageCount" : "app.draft.pageCountPlural", { count: worksheet.pageCount }) : ""
        };
      }
      if (mode === "project") {
        return {
          eyebrow: t("app.target.project"),
          title: workspace.project?.title || ui.selectedItem?.project?.title || t("app.target.project"),
          subtitle: ""
        };
      }
      if (mode === "candidates") {
        return { eyebrow: t("app.preview.eyebrow"), title: t("app.preview.drafts"), subtitle: mobilePreviewStatusLabel(workspace, mode) };
      }
      if (mode === "input") {
        return { eyebrow: "Input", title: "Input", subtitle: inputArtifactMeta(workspace) };
      }
      if (mode === "context") {
        return { eyebrow: t("app.concept.framework"), title: t("app.context.title"), subtitle: workspace.teachingContext?.readiness?.conceptAllowed ? t("app.context.ready") : t("app.context.clarifying") };
      }
      const concept = mobileConceptData(workspace, mode);
      return {
        eyebrow: concept.eyebrow || t("app.concept.title"),
        title: t("app.concept.title"),
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
        return `${mobileCommandButton(next, hasCandidates ? (isEnglish() ? "Another draft" : "Weiterer Entwurf") : t("app.confirm.create"), true, workspace)}`;
      }
      if (mode === "input" || mode === "context") {
        return "";
      }
      return renderMobileConceptFooter(workspace, mode, ui);
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
      return renderMobileConceptBody(workspace, mode, ui);
    }

    return {
      firstCandidatePage,
      mobileCloseButton,
      mobileCommandButton,
      mobileConceptData,
      mobileFocusChatButton,
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
