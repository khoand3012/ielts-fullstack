// Writes the backend's OpenAPI schema to types/openapi.json without starting the server.
// Builds the schema from the FastAPI app object, so no database is needed.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const backendDir = fileURLToPath(new URL("../../ielts-backend", import.meta.url));
const outFile = fileURLToPath(new URL("../types/openapi.json", import.meta.url));

const json = execFileSync(
  "uv",
  [
    "run",
    "--directory",
    backendDir,
    "python",
    "-c",
    "import json;from api.main import app;print(json.dumps(app.openapi(),indent=1))",
  ],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);

JSON.parse(json);
mkdirSync(new URL("../types", import.meta.url), { recursive: true });
writeFileSync(outFile, json);
console.log(`wrote ${outFile}`);
