import { useState } from 'react'
import { useUser } from '../lib/session'
import { cx } from './cx'
import { Tooltip } from './tooltip'

/** Stable colour slot 0..7 per user id (cursors, blame bars, avatar fallback). */
export function authorSlot(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % 8
}

export const authorColor = (id: string) => `var(--t-author-${authorSlot(id)})`

const SIZES = { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-12 text-base', xl: 'size-16 text-xl' }

export function Avatar({
  name,
  src,
  id,
  size = 'md',
  className,
}: {
  name: string
  src?: string | null
  id: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const initials = name.trim().slice(0, 1).toUpperCase() || '?'
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-2 ring-surface select-none', SIZES[size], className)}
      style={{ background: authorColor(id) }}
    >
      {src && !broken ? (
        <img src={src} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        initials
      )}
    </span>
  )
}

/** Avatar for a user id, resolved live from the directory (renames show instantly). */
export function UserAvatar({ id, size, tooltip, className }: { id: string; size?: keyof typeof SIZES; tooltip?: boolean; className?: string }) {
  const u = useUser(id)
  const a = <Avatar id={id} name={u?.name ?? '?'} src={u?.avatarUrl} size={size} className={className} />
  return tooltip ? <Tooltip label={u?.name}>{a}</Tooltip> : a
}

export function UserName({ id, className }: { id: string | null | undefined; className?: string }) {
  const u = useUser(id)
  return <span className={className}>{u?.name ?? '…'}</span>
}

export function AvatarStack({ ids, max = 4, size = 'sm' }: { ids: string[]; max?: number; size?: keyof typeof SIZES }) {
  const shown = ids.slice(0, max)
  return (
    <span className="flex -space-x-1.5">
      {shown.map((id) => (
        <UserAvatar key={id} id={id} size={size} tooltip />
      ))}
      {ids.length > max && (
        <span className={cx('inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-fg-2 ring-2 ring-surface', SIZES[size])}>
          +{ids.length - max}
        </span>
      )}
    </span>
  )
}
