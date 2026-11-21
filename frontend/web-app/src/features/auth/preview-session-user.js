export const previewStaff = Object.freeze({
  id: -1, username: 'demo-staff', name: '프리뷰 분석가', role: 'STAFF', source: 'fixture',
});
export const previewAdmin = Object.freeze({
  id: -2, username: 'demo-admin', name: '프리뷰 관리자', role: 'ADMIN', source: 'fixture',
});

let user = null;
export const currentPreviewUser = () => user;

export function setPreviewUser(next) {
  user = next;
  document.dispatchEvent(new Event('aml:preview-user'));
}

export function subscribePreviewUser(onChange) {
  document.addEventListener('aml:preview-user', onChange);
  return () => document.removeEventListener('aml:preview-user', onChange);
}
