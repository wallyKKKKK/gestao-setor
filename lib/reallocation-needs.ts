export type ReallocationNeedReason = 'no-surplus' | 'route' | 'insufficient' | 'tie' | 'unallocated';

export type ReallocationUnmetNeed = {
  ean: string;
  product: string;
  destinationCode: string;
  destinationName: string;
  needed: number;
  suggested: number;
  reason: ReallocationNeedReason;
};

export type ReallocationNeedsReport = {
  rows: ReallocationUnmetNeed[];
  total: number;
  missingUnits: number;
};

type CoverageRow = {
  ean: string;
  originCode: string;
  destinationCode: string;
  quantity: number;
  destinationNeed: number;
};

export function getReallocationDestinationCoverage(selected: CoverageRow, routes: CoverageRow[]) {
  let needed = selected.destinationNeed;
  let suggested = 0;
  const origins = new Set<string>();
  for (const route of routes) {
    if (route.ean !== selected.ean || route.destinationCode !== selected.destinationCode) continue;
    needed = Math.max(needed, route.destinationNeed);
    if (route.quantity <= 0) continue;
    suggested += route.quantity;
    origins.add(route.originCode);
  }
  return { needed, suggested, missing: Math.max(0, needed - suggested), originCount: origins.size };
}

type SplitRoute = CoverageRow & {
  originName: string;
  destinationName: string;
  automaticSplitGroups?: string[];
};

export function getReallocationSplitDestinations(selected: SplitRoute, routes: SplitRoute[]) {
  const groups = new Set(selected.automaticSplitGroups ?? []);
  const destinations = new Map<string, {
    code: string; name: string; needed: number; planned: number; routes: SplitRoute[];
  }>();

  for (const route of routes) {
    if (route.ean !== selected.ean || route.quantity <= 0) continue;
    if (groups.size
      ? !route.automaticSplitGroups?.some(group => groups.has(group))
      : route.originCode !== selected.originCode) continue;
    const destination = destinations.get(route.destinationCode) ?? {
      code: route.destinationCode, name: route.destinationName, needed: 0, planned: 0, routes: [],
    };
    destination.needed = Math.max(destination.needed, route.destinationNeed);
    destination.planned += route.quantity;
    destination.routes.push(route);
    destinations.set(destination.code, destination);
  }

  return [...destinations.values()].sort((a, b) => a.code.localeCompare(b.code));
}
