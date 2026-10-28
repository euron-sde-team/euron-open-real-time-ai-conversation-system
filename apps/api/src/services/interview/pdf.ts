/**
 * The report as a PDF (pdfkit, built-in Helvetica, no external fonts or network). Plain
 * and printable: a header, the three ratings, a table of rounds, then every question
 * with its scores and feedback. Transcripts are left out to keep it short; the web
 * report has them.
 */
import type { InterviewReport } from "@open-conversation/types";
import PDFDocument from "pdfkit";

const INK = "#111418";
const MUTED = "#5b6470";
const RULE = "#d9dde3";

const rating = (n: number | null) => (n === null ? "n/a" : String(n));

/** Helvetica covers Latin-1 only; replace what it cannot draw instead of printing boxes. */
function latin(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\t\n\r\x20-\x7e\xa0-\xff]/g, "?");
}

export function renderReportPdf(report: InterviewReport, appName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: latin(report.interview.title), Producer: latin(appName) } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - 112;
    const rule = () => {
      doc.moveDown(0.6);
      doc.strokeColor(RULE).lineWidth(0.5).moveTo(56, doc.y).lineTo(56 + width, doc.y).stroke();
      doc.moveDown(0.6);
    };

    doc.fillColor(MUTED).fontSize(9).text(latin(appName.toUpperCase()), { characterSpacing: 1 });
    doc.moveDown(0.3);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(latin(report.interview.title));
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    const facts = [report.candidateName, report.interview.role, report.interview.company, new Date(report.interview.createdAt).toUTCString().slice(5, 16)].filter(Boolean).join("  |  ");
    doc.text(latin(facts));
    rule();

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Overall");
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    doc.text(`Overall ${rating(report.overallRating)}    Domain knowledge ${rating(report.domainRating)}    Communication ${rating(report.communicationRating)}`);
    doc.fillColor(MUTED).text(`${report.interview.answeredCount} of ${report.interview.questionCount} questions answered, ${Math.round(report.voiceSeconds / 60)} min of live voice`);
    rule();

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Rounds");
    doc.moveDown(0.3);
    for (const r of report.rounds) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(latin(r.name), { continued: true });
      doc.font("Helvetica").fillColor(MUTED).text(`   overall ${rating(r.overallRating)}, domain ${rating(r.domainRating)}, communication ${rating(r.communicationRating)}, ${r.answeredCount}/${r.questionCount} answered`);
    }
    rule();

    let currentRound = -1;
    for (const q of report.questions) {
      if (q.round !== currentRound) {
        currentRound = q.round;
        doc.moveDown(0.4);
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(latin(report.rounds[q.round]?.name ?? `Round ${q.round + 1}`));
        doc.moveDown(0.3);
      }
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(latin(`Q${q.question + 1}. ${q.text}`), { width });
      const a = q.answer;
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED);
      if (!a) doc.text("Not answered.");
      else if (a.status !== "SCORED") doc.text(a.status === "FAILED" ? "Could not be scored." : "Being scored.");
      else {
        doc.text(`Domain ${rating(a.domainRating)}, communication ${rating(a.communicationRating)}`);
        const f = a.feedback;
        if (f) {
          doc.fillColor(INK);
          if (f.analysis) doc.text(latin(f.analysis), { width });
          const list = (label: string, items: string[]) => {
            if (!items.length) return;
            doc.moveDown(0.2).font("Helvetica-Bold").text(label).font("Helvetica");
            for (const it of items) doc.text(latin(`- ${it}`), { width, indent: 8 });
          };
          list("Strengths", f.strengths);
          list("To improve", f.weaknesses);
          list("Try next time", f.suggestions);
          if (f.correctedSnippet) doc.moveDown(0.2).font("Courier").fontSize(8.5).text(latin(f.correctedSnippet), { width }).font("Helvetica").fontSize(9.5);
        }
      }
      doc.moveDown(0.7);
    }

    if (report.proctoring?.events.length) {
      rule();
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Proctoring");
      doc.font("Helvetica").fontSize(9.5).fillColor(MUTED);
      for (const e of report.proctoring.events.slice(0, 100)) doc.text(`${e.occurredAt.slice(11, 19)} UTC  ${e.kind.replace(/_/g, " ").toLowerCase()}`);
    }
    doc.end();
  });
}
