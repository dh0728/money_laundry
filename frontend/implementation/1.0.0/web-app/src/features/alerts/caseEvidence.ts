import type { ReviewGroup } from '@/api/liveReview'

/** Current membership, independent of model score or investigation role. */
export function caseEvidence(groups: ReviewGroup[]) {
  const members = [...new Map(groups.flatMap(group => group.members)
    .filter(member => member.state !== 'EXCLUDED' && member.state !== 'TRANSFERRED')
    .map(member => [member.txId, member] as const)).values()]
  const accounts = new Set(members.flatMap(member => [member.transaction.fromAccountId, member.transaction.toAccountId]))
  const times = members.map(member => new Date(member.transaction.occurredAt).getTime()).sort((a, b) => a - b)
  const format = (time: number) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(time)
    const part = (type: string) => parts.find(value => value.type === type)?.value
    return `${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
  }
  return {
    members,
    accountCount: accounts.size,
    period: times.length ? `${format(times[0])} ~ ${format(times[times.length - 1])}` : '—',
  }
}
