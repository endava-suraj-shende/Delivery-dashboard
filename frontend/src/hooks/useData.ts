import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dashboardApi, excelApi, metaApi } from '@/services/api'
import { useFilters } from '@/hooks/useFilters'

export function useDataStatus() {
  return useQuery({ queryKey: ['excel', 'status'], queryFn: excelApi.status, refetchInterval: 30_000, staleTime: 10_000 })
}

export function useDimensions() {
  return useQuery({ queryKey: ['meta', 'dimensions'], queryFn: metaApi.dimensions, staleTime: 60_000 })
}

export function useAppConfig() {
  return useQuery({ queryKey: ['config', 'app'], queryFn: metaApi.appConfig, staleTime: Infinity })
}

export function useExecutive() {
  const { queryString } = useFilters()
  return useQuery({ queryKey: ['dashboard', 'executive', queryString], queryFn: () => dashboardApi.executive(queryString), placeholderData: (p) => p })
}

export function useTeam() {
  const { queryString } = useFilters()
  return useQuery({ queryKey: ['dashboard', 'team', queryString], queryFn: () => dashboardApi.team(queryString), placeholderData: (p) => p })
}

export function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}
