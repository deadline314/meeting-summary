import { createRoute, type AnyRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { NotePage } from '../features/notes/note-page'
import { NotesPage } from '../features/notes/notes-page'
import { IssuePage } from '../features/projects/issue-page'
import { MyIssuesPage, ProjectPage, TimelineOverviewPage } from '../features/projects/project-page'
import { ProjectsLayout } from '../features/projects/projects-layout'
import { TaskPage } from '../features/tasks/task-page'
import { TasksPage } from '../features/tasks/tasks-page'

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

  const tasks = createRoute({ getParentRoute: () => parent, path: '/tasks', component: TasksPage })

  const task = createRoute({
    getParentRoute: () => parent,
    path: '/tasks/$id',
    validateSearch: z.object({ tab: z.enum(['overview', 'submit', 'leaderboard', 'manage', 'settings']).optional() }),
    component: function Task() {
      const { id } = task.useParams()
      const { tab } = task.useSearch()
      const navigate = task.useNavigate()
      return <TaskPage key={id} id={id} tab={tab} onTab={(t) => navigate({ search: { tab: t }, replace: true })} />
    },
  })

  const pmSearch = z.object({
    view: z.enum(['list', 'board', 'timeline', 'stats']).optional(),
    assigneeId: z.string().optional(),
    priority: z.string().optional(),
    labelId: z.string().optional(),
    q: z.string().optional(),
    sort: z.string().optional(),
    due: z.enum(['overdue', 'week', 'none']).optional(),
    blocking: z.enum(['blocked', 'blocking']).optional(),
    statuses: z.string().optional(),
    project: z.string().optional(),
    all: z.coerce.boolean().optional(),
    settings: z.enum(['general', 'members', 'labels', 'templates', 'lifecycle']).optional(),
  })
  const projects = createRoute({ getParentRoute: () => parent, path: '/projects', component: ProjectsLayout })
  const mine = createRoute({
    getParentRoute: () => projects,
    path: '/',
    validateSearch: pmSearch,
    component: function Mine() {
      const search = mine.useSearch()
      const navigate = mine.useNavigate()
      return <MyIssuesPage search={search} setSearch={(s) => navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...s }), replace: true })} />
    },
  })
  const project = createRoute({
    getParentRoute: () => projects,
    path: '$key',
    validateSearch: pmSearch,
    component: function Project() {
      const { key } = project.useParams()
      const search = project.useSearch()
      const navigate = project.useNavigate()
      return <ProjectPage key={key} projectKey={key.toUpperCase()} search={search} setSearch={(s) => navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...s }), replace: true })} />
    },
  })
  const overview = createRoute({
    getParentRoute: () => projects,
    path: 'timeline',
    validateSearch: pmSearch,
    component: function Overview() {
      const search = overview.useSearch()
      const navigate = overview.useNavigate()
      return <TimelineOverviewPage search={search} setSearch={(s) => navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...s }), replace: true })} />
    },
  })
  const issue = createRoute({
    getParentRoute: () => projects,
    path: '$key/$ref',
    component: function Issue() {
      const { key, ref } = issue.useParams()
      return <IssuePage key={ref} projectKey={key.toUpperCase()} issueRef={ref.toUpperCase()} />
    },
  })

  return [notes, note, tasks, task, projects.addChildren([mine, overview, project, issue])]
}
