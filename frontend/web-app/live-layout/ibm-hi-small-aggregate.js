// IBM AMLworld HI-Small, 2022-09-01 through 2022-09-18 (source timestamps).
// Each pair is [all transactions, Is Laundering = 1] from HI-Small_Trans.csv.
// Pattern counts match occurrences in HI-Small_Patterns.txt against positive CSV rows.
// https://github.com/IBM/AML-Data · source data licensed CDLA-Sharing-1.0.
const countsByDay = [
  [1114921, 322], [754449, 408], [207382, 391], [207430, 407],
  [482650, 471], [482089, 531], [482751, 497], [482773, 539],
  [654467, 514], [208325, 442], [396, 232], [281, 170],
  [184, 106], [121, 70], [46, 28], [46, 26], [23, 15], [11, 8],
];
export const ibmDaily = countsByDay.map(([total, suspicious], index) => ({
  label: `09/${String(index + 1).padStart(2, '0')}`, total, suspicious,
}));
export const ibmTotal = ibmDaily.reduce((sum, row) => sum + row.total, 0);
export const ibmLaundering = ibmDaily.reduce((sum, row) => sum + row.suspicious, 0);
export const ibmPeriod = 'IBM AMLworld HI-Small · 2022-09-01 ~ 09-18';

const patternCounts = [
  ['FAN-OUT', 342], ['FAN-IN', 318], ['CYCLE', 287],
  ['SC-GA', 626], ['GA-SC', 716], ['RANDOM', 191],
];

export const ibmPatterns = patternCounts.map(([label, value], index) => ({ label, value, tone: `pattern-${index}` }));
export const ibmRemaining = [
  { label: 'STACK', value: 466, tone: 'other-pattern' },
  { label: 'BIPARTITE', value: 263, tone: 'bipartite' },
  { label: '패턴 없음', value: 1968, tone: 'other' },
];
