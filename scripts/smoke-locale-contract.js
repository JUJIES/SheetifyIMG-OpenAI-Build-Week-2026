"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  localeTag,
  normalizeLocale
} = require("../core/locale");
const browserLocale = require("../public/locale");

assert.equal(DEFAULT_LOCALE, "de");
assert.deepEqual(SUPPORTED_LOCALES, ["de", "en"]);
assert.equal(isSupportedLocale("en"), true);
assert.equal(isSupportedLocale("EN-us"), true);
assert.equal(isSupportedLocale("fr"), false);
assert.equal(normalizeLocale("en-GB"), "en");
assert.equal(normalizeLocale("fr"), "de");
assert.equal(normalizeLocale("fr", "en"), "en");
assert.equal(localeTag("de"), "de-DE");
assert.equal(localeTag("en"), "en-US");

assert.equal(browserLocale.resolve({
  query: "?lang=en",
  stored: "de",
  session: "de",
  invitation: "de",
  browser: "de-DE"
}), "en");
assert.equal(browserLocale.resolve({
  query: "?lang=fr",
  stored: "en",
  session: "de",
  invitation: "de",
  browser: "de-DE"
}), "en");
assert.equal(browserLocale.resolve({
  stored: "fr",
  session: "en",
  invitation: "de",
  browser: "de-DE"
}), "en");
assert.equal(browserLocale.resolve({
  session: "fr",
  invitation: "en",
  browser: "de-DE"
}), "en");
assert.equal(browserLocale.resolve({ browser: ["fr-FR", "en-US"] }), "en");
assert.equal(browserLocale.resolve({ browser: "fr-FR" }), "de");
assert.equal(browserLocale.set("en", { persistLocal: false }), "en");
assert.equal(browserLocale.current(), "en");
assert.equal(browserLocale.t("language.en"), "English");
assert.equal(browserLocale.t("language.en", {}, "de"), "Englisch");
assert.deepEqual(
  Object.keys(browserLocale.CATALOGUES.en).sort(),
  Object.keys(browserLocale.CATALOGUES.de).sort()
);
assert.equal(browserLocale.t("pass.panel.title", {}, "en"), "Log in");
assert.equal(browserLocale.t("beta.consent.title", {}, "en"), "Help improve SheetifyIMG");
assert.equal(browserLocale.t("pass.notice.topup", { count: 12 }, "en"), "12 draft pages have been added.");
assert.equal(browserLocale.t("missing.key"), "missing.key");

console.log(JSON.stringify({
  ok: true,
  supportedLocales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  deterministicResolution: true,
  catalogueFallback: true,
  catalogueParity: true,
  catalogueKeys: Object.keys(browserLocale.CATALOGUES.de).length
}, null, 2));
