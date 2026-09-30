import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  documentCompanyEnum,
  documentStatusEnum,
  documentTypeEnum,
  editRequestStatusEnum,
  forecastStatusEnum,
  interestLevelEnum,
  leadStatusEnum,
  productEnum,
  taskPriorityEnum,
  taskStatusEnum,
  userRoleEnum,
} from './enums';

/**
 * All primary keys are TEXT, not UUID.
 *
 * This is deliberate. The legacy schema inherited Firestore document IDs as
 * TEXT, and the dataset is already in production with those IDs referenced from
 * lead_notes, funnel_history, oi_forecasts and tasks. Changing to UUID now would
 * require a full cross-table rewrite during a hosting migration, which is
 * exactly the kind of risk this migration should not take.
 */

export const users = pgTable(
  'users',
  {
    /**
     * Legacy Firebase UID. Retained as the stable internal identifier so that
     * existing foreign keys keep resolving.
     */
    id: text('id').primaryKey(),
    /**
     * Supabase Auth UUID. Superseded by the Auth.js `account` table; kept
     * populated during the transition so the legacy lookup path still works.
     */
    /**
     * Supabase Auth UUID.
     *
     * No longer written - Auth.js tracks provider identity in the `accounts`
     * table - but retained so the value survives the migration rather than
     * being discarded, and kept as `uuid` to match the source column exactly.
     * Declaring it `text` would make pg_dump emit `'...'::uuid` into a text
     * column on restore.
     */
    authId: uuid('auth_id'),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    /** Required by the Auth.js Drizzle adapter. Google verifies the email. */
    emailVerified: timestamp('email_verified', { withTimezone: true }),
    image: text('image'),
    role: userRoleEnum('role').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex('users_auth_id_key').on(t.authId), index('users_role_idx').on(t.role)],
);

export const rolePermissions = pgTable('role_permissions', {
  role: userRoleEnum('role').primaryKey(),
  canManageUsers: boolean('can_manage_users').default(false),
  canSetTargets: boolean('can_set_targets').default(false),
  canApproveEdits: boolean('can_approve_edits').default(false),
  canAssignPic: boolean('can_assign_pic').default(false),
  canDeleteLeads: boolean('can_delete_leads').default(false),
  canBulkDelete: boolean('can_bulk_delete').default(false),
  canEditFunnelHistory: boolean('can_edit_funnel_history').default(false),
  canDeleteFunnelHistory: boolean('can_delete_funnel_history').default(false),
  canClearAllHistory: boolean('can_clear_all_history').default(false),
  canDeleteNotes: boolean('can_delete_notes').default(false),
  canEditDealValue: boolean('can_edit_deal_value').default(false),
  canImportCsv: boolean('can_import_csv').default(false),
});

export const leads = pgTable(
  'leads',
  {
    /** Firestore document ID of the original lead. */
    id: text('id').primaryKey(),
    dateInput: date('date_input'),
    category: text('category').notNull(),
    brandName: text('brand_name').notNull(),
    contact: text('contact').notNull(),
    /** The real column. Legacy code also read a non-existent `source` column. */
    leadSource: text('lead_source').default('-'),
    email: text('email'),
    status: leadStatusEnum('status').default('Leads').notNull(),
    interestLevel: interestLevelEnum('interest_level').default('-').notNull(),
    productOffered: text('product_offered').array().default(sql`'{}'::text[]`),
    actionPlan: text('action_plan'),

    dateChated: timestamp('date_chated', { withTimezone: true }),
    dateResponsed: timestamp('date_responsed', { withTimezone: true }),
    dateSetMeeting: timestamp('date_set_meeting', { withTimezone: true }),
    dateClosed: timestamp('date_closed', { withTimezone: true }),
    dateFailed: timestamp('date_failed', { withTimezone: true }),

    dealValue: numeric('deal_value', { precision: 18, scale: 2 }).default('0'),

    /**
     * Person in charge. Added out-of-band by scripts/add_pic_name_column.cjs and
     * referenced by the dashboard RPC, so it is part of the live schema even
     * though no migration file created it.
     */
    picName: text('pic_name'),

    isDeleted: boolean('is_deleted').default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    autoDeleteAt: timestamp('auto_delete_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('leads_is_deleted_idx').on(t.isDeleted),
    index('leads_category_idx').on(t.category),
    index('leads_created_at_idx').on(t.createdAt),
    index('leads_brand_name_idx').on(t.brandName),
    index('leads_status_idx').on(t.status),
  ],
);

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    text: text('text').notNull(),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    isLog: boolean('is_log').default(false),
    noteType: text('note_type').default('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [index('lead_notes_lead_id_idx').on(t.leadId)],
);

export const funnelHistory = pgTable(
  'funnel_history',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    leadId: text('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    stage: text('stage').notNull(),
    /** Legacy code wrote to a non-existent `date` column; this is the real one. */
    dateOccurred: timestamp('date_occurred', { withTimezone: true }).notNull(),
    /** Legacy code wrote to a non-existent `by` column; this is the real one. */
    byUserName: text('by_user_name').notNull(),
    byUserId: text('by_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    assignedBy: text('assigned_by'),
    dealValue: numeric('deal_value', { precision: 18, scale: 2 }),
    campaignNumber: integer('campaign_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('funnel_history_lead_id_idx').on(t.leadId),
    index('funnel_history_lead_stage_idx').on(t.leadId, t.stage),
    index('funnel_history_lead_campaign_idx').on(t.leadId, t.stage, t.campaignNumber),
    index('funnel_history_date_occurred_idx').on(t.dateOccurred),
  ],
);

export const editRequests = pgTable(
  'edit_requests',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    oldBrand: text('old_brand'),
    newBrand: text('new_brand'),
    oldContact: text('old_contact'),
    newContact: text('new_contact'),
    /**
     * Legacy code wrote `requested_by` and `timestamp`, neither of which ever
     * existed. The real columns are requested_by_id / requested_by_name /
     * created_at.
     */
    requestedById: text('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    requestedByName: text('requested_by_name'),
    status: editRequestStatusEnum('status').default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('edit_requests_status_idx').on(t.status), index('edit_requests_created_at_idx').on(t.createdAt)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    priority: taskPriorityEnum('priority').default('Medium'),
    status: taskStatusEnum('status').default('Todo'),
    assignedTo: text('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Denormalised display names. Written by scripts/migrate_remaining.cjs and
     * read by the UI, so they exist in the live database despite being absent
     * from the migration files.
     */
    assignedToName: text('assigned_to_name'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdByName: text('created_by_name'),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index('tasks_assigned_to_idx').on(t.assignedTo),
    index('tasks_created_by_idx').on(t.createdBy),
    index('tasks_lead_id_idx').on(t.leadId),
    index('tasks_status_idx').on(t.status),
  ],
);

export const globalTargets = pgTable('global_targets', {
  id: text('id').primaryKey(),
  /** Format: YYYY-MM */
  monthYear: text('month_year').notNull().unique(),
  targetChat: integer('target_chat').default(0),
  targetMeeting: integer('target_meeting').default(0),
  targetRevenue: numeric('target_revenue', { precision: 18, scale: 2 }).default('0'),
  /** FK to users.id. Legacy code wrote a display name here, violating the FK. */
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const individualTargets = pgTable(
  'individual_targets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    userName: text('user_name'),
    monthYear: text('month_year').notNull(),
    targetChat: integer('target_chat').default(0),
    targetMeeting: integer('target_meeting').default(0),
    targetRevenue: numeric('target_revenue', { precision: 18, scale: 2 }).default('0'),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex('individual_targets_user_month_key').on(t.userId, t.monthYear)],
);

export const auditLogs = pgTable(
  'global_audit_logs',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    details: text('details').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name').notNull(),
    targetId: text('target_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [index('audit_logs_created_at_idx').on(t.createdAt)],
);

export const oiForecasts = pgTable(
  'oi_forecasts',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    /** Format: YYYY-MM */
    monthYear: text('month_year').notNull(),
    product: text('product').notNull(),
    value: numeric('value', { precision: 18, scale: 2 }).default('0'),
    campaignNumber: integer('campaign_number'),
    budgetAds: numeric('budget_ads', { precision: 18, scale: 2 }).default('0'),
    budgetCreator: numeric('budget_creator', { precision: 18, scale: 2 }).default('0'),
    grossMargin: numeric('gross_margin', { precision: 18, scale: 2 }).default('0'),
    realMargin: numeric('real_margin', { precision: 18, scale: 2 }).default('0'),
    realPayment: numeric('real_payment', { precision: 18, scale: 2 }).default('0'),
    targetGmv: numeric('target_gmv', { precision: 18, scale: 2 }),
    targetCreator: numeric('target_creator', { precision: 18, scale: 2 }),
    targetVideoAffiliate: integer('target_video_affiliate'),
    targetVideoInternal: integer('target_video_internal'),
    targetViews: integer('target_views'),
    successRate: numeric('success_rate', { precision: 8, scale: 2 }).default('0'),
    status: forecastStatusEnum('status').default('OPEN'),
    tier: text('tier').default('-'),
    category: text('category'),
    lastFollowUp: timestamp('last_follow_up', { withTimezone: true }),
    noteSales: text('note_sales'),
    dateQuotation: date('date_quotation'),
    picQuotation: text('pic_quotation'),
    dateInvoice: date('date_invoice'),
    picInvoice: text('pic_invoice'),
    isDeleted: boolean('is_deleted').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    /**
     * Who last touched this row, and when.
     *
     * The forecast grid is a spreadsheet: sixteen editable cells per brand, and
     * sales performance is read off these numbers. Knowing which rep changed
     * what, and when down to the minute, is what makes a disputed figure
     * traceable. `updated_at` alone only said that *something* changed at
     * 14:32, not who.
     *
     * The name is denormalised alongside the id for the same reason
     * funnel_history.by_user_name is: the row stays readable after the user is
     * removed.
     */
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedByName: text('updated_by_name'),
  },
  (t) => [
    index('oi_forecasts_lead_id_idx').on(t.leadId),
    index('oi_forecasts_month_product_idx').on(t.monthYear, t.product),
    /**
     * A brand may be forecast once per month, per product, per campaign.
     *
     * The grid already refuses a duplicate, but that check only sees rows
     * already in the browser. Two open tabs, or a lead added by a colleague in
     * between, both pass it and produce a duplicate row - which then inflates
     * the WIN totals and the milestone percentages. This makes the database the
     * guarantee rather than the UI.
     *
     * COALESCE on campaign_number matters: a NULL campaign number would not
     * compare equal to another NULL under a plain unique index, so duplicates
     * with no campaign set would still slip through.
     */
    uniqueIndex('oi_forecasts_lead_month_product_campaign_key').on(
      t.leadId,
      t.monthYear,
      t.product,
      sql`coalesce(${t.campaignNumber}, 1)`,
    ),
  ],
);

export const oiTargets = pgTable(
  'oi_targets',
  {
    id: text('id').primaryKey(),
    monthYear: text('month_year').notNull(),
    product: text('product').notNull(),
    targetValue: numeric('target_value', { precision: 18, scale: 2 }).default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex('oi_targets_month_product_key').on(t.monthYear, t.product)],
);

// ---------------------------------------------------------------------------
// Documents: quotation and invoice generator
// ---------------------------------------------------------------------------

/**
 * One numbering sequence, plus the format string that turns a counter into a
 * real document number.
 *
 * Why this is a table and not a constant: the three series in use do not agree
 * with each other.
 *
 *   TNT quotation   037/QUO-TNT/SA/IX/26     roman month, two-digit year
 *   TNT invoice     01/INV-TNT/MCN/VIII/26   roman month, two-digit year
 *   HYPE            003/QUO-HYPE             no month, no year at all
 *
 * HYPE also appears to run ONE counter across both document types - a quotation
 * is 003 and the next invoice is 004 - while TNT keeps the two apart. And
 * HYPE's invoice still says `QUO` in the prefix, which is probably a mistake in
 * the old template but is already printed on paper the client holds.
 *
 * Encoding any of that in code would mean a code change the first time the
 * office decides differently. Here it is a row, and the office can change it.
 *
 * `nextNumber` is the number the NEXT document will receive, not the last one
 * used. It is advanced inside the same transaction that inserts the document,
 * under a row lock, so two people issuing at the same moment queue instead of
 * colliding.
 */
export const documentSeries = pgTable(
  'document_series',
  {
    id: text('id').primaryKey(),
    company: documentCompanyEnum('company').notNull(),
    docType: documentTypeEnum('doc_type').notNull(),

    /**
     * House style for the printed number, shown as a hint on the form.
     *
     * NOT used to generate anything. The office does not yet know what every
     * segment means - `SA` in one sample, `MCN` in another, and nobody can say
     * what else exists - so the number is typed by the user and this is only
     * there to show the convention.
     *
     * A system that guesses a number and gets it wrong is worse than one that
     * asks, because a wrong number has already been printed by the time anyone
     * notices.
     */
    format: text('format'),

    /**
     * Suggested next number, pre-filled in the form. The user may change it.
     *
     * Nullable and advisory: a series with no suggestion simply opens an empty
     * box. The unique index on (series_id, number) is what actually prevents a
     * duplicate, not this.
     */
    nextNumber: integer('next_number'),

    /** Stop offering this series without deleting it. */
    isActive: boolean('is_active').notNull().default(true),

    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex('document_series_company_type_key').on(t.company, t.docType)],
);

/**
 * A quotation or invoice. The archive.
 *
 * Bank details and the signatory are stored ON the document rather than read
 * from a settings table at print time. That is the whole point of the archive:
 * a document printed last year must still show the account number that was
 * current last year. Reading live settings would silently rewrite history every
 * time the bank details change.
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    seriesId: text('series_id')
      .references(() => documentSeries.id, { onDelete: 'restrict' })
      .notNull(),

    status: documentStatusEnum('status').notNull().default('DRAFT'),

    /**
     * The printed number. NULL while the document is a DRAFT.
     *
     * A DRAFT deliberately holds no number, so drafts that are started and
     * abandoned never burn one. Numbering happens when the document is issued,
     * inside the issuing transaction.
     */
    number: text('number'),

    /**
     * The number this document replaces, when this is a REVISION.
     *
     * The original is never modified. A revision points back at it so the
     * archive can show "supersedes 01/INV-TNT/MCN/VIII/26".
     */
    revisionOf: text('revision_of'),

    /**
     * Client's legal name, typed freely.
     *
     * Not a foreign key to leads. A quotation is frequently issued to a PT that
     * does not appear anywhere in the CRM, and the name on the document has to
     * be exactly what goes on the invoice - which is often the registered
     * entity rather than the brand the team calls them.
     */
    clientName: text('client_name').notNull(),

    /** Which product this concerns. Affects nothing except the segment field. */
    product: productEnum('product'),

    issueDate: date('issue_date'),
    period: text('period'),

    /** Sum of item prices. Computed server-side; never trusted from the client. */
    subtotal: numeric('subtotal', { precision: 18, scale: 2 }).notNull().default('0'),

    /**
     * Tax as a percentage, entered by hand.
     *
     * Deliberately free-form rather than a fixed rate: the TNT sample shows
     * `PPN 11%` struck through with a different figure in its place, and HYPE
     * quotes 0,5%. The office decides the rate per document, and the rule may
     * change again when the accountant answers. The arithmetic is still done
     * here - only the rate is a human decision.
     */
    taxRate: numeric('tax_rate', { precision: 6, scale: 3 }),
    taxLabel: text('tax_label'),
    taxAmount: numeric('tax_amount', { precision: 18, scale: 2 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 18, scale: 2 }).notNull().default('0'),

    /** Free-form conditions printed under the table. */
    terms: text('terms'),

    /** Free-text middle segment of the number, e.g. `SA` or `MCN`. */
    numberSegment: text('number_segment'),

    /**
     * Printed as its own line under the table, e.g. "Approve by VOJIC SKIN".
     * Kept separate from client_name because the two differ on the samples.
     */
    approverName: text('approver_name'),

    // --- snapshots: frozen at issue time -------------------------------------
    bankName: text('bank_name'),
    bankAccountName: text('bank_account_name'),
    bankAccountNumber: text('bank_account_number'),
    bankBranch: text('bank_branch'),
    signatoryName: text('signatory_name'),
    signatoryTitle: text('signatory_title'),
    /** Which template renders this. Frozen so a template change never rewrites history. */
    templateKey: text('template_key'),

    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedByName: text('updated_by_name'),
  },
  (t) => [
    index('documents_series_idx').on(t.seriesId),
    index('documents_status_idx').on(t.status),
    index('documents_issue_date_idx').on(t.issueDate),
    // One number per series, and one number per document. Postgres treats NULLs
    // as distinct here, so the many DRAFTs that hold no number do not collide.
    uniqueIndex('documents_series_number_key').on(t.seriesId, t.number),
  ],
);

/** Line items. Free-form, because every deal is described differently. */
export const documentItems = pgTable(
  'document_items',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').notNull().default(0),
    /** Short headline, e.g. "Affiliate Booster" or "Live Streaming Creator". */
    title: text('title').notNull(),
    /** The long, bulleted body. Newlines are meaningful and are preserved. */
    description: text('description'),
    /** Duration or campaign length, printed in its own column. */
    period: text('period'),
    price: numeric('price', { precision: 18, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [index('document_items_document_idx').on(t.documentId)],
);

/**
 * Free-form key/value settings.
 *
 * The UI queried a table literally named `settings` with a `list` column, which
 * was never created by any migration; it silently fell back to a hardcoded array.
 * This table is the real equivalent, and the category list lives under
 * `data->'categories'`.
 */
export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  leadNotes: many(leadNotes),
  funnelHistory: many(funnelHistory),
  tasksAssigned: many(tasks, { relationName: 'tasksAssigned' }),
  tasksCreated: many(tasks, { relationName: 'tasksCreated' }),
  individualTargets: many(individualTargets),
  auditLogs: many(auditLogs),
}));

export const leadsRelations = relations(leads, ({ many }) => ({
  notes: many(leadNotes),
  history: many(funnelHistory),
  forecasts: many(oiForecasts),
  tasks: many(tasks),
  editRequests: many(editRequests),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
  author: one(users, { fields: [leadNotes.authorId], references: [users.id] }),
}));

export const funnelHistoryRelations = relations(funnelHistory, ({ one }) => ({
  lead: one(leads, { fields: [funnelHistory.leadId], references: [leads.id] }),
  byUser: one(users, { fields: [funnelHistory.byUserId], references: [users.id] }),
}));

export const editRequestsRelations = relations(editRequests, ({ one }) => ({
  lead: one(leads, { fields: [editRequests.leadId], references: [leads.id] }),
  requestedBy: one(users, { fields: [editRequests.requestedById], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  assignee: one(users, { fields: [tasks.assignedTo], references: [users.id], relationName: 'tasksAssigned' }),
  creator: one(users, { fields: [tasks.createdBy], references: [users.id], relationName: 'tasksCreated' }),
}));

export const individualTargetsRelations = relations(individualTargets, ({ one }) => ({
  user: one(users, { fields: [individualTargets.userId], references: [users.id] }),
}));

export const oiForecastsRelations = relations(oiForecasts, ({ one }) => ({
  lead: one(leads, { fields: [oiForecasts.leadId], references: [leads.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const documentSeriesRelations = relations(documentSeries, ({ many }) => ({
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  series: one(documentSeries, { fields: [documents.seriesId], references: [documentSeries.id] }),
  items: many(documentItems),
  createdByUser: one(users, { fields: [documents.createdBy], references: [users.id] }),
  updatedByUser: one(users, { fields: [documents.updatedBy], references: [users.id] }),
}));

export const documentItemsRelations = relations(documentItems, ({ one }) => ({
  document: one(documents, { fields: [documentItems.documentId], references: [documents.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadNote = typeof leadNotes.$inferSelect;
export type FunnelHistoryRow = typeof funnelHistory.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type OIForecast = typeof oiForecasts.$inferSelect;
export type EditRequest = typeof editRequests.$inferSelect;
export type GlobalTarget = typeof globalTargets.$inferSelect;
export type IndividualTarget = typeof individualTargets.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type RolePermissions = typeof rolePermissions.$inferSelect;
export type DocumentSeries = typeof documentSeries.$inferSelect;
export type NewDocumentSeries = typeof documentSeries.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type DocumentItem = typeof documentItems.$inferSelect;
export type NewDocumentItem = typeof documentItems.$inferInsert;
