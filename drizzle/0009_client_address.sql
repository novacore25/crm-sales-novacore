-- Add optional client address to documents
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "client_address" text;
