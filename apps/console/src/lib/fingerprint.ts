/**
 * A result hash drawn as a 6 x 6 symmetric glyph. Approvers sign a specific result; when the
 * result changes, its glyph visibly changes and earlier approvals no longer count.
 */
export const fingerprintCells = (hash: string): boolean[] => {
  const bits: boolean[] = [];
  for (let i = 0; i < 18; i++) bits.push(Number.parseInt(hash.charAt(i), 16) % 2 === 1);
  const cells: boolean[] = [];
  for (let row = 0; row < 6; row++) {
    const half = bits.slice(row * 3, row * 3 + 3);
    cells.push(...half, ...[...half].reverse());
  }
  return cells;
};

export const shortHash = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 4)} ${hash.slice(4, 8)}` : "none");
