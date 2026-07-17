"use strict";

const SUPPORTED_LOCALES = Object.freeze(["de", "en"]);
const SUPPORTED_LOCALE_SET = new Set(SUPPORTED_LOCALES);
const DEFAULT_LOCALE = "de";
const LOCALE_TAGS = Object.freeze({
  de: "de-DE",
  en: "en-US"
});

function localeCandidate(value) {
  const candidate = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .split("-", 1)[0];
  return SUPPORTED_LOCALE_SET.has(candidate) ? candidate : null;
}

function isSupportedLocale(value) {
  return localeCandidate(value) !== null;
}

function normalizeLocale(value, fallback = DEFAULT_LOCALE) {
  return localeCandidate(value) || localeCandidate(fallback) || DEFAULT_LOCALE;
}

function localeTag(value) {
  return LOCALE_TAGS[normalizeLocale(value)];
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  localeTag,
  normalizeLocale
};
