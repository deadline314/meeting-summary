import { createRoute, type AnyRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { NotePage } from '../features/notes/note-page'
import { NotesPage } from '../features/notes/notes-page'

const bool = z.coerce.boolean().optional()

// Feature routes under the authenticated app layout. Each module adds its routes here.
export function appRoutes(parent: AnyRoute) {
  const notes = createRoute({
    getParentRoute: () => parent,
    path: '/notes',
    validateSearch: z.object({
      q: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      recorderId: z.string().optional(),
      attendeeId: z.string().optional(),
      openComments: bool,
      view: z.enum(['list', 'calendar']).optional(),
      month: z.string().optional(),
      create: bool,
      page: z.coerce.number().int().min(0).optional(),
    }),
    component: function Notes() {
      const search = notes.useSearch()
      const navigate = notes.useNavigate()
      return <NotesPage search={search} setSearch={(s) => navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...s }), replace: true })} />
    },
  })

  const note = createRoute({
    getParentRoute: () => parent,
    path: '/notes/$id',
    validateSearch: z.object({
      mode: z.enum(['edit', 'split', 'preview']).optional(),
      authors: bool,
      author: z.string().optional(),
      tab: z.enum(['comments', 'history', 'files', 'links']).optional(),
      version: z.string().optional(),
      edit: bool,
    }),
    component: function Note() {
      const { id } = note.useParams()
      const search = note.useSearch()
      const navigate = note.useNavigate()
      return <NotePage key={id} id={id} search={search} setSearch={(s, replace) => navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...s }), replace })} />
    },
  })

  return [notes, note]
}
