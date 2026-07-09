/**
 * Centralized telemetry initialization.
 *
 * This module MUST be imported before any other application code.
 * It sets up OpenTelemetry with dual export: Sentry (error events +
 * traces) and an OTel Collector (traces + metrics to Honeycomb).
 *
 * Sentry SDK: error events, performance traces, release tracking
 * OTel Collector → Honeycomb: performance traces, metrics
 */

import * as Sentry from "@sentry/node";
import {
	SentryPropagator,
	SentrySampler,
	SentrySpanProcessor,
} from "@sentry/opentelemetry";
import { trace, metrics } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

declare const __HEVY_MCP_NAME__: string | undefined;
declare const __HEVY_MCP_VERSION__: string | undefined;
declare const __HEVY_MCP_BUILD__: boolean | undefined;
declare const __OTEL_COLLECTOR_TOKEN__: string | undefined;

const name =
	typeof __HEVY_MCP_NAME__ === "string" ? __HEVY_MCP_NAME__ : "hevy-mcp";
const version =
	typeof __HEVY_MCP_VERSION__ === "string" ? __HEVY_MCP_VERSION__ : "dev";

// Collector token is injected at build time from the OTEL_COLLECTOR_TOKEN
// GitHub secret via tsdown.config.ts define. The collector forwards
// traces and metrics to Honeycomb, keeping the Honeycomb API key off the
// client. The collector endpoint is public (behind Cloudflare Tunnel).
const collectorToken =
	typeof __OTEL_COLLECTOR_TOKEN__ === "string" && __OTEL_COLLECTOR_TOKEN__
		? __OTEL_COLLECTOR_TOKEN__
		: (process.env.OTEL_COLLECTOR_TOKEN ?? "");

const COLLECTOR_ENDPOINT = "https://otel.chrisdoc.dev/v1";

const sentryRelease = process.env.SENTRY_RELEASE ?? `${name}@${version}`;

const resource = resourceFromAttributes({
	"service.name": name,
	"service.version": version,
});

// This fork keeps Sentry telemetry OPT-IN: no DSN is baked in, so Sentry only
// initializes when the user explicitly sets their own SENTRY_DSN. When unset,
// isValidDsn is false and Sentry.init receives dsn: undefined (a no-op).
const rawDsn = process.env.SENTRY_DSN;
const isValidDsn =
	typeof rawDsn === "string" && rawDsn.length > 0 && !rawDsn.startsWith("*");

// SENTRY_TRACES_SAMPLE_RATE is a fork-provided knob (default 1.0); invalid or
// unset values fall back to full sampling.
const parsedTracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
const sentryTracesSampleRate = Number.isFinite(parsedTracesSampleRate)
	? parsedTracesSampleRate
	: 1.0;

// --- Sentry (error monitoring + traces) ---
const sentryClient = Sentry.init({
	dsn: isValidDsn ? rawDsn : undefined,
	release: sentryRelease,
	tracesSampleRate: sentryTracesSampleRate,
	sendDefaultPii: false,
	skipOpenTelemetrySetup: true,
	registerEsmLoaderHooks: false,
	ignoreErrors: ["EPIPE", "broken pipe"],
});

// --- OpenTelemetry tracer provider (dual export) ---
const spanProcessors: SpanProcessor[] = [new SentrySpanProcessor()];

// Span processor 2: OTel Collector → Honeycomb (traces) — only if token is available
if (collectorToken) {
	spanProcessors.push(
		new BatchSpanProcessor(
			new OTLPTraceExporter({
				url: `${COLLECTOR_ENDPOINT}/traces`,
				headers: {
					Authorization: `Bearer ${collectorToken}`,
				},
			}),
		),
	);
}

const tracerProvider = new NodeTracerProvider({
	resource,
	sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
	spanProcessors,
});

tracerProvider.register({
	propagator: new SentryPropagator(),
	contextManager: new Sentry.SentryContextManager(),
});

// --- OpenTelemetry meter provider (→ Collector → Honeycomb metrics) ---
if (collectorToken) {
	const meterProvider = new MeterProvider({
		resource,
		readers: [
			new PeriodicExportingMetricReader({
				exporter: new OTLPMetricExporter({
					url: `${COLLECTOR_ENDPOINT}/metrics`,
					headers: {
						Authorization: `Bearer ${collectorToken}`,
					},
				}),
				exportIntervalMillis: 10_000,
			}),
		],
	});
	metrics.setGlobalMeterProvider(meterProvider);
}

trace.setGlobalTracerProvider(tracerProvider);

// Validate that Sentry + OpenTelemetry are wired correctly
Sentry.validateOpenTelemetrySetup();

// --- Shared instances for the rest of the codebase ---
export const tracer = trace.getTracer(name);
export const meter = metrics.getMeter(name);
export { Sentry };

/**
 * Bundled service identity — avoids passing name and version as
 * separate primitives throughout the codebase (Data Clumps smell).
 */
export interface ServiceInfo {
	readonly name: string;
	readonly version: string;
}

export const serviceInfo: ServiceInfo = { name, version } as const;

// Keep individual exports for backward compatibility
export { name as serviceName, version as serviceVersion };

// --- User context for span attributes ---
let currentUserId: string | undefined;

export function setCurrentUserId(id: string): void {
	currentUserId = id;
}

export function getCurrentUserId(): string | undefined {
	return currentUserId;
}
