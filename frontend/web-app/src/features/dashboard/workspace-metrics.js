export function readWorkspaceGap() {
  const gap = getComputedStyle(document.documentElement).getPropertyValue('--workspace-gap');
  return Number.parseFloat(gap);
}
