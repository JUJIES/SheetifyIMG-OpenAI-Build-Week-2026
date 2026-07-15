"use strict";

const CACHE_NAME = "sheetifyimg-static-v58";
const APP_SHELL_URLS = [
  "/vendor/simplebar/simplebar.min.css?v=1",
  "/brand.css?v=1",
  "/styles.css?v=112",
  "/pass-ui.css?v=2",
  "/pass.css?v=3",
  "/admin.css?v=4",
  "/vendor/simplebar/simplebar.min.js?v=1",
  "/app.js?v=184",
  "/pass-ui.js?v=2",
  "/pass.js?v=2",
  "/admin.js?v=4",
  "/pwa.js?v=1",
  "/candidateCards.js?v=2",
  "/actionBindings.js?v=1",
  "/mobilePreviewRenderer.js?v=7",
  "/canvasRenderer.js?v=1",
  "/manifest.webmanifest",
  "/icons/favicon.ico",
  "/icons/favicon-16x16.png",
  "/icons/favicon-32x32.png",
  "/icons/app-icon-180.png",
  "/icons/app-icon-192.png",
  "/icons/app-icon-512.png",
  "/icons/app-icon-maskable-512.png",
  "/icons/lucide-sprite.svg?v=16"
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
    throw new Error("Sheetify IMG app shell is unavailable.");
  }
}
