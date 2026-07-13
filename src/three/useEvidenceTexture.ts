import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { EvidenceItem } from '../types';
import {
  documentTexture,
  fingerprintTexture,
  mapTexture,
  newspaperTexture,
  photoPlaceholder,
  stickyTexture,
  suspectTexture,
} from './textures';
import { useBoardStore } from '../store/useBoardStore';

const STICKY_COLORS = ['#f6e05e', '#f6ad55', '#fc8181', '#68d391', '#63b3ed', '#f687b3'];

function seedOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Resolves the front-face texture for an evidence item. Uploaded images load
 * asynchronously (and record their true aspect ratio back into the store);
 * everything else is procedurally drawn and memoised.
 */
export function useEvidenceTexture(item: EvidenceItem): THREE.Texture | null {
  const [uploaded, setUploaded] = useState<THREE.Texture | null>(null);
  const updateEvidence = useBoardStore((s) => s.updateEvidence);
  const seed = useMemo(() => seedOf(item.id), [item.id]);

  useEffect(() => {
    if (!item.imageUrl) {
      setUploaded(null);
      return;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(item.imageUrl, (tex) => {
      if (cancelled) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const img = tex.image as HTMLImageElement;
      if (img && img.width && img.height) {
        const aspect = img.width / img.height;
        if (Math.abs((item.aspect ?? 0) - aspect) > 0.01) {
          updateEvidence(item.id, { aspect }, false);
        }
      }
      setUploaded(tex);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.imageUrl, item.id]);

  const procedural = useMemo(() => {
    switch (item.kind) {
      case 'sticky':
        return stickyTexture(STICKY_COLORS[seed % STICKY_COLORS.length], item.body || item.title, seed);
      case 'document':
        return documentTexture(item.title, item.body, seed);
      case 'note':
        return documentTexture(item.title || 'FIELD NOTE', item.body, seed);
      case 'suspect':
        return suspectTexture(item.title, item.body, seed);
      case 'location':
        return mapTexture(item.title, seed);
      case 'newspaper':
        return newspaperTexture(item.title, item.body, seed);
      case 'fingerprint':
        return fingerprintTexture(seed);
      case 'photo':
      default:
        return photoPlaceholder(item.title, seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.kind, item.title, item.body, seed]);

  return uploaded ?? procedural;
}
