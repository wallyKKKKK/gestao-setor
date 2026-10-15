export type ReallocationRowMarker = 'shared' | 'multiDestination' | 'multiOrigin' | 'manual' | 'minimum' | 'tie';

export function getReallocationRowMarkers(row: {
  quantity: number;
  maxQuantity: number;
  minimumStockQuantity?: number;
  decisionRequired?: boolean;
  decisionResolved?: boolean;
}, destinationCount: number, originCount: number): ReallocationRowMarker[] {
  const markers: ReallocationRowMarker[] = [];
  if (destinationCount > 1 && originCount > 1) markers.push('shared');
  if (destinationCount > 1) markers.push('multiDestination');
  if (originCount > 1) markers.push('multiOrigin');
  if (row.quantity !== row.maxQuantity) markers.push('manual');
  if (Number(row.minimumStockQuantity || 0) > 0) markers.push('minimum');
  if (row.decisionRequired && !row.decisionResolved) markers.push('tie');
  return markers;
}
