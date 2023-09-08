import { createJobRouter } from "./JobRouter";
import { createJobSender } from "./JobSender";
import { test, jest, expect } from '@jest/globals';
test("job sender should work", () => {
  type Events = {
    "user.created": {
      userId: string;
    };
  };
  const i = createJobRouter<Events>();
  const fn = jest.fn<any>();
  fn.mockResolvedValue(undefined);

  i.on("user.created", [i.createHandler("welcome flow", fn)]);

  let queue: any[] = [];

  const sender = createJobSender<Events>((jobs) =>
    Promise.resolve(queue.push(...jobs))
  );

  sender.send("user.created", {
    userId: "123",
  });

  while (queue.length > 0) {
    const state = queue.shift();
    if (state) {
      i.ingest(state);
    }
  }
});

test('types should fail', async () => {
  type Events = {
    'user.created': {
      userId: string
    },
    'order.created': {
      orderId: string
    }
  }
  
  const sender = createJobSender<Events>((jobs) => Promise.resolve([]));

  // @ts-expect-error
  await sender.send('asdf', { userId: 'yay' })

  await sender.send('user.created', {
    // @ts-expect-error
    orderId: 'asdf'
  });

  await sender.send('user.created', {
    userId: 'meow'
  })

  expect(true).toBe(true);
});
