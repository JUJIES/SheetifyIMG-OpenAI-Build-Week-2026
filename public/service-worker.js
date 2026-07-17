"use strict";

const CACHE_NAME = "sheetifyimg-static-v89";
const APP_SHELL_URLS = [
  "/vendor/simplebar/simplebar.min.css?v=1",
  "/brand.css?v=3",
  "/styles.css?v=122",
  "/pass-ui.css?v=4",
  "/beta-experience.css?v=5",
  "/pass.css?v=6",
  "/admin.css?v=8",
  "/vendor/simplebar/simplebar.min.js?v=1",
  "/app.js?v=194",
  "/pass-ui.js?v=7",
  "/locale.js?v=8",
  "/pass.js?v=5",
  "/admin.js?v=8",
  "/beta-experience.js?v=9",
  "/pwa.js?v=1",
  "/candidateCards.js?v=3",
  "/actionBindings.js?v=2",
  "/worksheetBlueprint.js?v=6",
  "/mobilePreviewRenderer.js?v=10",
  "/canvasRenderer.js?v=2",
  "/manifest.webmanifest",
  "/icons/favicon.ico",
  "/icons/favicon-16x16.png",
  "/icons/favicon-32x32.png",
  "/icons/app-icon-180.png",
  "/icons/app-icon-192.png",
  "/icons/app-icon-512.png",
  "/icons/app-icon-maskable-512.png",
  "/icons/lucide-sprite.svg?v=17"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw new Error("SheetifyIMG app shell is unavailable.");
  }
}
