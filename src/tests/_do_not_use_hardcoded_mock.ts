import { IEventExecutionState, createJobRouter } from "../JobRouter";
import { createJobSender } from "../JobSender";
import { createJobWorker } from "../JobWorker";
import { jobInsights } from "./test-utils";
import { jest } from "@jest/globals";
export function __do_not_use_createJobRouterMock() {
  type RouterEvents = {
    "user.created": {
      userId: string;
    };
    "user.updated": {
      userId: string;
    };
    "community.created": {
      communityId: string;
    };
  };

  const mocks = {
    _createCtx: jest.fn<any>(),
    _beforeHandleJob: jest.fn<any>(),
    _afterHandleJob: jest.fn<any>(),
    "user.created": {
      "3StepsAndSleep": {
        handler: jest.fn<any>(),
        steps: [jest.fn<any>(), jest.fn<any>(), jest.fn<any>()],
      },
      "3Steps": {
        handler: jest.fn<any>(),
        steps: [jest.fn<any>(), jest.fn<any>(), jest.fn<any>()],
      },
    },
    "user.updated": {
      "1step": {
        handler: jest.fn<any>(),
        steps: [jest.fn<any>()],
      },
    },
    "community.created": {
      func1: {
        handler: jest.fn<any>(),
      },
    },
  };

  const router = createJobRouter<RouterEvents>();

  router.on("user.created", [
    router.createHandler("3StepsAndSleep", async (args) => {
      let handlerMocks = mocks["user.created"]["3StepsAndSleep"];
      await handlerMocks.handler(args);
      await args.step.run("3StepsAndSleep.step0", handlerMocks.steps[0]);
      await args.step.sleep("sleep for a day", [1, "days"]);
      await args.step.run("3StepsAndSleep.step1", handlerMocks.steps[1]);
      await args.step.run("3StepsAndSleep.step2", handlerMocks.steps[2]);
    }),
    router.createHandler("3Steps", async (args) => {
      const handlerMocks = mocks["user.created"]["3Steps"];
      await handlerMocks.handler(args);
      await args.step.run("3Steps.step0", handlerMocks.steps[0]);
      await args.step.run("3Steps.step1", handlerMocks.steps[1]);
      await args.step.run("3Steps.step2", handlerMocks.steps[2]);
    }),
  ]);

  router.on("user.updated", [
    router.createHandler("1step", async (args) => {
      const handlerMocks = mocks["user.updated"]["1step"];
      await handlerMocks.handler(args);
      await args.step.run("1step.step0", handlerMocks.steps[0]);
    }),
  ]);

  router.on("community.created", [
    router.createHandler("func1", async (args) => {
      await mocks["community.created"]["func1"].handler(args);
    }),
  ]);

  const queue: { runAt: Date; job: IEventExecutionState<RouterEvents, any> }[] =
    [];

  const scheduler = createJobSender<RouterEvents>(async (jobs) => {
    for (const job of jobs) {
      queue.push({
        runAt: job.status.type === "sleeping" ? new Date(job.status.sleepingUntilISO) : new Date(),
        job,
      })
    }

    queue.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  });

  const worker = createJobWorker({
    createCtx: mocks._createCtx,
    router,
    scheduler,
    hooks: {
      beforeHandleJob: mocks._beforeHandleJob,
      afterHandleJob: mocks._afterHandleJob,
    },
  });

  const self = {
    mocks,
    router,
    worker,
    scheduler,
    queue,
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
    async run<T extends keyof RouterEvents>(
      type: T,
      args: RouterEvents[T]
    ): Promise<Array<Awaited<ReturnType<typeof worker.handleJob>>>> {
      await scheduler.send(type, args);
      let results = [];
      for await (const result of self.processQueue()) {
        results.push(result);
      }
      return results;
    },
    resetMocks() {
      mocks._createCtx.mockReset().mockReturnValue({});
      mocks._afterHandleJob.mockReset().mockResolvedValue(undefined);
      mocks._beforeHandleJob.mockReset().mockResolvedValue(undefined);
      mocks["user.created"]["3StepsAndSleep"].handler
        .mockReset()
        .mockResolvedValue(undefined);
      mocks["user.created"]["3StepsAndSleep"].steps.forEach((fn) =>
        fn.mockReset().mockResolvedValue(undefined)
      );
      mocks["user.created"]["3Steps"].handler
        .mockReset()
        .mockResolvedValue(undefined);
      mocks["user.created"]["3Steps"].steps.forEach((fn) =>
        fn.mockReset().mockResolvedValue(undefined)
      );
      mocks["user.updated"]["1step"].handler
        .mockReset()
        .mockResolvedValue(undefined);
      mocks["user.updated"]["1step"].steps.forEach((fn) =>
        fn.mockReset().mockResolvedValue(undefined)
      );
      mocks["community.created"]["func1"].handler
        .mockReset()
        .mockResolvedValue(undefined);
    },
  };

  return self;
}
