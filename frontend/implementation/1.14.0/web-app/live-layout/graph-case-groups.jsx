import './graph-case-groups.css';

const caseGroupColors = [
  'var(--brand-accent)', 'var(--case-wrap-violet)', 'var(--case-wrap-teal)',
  'var(--case-wrap-rose)', 'var(--case-wrap-indigo)', 'var(--case-wrap-ochre)',
];

export function caseGroupColor(index) {
  return caseGroupColors[index % caseGroupColors.length];
}

export function caseMembership(groups, transactionIds) {
  const ids = [...transactionIds];
  return groups.filter(group => ids.some(id => group.transactionIds.has(id))).map(group => group.id);
}
