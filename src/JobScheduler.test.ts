import { IEventExecutionState, createInitialEventExecutionState, createJobRouter } from "./JobRouter";
import { createJobScheduler } from "./JobScheduler";
import { test, jest, expect } from '@jest/globals';
import { typedExpect } from "./tests/typedExpect";


test('create initial works with sleep', ()=> {
  type Events = {
    "user.created": {
      userId: string;
    };
  };
  const job = createInitialEventExecutionState<Events, 'user.created'>({
    eventName: "user.created",
    data: {
      userId: 'asdf'
    },
    traceId: '456',
    delaySeconds: 15,
    jobId: '123'
  });

  typedExpect(job).toMatchObject({
    event: {
      traceId: '456',
    },
    state: {
      status: 'sleeping',
      numberOfSecondsToSleep: 15,
    }
  })
})

test('create initial works without sleep', ()=> {
  type Events = {
    "user.created": {
      userId: string;
    };
  };
  const job = createInitialEventExecutionState<Events, 'user.created'>({
    eventName: "user.created",
    data: {
      userId: 'asdf'
    },
    jobId: '123'
  });

  typedExpect(job).toMatchObject({
    state: {
      status: 'ready',
      numberOfSecondsToSleep: 0,
    }
  })
})

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

  const sender = createJobScheduler<Events>((jobs) =>
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
  
  const sender = createJobScheduler<Events>((jobs) => Promise.resolve([]));

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


test('should send jobs with traceId', async () => {
  type Events = {
    'user.created': {
      userId: string;
    }
  }

    let spy = jest.fn<Parameters<typeof createJobScheduler>[0]>()
    spy.mockResolvedValue(undefined);
    const sender = createJobScheduler<Events>(spy);

    await sender.send('user.created', { userId: '123' }, { traceId: '456' });
    await sender.send('user.created', { userId: '999'}, { traceId: '456' });

    expect(spy.mock.calls[0][0][0].event.traceId).toBe('456');
    expect(spy.mock.calls[0][0][0].event.data).toMatchObject({ userId: '123' });
    
    expect(spy.mock.calls[1][0][0].event.traceId).toBe('456');
    expect(spy.mock.calls[1][0][0].event.data).toMatchObject({ userId: '999' });
});