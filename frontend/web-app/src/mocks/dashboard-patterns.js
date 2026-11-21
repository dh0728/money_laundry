const patternAliases = {
  'GATHER-SCATTER': 'GA-SC',
  'SCATTER-GATHER': 'SC-GA',
  'G-SCATTER': 'GA-SC',
  'S-GATHER': 'SC-GA',
};

const supportedPatterns = new Set(['FAN-OUT', 'FAN-IN', 'GA-SC', 'SC-GA', 'CYCLE', 'BIPARTITE']);

export function dashboardPattern(label) {
  const key = label.trim().toUpperCase();
  const name = patternAliases[key] ?? (supportedPatterns.has(key) ? key : label);
  return { name, supported: supportedPatterns.has(name) };
}
