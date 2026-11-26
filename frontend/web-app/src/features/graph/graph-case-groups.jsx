const comparisonColors = [
  'var(--case-comparison-pink)',
  'var(--case-comparison-teal)',
  'var(--case-comparison-sky)',
  'var(--case-comparison-lime)',
];

export function caseGroupColor(index) {
  if (index === 0) return 'var(--brand-accent)';
  return comparisonColors[(index - 1) % comparisonColors.length];
}

export function caseMembership(groups, transactionIds) {
  const ids = [...transactionIds];
  return groups.filter(group => ids.some(id => group.transactionIds.has(id))).map(group => group.id);
}
