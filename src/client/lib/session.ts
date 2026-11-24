import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { DirectoryUser, UserDto } from '@shared/types'
import { ApiError, api, queryClient } from './api'
import { clearQueryCache, persistQueryCache, restoreQueryCache, stopPersisting } from './query-cache'

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    try {
      const user = (await api<{ user: UserDto }>('/api/me')).user
      // Once we know who this is, the pages they saw last time can draw from the browser.
      await restoreQueryCache(queryClient, user.id)
      persistQueryCache(queryClient, user.id)
      return user
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        stopPersisting()
        return null
      }
      throw err
    }
  },
  staleTime: 60_000,
})

export const useMe = () => useSuspenseQuery(meQuery).data!

export const directoryQuery = queryOptions({
  queryKey: ['users'],
  queryFn: async () => (await api<{ items: DirectoryUser[] }>('/api/users')).items,
  staleTime: 60_000,
  refetchInterval: 60_000,
  select: (items) => new Map(items.map((u) => [u.id, u])),
})

/** Names are always resolved from ids at render time, so renames show everywhere at once. */
export function useUser(id: string | null | undefined) {
  const { data } = useQuery(directoryQuery)
  return id ? data?.get(id) : undefined
}

export function useDirectory() {
  return useQuery(directoryQuery).data ?? new Map<string, DirectoryUser>()
}

export function refreshMe(user: UserDto) {
  queryClient.setQueryData(meQuery.queryKey, user)
  queryClient.invalidateQueries({ queryKey: ['users'] })
}

export async function logout(forget = false) {
  await api(`/auth/logout${forget ? '?forget=1' : ''}`, { method: 'POST' }).catch(() => undefined)
  stopPersisting()
  await clearQueryCache()
  queryClient.clear()
  location.href = '/login'
}

export const isAdminRole = (r: string | undefined) => r === 'admin' || r === 'owner'
