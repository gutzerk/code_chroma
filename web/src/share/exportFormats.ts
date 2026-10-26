import { jsPDF } from "jspdf";
import type { CanvasCapture } from "./captureCanvas";

export type ExportFormat = "png" | "html" | "pdf";

export interface ExportFile {
  blob: Blob;
  mime: string;
  extension: string;
}

export const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "png", label: "PNG image" },
  { id: "html", label: "HTML page" },
  { id: "pdf", label: "PDF document" },
];

export const EXPORT_META: Record<ExportFormat, { mime: string; extension: string }> = {
  png: { mime: "image/png", extension: "png" },
  html: { mime: "text/html", extension: "html" },
  pdf: { mime: "application/pdf", extension: "pdf" },
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** A standalone page that shows the diagram snapshot (an inlined SVG) at its natural size. */
export function htmlPage(title: string, svgDataUrl: string, background: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;background:${background}}img{display:block;max-width:none}</style>
</head>
<body>
<img src="${svgDataUrl}" alt="${escapeHtml(title)}">
</body>
</html>
`;
}

export async function buildExport(format: ExportFormat, capture: CanvasCapture, title: string): Promise<ExportFile> {
  if (format === "png") return { blob: await capture.png(), mime: "image/png", extension: "png" };
  if (format === "html") {
    const page = htmlPage(title, await capture.svgDataUrl(), capture.background);
    return { blob: new Blob([page], { type: "text/html" }), mime: "text/html", extension: "html" };
  }
  const png = await capture.png();
  const data = new Uint8Array(await png.arrayBuffer());
  const pdf = new jsPDF({
    orientation: capture.width >= capture.height ? "landscape" : "portrait",
    unit: "px",
    format: [capture.width, capture.height],
    hotfixes: ["px_scaling"],
  });
  pdf.addImage(data, "PNG", 0, 0, capture.width, capture.height, undefined, "NONE");
  return { blob: pdf.output("blob"), mime: "application/pdf", extension: "pdf" };
}
