import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createCorsaConfigJsonSchema } from "../src/lib/config/schema";

const schemaPath = join(import.meta.dir, "..", "schemas", "corsa.schema.json");
const schema = createCorsaConfigJsonSchema();

await mkdir(dirname(schemaPath), { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf-8");

console.log(`Generated ${schemaPath}`);
