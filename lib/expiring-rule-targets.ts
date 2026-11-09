export function expiringRuleTargets(rule: { scope_value: string; scope_values?: string[] }) {
  return rule.scope_values?.length ? rule.scope_values : rule.scope_value ? [rule.scope_value] : [];
}

export function matchesExpiringRuleTarget(rule: { scope_value: string; scope_values?: string[] }, value: string) {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*>\s*/g, '>');
  return expiringRuleTargets(rule).some(target => normalize(target) === normalize(value));
}
