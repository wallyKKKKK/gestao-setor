export type ReallocationRowMarker = 'manual' | 'minimum' | 'split';

export function hasAutomaticSplit(row: { automaticSplitDestinations?: number; automaticSplitGroups?: string[] }) {
  return Boolean(row.automaticSplitGroups?.length) || Number(row.automaticSplitDestinations || 0) > 1;
}

export function getReallocationRowMarkers(row: {
  quantity: number;
  maxQuantity: number;
  minimumStockQuantity?: number;
  automaticSplitDestinations?: number;
  automaticSplitGroups?: string[];
}): ReallocationRowMarker[] {
  const markers: ReallocationRowMarker[] = [];
  if (row.quantity !== row.maxQuantity) markers.push('manual');
  if (Number(row.minimumStockQuantity || 0) > 0) markers.push('minimum');
  if (hasAutomaticSplit(row)) markers.push('split');
  return markers;
}
