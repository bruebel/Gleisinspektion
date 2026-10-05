CREATE TYPE "public"."element_typ" AS ENUM('gleis', 'weiche', 'signal', 'bauwerk', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."feststellung_status" AS ENUM('offen', 'in_bearbeitung', 'erledigt');--> statement-breakpoint
CREATE TYPE "public"."inspektion_status" AS ENUM('entwurf', 'abgeschlossen');--> statement-breakpoint
CREATE TYPE "public"."rolle" AS ENUM('admin', 'inspektor', 'empfaenger');--> statement-breakpoint
CREATE TABLE "ansprechpartner" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"gleisanschluss_id" uuid NOT NULL,
	"name" text NOT NULL,
	"funktion" text,
	"telefon" text,
	"email" text,
	"erhaelt_bericht" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benutzer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"rolle" "rolle" DEFAULT 'inspektor' NOT NULL,
	"passwort_hash" text,
	"ansprechpartner_id" uuid,
	"aktiv" boolean DEFAULT true NOT NULL,
	CONSTRAINT "benutzer_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "feststellung" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"inspektion_id" uuid NOT NULL,
	"lfd_nr" integer NOT NULL,
	"infrastrukturelement_id" uuid,
	"ort" text,
	"feststellung" text NOT NULL,
	"massnahme" text NOT NULL,
	"frist" date,
	"zustaendig" text,
	"zustaendig_kontakt_id" uuid,
	"status" "feststellung_status" DEFAULT 'offen' NOT NULL,
	"erledigt_am" timestamp with time zone,
	"erledigt_von_id" uuid
);
--> statement-breakpoint
CREATE TABLE "foto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"feststellung_id" uuid NOT NULL,
	"mime_typ" text DEFAULT 'image/jpeg' NOT NULL,
	"groesse" integer,
	"aufgenommen_am" timestamp with time zone,
	"reihenfolge" integer DEFAULT 0 NOT NULL,
	"datei_vorhanden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gleisanschluss" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"firma" text,
	"adresse" text,
	"bemerkung" text,
	"aktiv" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "infrastrukturelement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"gleisanschluss_id" uuid NOT NULL,
	"typ" "element_typ" NOT NULL,
	"bezeichnung" text NOT NULL,
	"beschreibung" text,
	"sortierung" integer DEFAULT 0 NOT NULL,
	"aktiv" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspektion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"gleisanschluss_id" uuid NOT NULL,
	"datum" date NOT NULL,
	"beginn" time,
	"ende" time,
	"durchfuehrender" text NOT NULL,
	"durchfuehrender_id" uuid,
	"teilnehmer" text,
	"bemerkung" text,
	"status" "inspektion_status" DEFAULT 'entwurf' NOT NULL,
	"abgeschlossen_am" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kommentar" (
	"id" uuid PRIMARY KEY NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"geaendert_am" timestamp with time zone DEFAULT now() NOT NULL,
	"server_geaendert_am" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"geloescht" boolean DEFAULT false NOT NULL,
	"feststellung_id" uuid NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sitzung" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"benutzer_id" uuid NOT NULL,
	"erstellt_am" timestamp with time zone DEFAULT now() NOT NULL,
	"laeuft_ab_am" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ansprechpartner" ADD CONSTRAINT "ansprechpartner_gleisanschluss_id_gleisanschluss_id_fk" FOREIGN KEY ("gleisanschluss_id") REFERENCES "public"."gleisanschluss"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benutzer" ADD CONSTRAINT "benutzer_ansprechpartner_id_ansprechpartner_id_fk" FOREIGN KEY ("ansprechpartner_id") REFERENCES "public"."ansprechpartner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feststellung" ADD CONSTRAINT "feststellung_inspektion_id_inspektion_id_fk" FOREIGN KEY ("inspektion_id") REFERENCES "public"."inspektion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feststellung" ADD CONSTRAINT "feststellung_infrastrukturelement_id_infrastrukturelement_id_fk" FOREIGN KEY ("infrastrukturelement_id") REFERENCES "public"."infrastrukturelement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feststellung" ADD CONSTRAINT "feststellung_zustaendig_kontakt_id_ansprechpartner_id_fk" FOREIGN KEY ("zustaendig_kontakt_id") REFERENCES "public"."ansprechpartner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feststellung" ADD CONSTRAINT "feststellung_erledigt_von_id_benutzer_id_fk" FOREIGN KEY ("erledigt_von_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foto" ADD CONSTRAINT "foto_feststellung_id_feststellung_id_fk" FOREIGN KEY ("feststellung_id") REFERENCES "public"."feststellung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastrukturelement" ADD CONSTRAINT "infrastrukturelement_gleisanschluss_id_gleisanschluss_id_fk" FOREIGN KEY ("gleisanschluss_id") REFERENCES "public"."gleisanschluss"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspektion" ADD CONSTRAINT "inspektion_gleisanschluss_id_gleisanschluss_id_fk" FOREIGN KEY ("gleisanschluss_id") REFERENCES "public"."gleisanschluss"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspektion" ADD CONSTRAINT "inspektion_durchfuehrender_id_benutzer_id_fk" FOREIGN KEY ("durchfuehrender_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar" ADD CONSTRAINT "kommentar_feststellung_id_feststellung_id_fk" FOREIGN KEY ("feststellung_id") REFERENCES "public"."feststellung"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kommentar" ADD CONSTRAINT "kommentar_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitzung" ADD CONSTRAINT "sitzung_benutzer_id_benutzer_id_fk" FOREIGN KEY ("benutzer_id") REFERENCES "public"."benutzer"("id") ON DELETE no action ON UPDATE no action;