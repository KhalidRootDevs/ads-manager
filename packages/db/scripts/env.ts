/** Loads ../../.env for CLI scripts. Services get env from their runtime. */
import { config } from "dotenv"
import { fileURLToPath } from "node:url"
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true })
