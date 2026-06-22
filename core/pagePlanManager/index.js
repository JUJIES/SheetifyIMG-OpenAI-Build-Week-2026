"use strict";

const MAX_GENERATED_PAGES = 4;

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

function clampPageCount(value) {
  return Math.max(1, Math.min(Number(value) || 1, MAX_GENERATED_PAGES));
}

function explicitPageCountFromText(value) {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }
  const pageNoun = "(?:pages?|seiten?|blaetter|blatter|sheets?)";
  const numericMatch = text.match(new RegExp(`\\b([1-${MAX_GENERATED_PAGES}])(?:\\s+[a-z0-9-]+){0,8}\\s+${pageNoun}\\b`, "i"));
  if (numericMatch) {
    return clampPageCount(numericMatch[1]);
  }
  const wordToCount = new Map([
    ["one", 1],
    ["eine", 1],
    ["einen", 1],
    ["single", 1],
    ["two", 2],
    ["zwei", 2],
    ["three", 3],
    ["drei", 3],
    ["four", 4],
    ["vier", 4]
  ]);
  const wordMatch = text.match(new RegExp(`\\b(${[...wordToCount.keys()].join("|")})(?:\\s+[a-z0-9-]+){0,8}\\s+${pageNoun}\\b`, "i"));
  return wordMatch ? wordToCount.get(wordMatch[1]) || 0 : 0;
}

function explicitPageCountFromImageSpec(imageSpec) {
  const spec = imageSpec?.data || imageSpec || null;
  if (!spec) {
    return 0;
  }
  const values = [
    spec.placement,
    spec.purpose,
    spec.learningFunction,
    spec.topic,
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
    title: title ? `${firstLineMatch?.[1] || "Sheet"} ${number}: ${title}` : `Sheet ${number}`,
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
  const explicitPages = Number(content?.pageCount || content?.outputPreference?.pages || lessonBrief?.outputPreference?.pages || 0);
  const sheetGroups = sheetTaskGroups(content);
  if (explicitPages > 0 || sheetGroups.length > 1) {
    return clampPageCount(Math.max(explicitPages || 0, sheetGroups.length || 0, 1));
  }
  const specPages = explicitPageCountFromImageSpec(imageSpec);
  if (specPages > 0) {
    return specPages;
  }
  const materialCount = Array.isArray(content?.imageMaterials) ? content.imageMaterials.length : 0;
  return Math.max(1, Math.min(2, materialCount || 1));
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

function planSummary(plan) {
  return {
    pageNumber: plan.pageNumber,
    role: plan.role,
    title: plan.title || null,
    sourceTaskIds: plan.tasks?.map((task) => task.id).filter(Boolean) || [],
    sourceTextIds: plan.readingTexts?.map((text) => text.id).filter(Boolean) || [],
    imageMaterialIds: plan.imageMaterialIds || []
  };
}

function buildPagePlans(contentMirror = {}, lessonBrief = {}, pageCount = 1, imageSpec = null) {
  const readingTexts = Array.isArray(contentMirror.readingTexts) ? contentMirror.readingTexts : [];
  const tasks = Array.isArray(contentMirror.tasks) ? contentMirror.tasks : [];
  const imageMaterials = Array.isArray(contentMirror.imageMaterials) ? contentMirror.imageMaterials : [];
  const validMaterialIds = new Set(imageMaterials.map((material) => material.id).filter(Boolean));
  const sheetGroups = sheetTaskGroups(contentMirror);
  const inferredCount = pageCountFromContent(contentMirror, imageSpec, lessonBrief);
  const count = clampPageCount(Math.max(Number(pageCount) || 1, inferredCount, sheetGroups.length || 1));

  if (sheetGroups.length > 1) {
    const plans = sheetGroups.slice(0, count).map((group, index) => ({
      kind: "sheet",
      pageNumber: index + 1,
      role: `sheet_${group.sheetNumber}`,
      sheetNumber: group.sheetNumber,
      title: group.title || `Sheet ${group.sheetNumber}`,
      intro: group.intro || "",
      readingTexts: [],
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
    return plans.map((plan) => ({ ...plan, summary: planSummary(plan) }));
  }

  if (count <= 1) {
    const plan = {
      kind: "worksheet",
      pageNumber: 1,
      role: "worksheet",
      title: contentMirror.title || "Arbeitsblatt",
      readingTexts,
      tasks,
      imageMaterialIds: materialIdsForTasks(tasks, validMaterialIds)
    };
    return [{ ...plan, summary: planSummary(plan) }];
  }

  const plans = [];
  const taskSlots = readingTexts.length ? count - 1 : count;
  const taskGroups = splitEvenly(tasks, taskSlots);

  if (readingTexts.length) {
    plans.push({
      kind: "material",
      pageNumber: 1,
      role: "material",
      title: "Materialseite",
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
        ? "Aufgabenseite"
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

  return plans.slice(0, count).map((plan) => ({ ...plan, summary: planSummary(plan) }));
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
  pageCountFromContent,
  pagePlanForImageSpec,
  pageRole,
  sheetNumbersMentioned,
  sheetTaskGroups
};
