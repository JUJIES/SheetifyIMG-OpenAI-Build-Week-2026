"use strict";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project") || "";
const assetUrl = params.get("asset") || "";
const assetType = params.get("assetType") || "";
const assetLabel = params.get("assetLabel") || "";
const state = {
  activeStep: params.get("step") || null
};

const elements = {
  eyebrow: document.querySelector("#fullscreenEyebrow"),
  title: document.querySelector("#fullscreenTitle"),
  grid: document.querySelector("#fullscreenGrid"),
  closeButton: document.querySelector("#closePreviewButton")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message || `Request failed: ${response.status}`);
  }
  if (!payload) {
    throw new Error("Die Vorschau konnte nicht geladen werden.");
  }
  return payload;
}

function fileName(filePath) {
  return String(filePath || "").split("/").pop() || "Datei";
}

function conceptLabel(reference = {}) {
  if (!reference || (!reference.conceptId && !reference.conceptVersion)) {
    return "";
  }
  if (reference.label) {
    return reference.label;
  }
  return reference.conceptVersion ? `Konzept v${reference.conceptVersion}` : "Arbeitsblatt-Konzept";
}

function titleForPreview(preview) {
  const titles = {
    candidates: "Kandidaten",
    pdf: "PDF",
    project_status: "Input",
    selected_pages: "Kandidaten"
  };
  return titles[preview?.previewType] || "Vorschau";
}

function defaultStatusStep(item) {
  const previewType = item.preview?.previewType;
  if (previewType === "pdf" || previewType === "selected_pages" || previewType === "candidates") {
    return "candidates";
  }
  return "input";
}

function previewForStep(preview, step) {
  if (!preview) {
    return null;
  }
  if (step === "drafts") {
    if (preview.pages?.length) {
      return {
        ...preview,
        previewType: "selected_pages",
        pdfs: [],
        pages: preview.pages || [],
        candidates: []
      };
    }
    return {
      ...preview,
      previewType: "candidates",
      pdfs: [],
      pages: [],
      candidates: preview.candidates || []
    };
  }
  if (step === "candidates") {
    if (!preview.candidates?.length && preview.pdfs?.length) {
      return {
        ...preview,
        previewType: "pdf",
        pages: [],
        candidates: [],
        pdfs: preview.pdfs || []
      };
    }
    return {
      ...preview,
      previewType: "candidates",
      pdfs: [],
      pages: [],
      candidates: preview.candidates || []
    };
  }
  if (step === "selection") {
    return {
      ...preview,
      previewType: "selected_pages",
      pdfs: [],
      pages: preview.pages || [],
      candidates: []
    };
  }
  if (step === "export") {
    return {
      ...preview,
      previewType: "pdf",
      pages: [],
      candidates: [],
      pdfs: preview.pdfs || []
    };
  }
  return preview;
}

function applyPreviewLayout(preview) {
  elements.grid.classList.remove("preview-kind-pdf", "preview-kind-pages", "preview-kind-candidates");
  if (!preview?.previewType) {
    return;
  }
  elements.grid.classList.add(`preview-kind-${preview.previewType === "selected_pages" ? "pages" : preview.previewType}`);
}

function closePreview() {
  const target = projectId ? `/?project=${encodeURIComponent(projectId)}` : "/";
  if (window.opener && !window.opener.closed) {
    window.opener.focus();
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        window.location.assign(target);
      }
    }, 100);
    return;
  }
  window.location.assign(target);
}

function renderPageCard(page) {
  const meta = [page.role || "Arbeitsblatt", page.sourceCandidateId ? `aus ${page.sourceCandidateId}` : null]
    .filter(Boolean)
    .join(" · ");
  return `
    <figure class="preview-card">
      <img src="${escapeHtml(page.url)}" alt="Seite ${escapeHtml(page.page)}">
      <figcaption class="preview-caption">
        <span>Seite ${escapeHtml(page.page)}</span>
        <span>${escapeHtml(meta)}</span>
      </figcaption>
    </figure>
  `;
}

function renderPdfCard(pdf) {
  const exportKind = pdf.solutionSheet?.included
    ? "PDF mit Lösungsblatt"
    : "PDF";
  const meta = [
    pdf.pageCount ? `${pdf.pageCount} Seite${pdf.pageCount === 1 ? "" : "n"}` : null,
    conceptLabel(pdf.concept)
  ].filter(Boolean).join(" · ");
  return `
    <figure class="preview-card">
      <iframe src="${escapeHtml(pdf.url)}" title="PDF-Vorschau"></iframe>
      <figcaption class="preview-caption">
        <span>${escapeHtml(exportKind)}</span>
        <span>${escapeHtml(meta || fileName(pdf.path))}</span>
      </figcaption>
    </figure>
  `;
}

function renderCandidateCard(candidate) {
  const pages = (candidate.pages || []).filter((page) => page.url);
  const firstPage = pages[0];
  const foundation = conceptLabel(candidate.concept || candidate);
  if (!firstPage) {
    return "";
  }
  const plannedPageCount = Number(candidate.generation?.pageCount || candidate.generation?.plannedPageCount || pages.length) || pages.length;
  const candidateKind = plannedPageCount > 1
    ? pages.length >= plannedPageCount ? "Kandidatenreihe" : "Seitenvariante"
    : "Kandidat";
  const pageLabel = pages.length > 1 ? `${pages.length} Seiten` : "1 Seite";
  const pdf = candidate.pdf?.url ? candidate.pdf : null;
  return `
    <figure class="preview-card">
      <div class="preview-paper-meta">
        <span class="preview-paper-kind">${escapeHtml(candidateKind)}</span>
        <span class="preview-paper-id">${escapeHtml(candidate.id)}</span>
      </div>
      ${pdf ? `
        <div class="candidate-row-actions">
          <a class="mini-button primary-button candidate-pdf-link" href="${escapeHtml(pdf.url)}" download="${escapeHtml(fileName(pdf.path || pdf.url))}">PDF herunterladen</a>
        </div>
      ` : ""}
      <div class="candidate-page-stack ${pages.length > 1 ? "multi" : ""}">
        ${pages.map((page, index) => `
          <div class="candidate-page-tile">
            <div class="candidate-page-label">Seite ${escapeHtml(page.page || index + 1)}</div>
            <img
              src="${escapeHtml(page.url)}"
              alt="${escapeHtml(`${candidate.id} Seite ${page.page || index + 1}`)}"
              loading="lazy"
            >
          </div>
        `).join("")}
      </div>
      <figcaption class="preview-caption">
        <span>${escapeHtml(candidate.id)}</span>
        <span>${escapeHtml([pageLabel, foundation || candidate.status || "Kandidat"].filter(Boolean).join(" · "))}</span>
      </figcaption>
    </figure>
  `;
}

function renderPreview(preview) {
  elements.eyebrow.textContent = "Vorschau";
  elements.title.textContent = titleForPreview(preview);

  if (!preview || preview.previewType === "project_status") {
    elements.grid.innerHTML = '<div class="no-preview">Noch keine Bild- oder PDF-Vorschau vorhanden.</div>';
    applyPreviewLayout(preview);
    return;
  }

  applyPreviewLayout(preview);
  if (preview.previewType === "pdf") {
    elements.grid.innerHTML = preview.pdfs?.length
      ? preview.pdfs.map(renderPdfCard).join("")
      : '<div class="no-preview">Noch kein PDF vorhanden.</div>';
  } else if (preview.previewType === "selected_pages") {
    elements.grid.innerHTML = preview.pages?.length
      ? preview.pages.map(renderPageCard).join("")
      : '<div class="no-preview">Noch keine Kandidatenvorschau vorhanden.</div>';
  } else if (preview.previewType === "candidates") {
    elements.grid.innerHTML = preview.candidates?.length
      ? preview.candidates.map(renderCandidateCard).join("")
      : '<div class="no-preview">Noch keine Kandidaten vorhanden.</div>';
  } else {
    elements.grid.innerHTML = '<div class="no-preview">Keine Vorschau verfügbar.</div>';
  }
}

function renderAssetViewer() {
  document.title = `${assetLabel || "Asset"} - Vorschau`;
  elements.eyebrow.textContent = assetType === "image" ? "Bildansicht" : "Vorschau";
  elements.title.textContent = assetLabel || "Asset";
  elements.grid.classList.add("asset-view");

  if (assetType === "image") {
    elements.grid.innerHTML = `
      <figure class="asset-viewer-card">
        <img class="asset-viewer-image" src="${escapeHtml(assetUrl)}" alt="${escapeHtml(assetLabel || "Bild")}">
        <figcaption class="asset-viewer-caption">${escapeHtml(assetLabel || "Bild")}</figcaption>
      </figure>
    `;
    return;
  }

  elements.grid.innerHTML = '<div class="no-preview">Diese Vorschau wird noch nicht unterstützt.</div>';
}

async function loadPreview() {
  if (assetUrl) {
    renderAssetViewer();
    return;
  }
  if (!projectId) {
    throw new Error("Projekt fehlt.");
  }
  const payload = await fetchJson(`/api/library/items/${encodeURIComponent(`project:${projectId}`)}`);
  document.title = `${payload.item.project.title} - Vorschau`;
  elements.title.textContent = payload.item.project.title;
  renderPreview(previewForStep(payload.item.preview, state.activeStep || defaultStatusStep(payload.item)));
}

elements.closeButton?.addEventListener("click", closePreview);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePreview();
  }
});

loadPreview().catch((error) => {
  elements.title.textContent = "Vorschau nicht verfügbar";
  elements.grid.innerHTML = `<div class="no-preview">${escapeHtml(error.message)}</div>`;
});
