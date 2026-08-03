import { runServer } from "./index.js";
import { MissingHevyApiKeyError } from "./utils/config.js";
import { createSafeErrorDiagnostic } from "@hevy-mcp/core";

void runServer().catch((error) => {
	if (error instanceof MissingHevyApiKeyError) {
		console.error(error.message);
	} else {
		console.error("Fatal error in main()", createSafeErrorDiagnostic(error));
	}
	process.exit(1);
});
