export function readWorkspaceGap() {
  return readWorkspaceLength('--workspace-gap');
}

export function readWorkspaceLength(token) {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
}

export function readWorkspaceDuration(token, fallback) {
  const text = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const duration = Number.parseFloat(text);
  return Number.isFinite(duration) ? duration * (text.endsWith('ms') ? 1 : 1000) : fallback;
}
