import {
  IEventExecutionState,
  IEventSchemas,
  JobRouterArgs,
  createJobRouter,
} from "../JobRouter";
import { createJobScheduler, getDelaySeconds } from "../JobScheduler";
import { createJobWorker } from "../JobWorker";
import { addSeconds } from "../utils/addSeconds";
import { jobInsights } from "./test-utils";
import { jest } from "@jest/globals";

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

export type MockJobRouterConfig<Events> = {
  [EventName in keyof Events]?: {
    [FunctionName: string]: {
      [StepName: string]: "step" | ["sleep", number, "days"];
    };
  };
};

function createMockManager<Config extends MockJobRouterConfig<any>>(
  config: Config
) {
  const mocks: Record<string, jest.Mock<any>> = {};
  return {
    mockCache: mocks,
    resetAll() {
      Object.values(mocks).forEach((mock) => mock.mockReset());
    },
    getByPrefix<
      Event extends keyof Config,
      Fn extends keyof Config[Event],
      Step extends keyof Config[Event][Fn]
    >(event: Event, fn?: Fn, step?: Step) {
      const key = [event, fn, step].filter(Boolean).join("--");

      return Object.entries(mocks)
        .filter(([k]) => k.startsWith(key))
        .map(([key, value]) => {
          const [event, fn, step] = key.split("--");
          return { event, fn, step, key, mock: mocks[key] };
        });
    },
    get<
      Event extends keyof Config,
      Fn extends keyof Config[Event],
      Step extends keyof Config[Event][Fn]
    >(event: Event, fn: Fn, step?: Step) {
      const functions = config[event];

      if (!config[event]) {
        throw new Error(`Event ${String(event)} not found`);
      }

      const key = step ? [event, fn, step].join("--") : [event, fn].join("--");

      if (!mocks[key]) {
        mocks[key] = jest.fn<any>();
      }

      return mocks[key];
    },
  };
}

const config = {
  userCreated: {
    function1: {
      "step 1": "step",
      "step 2": "step",
      "step 3": ["sleep", 1, "days"],
    },
    function2: {
      "step 1": ["sleep", 1, "days"],
      "step 2": ["sleep", 1, "days"],
      "step 3": ["sleep", 1, "days"],
    },
    function3: {
      "step 1": "step",
      "step 2": "step",
    },
  },
} satisfies MockJobRouterConfig<Events>;

export function createMockJobRouter<
  RouterEvents extends IEventSchemas,
  Config extends MockJobRouterConfig<RouterEvents>
>(config: Config, routerArgs: JobRouterArgs<RouterEvents> = {}) {
  const mocks = createMockManager(config);

  const jobRouter = createJobRouter<RouterEvents>(routerArgs);

  for (const [eventName, functions] of Object.entries(config)) {
    const handlers = [];

    for (const [functionName, steps] of Object.entries(functions!)) {
      //@ts-expect-error
      const fnMock = mocks.get(eventName, functionName);
      // initialize step mocks
      Object.entries(steps || {}).forEach(
        ([stepName, step]) =>
          // @ts-expect-error
          step === "step" && mocks.get(eventName, functionName, stepName)
      );
      handlers.push(
        jobRouter.createHandler(functionName, async (args) => {
          await fnMock(args);

          for (const [stepName, step] of Object.entries(steps || {})) {
            if (step === "step") {
              await args.step.run(
                stepName,
                // @ts-expect-error
                mocks.get(eventName, functionName, stepName)
              );
            } else {
              const [sleep, time, unit] = step;
              await args.step.sleep(stepName, [time, unit]);
            }
          }
        })
      );
    }
    jobRouter.on(eventName, handlers);
  }

  Object.values(mocks.mockCache).forEach((mock) =>
    mock.mockReturnValue(Promise.resolve())
  );

  const queue: { runAt: Date; job: IEventExecutionState<RouterEvents, any> }[] =
    [];

  const scheduler = createJobScheduler<RouterEvents>(async (jobs) => {
    for (const job of jobs) {
      queue.push({
        runAt: addSeconds(new Date(), getDelaySeconds(job)),
        job,
      });
    }

    queue.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  });

  const worker = createJobWorker({
    createCtx: () => ({}),
    router: jobRouter,
    scheduler,
    hooks: {
      beforeHandleJob: () => Promise.resolve(),
      afterHandleJob: () => Promise.resolve(),
    },
  });
  const self = {
    mocks,
    async *processQueue() {
      while (queue.length) {
        const { job } = queue.shift()!;
        const result = await worker.handleJob(job);
        yield {
          ...result,
          insights: jobInsights(result.result),
        };
      }
    },
    async runIterator<T extends keyof RouterEvents>(
      type: T,
      args: RouterEvents[T]
    ) {
      await scheduler.send(type, args);
      return self.processQueue();
    },
    async run<T extends keyof RouterEvents>(type: T, args: RouterEvents[T]) {
      await scheduler.send(type, args);
      let results = [];
      for await (const result of self.processQueue()) {
        results.push(result);
      }
      return {
        results,
        /**
         * an object with the summary of each run. If a certain function or step
         * was not executed, it will not be included in the summary for that run.
         *
         */
        summary: Object.fromEntries(
          results.map((result, index) => [
            `run ${index}`,
            result.insights.executedFunctionsAndSteps(),
          ])
        ),
        /**
         * The result of the last run.
         *
         * Can be success, needsRetry, or maxRetriesExceeded
         */
        finalOutcome: results[results.length - 1].status,
      };
    },
  };
  return self;
}
