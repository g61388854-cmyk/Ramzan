import type { BoardSnapshot, EvidenceItem, Connection, EvidenceKind } from '../types';
import { KIND_SIZES, PIN_COLORS } from '../constants';

/**
 * A hand-placed opening case so the board reads as a living investigation the
 * moment it loads — not an empty canvas.
 */
export function seedBoard(uid: (p: string) => string): BoardSnapshot {
  const mk = (
    kind: EvidenceKind,
    x: number,
    y: number,
    title: string,
    body: string,
    pin: number,
    rot = (Math.random() - 0.5) * 0.12
  ): EvidenceItem => {
    const size = KIND_SIZES[kind] ?? KIND_SIZES.note;
    return {
      id: uid('ev'),
      kind,
      position: { x, y },
      rotation: rot,
      scale: 1,
      z: size.z,
      pinColor: PIN_COLORS[pin % PIN_COLORS.length],
      title,
      body,
      metadata: {},
      createdAt: Date.now(),
    };
  };

  const suspect = mk('suspect', -8.5, 3.4, 'V. MALLORY', 'Person of interest · alibi unverified', 0, -0.05);
  const photo1 = mk('photo', -3.2, 4.6, 'Pier — 00:14', '', 3, 0.06);
  const location = mk('location', 3.8, 4.2, 'PIER 4', 'Warehouse district', 1, -0.03);
  const doc = mk('document', 8.6, 2.6, 'TRANSIT LOG', 'Gate 7 · 23:58', 3, 0.04);
  const sticky1 = mk('sticky', -6.2, -2.2, '', 'WHO CALLED\nAT 11:47?', 2, -0.08);
  const news = mk('newspaper', 0.4, -3.6, 'THE DAILY LEDGER', 'MIDNIGHT DISAPPEARANCE', 3, 0.03);
  const fingerprint = mk('fingerprint', 6.0, -3.0, 'LATENT #7', 'Partial · 12 pts', 0, 0.05);
  const note = mk('note', -1.2, 0.2, 'FIELD NOTE', 'Subject seen leaving via the east stair. No vehicle logged.', 1, 0.02);
  const sticky2 = mk('sticky', 9.4, -1.6, '', 'CHECK\nCAMERAS', 0, 0.07);

  const evidence = [suspect, photo1, location, doc, sticky1, news, fingerprint, note, sticky2];

  const conn = (from: string, to: string, label: string, strength: number, material: Connection['material'] = 'redYarn'): Connection => ({
    id: uid('conn'),
    from,
    to,
    material,
    label,
    strength,
    annotations: [],
    metadata: {},
    createdAt: Date.now(),
  });

  const connections: Connection[] = [
    conn(suspect.id, photo1.id, 'placed at scene', 0.8),
    conn(photo1.id, location.id, 'same night', 0.65),
    conn(location.id, doc.id, 'gate record', 0.5, 'nylon'),
    conn(suspect.id, sticky1.id, 'phone lead', 0.4, 'twine'),
    conn(note.id, location.id, 'east stair', 0.55),
    conn(fingerprint.id, doc.id, 'matched print', 0.7),
    conn(news.id, location.id, 'press coverage', 0.3, 'cotton'),
  ];

  return { evidence, connections };
}
