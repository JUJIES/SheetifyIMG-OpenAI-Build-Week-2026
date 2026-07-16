"use strict";

(function attachCanvasRenderer(global) {
  function requiredFunction(dependencies, name) {
    const value = dependencies[name];
    if (typeof value !== "function") {
      throw new Error(`SheetifyIMG canvas renderer missing dependency: ${name}`);
    }
    return value;
  }

  function createCanvasRenderer(dependencies = {}) {
    const t = (key, variables = {}) => global.sheetifyLocale?.t(key, variables) || key;
    const isEnglish = () => global.sheetifyLocale?.current() === "en";
    const escapeHtml = requiredFunction(dependencies, "escapeHtml");
    const sourceFilesFrom = requiredFunction(dependencies, "sourceFilesFrom");
    const renderSourceInputs = requiredFunction(dependencies, "renderSourceInputs");
    const renderRawInputMessages = requiredFunction(dependencies, "renderRawInputMessages");
    const conceptSectionsFromContent = requiredFunction(dependencies, "conceptSectionsFromContent");
    const renderConceptDocumentHeader = requiredFunction(dependencies, "renderConceptDocumentHeader");
    const renderConceptSections = requiredFunction(dependencies, "renderConceptSections");
    const statusWord = requiredFunction(dependencies, "statusWord");
    const workspaceConceptArtifacts = requiredFunction(dependencies, "workspaceConceptArtifacts");
    const currentConceptArtifact = requiredFunction(dependencies, "currentConceptArtifact");
    const annotateCandidateDisplayList = requiredFunction(dependencies, "annotateCandidateDisplayList");
    const workspaceCandidateHistory = requiredFunction(dependencies, "workspaceCandidateHistory");
    const renderCandidateCard = requiredFunction(dependencies, "renderCandidateCard");
    const renderPageCard = requiredFunction(dependencies, "renderPageCard");

    function selectedConceptArtifact(workspace = {}, ui = {}) {
      const concepts = workspaceConceptArtifacts(workspace);
      const selection = ui.activeArtifactSelection;
      if (selection?.kind === "concept" && selection.id) {
        return concepts.find((concept) => concept.id === selection.id) || null;
      }
      return currentConceptArtifact(workspace, concepts);
    }

    function selectedCanvasCandidates(workspace = {}, ui = {}) {
      const candidates = annotateCandidateDisplayList(workspaceCandidateHistory(workspace));
      const selection = ui.activeArtifactSelection;
      if (selection?.kind === "candidate") {
        return candidates.filter((candidate) => {
          return candidate.id === selection.candidateId && (!selection.runId || candidate.runId === selection.runId);
        });
      }
      return candidates.length ? candidates : annotateCandidateDisplayList(workspace.preview?.candidates || []);
    }

    function firstCanvasAsset(workspace, mode, ui = {}) {
      if (mode === "candidates") {
        for (const candidate of selectedCanvasCandidates(workspace, ui)) {
          const page = (candidate.pages || []).find((entry) => entry.url);
          if (page) {
            return page;
          }
        }
      }
      return null;
    }

    function canCapture(workspace = {}, mode = "", ui = {}) {
      return mode === "candidates" && Boolean(selectedCanvasCandidates(workspace, ui).some((candidate) => {
        return (candidate.pages || []).some((page) => page.url);
      }));
    }

    function renderCanvasAssignment(workspace = {}) {
      const source = workspace.documents?.source || {};
      const userMessages = (workspace.chat?.messages || []).filter((message) => message.role === "user" && String(message.content || "").trim());
      const hasSourceInput = Boolean(sourceFilesFrom(source).length || source.transferCard);
      if (!hasSourceInput && !userMessages.length) {
        return `
          <article class="canvas-document">
            <p class="detail-label">${escapeHtml(t("app.empty.eyebrow"))}</p>
            <h3>${escapeHtml(workspace.project?.title || t("app.target.project"))}</h3>
            <p class="detail-muted">${escapeHtml(isEnglish() ? "No input yet. Describe what you want to create in the chat, or attach material." : "Noch kein Input vorhanden. Schreibe im Chat, was entstehen soll, oder lade Material dazu.")}</p>
          </article>
        `;
      }
      return `
        <article class="canvas-document">
          <p class="detail-label">Input</p>
          <h3>${escapeHtml(workspace.project?.title || t("app.target.project"))}</h3>
          ${renderSourceInputs({ source, projectId: workspace.project?.projectId })}
          ${renderRawInputMessages(userMessages)}
        </article>
      `;
    }

    function renderCanvasBrief(workspace = {}) {
      const brief = workspace.documents?.brief?.data || {};
      const sections = conceptSectionsFromContent({}, {
        brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      });
      return `
        <article class="canvas-document">
          ${renderConceptDocumentHeader({
            project: workspace.project || {},
            brief,
            content: {},
            teachingContext: workspace.teachingContext || {},
            label: t("app.concept.title"),
            titleTag: "h3",
            statusLabel: statusWord(workspace.documents?.brief?.status)
          })}
          <div class="detail-grid">
            <div><span>${escapeHtml(t("app.concept.subject"))}</span><strong>${escapeHtml(brief.subject || t("app.context.openValue"))}</strong></div>
            <div><span>${escapeHtml(t("app.concept.targetGroup"))}</span><strong>${escapeHtml(brief.targetGroup || t("app.context.openValue"))}</strong></div>
            <div><span>${escapeHtml(t("app.concept.status"))}</span><strong>${escapeHtml(statusWord(workspace.documents?.brief?.status))}</strong></div>
            <div><span>Layout</span><strong>${escapeHtml(brief.outputPreference?.layout || "auto")}</strong></div>
          </div>
          ${renderConceptSections(sections, { compact: false })}
        </article>
      `;
    }

    function renderCanvasContent(workspace = {}, ui = {}) {
      const conceptArtifact = selectedConceptArtifact(workspace, ui);
      const content = conceptArtifact?.data || workspace.documents?.content?.data || {};
      const brief = workspace.documents?.brief?.data || {};
      const sections = conceptSectionsFromContent(content, {
        brief,
        project: workspace.project || {},
        teachingContext: workspace.teachingContext || {}
      });
      const versionLabel = conceptArtifact?.version ? t("app.concept.version", { number: conceptArtifact.version }) : t("app.concept.current");
      const statusLabel = [
        statusWord(conceptArtifact?.status || workspace.documents?.content?.status),
        conceptArtifact?.current ? t("app.concept.current") : null
      ].filter(Boolean).join(" · ");
      return `
        <article class="canvas-document">
          ${renderConceptDocumentHeader({
            project: workspace.project || {},
            brief,
            content,
            teachingContext: workspace.teachingContext || {},
            label: `${t("app.concept.title")} · ${versionLabel}`,
            titleTag: "h3",
            versionLabel,
            statusLabel
          })}
          <div class="detail-grid">
            <div><span>Version</span><strong>${escapeHtml(versionLabel)}</strong></div>
            <div><span>${escapeHtml(t("app.concept.status"))}</span><strong>${escapeHtml(statusLabel || t("app.context.openValue"))}</strong></div>
            <div><span>${escapeHtml(isEnglish() ? "Concept" : "Konzept")}</span><strong>${workspace.approval?.canGenerate ? (isEnglish() ? "adopted" : "übernommen") : t("app.context.openValue")}</strong></div>
            <div><span>${escapeHtml(t("app.concept.texts"))}</span><strong>${escapeHtml(content.readingTexts?.length || 0)}</strong></div>
            <div><span>${escapeHtml(t("app.concept.tasks"))}</span><strong>${escapeHtml(content.tasks?.length || 0)}</strong></div>
            <div><span>${escapeHtml(t("app.concept.images"))}</span><strong>${escapeHtml(content.imageMaterials?.length || 0)}</strong></div>
          </div>
          ${renderConceptSections(sections, { compact: false })}
        </article>
      `;
    }

    function renderCanvasWarnings(workspace = {}) {
      const warnings = workspace.documents?.warnings?.warnings || [];
      return `
        <article class="canvas-document">
          <p class="detail-label">${escapeHtml(t("app.concept.title"))}</p>
          <h3>${warnings.length ? escapeHtml(isEnglish() ? `${warnings.length} notices` : `${warnings.length} Hinweise`) : escapeHtml(isEnglish() ? "No active notices" : "Keine aktiven Warnungen")}</h3>
          ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${escapeHtml(warning.message || warning.category || (isEnglish() ? "Notice" : "Warnung"))}</li>`).join("")}</ul>` : `<p class="detail-muted">${escapeHtml(isEnglish() ? "There are no technical or content notices." : "Die technischen und inhaltlichen Hinweise sind leer.")}</p>`}
        </article>
      `;
    }

    function renderCanvasCandidates(workspace = {}, ui = {}) {
      const candidates = selectedCanvasCandidates(workspace, ui);
      const cards = candidates.map((candidate) => renderCandidateCard(candidate, workspace, { showConceptTag: false }));
      return cards.length
        ? `<div class="canvas-candidate-grid">${cards.join("")}</div>`
        : `<div class="no-preview">${escapeHtml(t("app.preview.noDrafts"))}</div>`;
    }

    function renderCanvasPages(pages = [], emptyText = isEnglish() ? "No preview available." : "Keine Vorschau verfügbar.") {
      return pages.length
        ? `<div class="canvas-page-stack">${pages.map(renderPageCard).join("")}</div>`
        : `<div class="no-preview">${escapeHtml(emptyText)}</div>`;
    }

    function renderInternalImageSpecDetails(workspace = {}) {
      const imageSpec = workspace.proposals?.activeImageSpec || workspace.proposals?.latestImageSpec || null;
      if (!imageSpec?.data) {
        return "";
      }
      const spec = imageSpec.data;
      const promptPreview = spec.promptPreview || spec.finalPrompt || "";
      return `
        <details class="internal-spec-details">
          <summary>Interne Bildplanung ansehen</summary>
          <article class="canvas-document compact">
            <div class="detail-grid">
              <div><span>ID</span><strong>${escapeHtml(imageSpec.proposalId)}</strong></div>
              <div><span>Status</span><strong>${escapeHtml(statusWord(imageSpec.status))}</strong></div>
              <div><span>Format</span><strong>${escapeHtml(spec.aspectRatio || "portrait_a4_asset")}</strong></div>
              <div><span>Textregel</span><strong>${escapeHtml(spec.textPolicy || "no_text")}</strong></div>
            </div>
            <section class="detail-section">
              <p class="detail-label">Bildabsicht</p>
              <p>${escapeHtml(spec.visualBrief || spec.purpose || "")}</p>
            </section>
            <section class="detail-section">
              <p class="detail-label">Prompt-Vorschau</p>
              <p>${escapeHtml(promptPreview)}</p>
            </section>
          </article>
        </details>
      `;
    }

    return {
      canCapture,
      firstCanvasAsset,
      renderCanvasAssignment,
      renderCanvasBrief,
      renderCanvasCandidates,
      renderCanvasContent,
      renderCanvasPages,
      renderCanvasWarnings,
      renderInternalImageSpecDetails,
      selectedCanvasCandidates,
      selectedConceptArtifact
    };
  }

  global.SheetifyIMGCanvasRenderer = {
    createCanvasRenderer
  };
})(window);
