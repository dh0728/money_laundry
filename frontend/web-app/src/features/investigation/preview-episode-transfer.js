import { validWorkCode } from '../../app/preview-route.js';

import { applyPreviewJudgment } from './case-judgment-data.js';
import { liveNextEpisodeCode } from './live-data.js';

const storageKey = 'aml-radar-preview-episode-transfers';
const isAlert = code => validWorkCode(code) && code.startsWith('A-');
const isEpisode = code => validWorkCode(code) && code.startsWith('E-');
const failure = error => ({ ok: false, error });

function readTransfers() {
  try {
    const rows = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(rows) ? rows.filter(row => isEpisode(row?.code)
      && Array.isArray(row.alerts) && row.alerts.every(isAlert)) : [];
  } catch {
    return [];
  }
}

function storeTransfers(rows, code) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(rows));
    return { ok: true, code };
  } catch {
    return failure('이 탭에 Episode 변경을 저장할 수 없습니다.');
  }
}

export function canManagePreviewEpisodes(user) {
  // 서버 계정(api)의 변경은 layout.js의 saveEpisode가 서버로 보낸다.
  return (user?.source === 'fixture' || user?.source === 'api') && (user.role === 'ADMIN' || user.role === 'STAFF');
}

export function canTransferAlert(row) {
  return row.kind === 'Alert' && row.assigned && row.open && row.verdict === 'unjudged' && !row.episodeCode;
}

export function previewEpisodeWillDissolve(episode, unlinkCount) {
  return episode.linkedAlertCodesComplete && episode.linkedAlertCodes.length - unlinkCount < 2;
}

export function nextPreviewEpisodeCode(cases, alertCode, rows = readTransfers()) {
  if (!isAlert(alertCode)) return '';
  // 서버 데이터를 볼 때는 서버가 미리 잡아 준 번호를 쓴다.
  const reserved = liveNextEpisodeCode();
  if (reserved) return reserved;
  const date = alertCode.split('-')[1];
  const used = new Set([...cases, ...rows].map(row => row.code));
  let sequence = 900000 + rows.length;
  while (used.has(`E-${date}-${sequence}`)) sequence++;
  return `E-${date}-${sequence}`;
}

export function changePreviewEpisode({ cases, alertCodes, episodeCode, expectedNewCode, reason, unlink = false, user }) {
  if (!canManagePreviewEpisodes(user)) return failure('검수 계정에서 사용할 수 있습니다.');
  const comment = reason.trim();
  if (!comment || comment.length > 4000 || !alertCodes.length || new Set(alertCodes).size !== alertCodes.length) {
    return failure('Alert와 변경 사유를 확인해 주세요.');
  }
  const rows = readTransfers();
  const episode = cases.find(row => row.code === episodeCode && row.kind === 'Episode' && row.open);
  const saved = rows.find(row => row.code === episodeCode);
  const members = saved?.alerts ?? [];
  if (unlink) {
    if (!episode?.assigned || !saved || alertCodes.some(code => !members.includes(code))) return failure('연결된 Alert를 다시 선택해 주세요.');
    const remaining = members.filter(code => !alertCodes.includes(code));
    const dissolved = previewEpisodeWillDissolve(episode, alertCodes.length);
    return storeTransfers(rows.map(row => row === saved
      ? { ...row, alerts: dissolved ? [] : remaining, dissolved, comment } : row), episodeCode);
  }
  if (alertCodes.some(code => !cases.some(row => row.code === code && canTransferAlert(row)))) {
    return failure('내 담당 진행 중 Alert를 다시 선택해 주세요.');
  }
  if (episodeCode && !episode) return failure('진행 중인 Episode를 선택해 주세요.');
  if (!episodeCode && alertCodes.length < 2) return failure('새 Episode는 Alert가 2건 이상 필요합니다.');
  const first = cases.find(row => row.code === alertCodes[0]);
  const code = episodeCode || nextPreviewEpisodeCode(cases, first.code, rows);
  if (!episodeCode && code !== expectedNewCode) {
    return failure('생성 예정 ID가 바뀌었습니다. 내용을 다시 확인해 주세요.');
  }
  const transfer = { code, alerts: [...members, ...alertCodes], created: saved?.created ?? !episodeCode,
    seed: saved?.seed ?? first.code, comment };
  return storeTransfers([...rows.filter(row => row.code !== code), transfer], code);
}

export function applyPreviewEpisodeTransfers(cases, summarize) {
  const records = readTransfers();
  const byCode = new Map(cases.map(row => [row.code, row]));
  const memberships = new Map();
  for (const record of records) for (const code of record.alerts) memberships.set(code, record.code);

  for (const record of records) {
    const seed = byCode.get(record.seed);
    const parent = record.created ? seed : byCode.get(record.code);
    if (!parent || (record.dissolved && !record.created)) continue;
    const previous = record.created ? [] : parent.related;
    const linked = record.alerts.map(code => byCode.get(code)).filter(Boolean);
    const related = record.dissolved ? [] : [...new Map([...previous, ...linked.flatMap(row => row.related)]
      .map(transaction => [transaction.code, transaction])).values()];
    byCode.set(record.code, applyPreviewJudgment({ ...parent, ...summarize(related), code: record.code, kind: 'Episode',
      related, linkedAlertCodes: record.alerts, linkedAlertCodesComplete: record.created, episodeComment: record.comment,
      status: record.dissolved ? '처리 완료' : record.created ? '처리 중' : parent.status,
      open: !record.dissolved && (record.created || parent.open),
      unread: record.created ? false : parent.unread,
      completedAt: record.created ? null : parent.completedAt,
    }));
  }
  return [...byCode.values()].map(row => memberships.has(row.code)
    ? { ...row, open: false, unread: false, status: '처리 완료', episodeCode: memberships.get(row.code) }
    : row);
}
