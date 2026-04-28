# Gateway Logging SDK

Node-first TypeScript SDK for sending external application logs into Gateway.

## Usage

```ts
import { createGatewayLogger } from "@wiolett/gateway-logger";

const logger = createGatewayLogger({
  endpoint: "https://gateway.example.com",
  token: process.env.GATEWAY_LOGGING_TOKEN!,
  service: "api",
  source: "main",
  labels: { app: "billing", region: "eu" },
  fields: { version: "2.4.1" },
  batching: {
    maxBatchSize: 100,
    flushDebounceMs: 250,
    flushIntervalMs: 5000,
    maxQueueSize: 10000,
    overflow: "drop-oldest",
  },
});

const payments = logger.child({
  service: "billing-api",
  labels: { module: "payments" },
  fields: { provider: "stripe" },
});

payments.error("Payment capture failed", {
  labels: { region: "us" },
  fields: { statusCode: 502, durationMs: 1834 },
});

const trace = logger.createTrace({ requestId: "req_123" });
trace.info("Checkout started");
const span = trace.createSpan("stripe.capture");
span.error("Capture failed");
await span.end();
await trace.end();

await logger.flush();
await logger.close();
```

## Delivery

- Logs are queued in memory.
- The SDK flushes automatically after `flushDebounceMs`.
- The SDK also flushes periodically every `flushIntervalMs`.
- Reaching `maxBatchSize` schedules an immediate flush.
- Transient errors are retried with capped exponential backoff.
- `429` responses pause delivery using `Retry-After` or Gateway's `details.retryAfterSeconds`.
- Permanent validation/auth failures are not retried.

Keep `gwl_` ingest tokens server-side. Do not expose them in browser code.
