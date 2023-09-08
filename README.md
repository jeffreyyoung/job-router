# example
```typescript
// event-schema.ts
type EventsSchema = {
    'user.created': {
        userId: string
    }
}


// job-router.ts
const router = createJobRouter<EventsSchema>();


router.on('user.created', [
    router.createHandler('send welcome email', async ({ ctx, step, data: { userId } }) => {
        await step.run('log analytics', () => ctx.analytics.log('new user yay!'));

        await step.sleep('wait for 1 day', [1, 'day']);

        await step.run('send marketing email', () => ctx.email.send('Hi'))
    })
]);


// scheduler.ts
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({})

const scheduler = createJobScheduler<EventsSchema>((job) => {
    await sqs.send(new SendMessageCommand({
        MessageBody: JSON.stringify(job),
        QueueUrl: process.env.JOB_QUEUE_URL,
        DelaySeconds: job.status.type === "readyAt" ? job.status.readyAtDelaySeconds : 0,
    }));
});


// sqs-worker.js
import { SQSHandler } from "aws-lambda";
const worker = createJobWorker<EventSchema>({
    scheduler,
    router,
    createCtx: () => ({ analytics, email })
});

export const handler: SQSHandler = async (event) => {
    const jobs = event.Records.map(jsonString => JSON.parse(jsonString));

    await worker.handleMany(jobs);
}



// your-application.ts

scheduler.send('user.created', { userId: '123' });
```