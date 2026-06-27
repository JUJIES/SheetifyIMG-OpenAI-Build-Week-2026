"use strict";

const params = new URLSearchParams(window.location.search);
const projectId = String(params.get("project") || "").trim();

function appTargetUrl() {
  const url = new URL("/", window.location.origin);
  if (projectId) {
    url.searchParams.set("project", projectId);
  }
  return url.toString();
}

function redirectToApp() {
  window.location.replace(appTargetUrl());
}

document.querySelector("#closePreviewButton")?.addEventListener("click", redirectToApp);
redirectToApp();
