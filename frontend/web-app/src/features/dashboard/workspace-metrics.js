export function readWorkspaceGap() {
  return readWorkspaceLength('--workspace-gap');
}

export function readWorkspaceLength(token) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
}
