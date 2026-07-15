"use strict";

const MAX_GENERATED_PAGES = 4;
const PAGE_MARKER_VISUAL_SLOT = "dezenter Seitenhinweis oben rechts";
const PAGE_MARKER_TEMPLATE_POLICY = "Der Seitenhinweis-Anker bleibt app-eigen oben rechts im sicheren Seitenrand und wird nicht aus Vorlagen uebernommen, in Inhaltskaesten gesetzt oder in wechselnde Kopf-/Fussbereiche verschoben.";

function withPageMarkerTemplatePolicy(policy = "") {
  return [policy, PAGE_MARKER_TEMPLATE_POLICY].filter(Boolean).join(" ");
}

function usesConnectedPageMarker(plan = {}) {
  return Number(plan.pageCount || plan.totalPageCount || 1) > 1 && plan.kind !== "sheet";
}

function pageMarkerVisualSlots(plan = {}) {
  return usesConnectedPageMarker(plan) ? [PAGE_MARKER_VISUAL_SLOT] : [];
}

function templatePolicyForPlan(plan = {}, policy = "") {
  return usesConnectedPageMarker(plan) ? withPageMarkerTemplatePolicy(policy) : policy;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripLeadingPageMarker(value) {
  const text = String(value || "").trim();
  if (/^(?:page|sheet|seite|blatt)\s*[1-4]\s*$/i.test(text)) {
    return "";
  }
  return text.replace(/^\s*(?:page|sheet|seite|blatt)\s*[1-4]\s*[:\-–—]\s*/i, "").trim();
}

function cleanPagePlanTitle(value) {
  const text = stripLeadingPageMarker(value);
  const key = normalizeText(text).replace(/[^a-z0-9]+/g, " ").trim();
  if (!text || /^(?:material|materialseite|materialtext|lesetext|leseseite|infotext|kurzinfo|sachtext|quelle|text|info|aufgabenseite|aufgabenblatt|worksheet|worksheet page|task page|tasks page|material page|reading page|sheet)$/.test(key)) {
    return "";
  }
  return text;
}

function materialPageTitle(readingTexts = []) {
  for (const readingText of readingTexts) {
    const title = cleanPagePlanTitle(readingText?.title);
    if (title) {
      return title;
    }
  }
  return "Lesetext";
}

function clampPageCount(value) {
  return Math.max(1, Math.min(Number(value) || 1, MAX_GENERATED_PAGES));
}

function numericPageCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? clampPageCount(count) : 0;
}

function describesContentUnitsBeforePageNoun(value = "") {
  return /\b(?:aufgaben?|aufgabenbloecke?|aufgabenbereiche?|tasks?|taskblocks?|fragen?|questions?|bilder?|images?|grafiken?|graphics?|felder?|fields?|texte?|texts?|abschnitte?|sections?|stationen?|stations?)\b/i.test(
    normalizeText(value)
  );
}

function explicitPageCountFromText(value) {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }
  const pageNoun = "(?:pages?|seiten?|blaetter|blatter|sheets?)";
  const explicitPageRoles = [...text.matchAll(/\b(?:page|seite|blatt|sheet)\s*([1-4])\b/gi)]
    .map((match) => Number(match[1]) || 0)
    .filter(Boolean);
  const highestRolePage = Math.max(0, ...explicitPageRoles);
  if (explicitPageRoles.includes(1) && highestRolePage > 1) {
    return highestRolePage;
  }
  const pageOfTotalMatch = text.match(/\b(?:page|seite|blatt|sheet)\s*[1-4]\s*(?:of|von)\s*([1-4])\b/i);
  if (pageOfTotalMatch) {
    return clampPageCount(pageOfTotalMatch[1]);
  }
  if (new RegExp(`\\b(?:1\\s*[-–—]\\s*2|ein(?:e|en)?\\s+bis\\s+zwei|one\\s+to\\s+two)\\s+${pageNoun}\\b`, "i").test(text)) {
    return 0;
  }
  const pageNounNotRole = `${pageNoun}(?!\\s*[1-4]\\b)`;
  if (/\b(?:einseitig(?:e|er|es|en)?|single[-\s]?page|one[-\s]?page)\b/i.test(text)
    || new RegExp(`\\b(?:nur\\s+)?(?:eine|einen|ein|einzige|einzigen|einzelne|einzelnen)\\s+${pageNounNotRole}\\b`, "i").test(text)) {
    return 1;
  }
  const numericMatches = text.matchAll(new RegExp(`\\b([1-${MAX_GENERATED_PAGES}])((?:\\s+[a-z0-9-]+){0,8})\\s+${pageNounNotRole}\\b`, "gi"));
  for (const numericMatch of numericMatches) {
    if (!describesContentUnitsBeforePageNoun(numericMatch[2])) {
      return clampPageCount(numericMatch[1]);
    }
  }
  const wordToCount = new Map([
    ["one", 1],
    ["ein", 1],
    ["eine", 1],
    ["einen", 1],
    ["einer", 1],
    ["eines", 1],
    ["einem", 1],
    ["einzige", 1],
    ["einzigen", 1],
    ["einzelne", 1],
    ["einzelnen", 1],
    ["single", 1],
    ["two", 2],
    ["zwei", 2],
    ["three", 3],
    ["drei", 3],
    ["four", 4],
    ["vier", 4]
  ]);
  const wordMatches = text.matchAll(new RegExp(`\\b(${[...wordToCount.keys()].join("|")})((?:\\s+[a-z0-9-]+){0,8})\\s+${pageNounNotRole}\\b`, "gi"));
  for (const wordMatch of wordMatches) {
    if (!describesContentUnitsBeforePageNoun(wordMatch[2])) {
      return wordToCount.get(wordMatch[1]) || 0;
    }
  }
  return 0;
}

function explicitPageCountFromImageSpec(imageSpec) {
  const spec = imageSpec?.data || imageSpec || null;
  if (!spec) {
    return 0;
  }
  const directCount = numericPageCount(spec.pageCount || spec.plannedPageCount || spec.outputPreference?.pages);
  if (directCount > 0) {
    return directCount;
  }
  const values = [
    spec.placement,
    spec.purpose,
    spec.learningFunction,
    spec.topic,
    spec.visualBrief,
    spec.layoutIntent,
    spec.styleNotes,
    ...(Array.isArray(spec.mustShow) ? spec.mustShow : [])
  ].filter(Boolean);
  for (const value of values) {
    const count = explicitPageCountFromText(value);
    if (count > 0) {
      return count;
    }
  }
  return 0;
}

function explicitPageCountFromContentIntent(content = {}) {
  const directCount = numericPageCount(content?.pageCount || content?.outputPreference?.pages);
  if (directCount > 0) {
    return directCount;
  }
  const outputIntent = normalizeText([
    content?.title,
    content?.outputPreference?.layout,
    content?.outputPreference?.hierarchy,
    ...(Array.isArray(content?.solutionNotes) ? content.solutionNotes : []),
    ...(Array.isArray(content?.readingTexts) ? content.readingTexts.flatMap((text) => [text.title, text.body]) : [])
  ].filter(Boolean).join("\n"));
  if (/\b(?:single_task_sheet|compact_task_sheet|task_sheet|reines aufgabenblatt|aufgabenblatt|nur (?:die )?aufgaben|aufgabenseite|keine schreiblinien|ohne schreiblinien|keine loesungsfelder|keine losungsfelder)\b/.test(outputIntent)) {
    return 1;
  }
  const values = [
    content?.outputPreference?.layout,
    content?.outputPreference?.hierarchy,
    ...(Array.isArray(content?.solutionNotes) ? content.solutionNotes : []),
    ...(Array.isArray(content?.readingTexts) ? content.readingTexts.flatMap((text) => [text.title, text.body]) : []),
    ...(Array.isArray(content?.imageMaterials)
      ? content.imageMaterials.flatMap((material) => [
          material.prompt,
          material.description,
          material.purpose,
          material.placement
        ])
      : [])
  ].filter(Boolean);
  for (const value of values) {
    const count = explicitPageCountFromText(value);
    if (count > 0) {
      return count;
    }
  }
  return 0;
}

function sheetTitleFromFirstLine(label = "Sheet", number = 1, rawTitle = "") {
  const title = String(rawTitle || "").trim();
  if (!title) {
    return `${label} ${number}`;
  }
  const titleSentence = title.match(/^(.{3,70}?)\.\s+(.+)$/s);
  const looksLikeInstruction = (value) => /[?]/.test(value)
    || /\b(?:read|complete|talk|write|answer|use|questions?|prompts?|boxes|lies|lest|bearbeite|beantwort|fragen|aufgaben|fuell|füll|schreib)\b/i.test(value);
  const leadingTitle = titleSentence && !looksLikeInstruction(titleSentence[1]) && looksLikeInstruction(titleSentence[2])
    ? titleSentence[1].trim()
    : "";
  const visibleTitle = leadingTitle || title;
  return looksLikeInstruction(visibleTitle) || (!leadingTitle && /[.?]/.test(visibleTitle))
    ? `${label} ${number}`
    : `${label} ${number}: ${visibleTitle}`;
}

function sheetMetaFromTask(task = {}) {
  const rawPrompt = String(task.prompt || task.text || "").trim();
  const firstLineMatch = rawPrompt.match(/^\s*(sheet|seite|blatt)\s*([1-4])\s*[:\-–—]\s*([^\r\n]*)/i);
  const idMatch = String(task.id || "").match(/(?:sheet|seite|blatt)[_\-\s]*([1-4])/i);
  const number = Number(firstLineMatch?.[2] || idMatch?.[1] || 0);
  if (!number) {
    return null;
  }
  const title = firstLineMatch?.[3]?.trim() || "";
  const afterTitle = firstLineMatch ? rawPrompt.slice(firstLineMatch[0].length).trim() : "";
  const taskStart = afterTitle.search(/\b(?:task|aufgabe)\s*\d+\s*[:\-–—]/i);
  const intro = taskStart > 0 ? afterTitle.slice(0, taskStart).trim() : "";
  return {
    number,
    title: sheetTitleFromFirstLine(firstLineMatch?.[1] || "Sheet", number, title),
    intro
  };
}

function sheetTaskGroups(contentMirror = {}) {
  const tasks = Array.isArray(contentMirror.tasks) ? contentMirror.tasks : [];
  const groups = new Map();
  let assignedCount = 0;
  for (const task of tasks) {
    const meta = sheetMetaFromTask(task);
    if (!meta?.number) {
      continue;
    }
    assignedCount += 1;
    if (!groups.has(meta.number)) {
      groups.set(meta.number, {
        sheetNumber: meta.number,
        title: meta.title,
        intro: meta.intro,
        tasks: []
      });
    }
    const group = groups.get(meta.number);
    if (!group.title && meta.title) {
      group.title = meta.title;
    }
    if (!group.intro && meta.intro) {
      group.intro = meta.intro;
    }
    group.tasks.push(task);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => a.sheetNumber - b.sheetNumber);
  if (sortedGroups.length < 2 || assignedCount < Math.max(2, Math.ceil(tasks.length * 0.6))) {
    return [];
  }
  return sortedGroups;
}

function sheetNumbersMentioned(value) {
  const text = String(value || "");
  const numbers = new Set();
  for (const match of text.matchAll(/\b(?:sheet|seite|blatt)\s*([1-4])\b/gi)) {
    numbers.add(Number(match[1]));
  }
  return numbers;
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPageMarker(value) {
  const text = String(value || "");
  const match = text.match(/(?:^|[_\-\s])(?:s|p|pg|page|seite|blatt|sheet)[_\-\s]*([1-4])(?:[_\-\s]|$)/i);
  return match ? clampPageCount(match[1]) : 0;
}

function pageNumbersFromItemHints(item = {}) {
  const directPage = Number(item.page || item.pageNumber || 0);
  if (Number.isInteger(directPage) && directPage > 0) {
    return new Set([clampPageCount(directPage)]);
  }
  const pageNumbers = new Set();
  const markerPage = compactPageMarker(item.id);
  if (markerPage) {
    pageNumbers.add(markerPage);
  }
  const text = [
    item.title,
    item.groupLabel,
    item.prompt,
    item.text,
    item.purpose,
    item.placement
  ].filter(Boolean).join("\n");
  for (const number of sheetNumbersMentioned(text)) {
    pageNumbers.add(number);
  }
  return pageNumbers;
}

function itemPageFromOwnHints(item = {}) {
  const pages = [...pageNumbersFromItemHints(item)];
  return pages.length === 1 ? pages[0] : 0;
}

function lessonBriefPageHints(lessonBrief = {}, count = MAX_GENERATED_PAGES) {
  const hints = new Map();
  const values = [
    ...(Array.isArray(lessonBrief.requirements) ? lessonBrief.requirements : []),
    ...(Array.isArray(lessonBrief.teacherNotes) ? lessonBrief.teacherNotes : []),
    lessonBrief.outputPreference?.format,
    lessonBrief.outputPreference?.layout
  ].filter(Boolean);
  for (const value of values) {
    const numbers = [...sheetNumbersMentioned(value)];
    for (const pageNumber of numbers) {
      if (pageNumber < 1 || pageNumber > count) {
        continue;
      }
      hints.set(pageNumber, `${hints.get(pageNumber) || ""}\n${normalizeSearchText(value)}`.trim());
    }
  }
  return hints;
}

function specificItemHints(item = {}) {
  const rawHints = [
    item.title,
    item.groupLabel,
    item.purpose,
    item.placement,
    item.prompt
  ];
  return rawHints
    .map((value) => normalizeSearchText(value))
    .filter((value) => value.length >= 6 && !/^(?:aufgaben|task|tasks|arbeitsblatt|worksheet|auto)$/.test(value))
    .slice(0, 6);
}

function pageFromLessonBriefHints(item = {}, pageHints = new Map()) {
  const hints = specificItemHints(item);
  if (!hints.length || !pageHints.size) {
    return 0;
  }
  const matches = [];
  for (const [pageNumber, pageText] of pageHints.entries()) {
    if (hints.some((hint) => pageText.includes(hint))) {
      matches.push(pageNumber);
    }
  }
  return matches.length === 1 ? matches[0] : 0;
}

function inferItemPages(items = [], lessonBrief = {}, count = 1, type = "item") {
  const pageHints = lessonBriefPageHints(lessonBrief, count);
  const inferred = (Array.isArray(items) ? items : []).map((item) => {
    const page = itemPageFromOwnHints(item) || pageFromLessonBriefHints(item, pageHints);
    return page ? { ...item, page } : item;
  });
  if (type !== "reading" || count <= 1 || !inferred.some((item) => explicitItemPage(item) > 0)) {
    return inferred;
  }
  return inferred.map((item) => explicitItemPage(item) > 0
    ? item
    : { ...item, page: 1 });
}

function pageRole(pageNumber, pagePlan = null) {
  if (pagePlan?.role) {
    return pagePlan.role;
  }
  if (pageNumber === 1) {
    return "worksheet";
  }
  if (pageNumber === 2) {
    return "tasks";
  }
  return "extension";
}

function pageCountFromContent(content = {}, imageSpec = null, lessonBrief = {}) {
  const sheetGroups = sheetTaskGroups(content);
  const explicitContentPages = numericPageCount(content?.pageCount || content?.outputPreference?.pages);
  if (explicitContentPages > 0 || sheetGroups.length > 1) {
    return clampPageCount(Math.max(explicitContentPages || 0, sheetGroups.length || 0, 1));
  }
  const contentIntentPages = explicitPageCountFromContentIntent(content);
  if (contentIntentPages > 0) {
    return contentIntentPages;
  }
  const explicitBriefPages = numericPageCount(lessonBrief?.outputPreference?.pages);
  if (explicitBriefPages > 0) {
    return explicitBriefPages;
  }
  const specPages = explicitPageCountFromImageSpec(imageSpec);
  if (specPages > 0) {
    return specPages;
  }
  return 1;
}

function splitEvenly(items = [], slots = 1) {
  const count = Math.max(1, Number(slots) || 1);
  const result = Array.from({ length: count }, () => []);
  items.forEach((item, index) => {
    const bucket = Math.min(count - 1, Math.floor(index * count / Math.max(items.length, 1)));
    result[bucket].push(item);
  });
  return result;
}

function materialIdsForTasks(tasks = [], validMaterialIds = null) {
  const ids = new Set();
  for (const task of tasks) {
    for (const ref of task.materialRefs || []) {
      if (!validMaterialIds || validMaterialIds.has(ref)) {
        ids.add(ref);
      }
    }
  }
  return [...ids];
}

function explicitItemPage(item = {}) {
  return itemPageFromOwnHints(item);
}

function hasExplicitPageItems(items = []) {
  return (Array.isArray(items) ? items : []).some((item) => explicitItemPage(item) > 0);
}

function itemsForExplicitPage(items = [], pageNumber = 1) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => explicitItemPage(item) === Number(pageNumber));
}

function itemIdsForExplicitPage(items = [], pageNumber = 1) {
  return itemsForExplicitPage(items, pageNumber)
    .map((item) => item.id)
    .filter(Boolean);
}

function readingTextSheetNumbers(readingText = {}) {
  return sheetNumbersMentioned([
    readingText.id,
    readingText.title,
    readingText.body
  ].filter(Boolean).join("\n"));
}

function readingTextsForSheet(readingTexts = [], sheetNumber = 1, sheetGroups = []) {
  const firstSheetNumber = Math.min(...sheetGroups.map((group) => group.sheetNumber).filter(Boolean));
  const result = [];
  for (const readingText of readingTexts) {
    const mentionedSheets = readingTextSheetNumbers(readingText);
    if (mentionedSheets.has(sheetNumber) || (!mentionedSheets.size && sheetNumber === firstSheetNumber)) {
      result.push(readingText);
    }
  }
  return result;
}

function pageVisualContract(plan = {}) {
  const taskCount = Array.isArray(plan.tasks) ? plan.tasks.length : 0;
  const textCount = Array.isArray(plan.readingTexts) ? plan.readingTexts.length : 0;
  const materialCount = Array.isArray(plan.imageMaterialIds) ? plan.imageMaterialIds.length : 0;
  const taskOnlyPage = taskCount > 0 && textCount === 0;
  const connectedTaskPage = plan.kind === "task_group"
    || ((plan.kind === "page" || plan.kind === "worksheet") && taskOnlyPage);
  const markerSlots = pageMarkerVisualSlots(plan);

  if (connectedTaskPage && materialCount === 0) {
    return {
      pageRole: "tasks_only",
      allowedVisualSlots: [
        "Titel/Kopfzone",
        "Aufgabenblock",
        "Aufgabennummerierung",
        "Schreib-/Antwortflaechen",
        "kleine Strukturmarker",
        ...markerSlots
      ],
      disallowedVisualSlots: [
        "grosse Illustration",
        "Materialkasten",
        "Bildfeld",
        "Karte oder Diagramm",
        "aus der Vorlage kopierter Bildslot"
      ],
      templateCarryoverPolicy: templatePolicyForPlan(plan, "Vorlagen duerfen Kopfbereich, Abstaende, Aufgabenrhythmus, Nummerierung, Linienlogik und Randlogik uebernehmen, aber keine Bild-, Karten-, Diagramm- oder Materialslots.")
    };
  }

  if (connectedTaskPage && materialCount > 0) {
    return {
      pageRole: "tasks_with_material",
      allowedVisualSlots: [
        "Titel/Kopfzone",
        "Aufgabenblock",
        "Aufgabennummerierung",
        "Schreib-/Antwortflaechen",
        "genau freigegebenes Bildmaterial dieser Seite",
        ...markerSlots
      ],
      disallowedVisualSlots: [
        "zusaetzliche generische Illustration",
        "zweiter Materialkasten",
        "nicht freigegebenes Bildfeld",
        "aus der Vorlage kopiertes Material"
      ],
      templateCarryoverPolicy: templatePolicyForPlan(plan, "Vorlagen duerfen die Aufgabenkomposition uebernehmen; Bildslots sind nur erlaubt, wenn sie durch das freigegebene Bildmaterial dieser Seite gefuellt werden.")
    };
  }

  if (textCount > 0 && taskCount === 0) {
    return {
      pageRole: materialCount > 0 ? "reading_with_material" : "reading_page",
      allowedVisualSlots: [
        "Titel/Kopfzone",
        "Lesetextbereich",
        materialCount > 0 ? "freigegebenes Material-/Bildfeld" : "passende fachliche Visualisierung",
        ...markerSlots
      ],
      disallowedVisualSlots: [
        "Aufgabenblock anderer Seiten",
        "Schreiblinien fuer Aufgaben anderer Seiten"
      ],
      templateCarryoverPolicy: templatePolicyForPlan(plan, "Vorlagen duerfen Lesetext- und Materialkomposition uebernehmen, solange keine Aufgaben anderer Seiten sichtbar werden.")
    };
  }

  if (textCount > 0 && taskCount > 0) {
    return {
      pageRole: materialCount > 0 ? "mixed_with_material" : "mixed_text_tasks",
      allowedVisualSlots: [
        "Titel/Kopfzone",
        "Lesetextbereich",
        "Aufgabenblock",
        "Schreib-/Antwortflaechen",
        materialCount > 0 ? "freigegebenes Material-/Bildfeld" : "kleine fachliche Visualisierung",
        ...markerSlots
      ],
      disallowedVisualSlots: [
        "Inhalte anderer Seiten",
        "zusaetzliche nicht freigegebene Materialbilder"
      ],
      templateCarryoverPolicy: templatePolicyForPlan(plan, "Vorlagen duerfen die freigegebenen Text-, Aufgaben- und Materialbereiche strukturieren, aber keine Inhalte anderer Seiten einbringen.")
    };
  }

  return {
    pageRole: "generic_page",
    allowedVisualSlots: [
      "Titel/Kopfzone",
      "freigegebene Inhalte",
      ...markerSlots
    ],
    disallowedVisualSlots: [
      "Inhalte anderer Seiten"
    ],
    templateCarryoverPolicy: templatePolicyForPlan(plan, "Vorlagen duerfen nur die zum aktiven Seiteninhalt passenden Bereiche tragen.")
  };
}

function planSummary(plan) {
  return {
    pageNumber: plan.pageNumber,
    role: plan.role,
    kind: plan.kind || null,
    title: plan.title || null,
    sourceTaskIds: plan.tasks?.map((task) => task.id).filter(Boolean) || [],
    sourceTextIds: plan.readingTexts?.map((text) => text.id).filter(Boolean) || [],
    imageMaterialIds: plan.imageMaterialIds || [],
    visualContract: plan.visualContract || pageVisualContract(plan)
  };
}

function withPlanSummary(plan) {
  const visualContract = pageVisualContract(plan);
  return {
    ...plan,
    visualContract,
    summary: planSummary({ ...plan, visualContract })
  };
}

function buildPagePlans(contentMirror = {}, lessonBrief = {}, pageCount = 1, imageSpec = null) {
  const rawReadingTexts = Array.isArray(contentMirror.readingTexts) ? contentMirror.readingTexts : [];
  const rawTasks = Array.isArray(contentMirror.tasks) ? contentMirror.tasks : [];
  const rawImageMaterials = Array.isArray(contentMirror.imageMaterials) ? contentMirror.imageMaterials : [];
  const initialCount = clampPageCount(Math.max(Number(pageCount) || 1, pageCountFromContent(contentMirror, imageSpec, lessonBrief), 1));
  const readingTexts = inferItemPages(rawReadingTexts, lessonBrief, initialCount, "reading");
  const tasks = inferItemPages(rawTasks, lessonBrief, initialCount, "task");
  const imageMaterials = inferItemPages(rawImageMaterials, lessonBrief, initialCount, "image");
  const validMaterialIds = new Set(imageMaterials.map((material) => material.id).filter(Boolean));
  const sheetGroups = sheetTaskGroups(contentMirror);
  const inferredCount = pageCountFromContent(contentMirror, imageSpec, lessonBrief);
  const count = clampPageCount(Math.max(Number(pageCount) || 1, inferredCount, sheetGroups.length || 1));
  const hasExplicitReadingPages = hasExplicitPageItems(readingTexts);
  const hasExplicitTaskPages = hasExplicitPageItems(tasks);
  const hasExplicitMaterialPages = hasExplicitPageItems(imageMaterials);

  if (sheetGroups.length > 1) {
    const plans = sheetGroups.slice(0, count).map((group, index) => ({
      kind: "sheet",
      pageNumber: index + 1,
      role: `sheet_${group.sheetNumber}`,
      sheetNumber: group.sheetNumber,
      title: group.title || `Sheet ${group.sheetNumber}`,
      intro: group.intro || "",
      readingTexts: readingTextsForSheet(readingTexts, group.sheetNumber, sheetGroups),
      tasks: group.tasks,
      imageMaterialIds: materialIdsForTasks(group.tasks, validMaterialIds)
    }));
    for (let index = plans.length; index < count; index += 1) {
      const pageNumber = index + 1;
      plans.push({
        kind: "extension",
        pageNumber,
        role: pageRole(pageNumber),
        title: `Zusatzseite ${pageNumber}`,
        readingTexts: [],
        tasks: [],
        imageMaterialIds: []
      });
    }
    return plans.map((plan) => withPlanSummary({ ...plan, pageCount: count, totalPageCount: count }));
  }

  if (count > 1 && (hasExplicitReadingPages || hasExplicitTaskPages || hasExplicitMaterialPages)) {
    return Array.from({ length: count }, (_, index) => {
      const pageNumber = index + 1;
      const pageReadingTexts = hasExplicitReadingPages
        ? itemsForExplicitPage(readingTexts, pageNumber)
        : pageNumber === 1
          ? readingTexts
          : [];
      const pageTasks = hasExplicitTaskPages
        ? itemsForExplicitPage(tasks, pageNumber)
        : splitEvenly(tasks, count)[index] || [];
      const explicitMaterialIds = hasExplicitMaterialPages
        ? itemIdsForExplicitPage(imageMaterials, pageNumber)
        : [];
      const taskMaterialIds = hasExplicitMaterialPages
        ? []
        : materialIdsForTasks(pageTasks, validMaterialIds);
      const imageMaterialIds = [...new Set([...explicitMaterialIds, ...taskMaterialIds])];
      const role = pageReadingTexts.length && pageTasks.length
        ? "worksheet"
        : pageReadingTexts.length
          ? "material"
          : pageTasks.length
            ? "tasks"
            : pageRole(pageNumber);
      const title = pageReadingTexts[0]?.title
        ? cleanPagePlanTitle(pageReadingTexts[0].title) || contentMirror.title || `Seite ${pageNumber}`
        : pageTasks.length
          ? "Aufgaben"
          : contentMirror.title || `Seite ${pageNumber}`;
      const plan = {
        kind: "page",
        pageNumber,
        pageCount: count,
        totalPageCount: count,
        role,
        title,
        readingTexts: pageReadingTexts,
        tasks: pageTasks,
        imageMaterialIds,
        explicitPageContract: true
      };
      return withPlanSummary(plan);
    });
  }

  if (count <= 1) {
    const plan = {
      kind: "worksheet",
      pageNumber: 1,
      pageCount: 1,
      totalPageCount: 1,
      role: "worksheet",
      title: contentMirror.title || "Arbeitsblatt",
      readingTexts,
      tasks,
      imageMaterialIds: materialIdsForTasks(tasks, validMaterialIds)
    };
    return [withPlanSummary(plan)];
  }

  const plans = [];
  const taskSlots = readingTexts.length ? count - 1 : count;
  const taskGroups = splitEvenly(tasks, taskSlots);

  if (readingTexts.length) {
    plans.push({
      kind: "material",
      pageNumber: 1,
      role: "material",
      title: materialPageTitle(readingTexts),
      readingTexts,
      tasks: [],
      imageMaterialIds: imageMaterials
        .filter((material) => /(?:material|lese|text|seite\s*1|sheet\s*1|blatt\s*1)/i.test(`${material.id || ""} ${material.placement || ""} ${material.purpose || ""}`))
        .map((material) => material.id)
        .filter(Boolean)
    });
  }

  taskGroups.forEach((group, index) => {
    const pageNumber = readingTexts.length ? index + 2 : index + 1;
    const lastPage = pageNumber === count;
    const title = group.length && lastPage && count > 2
      ? "Weiterführende Aufgaben"
      : group.length
        ? "Aufgaben"
        : `Zusatzseite ${pageNumber}`;
    plans.push({
      kind: group.length ? "task_group" : "extension",
      pageNumber,
      role: pageNumber === 1 ? "worksheet" : lastPage && count > 2 ? "extension" : "tasks",
      title,
      readingTexts: [],
      tasks: group,
      imageMaterialIds: materialIdsForTasks(group, validMaterialIds)
    });
  });

  return plans.slice(0, count).map((plan) => withPlanSummary({ ...plan, pageCount: count, totalPageCount: count }));
}

function pagePlanForImageSpec(contentMirror = {}, lessonBrief = {}, imageSpec = null) {
  const pageCount = pageCountFromContent(contentMirror, imageSpec, lessonBrief);
  const plans = buildPagePlans(contentMirror, lessonBrief, pageCount, imageSpec);
  return {
    pageCount: plans.length,
    pages: plans.map((plan) => plan.summary)
  };
}

module.exports = {
  MAX_GENERATED_PAGES,
  buildPagePlans,
  clampPageCount,
  explicitPageCountFromContentIntent,
  explicitPageCountFromImageSpec,
  explicitPageCountFromText,
  pageCountFromContent,
  pagePlanForImageSpec,
  pageVisualContract,
  pageRole,
  sheetNumbersMentioned,
  sheetTaskGroups
};
