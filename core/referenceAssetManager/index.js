"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { EVENT_TYPES } = require("../contracts");
const { appendEvent } = require("../eventLog");
const { writeCoordinateReferencePng } = require("../coordinateReferenceManager");
const { defaultQrContent, writeQrPng } = require("../qrCodeManager");
const { downloadWikimediaReference } = require("../webReferenceSearchManager");

const APP_TEMPLATE_REFERENCES_ENABLED = false;

const PNG_COLOR = Object.freeze({
  white: [255, 255, 255, 255],
  black: [17, 24, 39, 255],
  gray: [156, 163, 175, 255],
  blue: [37, 99, 235, 255],
  paleBlue: [239, 246, 255, 255],
  amber: [245, 158, 11, 255],
  paleAmber: [254, 243, 199, 255]
});

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function clean(value) {
  return String(value || "").trim();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSourceManifest(projectDir) {
  try {
    return await readJson(path.join(projectDir, "source", "source-manifest.json"));
  } catch {
    return { files: [] };
  }
}

function latestSourceImage(sourceManifest = {}, requestedPath = "") {
  const files = Array.isArray(sourceManifest.files) ? sourceManifest.files : [];
  const imageFiles = files.filter((file) => String(file.mimeType || "").startsWith("image/") && file.path);
  if (requestedPath) {
    return imageFiles.find((file) => file.path === requestedPath) || null;
  }
  return imageFiles[imageFiles.length - 1] || null;
}

async function proposalById(projectDir, proposalId) {
  const proposalsDir = path.join(projectDir, "proposals");
  const files = await fs.readdir(proposalsDir);
  const fileName = files.find((entry) => entry.startsWith(`${proposalId}.`) && entry.endsWith(".json"));
  if (!fileName) {
    throw new Error(`Bildplanung nicht gefunden: ${proposalId}`);
  }
  const filePath = path.join(proposalsDir, fileName);
  return {
    filePath,
    proposal: await readJson(filePath)
  };
}

async function latestImageSpecProposal(projectDir) {
  const proposalsDir = path.join(projectDir, "proposals");
  if (!(await pathExists(proposalsDir))) {
    return null;
  }
  const files = (await fs.readdir(proposalsDir))
    .filter((entry) => entry.endsWith(".image_spec.json"))
    .sort();
  const proposals = [];
  for (const fileName of files) {
    const filePath = path.join(proposalsDir, fileName);
    const proposal = await readJson(filePath);
    if (proposal.kind === "image_spec" && (proposal.status === "proposed" || proposal.status === "adopted")) {
      proposals.push({ filePath, proposal });
    }
  }
  return proposals
    .sort((left, right) => String(right.proposal.createdAt || "").localeCompare(String(left.proposal.createdAt || "")))[0] || null;
}

function svgPage({ body, width = 1120, height = 1584 }) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    body,
    "</svg>"
  ].join("\n");
}

function coordinateTemplateSvg() {
  const width = 1120;
  const height = 1584;
  const margin = 116;
  const gridSize = 888;
  const left = Math.round((width - gridSize) / 2);
  const top = 260;
  const step = gridSize / 8;
  const axis = left + gridSize / 2;
  const yAxis = top + gridSize / 2;
  const lines = [];
  lines.push(`<text x="${width / 2}" y="116" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#111827">Koordinatensystem-Vorlage</text>`);
  lines.push(`<text x="${width / 2}" y="168" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#4b5563">A4 Hochformat · Raster -4 bis 4 · y-Achse als Spiegelachse</text>`);
  lines.push(`<rect x="${left}" y="${top}" width="${gridSize}" height="${gridSize}" fill="#ffffff" stroke="#111827" stroke-width="3"/>`);
  for (let index = 0; index <= 8; index += 1) {
    const x = left + index * step;
    const y = top + index * step;
    const value = index - 4;
    const isAxisX = Math.abs(x - axis) < 0.01;
    const isAxisY = Math.abs(y - yAxis) < 0.01;
    lines.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + gridSize}" stroke="${isAxisX ? "#111827" : "#9ca3af"}" stroke-width="${isAxisX ? 5 : 1.4}" ${isAxisX ? 'stroke-dasharray="18 12"' : ""}/>`);
    lines.push(`<line x1="${left}" y1="${y}" x2="${left + gridSize}" y2="${y}" stroke="${isAxisY ? "#111827" : "#9ca3af"}" stroke-width="${isAxisY ? 5 : 1.4}"/>`);
    if (value !== 0) {
      lines.push(`<text x="${x}" y="${yAxis + 42}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#111827">${value}</text>`);
      lines.push(`<text x="${axis - 32}" y="${y + 10}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#111827">${-value}</text>`);
    }
  }
  lines.push(`<text x="${axis - 18}" y="${yAxis + 42}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#111827">0</text>`);
  lines.push(`<text x="${left + gridSize + 34}" y="${yAxis + 10}" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#111827">x</text>`);
  lines.push(`<text x="${axis - 10}" y="${top - 24}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#111827">y</text>`);
  lines.push(`<rect x="${margin}" y="1230" width="${width - 2 * margin}" height="180" rx="22" fill="#f8fafc" stroke="#cbd5e1" stroke-width="3"/>`);
  lines.push(`<text x="${margin + 32}" y="1290" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#111827">Hinweis fuer das Bildmodell</text>`);
  lines.push(`<text x="${margin + 32}" y="1342" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#334155">Raster, Achsen, Ursprung und Zahlenlogik aus dieser Vorlage uebernehmen.</text>`);
  return svgPage({ body: lines.join("\n"), width, height });
}

function qrPlaceholderSvg() {
  const width = 1120;
  const height = 1584;
  const box = 420;
  const left = (width - box) / 2;
  const top = 440;
  const cells = 9;
  const step = box / cells;
  const darkCells = new Set([
    "0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2",
    "6,0", "7,0", "8,0", "6,1", "8,1", "6,2", "7,2", "8,2",
    "0,6", "1,6", "2,6", "0,7", "2,7", "0,8", "1,8", "2,8",
    "4,3", "5,4", "3,5", "6,6", "4,7", "7,4", "5,8"
  ]);
  const lines = [];
  lines.push(`<text x="${width / 2}" y="180" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#111827">QR-Code-Referenz</text>`);
  lines.push(`<text x="${width / 2}" y="232" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="25" fill="#4b5563">Echter QR-Code wird deterministisch erzeugt und nach der Bildgenerierung gescannt.</text>`);
  lines.push(`<rect x="${left - 28}" y="${top - 28}" width="${box + 56}" height="${box + 56}" rx="28" fill="#ffffff" stroke="#111827" stroke-width="5"/>`);
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      if (darkCells.has(`${x},${y}`)) {
        lines.push(`<rect x="${left + x * step}" y="${top + y * step}" width="${step}" height="${step}" fill="#111827"/>`);
      }
    }
  }
  lines.push(`<rect x="150" y="1030" width="820" height="210" rx="28" fill="#fef3c7" stroke="#f59e0b" stroke-width="4"/>`);
  lines.push(`<text x="${width / 2}" y="1110" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="31" font-weight="700" fill="#92400e">Benchmark: Scanbarkeit pruefen</text>`);
  lines.push(`<text x="${width / 2}" y="1164" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="25" fill="#92400e">Das Bildmodell soll den echten PNG-Code moeglichst unveraendert uebernehmen.</text>`);
  return svgPage({ body: lines.join("\n"), width, height });
}

function crc32(buffers) {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32([typeBuffer, data]), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPngCanvas(width, height, fill = PNG_COLOR.white) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = fill[0];
    pixels[index + 1] = fill[1];
    pixels[index + 2] = fill[2];
    pixels[index + 3] = fill[3];
  }
  return {
    width,
    height,
    pixels
  };
}

function fillRect(canvas, x, y, width, height, color) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(canvas.width, Math.ceil(x + width));
  const endY = Math.min(canvas.height, Math.ceil(y + height));
  for (let yy = startY; yy < endY; yy += 1) {
    for (let xx = startX; xx < endX; xx += 1) {
      const index = (yy * canvas.width + xx) * 4;
      canvas.pixels[index] = color[0];
      canvas.pixels[index + 1] = color[1];
      canvas.pixels[index + 2] = color[2];
      canvas.pixels[index + 3] = color[3];
    }
  }
}

function strokeRect(canvas, x, y, width, height, color, thickness = 1) {
  fillRect(canvas, x, y, width, thickness, color);
  fillRect(canvas, x, y + height - thickness, width, thickness, color);
  fillRect(canvas, x, y, thickness, height, color);
  fillRect(canvas, x + width - thickness, y, thickness, height, color);
}

function writePng(canvas) {
  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    const rawOffset = y * (canvas.width * 4 + 1);
    raw[rawOffset] = 0;
    canvas.pixels.copy(raw, rawOffset + 1, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND")
  ]);
}

function coordinateTemplatePng() {
  const canvas = createPngCanvas(1120, 1584, PNG_COLOR.white);
  const left = 116;
  const top = 260;
  const gridSize = 888;
  const step = gridSize / 8;
  const axis = left + gridSize / 2;
  const yAxis = top + gridSize / 2;
  fillRect(canvas, 116, 100, 888, 72, PNG_COLOR.paleBlue);
  strokeRect(canvas, 116, 100, 888, 72, PNG_COLOR.blue, 4);
  fillRect(canvas, left, top, gridSize, gridSize, PNG_COLOR.white);
  strokeRect(canvas, left, top, gridSize, gridSize, PNG_COLOR.black, 4);
  for (let index = 0; index <= 8; index += 1) {
    const x = Math.round(left + index * step);
    const y = Math.round(top + index * step);
    fillRect(canvas, x - 1, top, 2, gridSize, PNG_COLOR.gray);
    fillRect(canvas, left, y - 1, gridSize, 2, PNG_COLOR.gray);
    fillRect(canvas, x - 6, yAxis - 6, 12, 12, PNG_COLOR.black);
    fillRect(canvas, axis - 6, y - 6, 12, 12, PNG_COLOR.black);
  }
  fillRect(canvas, axis - 3, top, 6, gridSize, PNG_COLOR.black);
  fillRect(canvas, left, yAxis - 3, gridSize, 6, PNG_COLOR.black);
  for (let y = top; y < top + gridSize; y += 44) {
    fillRect(canvas, axis - 3, y, 6, 22, PNG_COLOR.white);
  }
  fillRect(canvas, 116, 1230, 888, 180, PNG_COLOR.paleBlue);
  strokeRect(canvas, 116, 1230, 888, 180, PNG_COLOR.blue, 4);
  return writePng(canvas);
}

function qrPlaceholderPng() {
  const canvas = createPngCanvas(1120, 1584, PNG_COLOR.white);
  const box = 420;
  const left = 350;
  const top = 440;
  const step = Math.floor(box / 9);
  const darkCells = new Set([
    "0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2",
    "6,0", "7,0", "8,0", "6,1", "8,1", "6,2", "7,2", "8,2",
    "0,6", "1,6", "2,6", "0,7", "2,7", "0,8", "1,8", "2,8",
    "4,3", "5,4", "3,5", "6,6", "4,7", "7,4", "5,8"
  ]);
  fillRect(canvas, 150, 170, 820, 92, PNG_COLOR.paleAmber);
  strokeRect(canvas, 150, 170, 820, 92, PNG_COLOR.amber, 4);
  strokeRect(canvas, left - 28, top - 28, box + 56, box + 56, PNG_COLOR.black, 6);
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if (darkCells.has(`${x},${y}`)) {
        fillRect(canvas, left + x * step, top + y * step, step, step, PNG_COLOR.black);
      }
    }
  }
  fillRect(canvas, 150, 1030, 820, 210, PNG_COLOR.paleAmber);
  strokeRect(canvas, 150, 1030, 820, 210, PNG_COLOR.amber, 5);
  return writePng(canvas);
}

async function renderTemplatePng(policy, pngPath, options = {}) {
  if (policy.category === "code_asset") {
    const qrContent = defaultQrContent(options);
    return writeQrPng(pngPath, qrContent, {
      errorCorrectionLevel: "H",
      scale: 14,
      margin: 4
    });
  }
  if (policy.category === "coordinate_template" && options.coordinatePlan) {
    return writeCoordinateReferencePng(pngPath, options.coordinatePlan);
  }
  const buffer = coordinateTemplatePng();
  await fs.writeFile(pngPath, buffer);
  return null;
}

function referenceRoleForPolicy(policy = {}) {
  if (policy.category === "factual_map") {
    return "content_reference";
  }
  if (policy.category === "coordinate_template") {
    return "coordinate_template_reference";
  }
  if (policy.category === "code_asset") {
    return "exact_qr_reference";
  }
  if (policy.category === "exact_structure") {
    return "layout_reference";
  }
  if (policy.category === "local_visual_reference") {
    return "style_reference";
  }
  return "content_reference";
}

function defaultWebReferenceQuery(policy = {}, imageSpec = {}, input = {}) {
  return clean(input.query)
    || clean(policy.suggestedSearchQuery)
    || clean(imageSpec.topic && `${imageSpec.topic} Wikimedia Commons`)
    || "Unterricht Bildreferenz Wikimedia Commons";
}

function appTemplateReferenceEnabled(policy = {}) {
  return APP_TEMPLATE_REFERENCES_ENABLED
    && ["coordinate_template", "code_asset"].includes(policy.category)
    && policy.preferredSource === "app_template";
}

function appendReference(existing = [], reference) {
  const seen = new Set();
  return [...(Array.isArray(existing) ? existing : []), reference]
    .filter((entry) => entry?.path)
    .filter((entry) => {
      if (seen.has(entry.path)) {
        return false;
      }
      seen.add(entry.path);
      return true;
    })
    .slice(-4)
    .map((entry, index) => ({
      id: entry.id || `ref_${String(index + 1).padStart(2, "0")}`,
      role: entry.role || "style_reference",
      path: entry.path,
      purpose: entry.purpose || "Referenzbild",
      source: entry.source || null,
      scope: entry.scope || "next_candidate"
    }));
}

async function createAppTemplate(projectDir, policy, options = {}) {
  const now = options.now || new Date().toISOString();
  const id = `reference_${String(now).replace(/[^0-9a-z]/gi, "").slice(0, 15)}_${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(projectDir, "references", id);
  const baseName = policy.category === "code_asset" ? "qr-code-reference" : "coordinate-template";
  const svgPath = path.join(dir, `${baseName}.svg`);
  const pngPath = path.join(dir, `${baseName}.png`);
  const svg = policy.category === "code_asset" ? qrPlaceholderSvg() : coordinateTemplateSvg();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(svgPath, svg, "utf8");
  const templateMeta = await renderTemplatePng(policy, pngPath, options);
  const relativePng = toPosix(path.relative(projectDir, pngPath));
  const manifest = {
    schemaVersion: 1,
    id,
    kind: "reference_template",
    category: policy.category,
    createdAt: now,
    svgPath: toPosix(path.relative(projectDir, svgPath)),
    pngPath: relativePng,
    qrContent: templateMeta?.content || null,
    coordinatePlan: templateMeta?.plan || null,
    note: policy.category === "code_asset"
      ? "Echter QR-Code als Bildmodell-Referenz und Benchmark. Nach der Entwurfserstellung muss die Ausgabe gescannt werden."
      : "Koordinatensystem-Vorlage fuer Bildmodell-Referenz."
  };
  await writeJson(path.join(dir, "reference-manifest.json"), manifest);
  return {
    id,
    path: relativePng,
    role: referenceRoleForPolicy(policy),
    purpose: policy.category === "code_asset"
      ? "Echten QR-Code moeglichst exakt und scanbar uebernehmen"
      : "App-Vorlage fuer Koordinatensystem, Achsen und Raster",
    source: {
      kind: "app_template",
      manifestPath: toPosix(path.relative(projectDir, path.join(dir, "reference-manifest.json"))),
      ...(templateMeta?.content ? { qrContent: templateMeta.content } : {})
    },
    scope: "next_candidate"
  };
}

async function prepareReferenceAsset(projectDir, input = {}, options = {}) {
  const now = input.now || options.now || new Date().toISOString();
  const target = input.proposalId
    ? await proposalById(projectDir, input.proposalId)
    : await latestImageSpecProposal(projectDir);
  if (!target?.proposal) {
    throw new Error("Es gibt noch keine Bildplanung fuer eine Referenz.");
  }
  const proposal = target.proposal;
  const imageSpec = proposal.data || {};
  const policy = imageSpec.referencePolicy || {};
  if (!policy.level || policy.level === "none") {
    throw new Error("Diese Visualisierung braucht aktuell keine spezielle Referenz.");
  }

  let reference;
  if (appTemplateReferenceEnabled(policy)) {
    reference = await createAppTemplate(projectDir, policy, {
      now,
      projectId: path.basename(projectDir),
      proposalId: proposal.proposalId,
      qrContent: input.qrContent || input.url || input.content,
      coordinatePlan: input.coordinatePlan || null
    });
  } else {
    const sourceManifest = await readSourceManifest(projectDir);
    const sourceImage = latestSourceImage(sourceManifest, input.sourcePath);
    if (!sourceImage) {
      throw new Error("Bitte zuerst ein passendes Referenzbild als Input hochladen.");
    }
    reference = {
      id: `ref_input_${crypto.randomUUID().slice(0, 8)}`,
      role: referenceRoleForPolicy(policy),
      path: sourceImage.path,
      purpose: clean(input.purpose) || policy.suggestedAction || "Referenzbild aus dem Input",
      source: {
        kind: "input_upload",
        originalName: sourceImage.originalName || null,
        mimeType: sourceImage.mimeType || null,
        artifactId: sourceImage.artifactId || null
      },
      scope: "next_candidate"
    };
  }

  const referenceImages = appendReference(imageSpec.referenceImages, reference);
  const nextPolicy = {
    ...policy,
    isSatisfied: true,
    preparedReferencePath: reference.path,
    preparedAt: now
  };
  const nextProposal = {
    ...proposal,
    data: {
      ...imageSpec,
      referenceImages,
      referencePolicy: nextPolicy
    }
  };
  await writeJson(target.filePath, nextProposal);

  const message = policy.category === "factual_map"
    ? "Ich habe das hochgeladene Bild als Kartenreferenz übernommen. Die Bildgenerierung soll sich daran für Umrisse, Stadtlagen und räumliche Logik orientieren."
    : policy.category === "code_asset"
      ? "Ich habe einen echten QR-Code deterministisch erzeugt und als Referenz für den nächsten Entwurf bereitgelegt. Nach der Bildgenerierung prüfen wir, ob der QR-Code im fertigen Entwurf noch scanbar ist."
      : "Ich habe eine App-Vorlage als Referenz für den nächsten Entwurf bereitgelegt. Die Bildgenerierung kann sie für Raster, Aufbau oder Fachstruktur nutzen.";
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "entwuerfe",
    payload: {
      mode: "reference_asset",
      message,
      suggestedActions: []
    }
  }, { now });

  return {
    proposalId: proposal.proposalId,
    proposalStatus: proposal.status,
    reference,
    referencePolicy: nextPolicy,
    referenceImages
  };
}

async function prepareWebReferenceAsset(projectDir, input = {}, options = {}) {
  const now = input.now || options.now || new Date().toISOString();
  const target = input.proposalId
    ? await proposalById(projectDir, input.proposalId)
    : await latestImageSpecProposal(projectDir);
  if (!target?.proposal) {
    throw new Error("Es gibt noch keine Bildplanung fuer eine Webreferenz.");
  }
  const proposal = target.proposal;
  const imageSpec = proposal.data || {};
  const policy = imageSpec.referencePolicy || {};
  if (!policy.level || policy.level === "none") {
    throw new Error("Diese Visualisierung braucht aktuell keine spezielle Webreferenz.");
  }
  const query = defaultWebReferenceQuery(policy, imageSpec, input);
  const webReference = await downloadWikimediaReference(projectDir, {
    query,
    limit: input.limit || 8,
    width: input.width || 1400
  }, {
    now
  });
  const reference = {
    id: webReference.id,
    role: input.role || referenceRoleForPolicy(policy),
    path: webReference.path,
    purpose: clean(input.purpose) || policy.suggestedAction || "Offen lizenzierte Webreferenz",
    source: {
      kind: "web_reference",
      provider: "wikimedia_commons",
      query,
      manifestPath: webReference.manifestPath,
      title: webReference.selected.title,
      pageUrl: webReference.selected.pageUrl,
      license: webReference.selected.license,
      licenseUrl: webReference.selected.licenseUrl,
      artist: webReference.selected.artist
    },
    scope: "next_candidate"
  };
  const referenceImages = appendReference(imageSpec.referenceImages, reference);
  const nextPolicy = {
    ...policy,
    isSatisfied: true,
    preparedReferencePath: reference.path,
    preparedAt: now,
    webReferenceQuery: query
  };
  const nextProposal = {
    ...proposal,
    data: {
      ...imageSpec,
      referenceImages,
      referencePolicy: nextPolicy
    }
  };
  await writeJson(target.filePath, nextProposal);
  await appendEvent(projectDir, {
    type: EVENT_TYPES.ASSISTANT_MESSAGE,
    createdAt: now,
    step: "entwuerfe",
    payload: {
      mode: "reference_asset",
      message: `Ich habe eine offene Webreferenz aus Wikimedia Commons geladen und als Bildreferenz angehängt. Für die Generierung nutze ich sie nur für Stil, Form und Ortsanmutung; die neue Fake-Beschriftung kommt aus deinem Arbeitsblatt-Konzept.`,
      suggestedActions: []
    }
  }, { now });
  return {
    proposalId: proposal.proposalId,
    proposalStatus: proposal.status,
    reference,
    referencePolicy: nextPolicy,
    referenceImages,
    query
  };
}

module.exports = {
  prepareReferenceAsset,
  prepareWebReferenceAsset
};
