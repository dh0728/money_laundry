export const previewStaff = Object.freeze({
  id: -1, username: 'demo-staff', name: '분석가 00', role: 'STAFF', source: 'fixture',
});
export const previewAdmin = Object.freeze({
  id: -2, username: 'demo-admin', name: '프리뷰 관리자', role: 'ADMIN', source: 'fixture',
});
export const alternatePreviewStaff = Object.freeze({
  id: -3, username: 'demo-staff-2', name: '분석가 01', role: 'STAFF', source: 'fixture',
});
export const previewAnalysts = Object.freeze([previewStaff, alternatePreviewStaff,
  ...Array.from({ length: 30 }, (_, index) => {
    const number = index + 3;
    return Object.freeze({ id: -(number + 1), username: `demo-staff-${number}`,
      name: `분석가 ${String(number - 1).padStart(2, '0')}`, role: 'STAFF', source: 'fixture' });
  }),
]);

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
