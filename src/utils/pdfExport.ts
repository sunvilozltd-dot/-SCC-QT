import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

export async function convertUploadedPadFileToImage(file: File): Promise<{
  imageDataUrl: string;
  mimeType: string;
  fileName: string;
}> {
  const mime = file.type.toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read the uploaded file.'));
      reader.readAsDataURL(file);
    });
    return { imageDataUrl: dataUrl, mimeType: mime, fileName: file.name };
  }

  if (mime === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfjsLib = await import('pdfjs-dist');
    if (typeof pdfjsLib.getDocument !== 'function') {
      throw new Error(
        'PDF pad conversion is not supported in the single-file Apps Script build. Please upload a PNG or JPG letterhead image instead.'
      );
    }
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
    }
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize canvas for PDF rendering.');

    await page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<
      typeof page.render
    >[0]).promise;

    return {
      imageDataUrl: canvas.toDataURL('image/png'),
      mimeType: 'application/pdf',
      fileName: file.name,
    };
  }

  throw new Error('Only PDF, PNG, or JPG files can be uploaded.');
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to encode PDF data.'));
    reader.readAsDataURL(blob);
  });
}

export async function exportA4ElementsToPdf(
  pageElements: HTMLElement[],
  filename: string
): Promise<{ blob: Blob; base64: string }> {
  if (pageElements.length === 0) {
    throw new Error('No pages available to generate PDF.');
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  for (let i = 0; i < pageElements.length; i++) {
    const el = pageElements[i];
    const imgData = await toPng(el, {
      cacheBust: true,
      pixelRatio: 2.2,
      backgroundColor: '#ffffff',
      skipAutoScale: true,
    });
    if (i > 0) {
      pdf.addPage('a4', 'portrait');
    }
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  }

  const blob = pdf.output('blob');
  const base64 = await blobToBase64(blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return { blob, base64 };
}

export async function shareDocumentPdf(
  pageElements: HTMLElement[],
  filename: string,
  title: string,
  summaryText: string
): Promise<'shared-file' | 'shared-text' | 'copied'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let i = 0; i < pageElements.length; i++) {
        const imgData = await toPng(pageElements[i], {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
        });
        if (i > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
      }
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title, text: summaryText, files: [file] });
        return 'shared-file';
      }
    } catch {
      // Fallback to text share
    }

    try {
      await navigator.share({ title, text: summaryText });
      return 'shared-text';
    } catch {
      // Fall through to clipboard
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(summaryText);
  }
  return 'copied';
}
