"use strict";

(function registerSheetifyImgPwa() {
  const serviceWorkerSupported = "serviceWorker" in navigator;
  const host = window.location.hostname;
  const localhost = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

  if (!serviceWorkerSupported || (!window.isSecureContext && !localhost)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // Home-screen shortcuts should still open the server-backed app if registration is unavailable.
    });
  });
})();
