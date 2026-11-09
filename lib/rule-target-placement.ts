export interface RuleTargetPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

export function ruleTargetPlacement(anchor: { top: number; bottom: number; right: number }, viewport: { width: number; height: number }): RuleTargetPlacement {
  const margin = 12;
  const gap = 8;
  const width = Math.min(560, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(440, Math.max(0, viewport.height - margin * 2));
  const anchorTop = Math.max(margin, Math.min(anchor.top, viewport.height - margin));
  const anchorBottom = Math.max(margin, Math.min(anchor.bottom, viewport.height - margin));
  const above = Math.max(0, anchorTop - margin - gap);
  const below = Math.max(0, viewport.height - anchorBottom - margin - gap);
  const left = Math.max(margin, Math.min(anchor.right - width, viewport.width - width - margin));
  // Tiny viewports need a viewport-bound panel instead of a cramped anchored list.
  if (Math.max(above, below) < 240) return { left, width, maxHeight: height, top: margin };
  return above > below && below < height
    ? { left, width, maxHeight: Math.min(height, above), bottom: viewport.height - anchorTop + gap }
    : { left, width, maxHeight: Math.min(height, below), top: anchorBottom + gap };
}
