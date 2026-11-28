import { expect, it } from 'vitest';
import { bundleConnection, previewEpisodeCompanions, transferBlockCounts, transferBlockReason } from './preview-episode-transfer';

const tx = (code, from, to) => ({ code, from: { code: from }, to: { code: to } });
const alert = (code, related, extra = {}) => ({
  code, kind: 'Alert', assigned: true, open: true, verdict: 'unjudged', episodeCode: '', related, ...extra,
});

it('Alert 상세의 새 Episode 후보는 계좌·거래를 공유하는 내 담당 미편입 Alert만, 공유가 많은 순으로 고른다', () => {
  const row = alert('A-1', [tx('T-1', 'a', 'b'), tx('T-2', 'b', 'c')]);
  const cases = [
    row,
    alert('A-2', [tx('T-9', 'c', 'z')]), // 계좌 1개 공유
    alert('A-3', [tx('T-2', 'b', 'c'), tx('T-8', 'c', 'y')]), // 거래 1건 공유
    alert('A-4', [tx('T-7', 'x', 'y')]), // 공유 없음
    alert('A-5', [tx('T-6', 'a', 'q')], { assigned: false }), // 다른 담당자
    alert('A-6', [tx('T-5', 'a', 'q')], { episodeCode: 'E-1' }), // 이미 편입
    alert('A-7', [tx('T-4', 'a', 'q')], { verdict: 'normal', open: false }), // 판정 완료
    { code: 'E-2', kind: 'Episode', related: [tx('T-1', 'a', 'b')] },
  ];
  const result = previewEpisodeCompanions(cases, row);
  expect(result.map(({ item }) => item.code)).toEqual(['A-3', 'A-2']);
  expect(result[0]).toMatchObject({ transactions: ['T-2'], accounts: ['b', 'c'] });
  expect(result[1]).toMatchObject({ transactions: [], accounts: ['c'] });
});

it('묶을 수 없는 Alert는 이유를 하나씩 받고, 이유별 개수는 정해진 순서로 센다', () => {
  const open = alert('A-1', []);
  const other = alert('A-2', [], { assigned: false });
  const linked = alert('A-3', [], { episodeCode: 'E-1', assigned: false });
  const judged = alert('A-4', [], { verdict: 'normal', open: false });
  expect([open, other, linked, judged].map(transferBlockReason)).toEqual(['', '다른 담당자', '기존 Episode 소속', '판정 완료']);
  expect(transferBlockCounts([open, other, linked, judged, alert('A-5', [], { assigned: false })]))
    .toEqual([['판정 완료', 1], ['다른 담당자', 2], ['기존 Episode 소속', 1]]);
});

it('묶기 연결 요약은 2건 이상이 함께 쓰는 계좌·거래와 어느 업무와도 이어지지 않은 업무를 찾는다', () => {
  const rows = [
    alert('A-1', [tx('T-1', 'a', 'b')]),
    alert('A-2', [tx('T-1', 'a', 'b'), tx('T-2', 'b', 'c')]),
    alert('A-3', [tx('T-3', 'c', 'd')]),
    alert('A-4', [tx('T-4', 'x', 'y')]),
  ];
  expect(bundleConnection(rows)).toEqual({ accounts: ['a', 'b', 'c'], transactions: ['T-1'], isolated: ['A-4'] });
  expect(bundleConnection([rows[3]]).isolated).toEqual([]);
});
