/**
 * Plain text out of a resume, in memory: PDF (unpdf, a serverless build of pdf.js) and
 * DOCX (mammoth). Nothing here executes document content: no macros, no scripts, no
 * external references are followed. The buffer is dropped as soon as the text is out;
 * resumes are never written to disk or object storage (ADR 0005).
 */
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const RESUME_MIME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export type ResumeType = "pdf" | "docx";

/** Longest resume text handed to a model; anything past it is a few pages of noise. */
export const MAX_RESUME_CHARS = 24_000;

/** The type from the bytes themselves (magic numbers), never from the file name or the browser. */
export function sniffResume(data: Buffer): ResumeType | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // DOCX is a ZIP whose first entry is usually [Content_Types].xml; require the ZIP header
  // and the word/ part name somewhere in the central directory.
  if (data[0] === 0x50 && data[1] === 0x4b && data.includes("word/", 0, "latin1")) return "docx";
  return null;
}

export async function extractResumeText(type: ResumeType, data: Buffer): Promise<string> {
  let text: string;
  if (type === "pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const out = await extractText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join("\n\n") : out.text;
  } else {
    text = (await mammoth.extractRawText({ buffer: data })).value;
  }
  return text
    .replaceAll("\u0000", "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_RESUME_CHARS);
}
