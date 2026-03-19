import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCorsaConfigJsonSchema } from "../schema";

describe("Config schema", () => {
	test("generated JSON schema file matches Zod schema", async () => {
		const schemaPath = join(
			import.meta.dir,
			"..",
			"..",
			"..",
			"..",
			"schemas",
			"corsa.schema.json",
		);

		const actual = JSON.parse(await readFile(schemaPath, "utf-8")) as object;
		const expected = createCorsaConfigJsonSchema();

		expect(actual).toEqual(expected);
	});
});
