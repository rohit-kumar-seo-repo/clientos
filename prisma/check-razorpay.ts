import "dotenv/config";
import { isRazorpayConfigured, getRazorpayMode, verifyApiConnectivity } from "../src/lib/razorpay";

/**
 * Runs on every container start (see docker-entrypoint.sh) — a lightweight,
 * read-only ping so a misconfigured LIVE key shows up in the deploy logs
 * immediately, before any real customer hits it. Never fails the container
 * start: a Razorpay-side hiccup here must not take the whole app down, and
 * the error itself is never logged (only a generic status), since it could
 * otherwise echo back more than intended.
 */
async function main() {
  if (!isRazorpayConfigured()) {
    console.log("Razorpay check: not configured — skipping.");
    return;
  }
  const mode = getRazorpayMode();
  try {
    await verifyApiConnectivity();
    console.log(`Razorpay check: API reachable (mode: ${mode}).`);
  } catch {
    console.log(`Razorpay check: configured (mode: ${mode}) but the API did not respond successfully — verify the key/secret in Razorpay's dashboard.`);
  }
}

main().finally(() => process.exit(0));
