"use strict";

(function attachWorksheetBlueprint(global) {
  function requiredFunction(dependencies, name) {
    const value = dependencies[name];
    if (typeof value !== "function") {
      throw new Error(`SheetifyIMG worksheet blueprint missing dependency: ${name}`);
    }
    return value;
  }

  function createWorksheetBlueprint(dependencies = {}) {
    const escapeHtml = requiredFunction(dependencies, "escapeHtml");

    function text(value) {
      return String(value || "").trim();
    }

    function short(value, maxLength = 150) {
      const normalized = text(value).replace(/\s+/g, " ");
      if (normalized.length <= maxLength) {
        return normalized;
      }
      return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
    }

    function pageOf(entry = {}) {
      const page = Number(entry.page || entry.pageNumber || 0);
      return Number.isInteger(page) && page > 0 ? page : 1;
    }

    function blueprintElements(content = {}) {
      const readingTexts = Array.isArray(content.readingTexts) ? content.readingTexts : [];
      const imageMaterials = Array.isArray(content.imageMaterials) ? content.imageMaterials : [];
      const tasks = Array.isArray(content.tasks) ? content.tasks : [];
      return [
        ...readingTexts.map((entry, index) => ({
          id: text(entry.id) || `text_${index + 1}`,
          type: "text",
          page: pageOf(entry),
          order: 100 + index,
          label: text(entry.title) || (entry.role === "work_instruction" ? "Arbeitsauftrag" : "Lesetext"),
          body: text(entry.body || entry.text),
          kicker: entry.role === "info_box" ? "Infobox" : entry.role === "source_text" ? "Quelle" : "Text"
        })),
        ...imageMaterials.map((entry, index) => ({
          id: text(entry.id) || `image_${index + 1}`,
          type: "image",
          page: pageOf(entry),
          order: 200 + index,
          label: text(entry.purpose) || `Bildmaterial ${index + 1}`,
          body: text(entry.prompt || entry.description),
          placement: text(entry.placement),
          kicker: "Bildmaterial"
        })),
        ...tasks.map((entry, index) => ({
          id: text(entry.id) || `task_${index + 1}`,
          type: "task",
          page: pageOf(entry),
          order: 300 + index,
          label: text(entry.groupLabel) || `Aufgabe ${index + 1}`,
          body: text(entry.prompt),
          expected: text(entry.expectedAnswer),
          difficulty: text(entry.difficulty),
          kicker: `Aufgabe ${index + 1}`
        }))
      ];
    }

    function threadModel(content = {}, elements = []) {
      const raw = content.didacticThread && typeof content.didacticThread === "object"
        ? content.didacticThread
        : {};
      const elementIds = new Set(elements.map((entry) => entry.id));
      const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((step, index) => ({
        id: text(step?.id) || `step_${index + 1}`,
        action: text(step?.action),
        purpose: text(step?.purpose),
        after: text(step?.after) || null,
        refs: (Array.isArray(step?.refs) ? step.refs : []).map(text).filter((ref) => elementIds.has(ref))
      }));
      const byId = new Map(steps.map((step) => [step.id, step]));
      const byElementId = new Map();
      steps.forEach((step, index) => {
        step.index = index;
        step.previous = step.after ? byId.get(step.after) || null : null;
        step.refs.forEach((ref) => {
          if (!byElementId.has(ref)) {
            byElementId.set(ref, step);
          }
        });
      });
      return {
        path: text(raw.path),
        steps,
        byElementId
      };
    }

    function pageCount(content = {}, elements = []) {
      const requested = Number(content.outputPreference?.pages || 0);
      const used = elements.reduce((max, entry) => Math.max(max, entry.page), 1);
      return Math.max(Number.isInteger(requested) && requested > 0 ? requested : 1, used);
    }

    function blockPreview(element) {
      if (element.type === "image") {
        return `
          <span class="worksheet-blueprint-image-placeholder" aria-hidden="true">
            <span></span><span></span><span></span>
          </span>
          <small>${escapeHtml(short(element.body || element.label, 82))}</small>
        `;
      }
      return `<small>${escapeHtml(short(element.body, element.type === "text" ? 170 : 120))}</small>`;
    }

    function renderNode(element, step, selected) {
      const role = step?.purpose || "";
      return `
        <button
          class="worksheet-blueprint-node type-${escapeHtml(element.type)}${selected ? " selected" : ""}"
          type="button"
          data-blueprint-node="${escapeHtml(element.id)}"
          aria-pressed="${selected ? "true" : "false"}"
          aria-label="${escapeHtml(`${element.kicker}: ${element.label}`)}"
        >
          <span class="worksheet-blueprint-node-heading">
            <span>${escapeHtml(element.kicker)}</span>
            ${step ? `<em title="${escapeHtml(role)}">${escapeHtml(String(step.index + 1))}</em>` : ""}
          </span>
          <strong>${escapeHtml(short(element.label, 90))}</strong>
          ${blockPreview(element)}
        </button>
      `;
    }

    function renderPage(content, elements, thread, page, selectedId) {
      const pageElements = elements.filter((entry) => entry.page === page).sort((a, b) => a.order - b.order);
      return `
        <section class="worksheet-blueprint-page" aria-label="Blatt ${page}">
          <div class="worksheet-blueprint-paper">
            <header>
              <span>${pageCount(content, elements) > 1 ? `Blatt ${page}` : "Arbeitsblatt"}</span>
              <strong>${escapeHtml(text(content.title) || "Arbeitsblatt-Konzept")}</strong>
            </header>
            <div class="worksheet-blueprint-page-content">
              ${pageElements.length
                ? pageElements.map((element) => renderNode(
                  element,
                  thread.byElementId.get(element.id),
                  element.id === selectedId
                )).join("")
                : '<p class="worksheet-blueprint-empty-page">Für dieses Blatt sind noch keine Elemente vorgesehen.</p>'}
            </div>
            <footer><span>Strukturvorschau</span><span>${page}/${pageCount(content, elements)}</span></footer>
          </div>
        </section>
      `;
    }

    function detailRows(element) {
      if (element.type === "task") {
        return `
          <section>
            <span>Aufgabentext</span>
            <p>${escapeHtml(element.body)}</p>
          </section>
          ${element.expected ? `
            <details>
              <summary>Prüfanker ansehen</summary>
              <p>${escapeHtml(element.expected)}</p>
            </details>
          ` : ""}
        `;
      }
      if (element.type === "image") {
        return `
          <section>
            <span>Bildbeschreibung</span>
            <p>${escapeHtml(element.body)}</p>
          </section>
          ${element.placement ? `<section><span>Vorgesehener Bereich</span><p>${escapeHtml(element.placement)}</p></section>` : ""}
        `;
      }
      return `
        <section>
          <span>Vorgesehener Text</span>
          <div class="worksheet-blueprint-long-text">${escapeHtml(element.body)}</div>
        </section>
      `;
    }

    function renderInspectorPanel(element, step, thread, selected) {
      const previous = step?.previous;
      return `
        <article class="worksheet-blueprint-inspector-panel${selected ? " selected" : ""}" data-blueprint-panel="${escapeHtml(element.id)}" ${selected ? "" : "hidden"}>
          <header>
            <span>${escapeHtml(element.kicker)} · Blatt ${escapeHtml(element.page)}</span>
            <h3>${escapeHtml(element.label)}</h3>
          </header>
          ${detailRows(element)}
          <section class="worksheet-blueprint-rationale${step ? "" : " missing"}">
            <span>Didaktische Rolle</span>
            ${step
              ? `<strong>${escapeHtml(step.action || `Schritt ${step.index + 1}`)}</strong><p>${escapeHtml(step.purpose)}</p>`
              : "<strong>Noch nicht strukturiert</strong><p>Diese ältere Konzeptfassung enthält noch keine explizite didaktische Begründung.</p>"}
            ${previous ? `<small>Baut auf „${escapeHtml(previous.action || `Schritt ${previous.index + 1}`)}“ auf.</small>` : ""}
          </section>
          ${thread.path ? `<p class="worksheet-blueprint-path-note"><span>Roter Faden</span>${escapeHtml(thread.path)}</p>` : ""}
        </article>
      `;
    }

    function render({ content = {} } = {}) {
      const elements = blueprintElements(content);
      if (!elements.length) {
        return '<div class="worksheet-blueprint-empty">Noch keine Texte, Aufgaben oder Bildmaterialien für den Bauplan vorhanden.</div>';
      }
      const thread = threadModel(content, elements);
      const selectedId = elements[0].id;
      const pages = Array.from({ length: pageCount(content, elements) }, (_, index) => index + 1);
      return `
        <div class="worksheet-blueprint" data-worksheet-blueprint>
          <div class="worksheet-blueprint-overview">
            <div class="worksheet-blueprint-heading">
              <div>
                <span>Arbeitsblatt-Bauplan</span>
                <h3>${escapeHtml(text(content.title) || "Arbeitsblatt-Konzept")}</h3>
              </div>
              ${thread.path ? `<p><span>Roter Faden</span>${escapeHtml(thread.path)}</p>` : ""}
            </div>
            <div class="worksheet-blueprint-pages">
              ${pages.map((page) => renderPage(content, elements, thread, page, selectedId)).join("")}
            </div>
          </div>
          <aside class="worksheet-blueprint-inspector" aria-live="polite">
            <div class="worksheet-blueprint-inspector-nav">
              <button type="button" data-blueprint-previous aria-label="Vorheriges Element">←</button>
              <span><strong data-blueprint-position>1</strong> von ${elements.length}</span>
              <button type="button" data-blueprint-next aria-label="Nächstes Element">→</button>
            </div>
            ${elements.map((element) => renderInspectorPanel(
              element,
              thread.byElementId.get(element.id),
              thread,
              element.id === selectedId
            )).join("")}
          </aside>
        </div>
      `;
    }

    function bind(container) {
      if (!container) {
        return;
      }
      container.querySelectorAll("[data-worksheet-blueprint]").forEach((root) => {
        const nodes = Array.from(root.querySelectorAll("[data-blueprint-node]"));
        const panels = Array.from(root.querySelectorAll("[data-blueprint-panel]"));
        const position = root.querySelector("[data-blueprint-position]");
        if (!nodes.length || !panels.length) {
          return;
        }

        function select(index, { focus = false, reveal = false } = {}) {
          const normalizedIndex = (index + nodes.length) % nodes.length;
          const selected = nodes[normalizedIndex];
          const selectedId = selected.dataset.blueprintNode;
          nodes.forEach((node, nodeIndex) => {
            const active = nodeIndex === normalizedIndex;
            node.classList.toggle("selected", active);
            node.setAttribute("aria-pressed", active ? "true" : "false");
          });
          panels.forEach((panel) => {
            const active = panel.dataset.blueprintPanel === selectedId;
            panel.hidden = !active;
            panel.classList.toggle("selected", active);
          });
          if (position) {
            position.textContent = String(normalizedIndex + 1);
          }
          root.dataset.blueprintIndex = String(normalizedIndex);
          if (focus) {
            selected.focus({ preventScroll: true });
          }
          if (reveal && global.matchMedia?.("(max-width: 760px)").matches) {
            const selectedPanel = panels.find((panel) => panel.dataset.blueprintPanel === selectedId);
            global.requestAnimationFrame(() => {
              const scroller = selectedPanel?.closest(".simplebar-content-wrapper");
              if (!selectedPanel || !scroller) {
                return;
              }
              const panelRect = selectedPanel.getBoundingClientRect();
              const scrollerRect = scroller.getBoundingClientRect();
              scroller.scrollTo({
                top: scroller.scrollTop + panelRect.top - scrollerRect.top - 12,
                behavior: "smooth"
              });
            });
          }
        }

        nodes.forEach((node, index) => node.addEventListener("click", () => select(index, { reveal: true })));
        root.querySelector("[data-blueprint-previous]")?.addEventListener("click", () => {
          select(Number(root.dataset.blueprintIndex || 0) - 1, { focus: true });
        });
        root.querySelector("[data-blueprint-next]")?.addEventListener("click", () => {
          select(Number(root.dataset.blueprintIndex || 0) + 1, { focus: true });
        });
        select(0);
      });
    }

    return {
      bind,
      render
    };
  }

  global.SheetifyIMGWorksheetBlueprint = {
    createWorksheetBlueprint
  };
})(window);
