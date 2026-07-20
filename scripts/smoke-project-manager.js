"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  createSingleWorksheetProject,
  listProjects,
  openProject
} = require("../core/projectManager");

const repoRoot = path.resolve(__dirname, "..");
const smokeRoot = path.join(repoRoot, "tmp", "project-manager-smoke");

async function main() {
  await fs.rm(smokeRoot, { recursive: true, force: true });
  await fs.mkdir(smokeRoot, { recursive: true });

  const options = {
    projectsDir: smokeRoot,
    now: "2026-06-18T00:00:00.000Z"
  };

  const single = await createSingleWorksheetProject({
    title: "Material für nächste Woche"
  }, options);
  assert.equal(single.projectType, "single_worksheet");
  assert.equal(single.status, "draft");
  assert.equal(single.subject, null);
  assert.equal(single.topic, null);
  assert.equal(single.targetGroup, null);
  assert.equal(single.conversationLocale, "de");

  const english = await createSingleWorksheetProject({
    title: "English conversation",
    conversationLocale: "en-US"
  }, {
    ...options,
    now: "2026-06-18T00:01:00.000Z"
  });
  assert.equal(english.conversationLocale, "en");

  const projects = await listProjects({ projectsDir: smokeRoot });
  assert.equal(projects.length, 2);

  const reopened = await openProject(single.projectId, { projectsDir: smokeRoot });
  assert.equal(reopened.title, "Material für nächste Woche");
  assert.equal(reopened.derivedStatus.hasDraftContent, false);
  assert.equal(reopened.derivedStatus.canGenerate, false);
  assert.equal(reopened.conversationLocale, "de");

  const reopenedEnglish = await openProject(english.projectId, { projectsDir: smokeRoot });
  assert.equal(reopenedEnglish.manifest.conversationLocale, "en");

  console.log(JSON.stringify({
    ok: true,
    projects: projects.map((project) => ({
      projectId: project.projectId,
      projectType: project.projectType,
      status: project.status
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
