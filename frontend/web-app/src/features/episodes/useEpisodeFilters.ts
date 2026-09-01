import { create } from 'zustand'

type EpisodeFiltersState = {
  institution: string
  query: string
  setInstitution: (institution: string) => void
  setQuery: (query: string) => void
}

export const useEpisodeFilters = create<EpisodeFiltersState>()((set) => ({
  institution: 'all',
  query: '',
  setInstitution: (institution) => set({ institution }),
  setQuery: (query) => set({ query }),
}))
