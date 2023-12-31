# example

```typescript
// event-schema.ts
type EventsSchema = {
  "user.created": {
    userId: string
  }
};

// job-router.ts
const router = createJobRouter<EventsSchema>().on("user.created", [
  router.createHandler(
    "send verification email",
    async ({ ctx, step, data: { userId, text } }) => {
      const email = await step.run("send verification email", () =>
        ctx.email.send({ userId, text })
      );

      await step.sleep(1, "day");

      await step.run("check if email was verified", () =>
        ctx.email.handleVerification(email)
      );
    }
  ),
]);

// scheduler.ts
// he we use SQS as our worker queue but you could use anything
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

const scheduler = createJobScheduler<EventsSchema>((job) =>
  sqs.send(
    new SendMessageCommand({
      MessageBody: JSON.stringify(job),
      QueueUrl: process.env.JOB_QUEUE_URL,
      DelaySeconds: getDelaySeconds(job),
    })
  )
);

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

- It's common for queues like SQS to guarantee **at least** once delivery, so keep your handlers idempotent in case the same event is run more than once
