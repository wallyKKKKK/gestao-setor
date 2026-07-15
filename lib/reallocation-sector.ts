export const DEFAULT_REALLOCATION_SECTOR = "Geral";

export function normalizeReallocationSector(value: unknown) {
  const sector = String(value || "").trim();
  return sector || DEFAULT_REALLOCATION_SECTOR;
}
