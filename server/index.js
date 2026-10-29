import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDuoServer } from "./app.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT ?? 8787);
const staticDir = process.env.NODE_ENV === "production" ? path.join(root, "dist") : null;

const { server } = createDuoServer({ staticDir });
server.listen(port, () => console.log(`Daily Duo server on http://localhost:${port}`));
