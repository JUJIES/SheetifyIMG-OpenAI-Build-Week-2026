"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const A4 = Object.freeze({
  width: 595.28,
  height: 841.89
});
const MM_TO_POINTS = 72 / 25.4;
const DEFAULT_PRINT_SAFE_MARGIN_MM = 6;

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
}

function readPngChunks(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("PNG-Datei ist ungueltig.");
  }
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += length + 12;
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterPngScanlines(data, width, height, bytesPerPixel) {
  const rowLength = width * bytesPerPixel;
  const output = Buffer.alloc(rowLength * height);
  let inputOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = data[inputOffset];
    inputOffset += 1;
    const rowStart = row * rowLength;
    const previousRowStart = rowStart - rowLength;

    for (let col = 0; col < rowLength; col += 1) {
      const raw = data[inputOffset + col];
      const left = col >= bytesPerPixel ? output[rowStart + col - bytesPerPixel] : 0;
      const above = row > 0 ? output[previousRowStart + col] : 0;
      const upperLeft = row > 0 && col >= bytesPerPixel ? output[previousRowStart + col - bytesPerPixel] : 0;
      let value;

      if (filter === 0) {
        value = raw;
      } else if (filter === 1) {
        value = raw + left;
      } else if (filter === 2) {
        value = raw + above;
      } else if (filter === 3) {
        value = raw + Math.floor((left + above) / 2);
      } else if (filter === 4) {
        value = raw + paethPredictor(left, above, upperLeft);
      } else {
        throw new Error(`PNG-Filter wird nicht unterstuetzt: ${filter}`);
      }
      output[rowStart + col] = value & 0xff;
    }
    inputOffset += rowLength;
  }

  return output;
}

function pngImage(buffer) {
  const chunks = readPngChunks(buffer);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (!ihdr) {
    throw new Error("PNG-Datei enthaelt keinen IHDR-Block.");
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error("PDF-Export unterstuetzt aktuell nur nicht-interlaced PNGs mit 8 Bit Farbtiefe.");
  }

  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  if (colorType === 2) {
    return {
      width,
      height,
      colorSpace: "/DeviceRGB",
      bitsPerComponent: 8,
      filters: "/FlateDecode",
      decodeParms: `<< /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${width} >>`,
      data: idat
    };
  }
  if (colorType === 0) {
    return {
      width,
      height,
      colorSpace: "/DeviceGray",
      bitsPerComponent: 8,
      filters: "/FlateDecode",
      decodeParms: `<< /Predictor 15 /Colors 1 /BitsPerComponent 8 /Columns ${width} >>`,
      data: idat
    };
  }
  if (colorType === 6) {
    const rgba = unfilterPngScanlines(zlib.inflateSync(idat), width, height, 4);
    const rgb = Buffer.alloc(width * height * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
      rgb[target] = rgba[source];
      rgb[target + 1] = rgba[source + 1];
      rgb[target + 2] = rgba[source + 2];
    }
    return {
      width,
      height,
      colorSpace: "/DeviceRGB",
      bitsPerComponent: 8,
      filters: "/FlateDecode",
      decodeParms: null,
      data: zlib.deflateSync(rgb)
    };
  }

  throw new Error(`PNG-Farbtyp wird fuer PDF noch nicht unterstuetzt: ${colorType}`);
}

function jpegImage(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("JPEG-Datei ist ungueltig.");
  }
  let offset = 2;
  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) {
      offset += 1;
    }
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    const length = buffer.readUInt16BE(offset);
    const isStartOfFrame = [
      0xc0, 0xc1, 0xc2, 0xc3,
      0xc5, 0xc6, 0xc7,
      0xc9, 0xca, 0xcb,
      0xcd, 0xce, 0xcf
    ].includes(marker);
    if (isStartOfFrame) {
      const bitsPerComponent = buffer[offset + 2];
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      const components = buffer[offset + 7];
      return {
        width,
        height,
        colorSpace: components === 1 ? "/DeviceGray" : components === 4 ? "/DeviceCMYK" : "/DeviceRGB",
        bitsPerComponent,
        filters: "/DCTDecode",
        decodeParms: null,
        data: buffer
      };
    }
    offset += length;
  }
  throw new Error("JPEG-Groesse konnte nicht gelesen werden.");
}

function imageForFile(filePath, buffer) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") {
    return pngImage(buffer);
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return jpegImage(buffer);
  }
  throw new Error(`PDF-Export unterstuetzt aktuell PNG und JPEG: ${path.basename(filePath)}`);
}

function normalizePrintSafeMarginMm(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const margin = Number(value);
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error("PDF printSafeMarginMm muss eine Zahl groesser oder gleich 0 sein.");
  }
  return margin;
}

function contentBoxForPage(page = A4, options = {}) {
  const margin = normalizePrintSafeMarginMm(options.printSafeMarginMm) * MM_TO_POINTS;
  const width = page.width - (margin * 2);
  const height = page.height - (margin * 2);
  if (width <= 0 || height <= 0) {
    throw new Error("PDF printSafeMarginMm ist groesser als die A4-Seite.");
  }
  return {
    x: margin,
    y: margin,
    width,
    height
  };
}

function fitOnPage(image, page = A4, options = {}) {
  const box = contentBoxForPage(page, options);
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: box.x + ((box.width - width) / 2),
    y: box.y + ((box.height - height) / 2),
    width,
    height
  };
}

function streamObject(dictionary, data) {
  return Buffer.concat([
    toBuffer(`${dictionary}\nstream\n`),
    data,
    toBuffer("\nendstream")
  ]);
}

function number(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, "");
}

function pdfText(value) {
  return String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "-");
}

function pdfString(value) {
  return `(${pdfText(value).replace(/[\\()]/g, "\\$&")})`;
}

function wrapText(value, maxLength = 92) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function textPageContent(page) {
  const commands = [];
  let y = A4.height - 54;

  function writeLine(text, size = 10, gap = 15) {
    if (y < 54) {
      return;
    }
    commands.push(`BT /F1 ${number(size)} Tf 54 ${number(y)} Td ${pdfString(text)} Tj ET`);
    y -= gap;
  }

  writeLine(page.title || "Lösungsteil", 18, 24);
  commands.push(`0.75 G 54 ${number(y + 7)} m 541 ${number(y + 7)} l S 0 G`);
  for (const section of page.sections || []) {
    if (section.title) {
      y -= 6;
      writeLine(section.title, 13, 18);
    }
    for (const item of section.items || []) {
      const prefix = item.label ? `${item.label}: ` : "";
      const lines = wrapText(`${prefix}${item.text || ""}`, item.label ? 88 : 94);
      lines.forEach((line, index) => writeLine(index === 0 ? line : `  ${line}`, 10, 14));
      y -= 5;
    }
  }
  return commands.join("\n");
}

function buildPdf(pages, options = {}) {
  const title = String(options.title || "Arbeitsblatt Export").replace(/[()\\]/g, "");
  const objects = [null];

  function addObject(body) {
    const id = objects.length;
    objects.push(toBuffer(body));
    return id;
  }

  function reserveObject() {
    const id = objects.length;
    objects.push(null);
    return id;
  }

  function setObject(id, body) {
    objects[id] = toBuffer(body);
  }

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = reserveObject();
  const pageObjectIds = [];
  const hasTextPages = pages.some((page) => page.kind === "text");
  const fontId = hasTextPages
    ? addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    : null;

  pages.forEach((page, index) => {
    const pageObjectId = reserveObject();
    pageObjectIds.push(pageObjectId);

    if (page.kind === "text") {
      const content = textPageContent(page);
      const contentBuffer = Buffer.from(content, "latin1");
      const contentObjectId = addObject(streamObject(`<< /Length ${contentBuffer.length} >>`, contentBuffer));
      setObject(pageObjectId, [
        `<< /Type /Page /Parent ${pagesId} 0 R`,
        `/MediaBox [0 0 ${A4.width} ${A4.height}]`,
        `/Resources << /Font << /F1 ${fontId} 0 R >> >>`,
        `/Contents ${contentObjectId} 0 R >>`
      ].join(" "));
      return;
    }

    const image = page.image;
    const imageDictionary = [
      "<< /Type /XObject /Subtype /Image",
      `/Width ${image.width}`,
      `/Height ${image.height}`,
      `/ColorSpace ${image.colorSpace}`,
      `/BitsPerComponent ${image.bitsPerComponent}`,
      `/Filter ${image.filters}`,
      image.decodeParms ? `/DecodeParms ${image.decodeParms}` : "",
      `/Length ${image.data.length} >>`
    ].filter(Boolean).join(" ");
    const imageObjectId = addObject(streamObject(imageDictionary, image.data));

    const placement = fitOnPage(image, A4, {
      printSafeMarginMm: options.printSafeMarginMm
    });
    const content = [
      "q",
      `${number(placement.width)} 0 0 ${number(placement.height)} ${number(placement.x)} ${number(placement.y)} cm`,
      `/Im${index + 1} Do`,
      "Q"
    ].join("\n");
    const contentObjectId = addObject(streamObject(`<< /Length ${Buffer.byteLength(content)} >>`, Buffer.from(content)));

    setObject(pageObjectId, [
      `<< /Type /Page /Parent ${pagesId} 0 R`,
      `/MediaBox [0 0 ${A4.width} ${A4.height}]`,
      `/Resources << /XObject << /Im${index + 1} ${imageObjectId} 0 R >> >>`,
      `/Contents ${contentObjectId} 0 R >>`
    ].join(" "));
  });

  setObject(pagesId, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`);
  const infoId = addObject(`<< /Title (${title}) /Creator (SheetifyIMG) >>`);

  const fixedOffsets = [0];
  const fixedChunks = [Buffer.from("%PDF-1.7\n%\xff\xff\xff\xff\n", "binary")];
  let byteOffset = fixedChunks[0].length;
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) {
      throw new Error(`PDF object ${id} was not written.`);
    }
    fixedOffsets[id] = byteOffset;
    const objectChunk = Buffer.concat([
      toBuffer(`${id} 0 obj\n`),
      objects[id],
      toBuffer("\nendobj\n")
    ]);
    fixedChunks.push(objectChunk);
    byteOffset += objectChunk.length;
  }
  const xrefOffset = byteOffset;
  fixedChunks.push(toBuffer(`xref\n0 ${objects.length}\n`));
  fixedChunks.push(toBuffer("0000000000 65535 f \n"));
  for (let id = 1; id < objects.length; id += 1) {
    fixedChunks.push(toBuffer(`${String(fixedOffsets[id]).padStart(10, "0")} 00000 n \n`));
  }
  fixedChunks.push(toBuffer([
    "trailer",
    `<< /Size ${objects.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    ""
  ].join("\n")));

  return Buffer.concat(fixedChunks);
}

async function renderImagesToPdf({ pages, outputPath, title, printSafeMarginMm = 0 }) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("PDF braucht mindestens eine Seite.");
  }
  const pdfPages = [];
  for (const page of pages) {
    if (page.kind === "text") {
      pdfPages.push(page);
      continue;
    }
    const buffer = await fs.readFile(page.path);
    pdfPages.push({
      kind: "image",
      image: imageForFile(page.path, buffer)
    });
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const normalizedPrintSafeMarginMm = normalizePrintSafeMarginMm(printSafeMarginMm);
  const pdf = buildPdf(pdfPages, {
    title,
    printSafeMarginMm: normalizedPrintSafeMarginMm
  });
  await fs.writeFile(outputPath, pdf);
  return {
    path: outputPath,
    pageCount: pdfPages.length,
    size: pdf.length,
    printSafeMarginMm: normalizedPrintSafeMarginMm
  };
}

module.exports = {
  A4,
  DEFAULT_PRINT_SAFE_MARGIN_MM,
  fitOnPage,
  normalizePrintSafeMarginMm,
  renderImagesToPdf
};
