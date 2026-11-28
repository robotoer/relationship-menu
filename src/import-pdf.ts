/**
 * relationshipmenu.org PDFs (spec SV-16): that site attaches its own menu JSON to each
 * PDF it makes, as an embedded file named "relationshipmenu.json". Reading it needs a
 * PDF parser, so this module is only ever imported with `import()` when someone
 * actually chooses a PDF: it stays out of the app's main download.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

/** The menu JSON attached to a PDF, or null when it has none. */
export const menuJsonFromPdf = async (bytes: ArrayBuffer): Promise<string | null> => {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return null;
  }
  const names = document.catalog.lookup(PDFName.of("Names"), PDFDict);
  const files = names?.lookup(PDFName.of("EmbeddedFiles"), PDFDict);
  const entries = files?.lookup(PDFName.of("Names"), PDFArray);
  if (!entries) return null;
  for (let i = 0; i + 1 < entries.size(); i += 2) {
    let name: string;
    try {
      const raw = entries.lookup(i);
      name = raw instanceof PDFRawStream ? new TextDecoder().decode(raw.contents) : "";
    } catch {
      continue;
    }
    // Their own importer looks for exactly this name; anything else is someone's logo.
    if (!/relationshipmenu\.json$/i.test(name)) continue;
    try {
      const spec = entries.lookup(i + 1, PDFDict);
      const stream = spec.lookup(PDFName.of("EF"), PDFDict)?.lookup(PDFName.of("F"));
      if (!stream) continue;
      const data = stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : null;
      if (!data) continue;
      return new TextDecoder("utf-8").decode(data);
    } catch {
      continue;
    }
  }
  return null;
};
