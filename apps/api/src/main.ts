import { Logger } from "nestjs-pino";
import { createApp } from "./bootstrap.js";
import { loadConfig } from "./config/config.js";

const config = loadConfig();
const app = await createApp();
await app.listen({ port: config.PORT, host: "0.0.0.0" });
app.get(Logger).log(`listening on :${config.PORT}`, "Main");
