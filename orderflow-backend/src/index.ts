import { app } from "./app";
import { config } from "./config";
import { startReminderWorker } from "./worker/reminders";

app.listen(config.port, () => {
  console.log(`OrderFlow API listening on :${config.port}`);
  startReminderWorker();
});
