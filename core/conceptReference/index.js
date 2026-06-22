"use strict";

function parseVersionFromArtifactId(artifactId) {
  const match = String(artifactId || "").match(/(?:^|_)v(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function normalizeVersion(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function conceptLabel(reference = {}) {
  const version = normalizeVersion(reference.conceptVersion);
  return version ? `Konzept v${version}` : "Arbeitsblatt-Konzept";
}

function conceptReferenceFromSourceArtifacts(sourceArtifacts = {}) {
  const lessonbriefId = sourceArtifacts.lessonbriefId || sourceArtifacts.lessonBriefId || null;
  const contentMirrorId = sourceArtifacts.contentMirrorId || null;
  const conceptId = sourceArtifacts.conceptId || contentMirrorId || lessonbriefId || null;
  const conceptVersion = normalizeVersion(sourceArtifacts.conceptVersion)
    || parseVersionFromArtifactId(contentMirrorId)
    || parseVersionFromArtifactId(lessonbriefId)
    || parseVersionFromArtifactId(conceptId);

  return {
    conceptId,
    conceptVersion,
    lessonbriefId,
    contentMirrorId,
    label: conceptLabel({ conceptVersion })
  };
}

function normalizeConceptReference(reference = {}, fallbackSourceArtifacts = {}) {
  const sourceReference = conceptReferenceFromSourceArtifacts({
    ...fallbackSourceArtifacts,
    lessonbriefId: reference.lessonbriefId || reference.lessonBriefId || fallbackSourceArtifacts.lessonbriefId,
    contentMirrorId: reference.contentMirrorId || fallbackSourceArtifacts.contentMirrorId,
    conceptId: reference.conceptId || fallbackSourceArtifacts.conceptId,
    conceptVersion: reference.conceptVersion || fallbackSourceArtifacts.conceptVersion
  });
  const conceptId = reference.conceptId || sourceReference.conceptId || null;
  const conceptVersion = normalizeVersion(reference.conceptVersion)
    || sourceReference.conceptVersion
    || parseVersionFromArtifactId(conceptId);

  return {
    conceptId,
    conceptVersion,
    lessonbriefId: reference.lessonbriefId || reference.lessonBriefId || sourceReference.lessonbriefId,
    contentMirrorId: reference.contentMirrorId || sourceReference.contentMirrorId,
    label: reference.label || conceptLabel({ conceptVersion })
  };
}

function createdFromWithConcept(baseIds = [], concept = {}) {
  const ids = Array.isArray(baseIds) ? baseIds : [baseIds];
  return Array.from(new Set([
    ...ids,
    concept.conceptId,
    concept.contentMirrorId,
    concept.lessonbriefId
  ].filter(Boolean)));
}

module.exports = {
  conceptLabel,
  conceptReferenceFromSourceArtifacts,
  createdFromWithConcept,
  normalizeConceptReference,
  parseVersionFromArtifactId
};
