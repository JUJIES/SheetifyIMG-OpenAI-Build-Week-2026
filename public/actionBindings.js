"use strict";

(function attachActionBindings(global) {
  function requiredFunction(dependencies, name) {
    const value = dependencies[name];
    if (typeof value !== "function") {
      throw new Error(`SheetifyIMG action bindings missing dependency: ${name}`);
    }
    return value;
  }

  function createActionBindings(dependencies = {}) {
    const executeCommand = requiredFunction(dependencies, "executeCommand");
    const parsePayload = requiredFunction(dependencies, "parsePayload");
    const handleCanvasModeRequest = requiredFunction(dependencies, "handleCanvasModeRequest");
    const artifactSelectionFromButton = requiredFunction(dependencies, "artifactSelectionFromButton");
    const openCandidateInfo = requiredFunction(dependencies, "openCandidateInfo");
    const downloadUrl = requiredFunction(dependencies, "downloadUrl");
    const fileName = requiredFunction(dependencies, "fileName");
    const showToast = requiredFunction(dependencies, "showToast");
    const depositCandidateWorksheet = requiredFunction(dependencies, "depositCandidateWorksheet");
    const openWorksheetInLibrary = requiredFunction(dependencies, "openWorksheetInLibrary");
    const isCanvasCaptureActive = requiredFunction(dependencies, "isCanvasCaptureActive");
    const isMobileViewport = requiredFunction(dependencies, "isMobileViewport");
    const openMobilePreview = requiredFunction(dependencies, "openMobilePreview");
    const openCandidateViewerFromCard = requiredFunction(dependencies, "openCandidateViewerFromCard");
    const openWorksheetViewerFromCard = requiredFunction(dependencies, "openWorksheetViewerFromCard");
    const openUrl = requiredFunction(dependencies, "openUrl");

    function bindCommandButtons(container) {
      if (!container) {
        return;
      }
      container.querySelectorAll("[data-command]").forEach((button) => {
        button.addEventListener("click", () => {
          executeCommand(button.dataset.command, parsePayload(button.dataset.payload));
        });
      });
    }

    function bindCanvasModeButtons(container) {
      if (!container) {
        return;
      }
      container.querySelectorAll("[data-canvas-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          handleCanvasModeRequest(button.dataset.canvasMode, artifactSelectionFromButton(button));
        });
      });
    }

    function downloadCandidateImages(button) {
      let pages = [];
      try {
        pages = JSON.parse(button.dataset.downloadPages || "[]");
      } catch {
        pages = [];
      }
      if (!Array.isArray(pages) || !pages.length) {
        pages = button.dataset.downloadUrl
          ? [{ url: button.dataset.downloadUrl, name: button.dataset.downloadName || "" }]
          : [];
      }
      const validPages = pages.filter((page) => page?.url);
      if (!validPages.length) {
        showToast("Kein Bild zum Herunterladen gefunden.", "error");
        return;
      }
      validPages.forEach((page) => {
        downloadUrl(page.url, page.name || fileName(page.url));
      });
    }

    function bindPreviewCardActions(container) {
      if (!container) {
        return;
      }
      container.querySelectorAll("[data-card-action='candidate-info']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openCandidateInfo(button.dataset.candidateId, button.dataset.runId);
        });
      });
      container.querySelectorAll("[data-card-action='download-image']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (button.dataset.downloadUrl) {
            downloadUrl(button.dataset.downloadUrl, button.dataset.downloadName);
          }
        });
      });
      container.querySelectorAll("[data-card-action='download-candidate-images']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          downloadCandidateImages(button);
        });
      });
      container.querySelectorAll("[data-card-action='deposit-candidate-worksheet']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          depositCandidateWorksheet(button);
        });
      });
      container.querySelectorAll("[data-card-action='open-deposited-worksheet']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openWorksheetInLibrary(button.dataset.worksheetId || "");
        });
      });
      container.querySelectorAll("[data-open-url]").forEach((node) => {
        node.addEventListener("click", (event) => {
          if (event.target.closest("[data-card-action]") || isCanvasCaptureActive()) {
            return;
          }
          if (isMobileViewport() && node.closest(".chat-timeline") && node.dataset.captureKind === "candidate") {
            event.preventDefault();
            openMobilePreview("candidates");
            return;
          }
          if (node.dataset.captureKind === "candidate") {
            event.preventDefault();
            openCandidateViewerFromCard(node, container);
            return;
          }
          if (node.dataset.captureKind === "worksheet-page") {
            event.preventDefault();
            openWorksheetViewerFromCard(node, container);
            return;
          }
          openUrl(node.dataset.openUrl);
        });
      });
    }

    return {
      bindCanvasModeButtons,
      bindCommandButtons,
      bindPreviewCardActions,
      downloadCandidateImages
    };
  }

  global.SheetifyIMGActionBindings = {
    createActionBindings
  };
})(window);
