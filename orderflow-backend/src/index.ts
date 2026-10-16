import { app } from "./app";
import { config } from "./config";
import { startupWarnings } from "./lib/startup-checks";
import { startReminderWorker } from "./worker/reminders";

app.listen(config.port, () => {
  console.log(`OrderFlow API listening on :${config.port}`);
  for (const w of startupWarnings(config)) console.warn(`[config warning] ${w}`);
  startReminderWorker();
});
