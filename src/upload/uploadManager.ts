import type { EvidenceItem } from '../types';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/**
 * Freeze an animated GIF to its first frame by drawing to a canvas — keeps the
 * board still and cheap. Other image types pass through untouched.
 */
async function firstFrame(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export interface UploadResult {
  patch: Partial<EvidenceItem>;
  kind: EvidenceItem['kind'];
}

/**
 * Turn dropped files into evidence patches. Images become photo cards; PDFs
 * become document cards labelled with the filename (a lightweight preview
 * without pulling in a PDF renderer).
 */
export async function filesToEvidence(files: FileList | File[]): Promise<UploadResult[]> {
  const out: UploadResult[] = [];
  for (const file of Array.from(files)) {
    if (IMAGE_TYPES.includes(file.type)) {
      let url = await readAsDataURL(file);
      if (file.type === 'image/gif') url = await firstFrame(url);
      out.push({ kind: 'photo', patch: { imageUrl: url, title: labelFrom(file.name) } });
    } else if (file.type === 'application/pdf') {
      out.push({
        kind: 'document',
        patch: { title: labelFrom(file.name), body: `PDF · ${(file.size / 1024).toFixed(0)} KB` },
      });
    }
  }
  return out;
}

function labelFrom(name: string): string {
  return name.replace(/\.[^.]+$/, '').slice(0, 22).toUpperCase();
}
