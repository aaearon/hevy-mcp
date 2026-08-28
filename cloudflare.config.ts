import { bindings, defineWorker } from "wrangler/experimental-config";
import * as entrypoint from "./packages/worker/src/worker.ts" with { type: "cf-worker" };

interface WorkerEnvironmentBindings {
	[key: string]:
		| ReturnType<typeof bindings.kv>
		| ReturnType<typeof bindings.text>;
	OAUTH_KV: ReturnType<typeof bindings.kv>;
}

export default defineWorker((ctx) => {
	const environment =
		process.env.WRANGLER_MODE ??
		ctx.mode ??
		process.env.CLOUDFLARE_ENV ??
		"development";
	const route = process.env.CLOUDFLARE_WORKER_ROUTE?.trim();
	const workerName =
		process.env.CLOUDFLARE_WORKER_NAME?.trim() ??
		(environment === "preview" ? "hevy-mcp-preview" : "hevy-mcp");
	const kvNamespaceId = process.env.CLOUDFLARE_OAUTH_KV_NAMESPACE_ID?.trim();

	const env: WorkerEnvironmentBindings = {
		OAUTH_KV: bindings.kv(kvNamespaceId ? { id: kvNamespaceId } : undefined),
	};
	if (environment === "preview")
		env.MCP_DISABLE_ORIGIN_CHECK = bindings.text("true");
	return {
		name: workerName,
		entrypoint,
		compatibilityDate: "2026-07-11",
		compatibilityFlags: ["global_fetch_strictly_public"],
		workersDev: environment === "development",
		previewUrls: true,
		domains: route ? [route] : undefined,
		env,
	};
});
