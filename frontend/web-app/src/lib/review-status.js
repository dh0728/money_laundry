export const reviewStates = [
  { value: '처리 전', label: '처리 전', preset: 'pending' },
  { value: '처리 중', label: '처리 중', preset: 'inProgress' },
  { value: '처리 완료', label: '처리 완료', preset: 'done' },
];

export const reviewStatusLabels = Object.fromEntries(reviewStates.map(({ preset, label }) => [preset, label]));
