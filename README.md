# example

```typescript
// event-schema.ts
type EventsSchema = {
  "user.created": {
    userId: string;
  };
};

// job-router.ts
const router = createJobRouter<EventsSchema>().on("user.created", [
  router.createHandler(
    "send welcome email",
    async ({ ctx, step, data: { userId } }) => {
      await step.run("log analytics", () => ctx.analytics.log("new user yay!"));

      await step.sleep("wait for 1 day", [1, "day"]);

      await step.run("send marketing email", () => ctx.email.send("welcome"));
    }
  ),
]);

// scheduler.ts
// he we use SQS as our scheduler but you could use anything
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

const scheduler = createJobScheduler<EventsSchema>((job) => {
  await sqs.send(
    new SendMessageCommand({
      MessageBody: JSON.stringify(job),
      QueueUrl: process.env.JOB_QUEUE_URL,
      DelaySeconds: getDelaySeconds(job),
    })
  );
});

// sqs-worker.js
// a lambda function that processes the SQS queue
import { SQSHandler } from "aws-lambda";
const worker = createJobWorker<EventSchema>({
  scheduler,
  router,
  createCtx: () => ({ analytics, email }),
});

export const handler: SQSHandler = async (event) => {
  const jobs = event.Records.map((record) => JSON.parse(record.body));

  await worker.handleMany(jobs);
};

// your-application.ts
scheduler.send("user.created", { userId: "123" });
```

# suggestions
* It's common for queues like SQS to guarantee **at least** once delivery, so keep your handlers idempotent so that route handlers can be run more than once