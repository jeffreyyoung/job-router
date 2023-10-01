import { MockJobRouterConfig, createMockJobRouter } from "./JobMocker";
import { describe, test, expect, beforeEach } from "@jest/globals";
describe("JobMocker", () => {
  type Events = {
    userCreated: {
      userId: string;
    };
    userUpdated: {
      userId: string;
    };
    communityCreated: {
      communityId: string;
    };
  };

  const config = {
    userCreated: {
      function1: {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
      function2: {
        "step 1": "step",
        "step 2": "step",
        "step 3": "step",
      },
      function3: {
        "step 1": "step",
        "step 2": ["sleep", 1, "days"],
        "step 3": "step",
      },
    },
    userUpdated: {
      function1: {
        "step 1": "step",
        "step 2": "step",
      },
    },
    communityCreated: {
      function1: {
        "step 1": "step",
        "step 2": "step",
      },
      function2: {
        "step 1": "step",
        "step 2": "step",
      },
      function3: {
        "step 1": "step",
        "step 2": "step",
      },
    },
  } satisfies MockJobRouterConfig<Events>;

  const { run, mocks } = createMockJobRouter(config);
  beforeEach(() => {
    mocks.resetAll();
  });

  test("all should succeed in one pass", async () => {
    const { results } = await run("userUpdated", { userId: "123" });
    expect(results.map((result) => result.result)).toMatchObject([
      {
        event: {
          data: {
            userId: "123",
          },
          eventName: "userUpdated",
        },
        functionStates: {
          function1: {
            functionName: "function1",
            state: {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              result: undefined,
              status: "success",
            },
            stepStates: {
              "step 1": {
                numberOfFailedPreviousAttempts: 0,
                numberOfPreviousAttempts: 1,
                result: undefined,
                status: "success",
              },
              "step 2": {
                numberOfFailedPreviousAttempts: 0,
                numberOfPreviousAttempts: 1,
                result: undefined,
                status: "success",
              },
            },
          },
        },
        numberOfFailedPreviousAttempts: 0,
        numberOfPreviousAttempts: 1,
        state: {
          status: "complete",
        },
      },
    ]);
    expect(results.length).toBe(1);

    expect(mocks.get("userCreated", "function1")).toBeCalledTimes(0);
    expect(mocks.get("userUpdated", "function1")).toBeCalledTimes(1);
  });

  test('traceId is preserved across attempts', async () => {
    const { results } = await run("userCreated", { userId: "123" }, { traceId: '456' });
    expect(results.length).toBe(2);
    expect(results[0].result.event.traceId).toBe('456');
    expect(results[1].result.event.traceId).toBe('456');
    const { results: results1 } = await run("userUpdated", { userId: "123" }, { traceId: '399' });
    expect(results1.length).toBe(1);
    expect(results1[0].result.event.traceId).toBe('399');
  });

  test('traceId is preserved across failures', async () => {
    mocks.get("userCreated", "function1").mockRejectedValueOnce('error');
    const { results } = await run("userCreated", { userId: "123" }, { traceId: '456' });
    expect(results.length).toBe(3);
    expect(results[0].result.event.traceId).toBe('456');
    expect(results[1].result.event.traceId).toBe('456');
    expect(results[2].result.event.traceId).toBe('456');
  })

  test('traceId is preserved maxRetriesExceeded failures', async () => {
    mocks.get("userCreated", "function1").mockRejectedValue('error');
    const { results } = await run("userCreated", { userId: "123" }, { traceId: '456' });
    expect(results.length).toBe(5);
    expect(results[0].result.event.traceId).toBe('456');
    expect(results[1].result.event.traceId).toBe('456');
    expect(results[2].result.event.traceId).toBe('456');
    expect(results[3].result.event.traceId).toBe('456');
    expect(results[4].result.event.traceId).toBe('456');
  })

  test("userCreated should pass in 2 steps because it has sleep", async () => {
    const { results } = await run("userCreated", { userId: "123" });
    expect(results.length).toBe(2);

    expect(mocks.get("userCreated", "function1")).toBeCalledTimes(1);
    expect(mocks.get("userCreated", "function2")).toBeCalledTimes(1);
    expect(mocks.get("userCreated", "function3")).toBeCalledTimes(2);
    expect(mocks.get("userCreated", "function3", "step 1")).toBeCalledTimes(1);

    for (const { mock } of mocks.getByPrefix("userUpdated")) {
      expect(mock).toBeCalledTimes(0);
    }
  });

  test("should work with all steps failing", async () => {
    const stepMocks = mocks
      .getByPrefix("communityCreated")
      .filter((m) => !!m.step)
      .map((m) => m.mock.mockRejectedValue("error"));
    expect(stepMocks).toHaveLength(6);
    const { results } = await run("communityCreated", { communityId: "123" });
    // should retry 3 times
    // 1 run + 3 retries = 4
    expect(results.length).toBe(4);
    expect(
      mocks.get("communityCreated", "function1", "step 1")
    ).toBeCalledTimes(4);
    expect(
      mocks.get("communityCreated", "function1", "step 2")
    ).toBeCalledTimes(0);
  });

  test("should work with all functions failing", async () => {
    const fnMocks = mocks
      .getByPrefix("communityCreated")
      .filter((m) => !m.step)
      .map((m) => m.mock.mockRejectedValue("error"));
    expect(fnMocks).toHaveLength(3);
    const { results, summary } = await run("communityCreated", {
      communityId: "123",
    });
    // should retry 3 times
    // 1 run + 3 retries = 4
    expect(results.length).toBe(4);
    fnMocks.forEach((mock) => expect(mock).toBeCalledTimes(4));
    mocks.getByPrefix("communityCreated");
    expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function1": {},
    "function2": {},
    "function3": {},
  },
  "run 1": {
    "function1": {},
    "function2": {},
    "function3": {},
  },
  "run 2": {
    "function1": {},
    "function2": {},
    "function3": {},
  },
  "run 3": {
    "function1": {},
    "function2": {},
    "function3": {},
  },
}
`);
  });

  test("should fail with only one function step failing", async () => {
    mocks
      .get("communityCreated", "function1", "step 2")
      .mockRejectedValue("error");

    const { results, summary } = await run("communityCreated", {
      communityId: "123",
    });
    expect(results.length).toBe(4);
    expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function1": {
      "step 1": "success",
      "step 2": "error",
    },
    "function2": {
      "step 1": "success",
      "step 2": "success",
    },
    "function3": {
      "step 1": "success",
      "step 2": "success",
    },
  },
  "run 1": {
    "function1": {
      "step 2": "error",
    },
  },
  "run 2": {
    "function1": {
      "step 2": "error",
    },
  },
  "run 3": {
    "function1": {
      "step 2": "error",
    },
  },
}
`);
  });

  test("should succeed when each step fails only once", async () => {
    mocks
      .getByPrefix("communityCreated")
      .filter(({ step }) => !!step)
      .forEach(({ mock }) => mock.mockRejectedValueOnce("error"));

    const { results, summary } = await run("communityCreated", {
      communityId: "123",
    });

    expect(results.length).toBe(3);

    expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function1": {
      "step 1": "error",
    },
    "function2": {
      "step 1": "error",
    },
    "function3": {
      "step 1": "error",
    },
  },
  "run 1": {
    "function1": {
      "step 1": "success",
      "step 2": "error",
    },
    "function2": {
      "step 1": "success",
      "step 2": "error",
    },
    "function3": {
      "step 1": "success",
      "step 2": "error",
    },
  },
  "run 2": {
    "function1": {
      "step 2": "success",
    },
    "function2": {
      "step 2": "success",
    },
    "function3": {
      "step 2": "success",
    },
  },
}
`);
  });

  test("should work with sleep", async () => {
    const { results, summary } = await run("userCreated", { userId: "123" });
    expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function1": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "success",
    },
    "function2": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "success",
    },
    "function3": {
      "step 1": "success",
      "step 2": "sleeping",
    },
  },
  "run 1": {
    "function3": {
      "step 2": "success",
      "step 3": "success",
    },
  },
}
`);
  });

  test("should fail out with failure after sleep", async () => {
    mocks.get("userCreated", "function3", "step 3").mockRejectedValue("error");
    const { results, summary, finalOutcome } = await run("userCreated", {
      userId: "123",
    });
    expect(finalOutcome).toBe("maxRetriesExceeded");
    expect(results.length).toBe(5);
    expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function1": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "success",
    },
    "function2": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "success",
    },
    "function3": {
      "step 1": "success",
      "step 2": "sleeping",
    },
  },
  "run 1": {
    "function3": {
      "step 2": "success",
      "step 3": "error",
    },
  },
  "run 2": {
    "function3": {
      "step 3": "error",
    },
  },
  "run 3": {
    "function3": {
      "step 3": "error",
    },
  },
  "run 4": {
    "function3": {
      "step 3": "error",
    },
  },
}
`);
  });

  test("should fail out with failure before sleep", async () => {
    mocks.get("userCreated", "function3", "step 1").mockRejectedValue("error");
    const { results, summary, finalOutcome } = await run("userCreated", {
      userId: "123",
    });
    expect(results.length).toBe(4);
    expect(summary).toMatchInlineSnapshot(`
{
  "run 0": {
    "function1": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "success",
    },
    "function2": {
      "step 1": "success",
      "step 2": "success",
      "step 3": "success",
    },
    "function3": {
      "step 1": "error",
    },
  },
  "run 1": {
    "function3": {
      "step 1": "error",
    },
  },
  "run 2": {
    "function3": {
      "step 1": "error",
    },
  },
  "run 3": {
    "function3": {
      "step 1": "error",
    },
  },
}
`);

    expect(finalOutcome).toBe("maxRetriesExceeded");
  });
});
