import { JobRouterArgs, createJobRouter } from "./JobRouter";
import { __do_not_use_createJobRouterMock } from "./tests/_do_not_use_hardcoded_mock";
import { MockJobRouterConfig, createMockJobRouter } from "./tests/JobMocker";
import { createJobScheduler } from "./JobScheduler";
import { createJobWorker } from "./JobWorker";
import { expect, test, describe, beforeEach, jest } from "@jest/globals";
import { typedExpect } from "./tests/typedExpect";

type Jobs = {
  "user.created": {
    userId: string;
  };
};

test("job should pass successfully", async () => {
  const { mocks, run } = __do_not_use_createJobRouterMock();

  await run("user.created", {
    userId: "123",
  });

  expect(mocks["user.created"]["3StepsAndSleep"].handler).toHaveBeenCalledTimes(
    2
  );
  expect(
    mocks["user.created"]["3StepsAndSleep"].steps[0]
  ).toHaveBeenCalledTimes(1);
  expect(
    mocks["user.created"]["3StepsAndSleep"].steps[1] // this one is called after sleep
  ).toHaveBeenCalledTimes(1);
});

test("sendJob.iterator", async () => {
  const { mocks, runIterator } = __do_not_use_createJobRouterMock();
  const iterator = await runIterator("user.created", {
    userId: "123",
  });

  typedExpect(await iterator.next()).toMatchObject({
    done: false,
    value: {
      status: "needsRetry",
      nextJobs: [
        {
          state: {
            status: "sleeping",
          },
        },
      ],
    },
  });

  typedExpect(await iterator.next()).toMatchObject({
    done: false,
    value: {
      status: "success",
      nextJobs: [],
    },
  });
});

test("sendJob.flush should work", async () => {
  const { mocks, run } = __do_not_use_createJobRouterMock();

  typedExpect(
    await run("user.created", {
      userId: "123",
    })
  ).toMatchObject([
    {
      nextJobs: [
        {
          state: {
            status: "sleeping",
          },
        },
      ],
    },
    {
      nextJobs: [],
    },
  ]);
});

test("should sleeping function should retry last", async () => {
  const { mocks, runIterator, queue } = __do_not_use_createJobRouterMock();
  const func1Mocks = mocks["user.created"]["3Steps"];
  func1Mocks.steps[0].mockRejectedValueOnce("something went wrong 1");
  func1Mocks.steps[1].mockRejectedValueOnce("something went wrong 2");
  func1Mocks.steps[2].mockRejectedValueOnce("something went wrong 3");

  const iterator = await runIterator("user.created", {
    userId: "123",
  });

  async function nextExecutionSummary() {
    let r = await iterator.next();
    return r.value!.insights.executedFunctionsAndSteps();
  }
  expect(await nextExecutionSummary()).toMatchObject({
    "3Steps": {
      "3Steps.step0": "error",
    },
    "3StepsAndSleep": {
      "3StepsAndSleep.step0": "success",
      "sleep for a day": "sleeping",
    },
  });

  expect(await nextExecutionSummary()).toMatchObject({
    "3Steps": {
      "3Steps.step0": "success",
      "3Steps.step1": "error",
    },
  });

  expect(await nextExecutionSummary()).toMatchObject({
    "3Steps": {
      "3Steps.step1": "success",
      "3Steps.step2": "error",
    },
  });

  expect(await nextExecutionSummary()).toMatchObject({
    "3Steps": {
      "3Steps.step2": "success",
    },
  });

  expect(await nextExecutionSummary()).toMatchObject({
    "3StepsAndSleep": {
      "3StepsAndSleep.step1": "success",
      "3StepsAndSleep.step2": "success",
      "sleep for a day": "success",
    },
  });

  expect(queue.length).toBe(0);
});

test("job should fail with max retries exceeded", async () => {
  const { mocks, run } = __do_not_use_createJobRouterMock();

  mocks["user.created"]["3StepsAndSleep"].steps[1].mockRejectedValue(
    "something went wrong"
  );

  let allJobResults = await run("user.created", {
    userId: "123",
  });

  typedExpect(allJobResults).toMatchObject([
    {
      status: "needsRetry",
    },
    {
      status: "needsRetry",
    },
    {
      status: "needsRetry",
    },
    {
      status: "needsRetry",
    },
    {
      status: "maxRetriesExceeded",
    },
  ]);

  expect(mocks["user.updated"]["1step"].handler).toHaveBeenCalledTimes(0);
  expect(mocks["user.created"]["3Steps"].handler).toHaveBeenCalledTimes(1);
  expect(mocks["user.created"]["3StepsAndSleep"].handler).toHaveBeenCalledTimes(
    5
  );

  expect(mocks._beforeHandleJob).toHaveBeenCalledTimes(5);
  // expect(mocks._beforeHandleJob.mock.calls).toMatchObject();

  expect(mocks._afterHandleJob).toHaveBeenCalledTimes(5);

  // runs successfully and is not retried
  expect(mocks["user.created"]["3Steps"].handler).toHaveBeenCalledTimes(1);

  expect(
    mocks["user.created"]["3StepsAndSleep"].steps[0]
  ).toHaveBeenCalledTimes(1);
  expect(
    mocks["user.created"]["3StepsAndSleep"].steps[1] // this one is called after sleep
  ).toHaveBeenCalledTimes(4);
  expect(
    mocks["user.created"]["3StepsAndSleep"].steps[2]
  ).toHaveBeenCalledTimes(0);
});

test("job should fail and retry", async () => {
  const { mocks, scheduler, run } = __do_not_use_createJobRouterMock();
  const functionMocks = mocks["user.created"]["3StepsAndSleep"];

  functionMocks.steps[1].mockRejectedValueOnce("something went wrong");

  await run("user.created", { userId: "123" });

  expect(functionMocks.steps[1]).toHaveBeenCalledTimes(2);

  expect(functionMocks.steps[2]).toHaveBeenCalledTimes(1);

  // first run, sleep, retry
  expect(functionMocks.handler).toHaveBeenCalledTimes(3);
  expect(mocks["user.created"]["3Steps"].handler).toHaveBeenCalledTimes(1);
});

describe("job worker should work", () => {
  // create router
  const router = createJobRouter<Jobs>();
  let mock = jest.fn<any>();
  let onProcessedJobMock = jest.fn<any>();
  router.on("user.created", [router.createHandler("welcome flow", mock)]);

  const worker = createJobWorker({
    createCtx: () => ({}),
    router,
    scheduler: createJobScheduler(async (jobs) => {
      // console.log("processing job", state);
      await worker.handleMany(jobs);
    }),
    hooks: {
      afterHandleJob: onProcessedJobMock,
    },
  });

  beforeEach(() => {
    mock.mockReset();
    onProcessedJobMock.mockReset();
    onProcessedJobMock.mockResolvedValue(undefined);
    mock.mockResolvedValue(undefined);
  });

  test("should not do more than 3 retries", async () => {
    mock.mockRejectedValue("Service unavailable");

    await expect(
      worker.handleMany([
        router.utils.createJobForEvent("user.created", { userId: "123" }),
      ])
    ).resolves.toMatchObject([
      {
        result: {
          numberOfFailedPreviousAttempts: 1,
          numberOfPreviousAttempts: 1,
          functionStates: {
            "welcome flow": {
              state: {
                err: "Service unavailable",
                numberOfFailedPreviousAttempts: 1,
                numberOfPreviousAttempts: 1,
                status: "error",
              },
            },
          },
          state: {
            status: "complete-with-error",
          },
        },
        status: "needsRetry",
      },
    ]);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  test("should succeed not retry when no failures", async () => {
    mock.mockResolvedValue("yay");

    expect(
      await worker.handleMany([
        router.utils.createJobForEvent("user.created", { userId: "123" }),
      ])
    ).toMatchObject([
      {
        nextJobs: [],
        result: {
          event: {
            eventName: "user.created",
          },
          functionStates: {
            "welcome flow": {
              functionName: "welcome flow",
              state: {
                numberOfFailedPreviousAttempts: 0,
                numberOfPreviousAttempts: 1,
                result: "yay",
                status: "success",
              },
              stepStates: {},
            },
          },
          numberOfFailedPreviousAttempts: 0,
          numberOfPreviousAttempts: 1,
          state: {
            status: "complete",
          },
        },
        status: "success",
      },
    ]);

    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("jobRouter maxRetries", () => {});
test('should not retry when "maxRetries" is set to 0', async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
    },
  } satisfies MockJobRouterConfig<Jobs>;

  const { mocks, run } = createMockJobRouter(config, {
    maxRetries: 0,
  });

  mocks
    .get("user.created", "function 1", "step 2")
    .mockRejectedValue("something went wrong");

  const { finalOutcome, summary, results } = await run("user.created", {
    userId: "123",
  });
  expect(results.length).toBe(1);
  expect(finalOutcome).toBe("maxRetriesExceeded");
  expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function 1": {
      "step 1": "success",
      "step 2": "error",
    },
  },
}
`);
});

test('hooks should work', async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
      "function 2": {
        "step 1": "step",
        "step 2": ["sleep", 1, "days"],
        "step 3": "step",
      }
    },
  } satisfies MockJobRouterConfig<Jobs>;

  type Hooks = Required<Required<JobRouterArgs<any>>['hooks']>;
  const hooks = {
    beforeExecuteFunction: jest.fn<Hooks['beforeExecuteFunction']>(),
    afterExecuteFunction: jest.fn<Hooks['afterExecuteFunction']>(),
    beforeExecuteStep: jest.fn<Hooks['beforeExecuteStep']>(),
    afterExecuteStep: jest.fn<Hooks['afterExecuteStep']>(),
  }
  const { mocks, run } = createMockJobRouter(config, {
    maxRetries: 1,
    hooks
  });

  await run("user.created", { 
    userId: 'abc'
  });

  expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(3);
  expect(hooks.beforeExecuteFunction.mock.calls.map((call) => call[0].functionName)).toMatchInlineSnapshot(`
[
  "function 1",
  "function 2",
  "function 2",
]
`);
  expect(hooks.afterExecuteFunction).toHaveBeenCalledTimes(3);
  expect(hooks.afterExecuteFunction.mock.calls.map((call) => call[0].functionName)).toMatchInlineSnapshot(`
[
  "function 2",
  "function 1",
  "function 2",
]
`);

expect(hooks.beforeExecuteStep.mock.calls.map(([arg]) => [arg.functionName,arg.stepName, arg.stepState?.status].join(' -- '))).toMatchInlineSnapshot(`
[
  "function 1 -- step 1 -- pending",
  "function 2 -- step 1 -- pending",
  "function 1 -- step 2 -- pending",
  "function 2 -- step 2 -- ",
  "function 1 -- step 3 -- pending",
  "function 2 -- step 2 -- sleeping",
  "function 2 -- step 3 -- pending",
]
`);
expect(hooks.afterExecuteStep.mock.calls.map(([arg]) => [arg.functionName,arg.stepName, arg.stepState?.status].join(' -- '))).toMatchInlineSnapshot(`
[
  "function 1 -- step 1 -- success",
  "function 2 -- step 1 -- success",
  "function 2 -- step 2 -- sleeping",
  "function 1 -- step 2 -- success",
  "function 1 -- step 3 -- success",
  "function 2 -- step 2 -- success",
  "function 2 -- step 3 -- success",
]
`);
});


test("should retry once when max retries is set to 1", async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
    },
  } satisfies MockJobRouterConfig<Jobs>;

  const { mocks, run } = createMockJobRouter(config, {
    maxRetries: 1,
  });

  mocks
    .get("user.created", "function 1", "step 2")
    .mockRejectedValue("something went wrong");

  const { finalOutcome, summary, results } = await run("user.created", {
    userId: "123",
  });

  expect(results.length).toBe(2);
  expect(finalOutcome).toBe("maxRetriesExceeded");
  expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function 1": {
      "step 1": "success",
      "step 2": "error",
    },
  },
  "run 1": {
    "function 1": {
      "step 2": "error",
    },
  },
}
`);
});

test("result status should be correct on max retries exceeded", async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
    },
  } satisfies MockJobRouterConfig<Jobs>;

  const { mocks, run } = createMockJobRouter(config, {
    maxRetries: 1,
  });

  mocks
    .get("user.created", "function 1", "step 2")
    .mockRejectedValue("something went wrong");

  const { finalOutcome, summary, results } = await run("user.created", {
    userId: "123",
  });

  expect(results.length).toBe(2);
  expect(finalOutcome).toBe("maxRetriesExceeded");
  expect(results[1].status).toBe("maxRetriesExceeded");
  // @ts-expect-error
  expect(results[1].result.state.error).toBe('something went wrong');
  typedExpect(results[1].result.state.status).toBe('maxRetriesExceeded')
});

test("maxRetries 0 should work with sleep", async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": ["sleep", 1, "days"],
        "step 3": "step",
      },
    },
  } satisfies MockJobRouterConfig<Jobs>;

  const { run } = createMockJobRouter(config, {
    maxRetries: 0,
  });

  const { finalOutcome, summary, results } = await run("user.created", {
    userId: "123",
  });

  expect(results.length).toBe(2);
  expect(finalOutcome).toBe("success");
  expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function 1": {
      "step 1": "success",
      "step 2": "sleeping",
    },
  },
  "run 1": {
    "function 1": {
      "step 2": "success",
      "step 3": "success",
    },
  },
}
`);
});

test("maxRetries 0 should work with sleep and failure", async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": ["sleep", 1, "days"],
        "step 3": "step",
      },
    },
  } satisfies MockJobRouterConfig<Jobs>;

  const { run, mocks } = createMockJobRouter(config, {
    maxRetries: 0,
  });

  mocks
    .get("user.created", "function 1", "step 3")
    .mockRejectedValue("something went wrong");

  const { finalOutcome, summary, results } = await run("user.created", {
    userId: "123",
  });

  expect(results.length).toBe(2);
  expect(finalOutcome).toBe("maxRetriesExceeded");
  expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function 1": {
      "step 1": "success",
      "step 2": "sleeping",
    },
  },
  "run 1": {
    "function 1": {
      "step 2": "success",
      "step 3": "error",
    },
  },
}
`);
});

test("maxRetries 0 should work with multiple sleeping functions", async () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": ["sleep", 1, "days"],
        "step 3": "step",
      },
      "function 2": {
        "step 1": ["sleep", 5, "days"],
        "step 2": "step",
        "step 3": "step",
      },
    },
  } satisfies MockJobRouterConfig<Jobs>;

  const { run, mocks } = createMockJobRouter(config, {
    maxRetries: 0,
  });

  mocks
    .get("user.created", "function 1", "step 3")
    .mockRejectedValue("something went wrong");
  mocks
    .get("user.created", "function 2", "step 3")
    .mockRejectedValue("something went wrong");

  const { finalOutcome, summary, results } = await run("user.created", {
    userId: "123",
  });

  expect(results.length).toBe(3);
  expect(finalOutcome).toBe("maxRetriesExceeded");
  expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function 1": {
      "step 1": "success",
      "step 2": "sleeping",
    },
    "function 2": {
      "step 1": "sleeping",
    },
  },
  "run 1": {
    "function 1": {
      "step 2": "success",
      "step 3": "error",
    },
  },
  "run 2": {
    "function 2": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "error",
    },
  },
}
`);
});

describe('jobRouter', () => {
  const config = {
    "user.created": {
      "function 1": {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
      "function 2": {
        "step 1": "step",
        "step 2": ["sleep", 1, "days"],
        "step 3": "step",
      }
    },
  } satisfies MockJobRouterConfig<Jobs>;

  type Hooks = Required<Required<JobRouterArgs<any>>['hooks']>;
  const hooks = {
    beforeExecuteFunction: jest.fn<Hooks['beforeExecuteFunction']>(),
    afterExecuteFunction: jest.fn<Hooks['afterExecuteFunction']>(),
    beforeExecuteStep: jest.fn<Hooks['beforeExecuteStep']>(),
    afterExecuteStep: jest.fn<Hooks['afterExecuteStep']>(),
    onError: jest.fn<Hooks['onError']>(),
    onMaxRetriesExceeded: jest.fn<Hooks['onMaxRetriesExceeded']>(),
  }

  const {mocks, run} = createMockJobRouter(config, {
    hooks
  })

  beforeEach(() => {
    mocks.resetAll();
    Object.values(hooks).forEach(mock => mock.mockReset());
  })

  test('result state is correct on max retries exceeded', async () => {
    mocks.get('user.created', 'function 1', 'step 1').mockRejectedValue(new Error('not enough puppies'));
    let { results } = await run('user.created', {
      userId: '123'
    });
    expect(results.length).toBe(5);
  })

  test('onError hook is not called on no error', async () => {
    await run('user.created', {
      userId: '123'
    });
    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(3);
    expect(hooks.onError).not.toHaveBeenCalled();
    expect(hooks.onMaxRetriesExceeded).not.toHaveBeenCalled();
  });

  test('maxRetriesExceeded hook is called on max retries exceeded for step failure', async () => {
    mocks.get('user.created', 'function 1', 'step 1').mockRejectedValue(new Error('not enough puppies'));
    await run('user.created', {
      userId: '123'
    });

    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(6);
    expect(hooks.onMaxRetriesExceeded).toHaveBeenCalledTimes(1);
    typedExpect(hooks.onMaxRetriesExceeded.mock.calls[0][0]).toMatchObject({
      error: new Error('not enough puppies') as any,
    });
  });

  test('maxRetriesExceed hook is called on function failure', async () => {
    mocks.get('user.created', 'function 1').mockRejectedValue(new Error('not enough puppies'));
    await run('user.created', {
      userId: '123'
    });

    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(6);
    expect(hooks.onMaxRetriesExceeded).toHaveBeenCalledTimes(1);
    typedExpect(hooks.onMaxRetriesExceeded.mock.calls[0][0]).toMatchObject({
      error: new Error('not enough puppies') as any,
    });
  });

  test('onError hook is called on step failure', async () => {
    mocks.get('user.created', 'function 1', 'step 1').mockRejectedValueOnce(new Error('not enough kittens'));

    await run('user.created', {
      userId: '123'
    });

    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(4);

    expect(hooks.onError).toHaveBeenCalledTimes(1);
    expect(hooks.onMaxRetriesExceeded).not.toHaveBeenCalled();
    typedExpect(hooks.onError.mock.lastCall).toMatchObject([{
      error: new Error('not enough kittens') as any,
      stepState: {
        status: 'error',
        err: new Error('not enough kittens') as any,
        numberOfFailedPreviousAttempts: 1,
      },
      functionName: 'function 1',
      stepName: 'step 1'
    }]);
  });

  test('onError hook is called once on function failure', async () => {
    mocks.get('user.created', 'function 1').mockRejectedValueOnce(new Error('not enough puppies'));

    await run('user.created', {
      userId: '123'
    });

    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(4);
    expect(hooks.onError).toHaveBeenCalledTimes(1);
    typedExpect(hooks.onError.mock.lastCall).toMatchObject([{
      error: new Error('not enough puppies') as any,
      functionName: 'function 1',
      functionState: {
        state: {
          status: 'error',
          err: new Error('not enough puppies') as any
        }
      }
    }])

    expect(hooks.onError.mock.lastCall![0].stepState).toBe(undefined);
    expect(hooks.onError.mock.lastCall![0].stepName).toBe(undefined);
  });

  test('onError hook is called until max attempts is exceeded', async () => {
    mocks.get('user.created', 'function 1').mockRejectedValue(new Error('not enough puppies'));
    await run('user.created', {
      userId: '123'
    });

    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(6);
    expect(hooks.onError).toHaveBeenCalledTimes(4);
  });

  test('onError hook is called until max attempts is exceeded', async () => {
    mocks.get('user.created', 'function 1', 'step 1').mockRejectedValue(new Error('not enough puppies'));
    await run('user.created', {
      userId: '123'
    });

    expect(hooks.beforeExecuteFunction).toHaveBeenCalledTimes(6);
    expect(hooks.onError).toHaveBeenCalledTimes(4);
  })
})