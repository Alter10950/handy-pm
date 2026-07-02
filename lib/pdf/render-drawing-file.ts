// Browser-only (Canvas, File, pdfjs-dist worker). Only import this from
// Client Components, and only call it from inside an event handler.

const MAX_DIMENSION = 2000;
const MAX_PDF_PAGES = 15;

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
}

export async function renderFileToPages(file: File): Promise<RenderedPage[]> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    return renderPdfPages(file);
  }
  return [await renderImageFile(file)];
}

async function renderImageFile(file: File): Promise<RenderedPage> {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return { blob: await canvasToBlob(canvas), width, height };
}

async function renderPdfPages(file: File): Promise<RenderedPage[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pages: RenderedPage[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      3,
      MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height)
    );
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push({
      blob: await canvasToBlob(canvas),
      width: canvas.width,
      height: canvas.height,
    });
  }

  return pages;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not export the rendered page."));
      },
      "image/jpeg",
      0.85
    );
  });
}
