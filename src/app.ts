import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import swaggerUi from "swagger-ui-express";
import yaml from "js-yaml";
import apiRouter from "./routes";

const app = express();
app.use(
  express.json({
    type: ["application/json", "application/*+json", "text/plain"],
  }),
);
app.use(express.urlencoded({ extended: true }));

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

// Ensure BigInt values (e.g., Postgres bigint) can be returned as JSON.
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  (res as unknown as { json: (body: unknown) => unknown }).json = (body) =>
    originalJson(jsonSafe(body));
  next();
});

// Swagger UI (serves openapi.yaml)
const openApiPath = path.join(process.cwd(), "openapi.yaml");
if (fs.existsSync(openApiPath)) {
  const raw = fs.readFileSync(openApiPath, "utf8");
  const spec = yaml.load(raw) as object;

  app.get("/openapi.yaml", (_req, res) => {
    res.type("text/yaml").send(raw);
  });

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
}

app.use(apiRouter);

// Handle invalid JSON bodies with a clean 400 response.
// (Avoids noisy stack traces when a client sends non-JSON like { userId: ... }.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const maybeErr = err as
    | (SyntaxError & { status?: unknown; type?: unknown })
    | undefined;

  if (
    maybeErr instanceof SyntaxError &&
    (maybeErr as { status?: unknown }).status === 400 &&
    (maybeErr as { type?: unknown }).type === "entity.parse.failed"
  ) {
    return res.status(400).json({
      error:
        "invalid JSON body (use double-quoted property names and strings)",
    });
  }
  return next(err);
});

export default app;

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on port ${port}`);
  });
}
