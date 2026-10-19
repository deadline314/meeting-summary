import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const ts = (name: string) => integer(name, { mode: 'number' })
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()

// ---------- accounts ----------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    googleSub: text('google_sub'),
    name: text('name').notNull(),
    googleName: text('google_name').notNull(),
    avatarUrl: text('avatar_url'),
    role: text('role', { enum: ['student', 'admin', 'owner'] }).notNull().default('student'),
    status: text('status', { enum: ['active', 'disabled', 'removed'] }).notNull().default('active'),
    prefs: json<{ locale?: string; accent?: string; mode?: string }>('prefs').notNull().default({}),
    onboardedAt: ts('onboarded_at'),
    createdAt: ts('created_at').notNull(),
    lastSeenAt: ts('last_seen_at'),
  },
  (t) => [uniqueIndex('users_email').on(t.email), uniqueIndex('users_google_sub').on(t.googleSub)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha-256 of the cookie token
    userId: text('user_id').notNull(),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull(),
    lastUsedAt: ts('last_used_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    hash: text('hash').notNull(),
    prefix: text('prefix').notNull(),
    scope: text('scope', { enum: ['read', 'write', 'manage'] }).notNull(),
    projectIds: json<string[] | null>('project_ids'),
    expiresAt: ts('expires_at'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [uniqueIndex('api_keys_hash').on(t.hash), index('api_keys_user').on(t.userId)],
)

// ---------- cross-cutting ----------

export const activities = sqliteTable(
  'activities',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    data: json<Record<string, unknown>>('data').notNull().default({}),
    source: text('source', { enum: ['web', 'mcp', 'system'] }).notNull().default('web'),
    projectId: text('project_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('activities_entity').on(t.entityType, t.entityId, t.createdAt),
    index('activities_actor').on(t.actorId, t.createdAt),
    index('activities_created').on(t.createdAt),
  ],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
})

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: ts('reset_at').notNull(),
})

export const idempotency = sqliteTable('idempotency', {
  key: text('key').primaryKey(), // `${userId}:${operationId}`
  response: json<unknown>('response').notNull(),
  createdAt: ts('created_at').notNull(),
})

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    r2Key: text('r2_key').notNull(),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    kind: text('kind', { enum: ['image', 'file', 'drive'] }).notNull(),
    parentType: text('parent_type', { enum: ['note', 'issue', 'task', 'submission', 'avatar'] }).notNull(),
    parentId: text('parent_id').notNull(),
    driveUrl: text('drive_url'),
    status: text('status', { enum: ['pending', 'ready'] }).notNull().default('pending'),
    createdAt: ts('created_at').notNull(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('files_parent').on(t.parentType, t.parentId), index('files_owner').on(t.ownerId)],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    actorId: text('actor_id'),
    type: text('type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    data: json<Record<string, unknown>>('data').notNull().default({}),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('notifications_user').on(t.userId, t.readAt, t.createdAt)],
)

// ---------- meeting notes ----------

export type Absentee = { userId?: string; name?: string; reason?: string }

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    location: text('location').notNull().default(''),
    recorderId: text('recorder_id').notNull(),
    attendeeIds: json<string[]>('attendee_ids').notNull().default([]),
    absentees: json<Absentee[]>('absentees').notNull().default([]),
    projectId: text('project_id'),
    visibility: text('visibility', { enum: ['site', 'project'] }).notNull().default('site'),
    content: text('content').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    deletedAt: ts('deleted_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('notes_starts').on(t.startsAt), index('notes_project').on(t.projectId)],
)

export const noteVersions = sqliteTable(
  'note_versions',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id').notNull(),
    authorId: text('author_id').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at').notNull(),
    inserted: integer('inserted').notNull(),
    deleted: integer('deleted').notNull(),
    content: text('content').notNull(),
    restoredFrom: text('restored_from'),
  },
  (t) => [index('note_versions_note').on(t.noteId, t.endedAt)],
)

export const noteComments = sqliteTable(
  'note_comments',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id').notNull(),
    parentId: text('parent_id'),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    anchor: json<{ start: string; end: string } | null>('anchor'),
    quote: text('quote'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: text('resolved_by'),
    createdAt: ts('created_at').notNull(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('note_comments_note').on(t.noteId, t.createdAt)],
)

// ---------- tasks ----------

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['draft', 'published', 'archived'] }).notNull().default('draft'),
  opensAt: ts('opens_at'),
  dueAt: ts('due_at'),
  projectId: text('project_id'),
  submitKind: text('submit_kind', { enum: ['file', 'code'] }).notNull().default('file'),
  accept: text('accept').notNull().default(''),
  maxBytes: integer('max_bytes').notNull().default(10 * 1024 * 1024),
  dailyLimit: integer('daily_limit').notNull().default(10),
  leaderboard: integer('leaderboard', { mode: 'boolean' }).notNull().default(true),
  higherIsBetter: integer('higher_is_better', { mode: 'boolean' }).notNull().default(true),
  graderFileId: text('grader_file_id'),
  dataFileId: text('data_file_id'),
  image: text('image').notNull().default('python:3.12-slim'),
  requirements: text('requirements').notNull().default(''),
  timeoutSec: integer('timeout_sec').notNull().default(300),
  memoryMb: integer('memory_mb').notNull().default(2048),
  trialPassedAt: ts('trial_passed_at'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull(),
  updatedAt: ts('updated_at').notNull(),
  version: integer('version').notNull().default(1),
})

export type ResultDetail = { name: string; passed: boolean; message?: string }

export const submissions = sqliteTable(
  'submissions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    userId: text('user_id').notNull(),
    fileId: text('file_id').notNull(),
    isTrial: integer('is_trial', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['queued', 'running', 'passed', 'failed', 'error', 'timeout'] }).notNull(),
    score: real('score'),
    message: text('message'),
    details: json<ResultDetail[]>('details'),
    log: text('log'),
    runId: text('run_id'),
    createdAt: ts('created_at').notNull(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('submissions_task_user').on(t.taskId, t.userId, t.createdAt), index('submissions_status').on(t.status)],
)

// ---------- project management ----------

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    parentId: text('parent_id'),
    reviewerId: text('reviewer_id'),
    targetDate: ts('target_date'),
    state: text('state', { enum: ['active', 'closed', 'archived'] }).notNull().default('active'),
    hiddenFromAdmins: integer('hidden_from_admins', { mode: 'boolean' }).notNull().default(false),
    issueSeq: integer('issue_seq').notNull().default(0),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [uniqueIndex('projects_key').on(t.key)],
)

export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role', { enum: ['viewer', 'member', 'owner'] }).notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('project_members_user').on(t.userId)],
)

export const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const
export const ISSUE_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const

export const issues = sqliteTable(
  'issues',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status', { enum: ISSUE_STATUSES }).notNull().default('todo'),
    priority: text('priority', { enum: ISSUE_PRIORITIES }).notNull().default('none'),
    sortOrder: real('sort_order').notNull(),
    parentId: text('parent_id'),
    dueAt: ts('due_at'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    statusChangedAt: ts('status_changed_at').notNull(),
    completedAt: ts('completed_at'),
    deletedAt: ts('deleted_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    uniqueIndex('issues_number').on(t.projectId, t.number),
    index('issues_status').on(t.projectId, t.status, t.sortOrder),
    index('issues_parent').on(t.parentId),
  ],
)

export const issueAssignees = sqliteTable(
  'issue_assignees',
  {
    issueId: text('issue_id').notNull(),
    userId: text('user_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.userId] }), index('issue_assignees_user').on(t.userId)],
)

export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    name: text('name').notNull(),
    color: integer('color').notNull(), // token index 1..8
  },
  (t) => [uniqueIndex('labels_name').on(t.projectId, t.name)],
)

export const issueLabels = sqliteTable(
  'issue_labels',
  { issueId: text('issue_id').notNull(), labelId: text('label_id').notNull() },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] }), index('issue_labels_label').on(t.labelId)],
)

export const issueRelations = sqliteTable(
  'issue_relations',
  {
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    type: text('type', { enum: ['blocks', 'relates', 'duplicate_of'] }).notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId, t.type] }), index('issue_relations_to').on(t.toId)],
)

export const issueComments = sqliteTable(
  'issue_comments',
  {
    id: text('id').primaryKey(),
    issueId: text('issue_id').notNull(),
    parentId: text('parent_id'),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('issue_comments_issue').on(t.issueId, t.createdAt)],
)

// ---------- references between modules ----------

export const references = sqliteTable(
  'references',
  {
    sourceType: text('source_type', { enum: ['note', 'issue_comment', 'issue'] }).notNull(),
    sourceId: text('source_id').notNull(),
    targetType: text('target_type', { enum: ['issue', 'task'] }).notNull(),
    targetId: text('target_id').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceType, t.sourceId, t.targetType, t.targetId] }),
    index('references_target').on(t.targetType, t.targetId),
  ],
)
