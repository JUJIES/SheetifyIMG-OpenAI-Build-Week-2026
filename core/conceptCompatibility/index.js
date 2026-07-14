"use strict";

function textValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function textList(value) {
  return (Array.isArray(value) ? value : [])
    .map(textValue)
    .filter(Boolean);
}

function normalizeConceptFrame(value = {}, project = {}) {
  const frame = {
    subject: textValue(value.subject) || textValue(project.subject),
    topic: textValue(value.topic) || textValue(project.topic) || textValue(project.title),
    targetGroup: textValue(value.targetGroup) || textValue(project.targetGroup) || textValue(project.manifest?.targetGroup),
    goal: textValue(value.goal) || "Die Lernenden bearbeiten das Arbeitsblatt fachlich nachvollziehbar.",
    requirements: textList(value.requirements),
    teacherNotes: textList(value.teacherNotes),
    visualStyle: textValue(value.visualStyle) || "klar"
  };
  if (!frame.topic || !frame.goal) {
    throw new Error("Unified concept frame is missing topic or goal.");
  }
  return frame;
}

function legacyLessonBriefFromConcept(frameInput = {}, content = {}, project = {}) {
  const frame = normalizeConceptFrame(frameInput, project);
  const outputPreference = content.outputPreference || {};
  return {
    subject: frame.subject,
    topic: frame.topic,
    targetGroup: frame.targetGroup,
    goal: frame.goal,
    requirements: frame.requirements,
    teacherNotes: frame.teacherNotes,
    outputPreference: {
      format: "A4",
      pages: Number(outputPreference.pages) > 0 ? Number(outputPreference.pages) : null,
      layout: textValue(outputPreference.layout) || "auto",
      style: frame.visualStyle
    },
    compatibility: {
      kind: "unified_concept_projection",
      canonicalArtifact: "content_mirror"
    }
  };
}

function conceptFrameFromLegacy(brief = {}, project = {}) {
  return normalizeConceptFrame({
    subject: brief.subject,
    topic: brief.topic,
    targetGroup: brief.targetGroup,
    goal: brief.goal,
    requirements: brief.requirements,
    teacherNotes: brief.teacherNotes,
    visualStyle: brief.outputPreference?.style
  }, project);
}

function teachingFieldValue(teachingContext = {}, id) {
  const field = teachingContext.fields?.[id] || null;
  return field?.value && ["known", "partial", "assumed"].includes(field.status)
    ? textValue(field.value)
    : null;
}

function conceptFrameFromTeachingContext(teachingContext = {}, fallbackInput = {}, project = {}) {
  const fallback = normalizeConceptFrame(fallbackInput, project);
  const worksheetType = teachingFieldValue(teachingContext, "worksheetType");
  const specialRequirements = teachingFieldValue(teachingContext, "specialRequirements");
  const requirements = [
    ...fallback.requirements,
    ...(worksheetType ? [`Arbeitsblatt-Typ: ${worksheetType}`] : []),
    ...(specialRequirements ? [specialRequirements] : [])
  ];
  return normalizeConceptFrame({
    ...fallback,
    topic: teachingFieldValue(teachingContext, "topic") || fallback.topic,
    targetGroup: teachingFieldValue(teachingContext, "targetGroup") || fallback.targetGroup,
    goal: teachingFieldValue(teachingContext, "lessonGoal") || fallback.goal,
    requirements: [...new Set(requirements)]
  }, project);
}

module.exports = {
  conceptFrameFromLegacy,
  conceptFrameFromTeachingContext,
  legacyLessonBriefFromConcept,
  normalizeConceptFrame
};
