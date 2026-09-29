CREATE TYPE "public"."edit_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."forecast_status" AS ENUM('WIN', 'OPEN', 'LOSE');--> statement-breakpoint
CREATE TYPE "public"."interest_level" AS ENUM('HOT', 'WARM', 'COLD', '-');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('Leads', 'Chated', 'Responsed', 'Set Meeting', 'Hold', 'Close Win', 'Close Lost', 'Failed');--> statement-breakpoint
CREATE TYPE "public"."product" AS ENUM('MCN', 'TNT', 'HYPE');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('Low', 'Medium', 'High');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('Todo', 'In Progress', 'Done');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('lord', 'admin', 'staff', 'pending');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "global_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"details" text NOT NULL,
	"user_id" text,
	"user_name" text NOT NULL,
	"target_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "edit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"old_brand" text,
	"new_brand" text,
	"old_contact" text,
	"new_contact" text,
	"requested_by_id" text,
	"requested_by_name" text,
	"status" "edit_request_status" DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "funnel_history" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"lead_id" text NOT NULL,
	"stage" text NOT NULL,
	"date_occurred" timestamp with time zone NOT NULL,
	"by_user_name" text NOT NULL,
	"by_user_id" text,
	"note" text,
	"assigned_by" text,
	"deal_value" numeric(18, 2),
	"campaign_number" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "global_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"month_year" text NOT NULL,
	"target_chat" integer DEFAULT 0,
	"target_meeting" integer DEFAULT 0,
	"target_revenue" numeric(18, 2) DEFAULT '0',
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "global_targets_month_year_unique" UNIQUE("month_year")
);
--> statement-breakpoint
CREATE TABLE "individual_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text,
	"month_year" text NOT NULL,
	"target_chat" integer DEFAULT 0,
	"target_meeting" integer DEFAULT 0,
	"target_revenue" numeric(18, 2) DEFAULT '0',
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"text" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"is_log" boolean DEFAULT false,
	"note_type" text DEFAULT 'note',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"date_input" date,
	"category" text NOT NULL,
	"brand_name" text NOT NULL,
	"contact" text NOT NULL,
	"lead_source" text DEFAULT '-',
	"email" text,
	"status" "lead_status" DEFAULT 'Leads' NOT NULL,
	"interest_level" "interest_level" DEFAULT '-' NOT NULL,
	"product_offered" text[] DEFAULT '{}'::text[],
	"action_plan" text,
	"date_chated" timestamp with time zone,
	"date_responsed" timestamp with time zone,
	"date_set_meeting" timestamp with time zone,
	"date_closed" timestamp with time zone,
	"date_failed" timestamp with time zone,
	"deal_value" numeric(18, 2) DEFAULT '0',
	"pic_name" text,
	"is_deleted" boolean DEFAULT false,
	"deleted_at" timestamp with time zone,
	"auto_delete_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oi_forecasts" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"month_year" text NOT NULL,
	"product" text NOT NULL,
	"value" numeric(18, 2) DEFAULT '0',
	"campaign_number" integer,
	"budget_ads" numeric(18, 2) DEFAULT '0',
	"budget_creator" numeric(18, 2) DEFAULT '0',
	"gross_margin" numeric(18, 2) DEFAULT '0',
	"real_margin" numeric(18, 2) DEFAULT '0',
	"real_payment" numeric(18, 2) DEFAULT '0',
	"target_gmv" numeric(18, 2),
	"target_creator" numeric(18, 2),
	"target_video_affiliate" integer,
	"target_video_internal" integer,
	"target_views" integer,
	"success_rate" numeric(8, 2) DEFAULT '0',
	"status" "forecast_status" DEFAULT 'OPEN',
	"tier" text DEFAULT '-',
	"category" text,
	"last_follow_up" timestamp with time zone,
	"note_sales" text,
	"date_quotation" date,
	"pic_quotation" text,
	"date_invoice" date,
	"pic_invoice" text,
	"is_deleted" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oi_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"month_year" text NOT NULL,
	"product" text NOT NULL,
	"target_value" numeric(18, 2) DEFAULT '0',
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "user_role" PRIMARY KEY NOT NULL,
	"can_manage_users" boolean DEFAULT false,
	"can_set_targets" boolean DEFAULT false,
	"can_approve_edits" boolean DEFAULT false,
	"can_assign_pic" boolean DEFAULT false,
	"can_delete_leads" boolean DEFAULT false,
	"can_bulk_delete" boolean DEFAULT false,
	"can_edit_funnel_history" boolean DEFAULT false,
	"can_delete_funnel_history" boolean DEFAULT false,
	"can_clear_all_history" boolean DEFAULT false,
	"can_delete_notes" boolean DEFAULT false,
	"can_edit_deal_value" boolean DEFAULT false,
	"can_import_csv" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp with time zone NOT NULL,
	"priority" "task_priority" DEFAULT 'Medium',
	"status" "task_status" DEFAULT 'Todo',
	"assigned_to" text,
	"assigned_to_name" text,
	"created_by" text,
	"created_by_name" text,
	"lead_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"role" "user_role" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "global_audit_logs" ADD CONSTRAINT "global_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_history" ADD CONSTRAINT "funnel_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_history" ADD CONSTRAINT "funnel_history_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_targets" ADD CONSTRAINT "global_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_targets" ADD CONSTRAINT "individual_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_targets" ADD CONSTRAINT "individual_targets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oi_forecasts" ADD CONSTRAINT "oi_forecasts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "global_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "edit_requests_status_idx" ON "edit_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "edit_requests_created_at_idx" ON "edit_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "funnel_history_lead_id_idx" ON "funnel_history" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "funnel_history_lead_stage_idx" ON "funnel_history" USING btree ("lead_id","stage");--> statement-breakpoint
CREATE INDEX "funnel_history_lead_campaign_idx" ON "funnel_history" USING btree ("lead_id","stage","campaign_number");--> statement-breakpoint
CREATE INDEX "funnel_history_date_occurred_idx" ON "funnel_history" USING btree ("date_occurred");--> statement-breakpoint
CREATE UNIQUE INDEX "individual_targets_user_month_key" ON "individual_targets" USING btree ("user_id","month_year");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_id_idx" ON "lead_notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "leads_is_deleted_idx" ON "leads" USING btree ("is_deleted");--> statement-breakpoint
CREATE INDEX "leads_category_idx" ON "leads" USING btree ("category");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_brand_name_idx" ON "leads" USING btree ("brand_name");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "oi_forecasts_lead_id_idx" ON "oi_forecasts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "oi_forecasts_month_product_idx" ON "oi_forecasts" USING btree ("month_year","product");--> statement-breakpoint
CREATE UNIQUE INDEX "oi_targets_month_product_key" ON "oi_targets" USING btree ("month_year","product");--> statement-breakpoint
CREATE INDEX "tasks_assigned_to_idx" ON "tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "tasks_created_by_idx" ON "tasks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "tasks_lead_id_idx" ON "tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_id_key" ON "users" USING btree ("auth_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts" USING btree ("provider","providerAccountId");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens" USING btree ("identifier","token");