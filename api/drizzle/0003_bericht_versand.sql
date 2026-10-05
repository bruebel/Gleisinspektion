CREATE TABLE "bericht_versand" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspektion_id" uuid NOT NULL,
	"versendet_am" timestamp with time zone DEFAULT now() NOT NULL,
	"absender" text NOT NULL,
	"empfaenger" text[] NOT NULL,
	"benutzer_id" uuid
);
--> statement-breakpoint
ALTER TABLE "bericht_versand" ADD CONSTRAINT "bericht_versand_inspektion_id_inspektion_id_fk" FOREIGN KEY ("inspektion_id") REFERENCES "public"."inspektion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bericht_versand" ADD CONSTRAINT "bericht_versand_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;