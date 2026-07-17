ALTER TABLE "database_connections" ADD COLUMN "slug" varchar(60);--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "slug" varchar(60);--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "slug" varchar(60);--> statement-breakpoint

CREATE FUNCTION "gateway_slug_transliterate"("input_value" text) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
	"value" text := lower(normalize(coalesce("input_value", ''), NFC));
BEGIN
	"value" := replace("value", 'ё', 'yo');
	"value" := replace("value", 'ж', 'zh');
	"value" := replace("value", 'й', 'y');
	"value" := replace("value", 'х', 'kh');
	"value" := replace("value", 'ц', 'ts');
	"value" := replace("value", 'ч', 'ch');
	"value" := replace("value", 'ш', 'sh');
	"value" := replace("value", 'щ', 'shch');
	"value" := replace("value", 'ъ', '');
	"value" := replace("value", 'ы', 'y');
	"value" := replace("value", 'ь', '');
	"value" := replace("value", 'э', 'e');
	"value" := replace("value", 'ю', 'yu');
	"value" := replace("value", 'я', 'ya');
	"value" := replace("value", 'ї', 'yi');
	"value" := replace("value", 'є', 'ye');
	"value" := replace("value", 'ў', 'u');
	"value" := translate("value", 'абвгдезиклмнопрстуфіґ', 'abvgdeziklmnoprstufig');

	"value" := normalize("value", NFD);
	"value" := regexp_replace("value", U&'[\0300-\036f]', '', 'g');
	"value" := replace("value", 'æ', 'ae');
	"value" := replace("value", 'œ', 'oe');
	"value" := replace("value", 'ß', 'ss');
	"value" := replace("value", 'þ', 'th');
	"value" := translate("value", 'øłđðħı', 'olddhi');

	RETURN "value";
END
$function$;--> statement-breakpoint

CREATE FUNCTION "gateway_slug_base"("input_value" text, "fallback_value" text, "max_length" integer) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
	"value" text;
BEGIN
	"value" := regexp_replace("gateway_slug_transliterate"("input_value"), '[^a-z0-9]+', '-', 'g');
	"value" := regexp_replace("value", '(^-+|-+$)', '', 'g');
	"value" := regexp_replace(left("value", "max_length"), '-+$', '', 'g');

	IF "value" = '' THEN
		"value" := regexp_replace("gateway_slug_transliterate"("fallback_value"), '[^a-z0-9]+', '-', 'g');
		"value" := regexp_replace("value", '(^-+|-+$)', '', 'g');
		"value" := regexp_replace(left("value", "max_length"), '-+$', '', 'g');
	END IF;

	IF "value" = '' THEN
		"value" := left('resource', "max_length");
	END IF;

	RETURN "value";
END
$function$;--> statement-breakpoint

CREATE FUNCTION "gateway_slug_candidate"("base_value" text, "collision_index" integer, "max_length" integer) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
	"suffix" text := CASE WHEN "collision_index" = 0 THEN '' ELSE '-' || "collision_index"::text END;
	"prefix" text;
BEGIN
	"prefix" := regexp_replace(left("base_value", "max_length" - char_length("suffix")), '-+$', '', 'g');
	RETURN "prefix" || "suffix";
END
$function$;--> statement-breakpoint

DO $block$
DECLARE
	"node_row" record;
	"base_value" text;
	"candidate_value" text;
	"collision_index" integer;
BEGIN
	FOR "node_row" IN
		SELECT "id", coalesce(nullif(btrim("display_name"), ''), "hostname") AS "source_value"
		FROM "nodes"
		ORDER BY "created_at", "id"
	LOOP
		"base_value" := "gateway_slug_base"("node_row"."source_value", 'node', 60);
		"collision_index" := CASE WHEN "base_value" IN ('file', 'console') THEN 1 ELSE 0 END;
		LOOP
			"candidate_value" := "gateway_slug_candidate"("base_value", "collision_index", 60);
			EXIT WHEN NOT EXISTS (SELECT 1 FROM "nodes" WHERE "slug" = "candidate_value");
			"collision_index" := "collision_index" + 1;
		END LOOP;
		UPDATE "nodes" SET "slug" = "candidate_value" WHERE "id" = "node_row"."id";
	END LOOP;
END
$block$;--> statement-breakpoint

DO $block$
DECLARE
	"database_row" record;
	"base_value" text;
	"candidate_value" text;
	"collision_index" integer;
BEGIN
	FOR "database_row" IN
		SELECT "id", "name" AS "source_value"
		FROM "database_connections"
		ORDER BY "created_at", "id"
	LOOP
		"base_value" := "gateway_slug_base"("database_row"."source_value", 'database', 60);
		"collision_index" := 0;
		LOOP
			"candidate_value" := "gateway_slug_candidate"("base_value", "collision_index", 60);
			EXIT WHEN NOT EXISTS (SELECT 1 FROM "database_connections" WHERE "slug" = "candidate_value");
			"collision_index" := "collision_index" + 1;
		END LOOP;
		UPDATE "database_connections" SET "slug" = "candidate_value" WHERE "id" = "database_row"."id";
	END LOOP;
END
$block$;--> statement-breakpoint

DO $block$
DECLARE
	"proxy_row" record;
	"base_value" text;
	"candidate_value" text;
	"collision_index" integer;
BEGIN
	FOR "proxy_row" IN
		SELECT "id", nullif(btrim("domain_names" ->> 0), '') AS "source_value"
		FROM "proxy_hosts"
		ORDER BY "created_at", "id"
	LOOP
		"base_value" := "gateway_slug_base"("proxy_row"."source_value", 'proxy-host', 60);
		"collision_index" := CASE WHEN "base_value" = 'new' THEN 1 ELSE 0 END;
		LOOP
			"candidate_value" := "gateway_slug_candidate"("base_value", "collision_index", 60);
			EXIT WHEN NOT EXISTS (SELECT 1 FROM "proxy_hosts" WHERE "slug" = "candidate_value");
			"collision_index" := "collision_index" + 1;
		END LOOP;
		UPDATE "proxy_hosts" SET "slug" = "candidate_value" WHERE "id" = "proxy_row"."id";
	END LOOP;
END
$block$;--> statement-breakpoint

ALTER TABLE "database_connections" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_slug_unique" UNIQUE("slug");--> statement-breakpoint

DROP FUNCTION "gateway_slug_candidate"(text, integer, integer);--> statement-breakpoint
DROP FUNCTION "gateway_slug_base"(text, text, integer);--> statement-breakpoint
DROP FUNCTION "gateway_slug_transliterate"(text);
