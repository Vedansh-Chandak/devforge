# @repo/logger

Shared Pino logger for DevForge.

## Usage

```ts
import { logger } from "@repo/logger";

logger.info("server started");
logger.warn("deprecation notice");
logger.error({ err }, "failed");
logger.debug("payload", payload);
```

## Environment behavior

- `NODE_ENV=development` -> pretty-printed output via `pino-pretty`
- `NODE_ENV=production`  -> raw JSON output

Environment is read exclusively from `@devforge/config`.
