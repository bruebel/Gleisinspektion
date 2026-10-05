ALTER TABLE "gleisanschluss" ADD COLUMN "kuerzel" text;--> statement-breakpoint
ALTER TABLE "gleisanschluss" ADD CONSTRAINT "gleisanschluss_kuerzel_unique" UNIQUE("kuerzel");