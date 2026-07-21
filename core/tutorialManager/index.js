"use strict";

const { normalizeLocale } = require("../locale");

const CATALOG_VERSION = "sheetifyimg.tutorials.v2";
const TUTORIALS = Object.freeze([
  Object.freeze({
    id: "first-worksheet",
    order: 1,
    intro: true,
    youtubeUrls: Object.freeze({
      de: "https://youtu.be/3uJi1SkLXYs",
      en: "https://youtu.be/zbgVeGDTo7o"
    }),
    eyebrow: Object.freeze({ de: "Erste Schritte", en: "Getting started" }),
    title: Object.freeze({ de: "Mein erstes Arbeitsblatt", en: "My first worksheet" }),
    description: Object.freeze({
      de: "Vom neuen Projekt bis zum ersten Entwurf – kompakt erklärt.",
      en: "From a new project to your first draft, explained briefly."
    })
  })
]);

function tutorialDefinition(id) {
  return TUTORIALS.find((tutorial) => tutorial.id === id) || null;
}

function progressIds(values) {
  return [...new Set(Array.isArray(values) ? values.map(String).filter(Boolean) : [])].slice(-50);
}

function validYoutubeVideoId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

function youtubeVideoId(value) {
  const source = String(value || "").trim();
  if (!source) return null;
  const directId = validYoutubeVideoId(source);
  if (directId) return directId;
  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "youtu.be") {
      return validYoutubeVideoId(parsed.pathname.split("/").filter(Boolean)[0]);
    }
    const youtubeHosts = new Set([
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com"
    ]);
    if (!youtubeHosts.has(hostname)) return null;
    const queryId = validYoutubeVideoId(parsed.searchParams.get("v"));
    if (queryId) return queryId;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (["embed", "live", "shorts"].includes(segments[0])) {
      return validYoutubeVideoId(segments[1]);
    }
  } catch {
    return null;
  }
  return null;
}

async function buildTutorialCatalog({ locale = "de", progress = {}, sourceOverrides = {} } = {}) {
  const selectedLocale = normalizeLocale(locale);
  const autoShownIds = progressIds(progress.autoShownIds);
  const completedIds = progressIds(progress.completedIds);
  const items = TUTORIALS.map((tutorial) => {
    const sourceOverride = sourceOverrides[tutorial.id];
    const localizedOverride = sourceOverride && typeof sourceOverride === "object"
      ? sourceOverride[selectedLocale]
      : sourceOverride;
    const fallbackSource = tutorial.youtubeUrls?.[selectedLocale] || tutorial.youtubeUrl;
    const videoId = youtubeVideoId(localizedOverride) || youtubeVideoId(fallbackSource);
    return {
      id: tutorial.id,
      order: tutorial.order,
      intro: tutorial.intro,
      eyebrow: tutorial.eyebrow[selectedLocale],
      title: tutorial.title[selectedLocale],
      description: tutorial.description[selectedLocale],
      available: Boolean(videoId),
      videoProvider: videoId ? "youtube" : null,
      youtubeVideoId: videoId,
      autoShown: autoShownIds.includes(tutorial.id),
      completed: completedIds.includes(tutorial.id)
    };
  });
  const intro = items.find((tutorial) => tutorial.intro) || null;
  return {
    version: CATALOG_VERSION,
    introTutorialId: intro?.id || null,
    autoShowId: intro?.available && !intro.autoShown && !intro.completed ? intro.id : null,
    items
  };
}

module.exports = {
  CATALOG_VERSION,
  TUTORIALS,
  buildTutorialCatalog,
  tutorialDefinition,
  youtubeVideoId
};
