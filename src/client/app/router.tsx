import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, createRoute, createRouter, redirect, useRouter } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '../lib/api'
import { useT } from '../lib/i18n'
import { meQuery } from '../lib/session'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/misc'
import { AdminPage } from '../features/admin/admin'
import { LoginPage } from '../features/auth/login'
import { WelcomePage } from '../features/auth/welcome'
import { HomePage } from '../features/home/home'
import { SettingsPage } from '../features/settings/settings'
import { AppShell } from './shell'
import { appRoutes } from './routes'

type Ctx = { queryClient: QueryClient }

export const rootRoute = createRootRouteWithContext<Ctx>()({
  component: Outlet,
  errorComponent: RouteError,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({ next: z.string().optional(), cancelled: z.coerce.number().optional(), error: z.string().optional() }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me) throw redirect({ to: '/' })
  },
  component: function Login() {
    return <LoginPage search={loginRoute.useSearch()} />
  },
})

const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/welcome',
  validateSearch: z.object({ next: z.string().optional() }),
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (!me) throw redirect({ to: '/login', search: { next: location.href } })
  },
  component: function Welcome() {
    return <WelcomePage next={welcomeRoute.useSearch().next ?? '/'} />
  },
})

export const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (!me) throw redirect({ to: '/login', search: { next: location.href } })
    if (!me.onboarded) throw redirect({ to: '/welcome', search: { next: location.href } })
  },
  component: AppShell,
  errorComponent: RouteError,
})

const homeRoute = createRoute({ getParentRoute: () => appLayout, path: '/', component: HomePage })

const settingsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/settings',
  validateSearch: z.object({ tab: z.enum(['profile', 'appearance', 'devices', 'api', 'admin']).catch('profile').default('profile') }),
  component: function Settings() {
    const { tab } = settingsRoute.useSearch()
    const navigate = settingsRoute.useNavigate()
    return <SettingsPage tab={tab} onTab={(t) => navigate({ search: { tab: t }, replace: true })} />
  },
})

const adminRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/admin',
  validateSearch: z.object({
    tab: z.enum(['members', 'activity', 'usage', 'site']).catch('members').default('members'),
    member: z.string().optional(),
    actor: z.string().optional(),
    type: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery)
    if (me?.role === 'student') throw redirect({ to: '/' })
  },
  component: function Admin() {
    const search = adminRoute.useSearch()
    const navigate = adminRoute.useNavigate()
    return <AdminPage search={search} setSearch={(s, replace = true) => navigate({ search: s, replace })} />
  },
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  welcomeRoute,
  appLayout.addChildren([homeRoute, settingsRoute, adminRoute, ...appRoutes(appLayout)]),
])

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  })
}

function NotFound() {
  const t = useT()
  return <EmptyState className="py-24" title={t('error.not_found')} />
}

function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const t = useT()
  const router = useRouter()
  if (error instanceof ApiError && error.status === 404) return <NotFound />
  return (
    <EmptyState
      className="py-24"
      title={t('common.somethingWrong')}
      hint={error instanceof ApiError && error.requestId ? t('common.requestId', { id: error.requestId.slice(0, 8) }) : undefined}
      action={
        <Button
          icon={<RotateCcw className="size-4" />}
          onClick={() => {
            reset()
            router.invalidate()
          }}
        >
          {t('common.retry')}
        </Button>
      }
    />
  )
}
