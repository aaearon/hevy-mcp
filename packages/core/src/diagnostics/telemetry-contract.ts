/**
 * Observation contract shared by Core and the Worker adapter.
 *
 * Upstream also declares user-pseudonym constants here (a hash context
 * string, a digest length, and a matching validation pattern) whose only
 * purpose is to build a Sentry user id. They are deliberately absent from
 * this fork and must be dropped again on every upstream merge; see the
 * "No Telemetry, No Phone-Home" section of AGENTS.md. The guard test
 * `tests/unit/no-runtime-telemetry.test.ts` fails if they return, which is
 * also why this comment does not spell their names out.
 */

/**
 * Argument keys telemetry may name. Both adapters project tool arguments
 * against this list; keys missing here are silently excluded everywhere.
 */
export const TELEMETRY_ARGUMENT_KEYS: readonly string[] = Object.freeze([
	"page",
	"page_size",
	"since",
	"workout_id",
	"routine_id",
	"folder_id",
	"exercise_template_id",
	"date",
	"start_date",
	"end_date",
	"updated_since",
	"include_custom",
	"limit",
	"offset",
	"refresh",
	"query",
	"primary_muscle_group",
]);
