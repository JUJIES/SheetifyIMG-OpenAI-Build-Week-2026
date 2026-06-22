"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "SheetifyIMG/0.1 reference-search (local development)";

function clean(value) {
  return String(value || "").trim();
}

function toPosix(value) {
  return String(value || "").split(path.sep).join("/");
}

function extFromMime(mime = "") {
  if (/png/i.test(mime)) {
    return ".png";
  }
  if (/webp/i.test(mime)) {
    return ".webp";
  }
  return ".jpg";
}

function metadataValue(metadata = {}, key) {
  return clean(metadata?.[key]?.value).replace(/<[^>]+>/g, "");
}

function licenseRank(image = {}) {
  const license = `${image.license || ""} ${image.licenseUrl || ""}`.toLowerCase();
  if (license.includes("cc0") || license.includes("public domain")) {
    return 0;
  }
  if (license.includes("cc-by")) {
    return 1;
  }
  if (license.includes("gfdl")) {
    return 2;
  }
  return 5;
}

function imageFromPage(page = {}) {
  const info = page.imageinfo?.[0] || {};
  const metadata = info.extmetadata || {};
  const mime = clean(info.mime);
  if (!mime.startsWith("image/") || !info.url) {
    return null;
  }
  return {
    title: page.title,
    pageUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || "")}`,
    fileUrl: info.thumburl || info.url,
    originalUrl: info.url,
    mimeType: mime,
    width: info.thumbwidth || info.width || null,
    height: info.thumbheight || info.height || null,
    license: metadataValue(metadata, "LicenseShortName"),
    licenseUrl: metadataValue(metadata, "LicenseUrl"),
    credit: metadataValue(metadata, "Credit"),
    artist: metadataValue(metadata, "Artist")
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept": "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Wikimedia search failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function searchWikimediaImages(query, options = {}) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: clean(query),
    gsrlimit: String(options.limit || 8),
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: String(options.width || 1400)
  });
  const json = await fetchJson(`${COMMONS_API}?${params.toString()}`);
  const images = Object.values(json.query?.pages || {})
    .map(imageFromPage)
    .filter(Boolean)
    .sort((left, right) => {
      return licenseRank(left) - licenseRank(right)
        || String(left.title || "").localeCompare(String(right.title || ""));
    });
  return images;
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept": "image/*"
    }
  });
  if (!response.ok) {
    throw new Error(`Reference image download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function downloadWikimediaReference(projectDir, input = {}, options = {}) {
  const query = clean(input.query);
  if (!query) {
    throw new Error("Webreferenz braucht eine Suchanfrage.");
  }
  const images = await searchWikimediaImages(query, {
    limit: input.limit || options.limit || 8,
    width: input.width || options.width || 1400
  });
  const selected = images.find((image) => licenseRank(image) <= 1) || images[0] || null;
  if (!selected) {
    throw new Error(`Keine passende Wikimedia-Bildreferenz gefunden: ${query}`);
  }

  const now = options.now || new Date().toISOString();
  const id = `web_reference_${String(now).replace(/[^0-9a-z]/gi, "").slice(0, 15)}_${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(projectDir, "references", id);
  await fs.mkdir(dir, { recursive: true });
  const ext = extFromMime(selected.mimeType);
  const relativeImagePath = toPosix(path.join("references", id, `source${ext}`));
  const imagePath = path.join(projectDir, relativeImagePath);
  const buffer = await downloadImage(selected.fileUrl);
  await fs.writeFile(imagePath, buffer);

  const manifest = {
    schemaVersion: 1,
    id,
    kind: "web_reference",
    createdAt: now,
    query,
    source: {
      provider: "wikimedia_commons",
      title: selected.title,
      pageUrl: selected.pageUrl,
      fileUrl: selected.fileUrl,
      originalUrl: selected.originalUrl,
      mimeType: selected.mimeType,
      license: selected.license,
      licenseUrl: selected.licenseUrl,
      credit: selected.credit,
      artist: selected.artist
    },
    imagePath: relativeImagePath
  };
  const manifestPath = path.join(dir, "reference-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    id,
    path: relativeImagePath,
    manifestPath: toPosix(path.relative(projectDir, manifestPath)),
    selected,
    query
  };
}

module.exports = {
  downloadWikimediaReference,
  searchWikimediaImages
};
