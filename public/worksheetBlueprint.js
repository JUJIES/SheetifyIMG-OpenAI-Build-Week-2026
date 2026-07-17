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
    const onSelectionChange = typeof dependencies.onSelectionChange === "function"
      ? dependencies.onSelectionChange
      : null;
    const onRevise = typeof dependencies.onRevise === "function"
      ? dependencies.onRevise
      : null;
    const translate = typeof dependencies.t === "function" ? dependencies.t : null;

    function label(key, fallback, variables = {}) {
      if (translate) {
        const translated = translate(key, variables);
        if (translated && translated !== key) {
          return translated;
        }
      }
      return String(fallback).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_match, name) => (
        Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : ""
      ));
    }

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
          label: text(entry.title) || (entry.role === "work_instruction"
            ? label("app.blueprint.workInstruction", "Arbeitsauftrag")
            : label("app.blueprint.text", "Text")),
          body: text(entry.body || entry.text),
          kicker: entry.role === "info_box"
            ? label("app.blueprint.infoBox", "Infobox")
            : entry.role === "source_text"
              ? label("app.blueprint.source", "Quelle")
              : label("app.blueprint.text", "Text")
        })),
        ...imageMaterials.map((entry, index) => ({
          id: text(entry.id) || `image_${index + 1}`,
          type: "image",
          page: pageOf(entry),
          order: 200 + index,
          label: text(entry.purpose) || `${label("app.blueprint.imageMaterial", "Bildmaterial")} ${index + 1}`,
          body: text(entry.prompt || entry.description),
          placement: text(entry.placement),
          kicker: label("app.blueprint.imageMaterial", "Bildmaterial")
        })),
        ...tasks.map((entry, index) => ({
          id: text(entry.id) || `task_${index + 1}`,
          type: "task",
          page: pageOf(entry),
          order: 300 + index,
          label: text(entry.groupLabel) || `${label("app.blueprint.task", "Aufgabe")} ${index + 1}`,
          body: text(entry.prompt),
          expected: text(entry.expectedAnswer),
          difficulty: text(entry.difficulty),
          kicker: `${label("app.blueprint.task", "Aufgabe")} ${index + 1}`
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
          data-blueprint-type="${escapeHtml(element.type)}"
          data-blueprint-label="${escapeHtml(element.label)}"
          data-blueprint-page="${escapeHtml(element.page)}"
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
        <section class="worksheet-blueprint-page" aria-label="${escapeHtml(label("app.blueprint.sheet", "Blatt"))} ${page}">
          <div class="worksheet-blueprint-paper">
            <header>
              <span>${pageCount(content, elements) > 1
                ? `${label("app.blueprint.sheet", "Blatt")} ${page}`
                : label("app.blueprint.worksheet", "Arbeitsblatt")}</span>
              <strong>${escapeHtml(text(content.title) || label("app.concept.title", "Arbeitsblatt-Konzept"))}</strong>
            </header>
            <div class="worksheet-blueprint-page-content">
              ${pageElements.length
                ? pageElements.map((element) => renderNode(
                  element,
                  thread.byElementId.get(element.id),
                  element.id === selectedId
                )).join("")
                : `<p class="worksheet-blueprint-empty-page">${escapeHtml(label("app.blueprint.emptyPage", "Für dieses Blatt sind noch keine Elemente vorgesehen."))}</p>`}
            </div>
            <footer><span>${escapeHtml(label("app.blueprint.structurePreview", "Strukturvorschau"))}</span><span>${page}/${pageCount(content, elements)}</span></footer>
          </div>
        </section>
      `;
    }

    function detailRows(element) {
      if (element.type === "task") {
        return `
          <section>
            <span>${escapeHtml(label("app.blueprint.taskText", "Aufgabentext"))}</span>
            <p>${escapeHtml(element.body)}</p>
          </section>
          ${element.expected ? `
            <details>
              <summary>${escapeHtml(label("app.blueprint.answerAnchor", "Prüfanker ansehen"))}</summary>
              <p>${escapeHtml(element.expected)}</p>
            </details>
          ` : ""}
        `;
      }
      if (element.type === "image") {
        return `
          <section>
            <span>${escapeHtml(label("app.blueprint.imageDescription", "Bildbeschreibung"))}</span>
            <p>${escapeHtml(element.body)}</p>
          </section>
          ${element.placement ? `<section><span>${escapeHtml(label("app.blueprint.plannedArea", "Vorgesehener Bereich"))}</span><p>${escapeHtml(element.placement)}</p></section>` : ""}
        `;
      }
      return `
        <section>
          <span>${escapeHtml(label("app.blueprint.plannedText", "Vorgesehener Text"))}</span>
          <div class="worksheet-blueprint-long-text">${escapeHtml(element.body)}</div>
        </section>
      `;
    }

    function renderInspectorPanel(element, step, thread, selected) {
      const previous = step?.previous;
      return `
        <article class="worksheet-blueprint-inspector-panel${selected ? " selected" : ""}" data-blueprint-panel="${escapeHtml(element.id)}" ${selected ? "" : "hidden"}>
          <header>
            <span>${escapeHtml(element.kicker)} · ${escapeHtml(label("app.blueprint.sheet", "Blatt"))} ${escapeHtml(element.page)}</span>
            <h3>${escapeHtml(element.label)}</h3>
          </header>
          ${detailRows(element)}
          <section class="worksheet-blueprint-rationale${step ? "" : " missing"}">
            <span>${escapeHtml(label("app.blueprint.didacticRole", "Didaktische Rolle"))}</span>
            ${step
              ? `<strong>${escapeHtml(step.action || `${label("app.blueprint.step", "Schritt")} ${step.index + 1}`)}</strong><p>${escapeHtml(step.purpose)}</p>`
              : `<strong>${escapeHtml(label("app.blueprint.notStructured", "Noch nicht strukturiert"))}</strong><p>${escapeHtml(label("app.blueprint.legacyRationale", "Diese ältere Konzeptfassung enthält noch keine explizite didaktische Begründung."))}</p>`}
            ${previous ? `<small>${escapeHtml(label("app.blueprint.buildsOn", "Baut auf „{{action}}“ auf.", { action: previous.action || `${label("app.blueprint.step", "Schritt")} ${previous.index + 1}` }))}</small>` : ""}
          </section>
          ${thread.path ? `<p class="worksheet-blueprint-path-note"><span>${escapeHtml(label("app.blueprint.thread", "Roter Faden"))}</span>${escapeHtml(thread.path)}</p>` : ""}
          <button class="worksheet-blueprint-revise" type="button" data-blueprint-revise="${escapeHtml(element.id)}">${escapeHtml(label("app.blueprint.reviseElement", "Dieses Element überarbeiten"))}</button>
        </article>
      `;
    }

    function render({ content = {} } = {}) {
      const elements = blueprintElements(content);
      if (!elements.length) {
        return `<div class="worksheet-blueprint-empty">${escapeHtml(label("app.blueprint.empty", "Noch keine Texte, Aufgaben oder Bildmaterialien für den Bauplan vorhanden."))}</div>`;
      }
      const thread = threadModel(content, elements);
      const selectedId = elements[0].id;
      const pages = Array.from({ length: pageCount(content, elements) }, (_, index) => index + 1);
      return `
        <div class="worksheet-blueprint" data-worksheet-blueprint>
          <div class="worksheet-blueprint-overview">
            <div class="worksheet-blueprint-heading">
              <div>
                <span>${escapeHtml(label("app.blueprint.title", "Arbeitsblatt-Bauplan"))}</span>
                <h3>${escapeHtml(text(content.title) || label("app.concept.title", "Arbeitsblatt-Konzept"))}</h3>
              </div>
              ${thread.path ? `<p><span>${escapeHtml(label("app.blueprint.thread", "Roter Faden"))}</span>${escapeHtml(thread.path)}</p>` : ""}
            </div>
            <div class="worksheet-blueprint-pages">
              ${pages.map((page) => renderPage(content, elements, thread, page, selectedId)).join("")}
            </div>
          </div>
          <aside class="worksheet-blueprint-inspector" aria-live="polite">
            <div class="worksheet-blueprint-inspector-nav">
              <button type="button" data-blueprint-previous aria-label="${escapeHtml(label("app.blueprint.previousElement", "Vorheriges Element"))}">←</button>
              <span><strong data-blueprint-position>1</strong> ${escapeHtml(label("app.blueprint.of", "von"))} ${elements.length}</span>
              <button type="button" data-blueprint-next aria-label="${escapeHtml(label("app.blueprint.nextElement", "Nächstes Element"))}">→</button>
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
          onSelectionChange?.({
            id: selectedId,
            type: selected.dataset.blueprintType || "content",
            label: selected.dataset.blueprintLabel || selectedId,
            page: Number(selected.dataset.blueprintPage || 1) || 1
          });
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
        root.querySelectorAll("[data-blueprint-revise]").forEach((button) => {
          button.addEventListener("click", () => {
            const index = nodes.findIndex((node) => node.dataset.blueprintNode === button.dataset.blueprintRevise);
            if (index < 0) {
              return;
            }
            select(index);
            const selected = nodes[index];
            onRevise?.({
              id: selected.dataset.blueprintNode,
              type: selected.dataset.blueprintType || "content",
              label: selected.dataset.blueprintLabel || selected.dataset.blueprintNode,
              page: Number(selected.dataset.blueprintPage || 1) || 1
            });
          });
        });
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
