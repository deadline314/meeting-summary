export type Role = 'student' | 'admin' | 'owner'
export type UserStatus = 'active' | 'disabled' | 'removed'

export type UserDto = {
  id: string
  email: string
  name: string
  googleName: string
  avatarUrl: string | null
  role: Role
  status: UserStatus
  prefs: { locale?: 'zh' | 'en'; accent?: string; mode?: string; notifyOff?: string[]; emailOff?: boolean; toursSeen?: string[] }
  onboarded: boolean
  createdAt: number
  lastSeenAt: number | null
}

export type DirectoryUser = Pick<UserDto, 'id' | 'name' | 'avatarUrl' | 'role' | 'status'>

export type Page<T> = { items: T[]; total: number }
