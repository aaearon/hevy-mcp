import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Session = {
	transport: StreamableHTTPServerTransport;
	server: McpServer;
};

async function readBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			try {
				resolve(raw ? JSON.parse(raw) : undefined);
			} catch {
				resolve(undefined);
			}
		});
		req.on("error", reject);
	});
}

export function startHttpServer(
	buildServer: () => McpServer,
	port: number,
): Promise<Server> {
	const sessions = new Map<string, Session>();

	const httpServer = createServer(async (req, res) => {
		if (req.url !== "/mcp") {
			res.writeHead(404).end();
			return;
		}

		let body: unknown;
		if (req.method === "POST") body = await readBody(req);

		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		if (sessionId && sessions.has(sessionId)) {
			await sessions.get(sessionId)!.transport.handleRequest(req, res, body);
			return;
		}

		if (!sessionId && req.method === "POST" && isInitializeRequest(body)) {
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (id) => {
					sessions.set(id, { transport, server: mcpServer });
				},
			});
			transport.onclose = () => {
				if (transport.sessionId) sessions.delete(transport.sessionId);
			};
			const mcpServer = buildServer();
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, body);
			return;
		}

		res.writeHead(404).end(
			JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32000, message: "Session not found" },
				id: null,
			}),
		);
	});

	return new Promise((resolve, reject) => {
		httpServer.listen(port, () => resolve(httpServer));
		httpServer.on("error", reject);
	});
}
