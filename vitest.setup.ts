import "dotenv/config";
import { config } from "dotenv";

// Load .env.test AFTER dotenv/config's default .env load, so it overrides
// DATABASE_URL to point at clientos_test instead of clientos_dev.
config({ path: ".env.test", override: true });
