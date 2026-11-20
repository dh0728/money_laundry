import type { ReviewCase, ReviewCommand, ReviewGroup, ReviewSelection } from './liveReview'

type User = { userId: number; role: 'STAFF' | 'ADMIN' }

export function assertEditableAlert(item: ReviewCase, user: User) {
  if (user.role !== 'STAFF' || item.kind !== 'ALERT' || item.status !== 'OPEN' || item.assigneeId !== user.userId || item.episodeId != null) {
    throw new Error('본인 담당의 미편입 진행 중 Alert만 처리할 수 있습니다.')
  }
}

export const wholeAlertSelection = (item: ReviewCase): ReviewSelection => ({
  caseId: item.caseId, revision: item.revision, groupId: 0, txIds: [],
})

export function buildAlertClose(item: ReviewCase, decision: 'NORMAL' | 'SUSPICIOUS', comment: string): ReviewCommand {
  return { action: 'CLOSE', selections: [wholeAlertSelection(item)], decision, targetCaseId: null, targetRevision: null, targetGroupId: null, comment: comment.trim() }
}

export function buildAlertTransfer(items: ReviewCase[], target: ReviewCase | null, comment: string): ReviewCommand {
  if (!items.length) throw new Error('편입할 Alert를 선택해 주세요.')
  if (new Set(items.map(item => item.caseId)).size !== items.length) throw new Error('같은 Alert를 중복 선택할 수 없습니다.')
  if (target == null && items.length < 2) throw new Error('새 Episode는 Alert가 2개 이상 필요합니다.')
  if (target != null && (target.kind !== 'EPISODE' || target.status !== 'OPEN')) throw new Error('진행 중인 Episode를 선택해 주세요.')
  return {
    action: 'TRANSFER', selections: items.map(wholeAlertSelection), decision: null,
    targetCaseId: target?.caseId ?? null, targetRevision: target?.revision ?? null, targetGroupId: null, comment: comment.trim(),
  }
}

export const episodeGroupSelection = (item: ReviewCase, group: ReviewGroup): ReviewSelection => ({
  caseId: item.caseId, revision: item.revision, groupId: group.groupId,
  txIds: group.members.filter(member => member.reviewRole === 'SUBJECT' && member.state === 'PENDING').map(member => member.txId),
})

export function buildEpisodeUnlink(item: ReviewCase, groupIds: number[], comment: string): ReviewCommand {
  if (item.kind !== 'EPISODE' || item.status !== 'OPEN') throw new Error('진행 중 Episode만 연결 해제할 수 있습니다.')
  if (!groupIds.length || new Set(groupIds).size !== groupIds.length
      || groupIds.some(id => !item.groups?.some(group => group.groupId === id && group.sourceAlertId != null))) {
    throw new Error('연결 해제할 Alert를 선택해 주세요.')
  }
  if (!comment.trim() || comment.trim().length > 4000) throw new Error('연결 해제 사유를 1~4,000자로 입력해 주세요.')
  return {
    action: 'UNLINK', selections: groupIds.map(groupId => ({ caseId: item.caseId, revision: item.revision, groupId, txIds: [] })),
    targetCaseId: null, targetRevision: null, targetGroupId: null, decision: null, comment: comment.trim(),
  }
}
