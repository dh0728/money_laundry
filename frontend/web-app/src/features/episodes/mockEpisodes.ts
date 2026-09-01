export type EpisodeListItem = {
  id: string
  detectedAt: string
  institutions: string[]
  accountCount: number
  transactionCount: number
  totalAmount: string
}

export const mockEpisodes: EpisodeListItem[] = [
  {
    id: 'EP-2026-0901-001',
    detectedAt: '2026.09.01 09:12',
    institutions: ['한빛은행', '새봄저축은행'],
    accountCount: 6,
    transactionCount: 14,
    totalAmount: '₩286,500,000',
  },
  {
    id: 'EP-2026-0901-002',
    detectedAt: '2026.09.01 08:44',
    institutions: ['한빛은행'],
    accountCount: 4,
    transactionCount: 9,
    totalAmount: '₩91,200,000',
  },
  {
    id: 'EP-2026-0901-003',
    detectedAt: '2026.09.01 08:16',
    institutions: ['동해은행', '가온증권'],
    accountCount: 8,
    transactionCount: 21,
    totalAmount: '₩514,000,000',
  },
  {
    id: 'EP-2026-0831-014',
    detectedAt: '2026.08.31 23:48',
    institutions: ['새봄저축은행'],
    accountCount: 3,
    transactionCount: 7,
    totalAmount: '₩47,800,000',
  },
]
