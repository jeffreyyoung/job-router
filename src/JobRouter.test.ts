import { addHours } from "date-fns";
import { typedExpect } from "./tests/typedExpect";
import { createJobRouter, createInitialEventExecutionState } from "./JobRouter";
import { expectDate, getSleepUntilDate } from "./tests/test-utils";
import { describe, test, jest, beforeEach, expect } from "@jest/globals";
describe("ingester", () => {
  describe("basic createJobRouter tests", () => {
    type EventSchema = {
      "user.created": { userId: string };
      "user.updated": { userId: string };
    };
    const onCreated = jest.fn<any>().mockResolvedValue(undefined);
    const onUpdated = jest.fn<any>().mockRejectedValue(new Error("wat"));

    const i = createJobRouter<EventSchema>();

    i.on("user.created", [i.createHandler("log yay!", onCreated)]);
    i.on("user.updated", [i.createHandler("throw error", onUpdated)]);

    beforeEach(() => {
      onCreated.mockClear();
      onUpdated.mockClear();
    });

    test("createJobRouter should succeed", async () => {
      typedExpect(
        await i.ingestInitial("user.created", { userId: "123" }, "123")
      ).toMatchObject({
        status: "success",
        result: {
          event: {
            data: {
              userId: "123",
            },
            eventName: "user.created",
            jobId: "123",
          },
          functionStates: {
            "log yay!": {
              state: {
                numberOfFailedPreviousAttempts: 0,
                numberOfPreviousAttempts: 1,
                result: undefined,
                status: "success",
              },
              stepStates: {},
              functionName: "log yay!",
            },
          },
        },
      });

      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onUpdated).toHaveBeenCalledTimes(0);
    });

    test("job should fail", async () => {
      typedExpect(
        await i.ingestInitial("user.updated", { userId: "123" }, "jobId123")
      ).toMatchObject({
        status: "needsRetry",
        nextJobs: [{}],
        result: {
          event: {
            data: {
              userId: "123",
            },
            eventName: "user.updated",
            jobId: "jobId123",
          },
          functionStates: {
            "throw error": {
              state: {
                numberOfFailedPreviousAttempts: 1,
                err: expect.any(Error) as any,
                status: "error",
              },
              stepStates: {},
              functionName: "throw error",
            },
          },
        },
      });
      expect(onCreated).toHaveBeenCalledTimes(0);
      expect(onUpdated).toHaveBeenCalledTimes(1);
    });
  });

  type EventSchema = {
    "user.created": { userId: string };
  };

  test("createJobRouter type tests", async () => {
    const i = createJobRouter<{
      "user.created": { userId: string };
      "user.updated": { userId: string; jobId: string };
      "send email": { emailId: string; jobId: string };
    }>();

    const fn1 = i.createHandler<"user.created">(
      "do stuff",
      async ({ eventName, data, step }) => {}
    );

    const fn2 = i.createHandler<"user.updated" | "send email">(
      "do stuff",
      async ({ eventName, data, step }) => {
        // @ts-expect-error
        let j: "user.created" = eventName;

        // @ts-expect-error
        data.email;

        // @ts-expect-error
        data.userId;

        data.jobId;
      }
    );

    // @ts-expect-error
    i.on("user.updated", [fn1]);

    i.on("user.updated", [fn2]);

    i.on("send email", [fn2]);

    expect(true).toBe(true);
  });

  test("function should fail if step fails", async () => {
    let sendEmailStepSpy = jest.fn<any>().mockRejectedValue(new Error("nope"));
    let updateDbStepSpy = jest.fn<any>().mockRejectedValue(new Error("nope"));

    const i = createJobRouter<EventSchema>();

    i.on("user.created", [
      i.createHandler("send email", async ({ data, step }) => {
        const userFirstName = await step.run("update db", updateDbStepSpy);

        await step.run("send email", () =>
          sendEmailStepSpy(userFirstName, data.userId)
        );
      }),
    ]);

    const result = await i.ingestInitial("user.created", {
      userId: "123",
    });
    expect(result.status).toEqual("needsRetry");
    expect(result.nextJobs.length).toEqual(1);

    expect(updateDbStepSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailStepSpy).toHaveBeenCalledTimes(0);

    updateDbStepSpy.mockResolvedValue("jimmy");

    // second try
    const result2 = await i.ingest(result.nextJobs[0]);
    expect(result2.status).toEqual("needsRetry");
    expect(result2.nextJobs.length).toEqual(1);
    expect(updateDbStepSpy).toHaveBeenCalledTimes(2);
    expect(sendEmailStepSpy).toHaveBeenCalledTimes(1);

    // third try
    const result3 = await i.ingest(result2.nextJobs[0]);
    expect(result3.status).toEqual("needsRetry");
    expect(result3.nextJobs.length).toEqual(1);
    expect(updateDbStepSpy).toHaveBeenCalledTimes(2);
    expect(sendEmailStepSpy).toHaveBeenCalledTimes(2);

    sendEmailStepSpy.mockResolvedValue("emailId-123");

    // fourth try
    const result4 = await i.ingest(result3.nextJobs[0]);
    expect(result4.status).toEqual("success");
    expect(updateDbStepSpy).toHaveBeenCalledTimes(2);
    expect(sendEmailStepSpy).toHaveBeenCalledTimes(3);
    expect(sendEmailStepSpy).lastCalledWith("jimmy", "123");

    expect(result4.result).toMatchObject({
      functionStates: {
        "send email": {
          state: {
            numberOfFailedPreviousAttempts: 3,
            numberOfPreviousAttempts: 4,
            result: undefined,
            status: "success",
          },
          stepStates: {
            "send email": {
              numberOfFailedPreviousAttempts: 2,
              numberOfPreviousAttempts: 3,
              result: "emailId-123",
              status: "success",
            },
            "update db": {
              numberOfFailedPreviousAttempts: 1,
              numberOfPreviousAttempts: 2,
              result: "jimmy",
              status: "success",
            },
          },
        },
      },
    });
  });

  test("lots of functions works as expected", async () => {
    type EventSchema = {
      a: { a: string };
      b: { b: string };
      c: { c: string };
    };

    const a1 = jest.fn<any>().mockResolvedValue(undefined);
    const a2 = jest.fn<any>().mockRejectedValue(undefined);
    const a3 = jest.fn<any>().mockRejectedValue(undefined);

    const b1 = jest.fn<any>().mockResolvedValue(undefined);
    const b2 = jest.fn<any>().mockResolvedValue(undefined);

    const c1 = jest.fn<any>().mockResolvedValue(undefined);

    const i = createJobRouter<EventSchema>();

    i.on("a", [
      i.createHandler("a1", a1),
      i.createHandler("a2", a2),
      i.createHandler("a3", a3),
    ]);

    i.on("b", [i.createHandler("b1", b1), i.createHandler("b2", b2)]);

    i.on("c", [i.createHandler("c1", c1)]);

    const result1 = await i.ingestInitial(
      "a",
      { a: "someRandomData" },
      "jobId123"
    );
    // a2 and a3 funcs should fail
    expect(result1.status).toEqual("needsRetry");
    expect(result1.nextJobs.length).toEqual(1);
    // only a funcs should be called
    expect(a1).toHaveBeenCalledTimes(1);
    expect(a2).toHaveBeenCalledTimes(1);
    expect(a3).toHaveBeenCalledTimes(1);
    expect(b1).toHaveBeenCalledTimes(0);
    expect(b2).toHaveBeenCalledTimes(0);
    expect(c1).toHaveBeenCalledTimes(0);

    // make a3 and a3 succeed this time
    a2.mockResolvedValue(undefined);
    a3.mockResolvedValue(undefined);
    const result2 = await i.ingest(result1.nextJobs[0]);
    expect(result2.status).toEqual("success");
    expect(a1).toHaveBeenCalledTimes(1); // a1 should not be rerun
    expect(a2).toHaveBeenCalledTimes(2); // a1 should be rerun
    expect(a3).toHaveBeenCalledTimes(2); // a3 should be rerun
    expect(b1).toHaveBeenCalledTimes(0);
    expect(b2).toHaveBeenCalledTimes(0);
    expect(c1).toHaveBeenCalledTimes(0);

    expect(a1.mock.lastCall).toMatchObject([
      {
        data: {
          a: "someRandomData",
        },
        eventName: "a",
        jobId: "jobId123",
        numberOfFailedPreviousAttempts: 0,
      },
    ]);
    expect(a2.mock.lastCall).toMatchObject([
      {
        data: {
          a: "someRandomData",
        },
        eventName: "a",
        jobId: "jobId123",
        numberOfFailedPreviousAttempts: 1,
      },
    ]);
    expect(a3.mock.lastCall).toMatchObject([
      {
        data: {
          a: "someRandomData",
        },
        eventName: "a",
        jobId: "jobId123",
        numberOfFailedPreviousAttempts: 1,
      },
    ]);
  });

  test("getCtx should work", async () => {
    const getCtx = jest.fn<() => Promise<number>>().mockResolvedValue(1234);

    const i = createJobRouter<EventSchema>({ getCtx });

    const onCreated = jest.fn<any>().mockResolvedValue(undefined);
    const fn1 = i.createHandler("log yay!", onCreated);

    i.on("user.created", [
      fn1,
      i.createHandler("log yay 1!", jest.fn<any>().mockResolvedValue(undefined)),
      i.createHandler("log yay 2!", jest.fn<any>().mockResolvedValue(undefined)),
    ]);

    await i.ingestInitial("user.created", { userId: "123" }, "123");
    expect(onCreated.mock.calls[0]).toMatchObject([
      {
        ctx: 1234,
        data: {
          userId: "123",
        },
        eventName: "user.created",
        jobId: "123",
        numberOfFailedPreviousAttempts: 0,
        step: {
          run: expect.any(Function),
        },
      },
    ]);
    expect(getCtx).toHaveBeenCalledTimes(1);

    await i.ingestInitial("user.created", { userId: "123" }, "123");
    expect(getCtx).toHaveBeenCalledTimes(2);
  });

  test("includeFunctions should work", async () => {
    const i = createJobRouter<EventSchema>();
    const fn1 = jest.fn<any>().mockResolvedValue(undefined);
    const fn2 = jest.fn<any>().mockResolvedValue(undefined);
    i.on("user.created", [
      i.createHandler("fn1", fn1),
      i.createHandler("fn2", fn2),
    ]);

    const state = createInitialEventExecutionState<EventSchema, "user.created">(
      {
        data: { userId: "123" },
        eventName: "user.created",
      }
    );

    state.includeFunctions = ["fn1"];

    const result = await i.ingest(state);
    expect(result.status).toEqual("success");
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(0);
  });

  test("excludeFunctions should work", async () => {
    const i = createJobRouter<EventSchema>();
    const fn1 = jest.fn<any>().mockResolvedValue(undefined);
    const fn2 = jest.fn<any>().mockResolvedValue(undefined);
    const fn3 = jest.fn<any>().mockResolvedValue(undefined);
    i.on("user.created", [
      i.createHandler("fn1", fn1),
      i.createHandler("fn2", fn2),
      i.createHandler("fn3", fn3),
    ]);

    const state = createInitialEventExecutionState<EventSchema, "user.created">(
      {
        data: { userId: "123" },
        eventName: "user.created",
      }
    );

    state.excludeFunctions = ["fn1"];

    const result = await i.ingest(state);
    expect(result.status).toEqual("success");
    expect(fn1).toHaveBeenCalledTimes(0);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  test("sleep should work", async () => {
    const i = createJobRouter<EventSchema>();
    const fn1 = jest.fn<any>().mockResolvedValue(undefined);
    const fn2 = jest.fn<any>().mockResolvedValue(undefined);
    const fn3 = jest.fn<any>().mockResolvedValue(undefined);
    const fn1step1 = jest.fn<any>().mockResolvedValue(undefined);
    const fn1step2 = jest.fn<any>().mockResolvedValue(undefined);
    const fn1step3 = jest.fn<any>().mockResolvedValue(undefined);
    i.on("user.created", [
      i.createHandler("fn1", async ({ step }) => {
        await fn1();
        await step.run("fn1step1", fn1step1);
        await step.run("fn1step2", fn1step2);
        await step.sleep("wait 1 day", [1, "days"]);
        await step.run("fn1step3", fn1step3);
      }),
      i.createHandler("fn2", fn2),
      i.createHandler("fn3", fn3),
    ]);

    const result1 = await i.ingestInitial("user.created", { userId: "yay" });

    expect(result1.nextJobs.length).toEqual(1);
    typedExpect(result1.nextJobs[0]).toMatchObject({
      status: {
        type: "sleeping",
        sleepingUntilISO: expect.any(String) as any,
      },
      event: {
        data: {
          userId: "yay",
        },
        eventName: "user.created",
      },
      includeFunctions: ["fn1"],
      functionStates: {
        fn1: {
          functionName: "fn1",
          state: {
            status: "sleeping",
            untilISO: expect.any(String) as any,
          },
          stepStates: {
            fn1step1: {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              result: undefined,
              status: "success",
            },
            fn1step2: {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              result: undefined,
              status: "success",
            },
            "wait 1 day": {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              status: "sleeping",
              untilISO: expect.any(String) as any,
            },
          },
        },
        fn2: {
          functionName: "fn2",
          state: {
            numberOfFailedPreviousAttempts: 0,
            numberOfPreviousAttempts: 1,
            result: undefined,
            status: "success",
          },
          stepStates: {},
        },
        fn3: {
          functionName: "fn3",
          state: {
            numberOfFailedPreviousAttempts: 0,
            numberOfPreviousAttempts: 1,
            result: undefined,
            status: "success",
          },
          stepStates: {},
        },
      },
    });
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
    expect(fn1step1).toHaveBeenCalledTimes(1);
    expect(fn1step2).toHaveBeenCalledTimes(1);
    expect(fn1step3).toHaveBeenCalledTimes(0);

    const nextJob = result1.nextJobs[0];
    const status = nextJob.status;
    if (status.type !== "sleeping") {
      throw new Error("expected status to be sleeping");
    }
    expect(status.numberOfSecondsToSleep).toBe(86400);
    expect(new Date(status.sleepingUntilISO).getTime()).toBeGreaterThan(
      addHours(new Date(), 23).getTime()
    );
    expect(new Date(status.sleepingUntilISO).getTime()).toBeLessThan(
      addHours(new Date(), 25).getTime()
    );

    const result2 = await i.ingest(nextJob);

    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
    expect(fn1step1).toHaveBeenCalledTimes(1);
    expect(fn1step2).toHaveBeenCalledTimes(1);
    expect(fn1step3).toHaveBeenCalledTimes(1);

    expect(result2.status).toEqual("success");
    expect(result2.nextJobs.length).toEqual(0);
  });

  test("multiple sleeps should work", async () => {
    type EventSchema = {
      a: { a: string };
      b: { b: string };
      c: { c: string };
    };
    const i = createJobRouter<EventSchema>();

    const aFn1 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn2 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn3 = jest.fn<any>().mockRejectedValue(undefined);
    const aFn4 = jest.fn<any>().mockResolvedValue(undefined);
    const bFn1 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn1Step1 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn1Step2 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn1Step3 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn2Step1 = jest.fn<any>().mockResolvedValue(undefined);
    const aFn2Step2 = jest.fn<any>().mockResolvedValue(undefined);

    i.on("a", [
      i.createHandler("aFn1", async ({ step }) => {
        await aFn1();
        await step.run("aFn1Step1", aFn1Step1);
        await step.run("aFn1Step2", aFn1Step2);
        await step.sleep("wait 1 day", [1, "days"]);
        await step.run("aFn1Step3", aFn1Step3);
      }),
      i.createHandler("aFn2", async ({ step }) => {
        await aFn2();
        await step.run("aFn2Step1", aFn2Step1);
        await step.sleep("wait 1 day", [1, "days"]);
        await step.run("aFn2Step2", aFn2Step2);
      }),
      i.createHandler("aFn3", aFn3),
      i.createHandler("aFn4", aFn4),
    ]);

    i.on("b", [i.createHandler("bFn1", bFn1)]);

    const result1 = await i.ingestInitial("a", { a: "yay" });
    typedExpect(result1.status).toBe("needsRetry");
    expect(result1.nextJobs.length).toEqual(3);
    expect(aFn1).toHaveBeenCalledTimes(1);
    expect(aFn2Step1).toHaveBeenCalledTimes(1);
    expect(aFn2Step2).toHaveBeenCalledTimes(0);
    expect(aFn1Step1).toHaveBeenCalledTimes(1);
    expect(aFn1Step2).toHaveBeenCalledTimes(1);
    expect(aFn1Step3).toHaveBeenCalledTimes(0);
    expect(aFn2).toHaveBeenCalledTimes(1);
    expect(aFn3).toHaveBeenCalledTimes(1);
    expect(aFn4).toHaveBeenCalledTimes(1);
    aFn3.mockResolvedValue(undefined);

    typedExpect(result1.result.functionStates.aFn1).toMatchObject({
      functionName: "aFn1",
      state: {
        status: "sleeping",
      },
    });
    typedExpect(result1.result.functionStates.aFn2).toMatchObject({
      functionName: "aFn2",
      state: {
        status: "sleeping",
      },
    });
    typedExpect(result1.result.functionStates.aFn3).toMatchObject({
      functionName: "aFn3",
      state: {
        status: "error",
      },
    });

    typedExpect(result1.nextJobs).toMatchObject([
      {
        status: {
          type: "sleeping",
        },
        includeFunctions: ["aFn1"],
      },
      {
        status: {
          type: "sleeping",
        },
        includeFunctions: ["aFn2"],
      },
      {
        status: {
          type: "ready",
        },
        excludeFunctions: ["aFn1", "aFn2"],
      },
    ]);

    const result2 = await i.ingest(result1.nextJobs[0]);
    typedExpect(result2.status).toBe("success");
    typedExpect(result2.nextJobs).toMatchObject([]);

    const result3 = await i.ingest(result1.nextJobs[1]);
    typedExpect(result3.status).toBe("success");
    typedExpect(result2.nextJobs).toMatchObject([]);

    const result4 = await i.ingest(result1.nextJobs[2]);
    typedExpect(result4.status).toBe("success");
    typedExpect(result2.nextJobs).toMatchObject([]);

    expect(aFn1).toHaveBeenCalledTimes(2);
    expect(aFn2Step1).toHaveBeenCalledTimes(1);
    expect(aFn2Step2).toHaveBeenCalledTimes(1);
    expect(aFn1Step1).toHaveBeenCalledTimes(1);
    expect(aFn1Step2).toHaveBeenCalledTimes(1);
    expect(aFn1Step3).toHaveBeenCalledTimes(1);
    expect(aFn2).toHaveBeenCalledTimes(2);
    expect(aFn3).toHaveBeenCalledTimes(2);
    expect(aFn4).toHaveBeenCalledTimes(1);
  });

  test("multiple sleep steps works", async () => {
    const aFn1 = jest.fn<any>().mockResolvedValue(undefined);

    const sendWelcomeAlert = jest.fn<any>().mockResolvedValue("welcome!!!");
    const sendEmail = jest.fn<any>().mockResolvedValue(undefined);
    const sendFollowUpEmail = jest.fn<any>().mockResolvedValue(undefined);

    const i = createJobRouter<EventSchema>();

    i.on("user.created", [
      i.createHandler("new user welcome flow", async ({ step }) => {
        await aFn1();
        const welcomeMessage: string = await step.run(
          "send welcome message",
          sendWelcomeAlert
        );
        await step.sleep("wait before sending email", [1, "days"]);
        await step.run("send email", async () => {
          return await sendEmail(welcomeMessage);
        });
        await step.sleep("wait for email response", [1, "days"]);
        await step.run("send followup email", sendFollowUpEmail);
      }),
    ]);

    const result1 = await i.ingestInitial("user.created", { userId: "yay" });
    typedExpect(result1.status).toBe("needsRetry");
    expect(result1.nextJobs.length).toEqual(1);
    expect(aFn1).toHaveBeenCalledTimes(1);
    expect(sendWelcomeAlert).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(0);
    expect(sendFollowUpEmail).toHaveBeenCalledTimes(0);

    const result2 = await i.ingest(result1.nextJobs[0]);
    typedExpect(result2.status).toBe("needsRetry");
    expect(result2.nextJobs.length).toEqual(1);
    expect(aFn1).toHaveBeenCalledTimes(2);
    expect(sendWelcomeAlert).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.lastCall).toEqual(["welcome!!!"]);
    expect(sendFollowUpEmail).toHaveBeenCalledTimes(0);

    const result3 = await i.ingest(result2.nextJobs[0]);
    typedExpect(result3.status).toBe("success");
    expect(result3.nextJobs.length).toEqual(0);
    expect(aFn1).toHaveBeenCalledTimes(3);
    expect(sendWelcomeAlert).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendFollowUpEmail).toHaveBeenCalledTimes(1);
  });

  test("multiple consecutive sleeps work", async () => {
    const i = createJobRouter<EventSchema>();

    const fn1Start = jest.fn<any>().mockResolvedValue(undefined);
    const fn1Finish = jest.fn<any>().mockResolvedValue(undefined);

    i.on("user.created", [
      i.createHandler("do stuff", async ({ step }) => {
        await fn1Start();
        await step.sleep("wait 1 day", [1, "days"]);
        await step.sleep("wait 2 days", [2, "days"]);
        await step.sleep("wait 3 days", [3, "days"]);
        await step.run("finish", fn1Finish);
      }),
    ]);

    const result1 = await i.ingestInitial("user.created", { userId: "yay" });
    expect(result1.nextJobs.length).toEqual(1);
    expectDate(getSleepUntilDate(result1.nextJobs[0])).toBeBetween(
      addHours(new Date(), 23),
      addHours(new Date(), 25)
    );
    expect(fn1Start).toHaveBeenCalledTimes(1);
    expect(fn1Finish).toHaveBeenCalledTimes(0);

    const result2 = await i.ingest(result1.nextJobs[0]);
    expect(result2.nextJobs.length).toEqual(1);
    expectDate(getSleepUntilDate(result2.nextJobs[0])).toBeBetween(
      addHours(new Date(), 47),
      addHours(new Date(), 49)
    );
    expect(fn1Start).toHaveBeenCalledTimes(2);
    expect(fn1Finish).toHaveBeenCalledTimes(0);

    const result3 = await i.ingest(result2.nextJobs[0]);
    expect(result3.nextJobs.length).toEqual(1);
    expectDate(getSleepUntilDate(result3.nextJobs[0])).toBeBetween(
      addHours(new Date(), 71),
      addHours(new Date(), 73)
    );
    expect(fn1Start).toHaveBeenCalledTimes(3);
    expect(fn1Finish).toHaveBeenCalledTimes(0);

    const result4 = await i.ingest(result3.nextJobs[0]);
    expect(result4.nextJobs.length).toEqual(0);
    expect(fn1Start).toHaveBeenCalledTimes(4);
    expect(fn1Finish).toHaveBeenCalledTimes(1);
  });

  test("function state should look correct on function fail", async () => {
    const i = createJobRouter<EventSchema>();
    i.on("user.created", [
      i.createHandler(
        "do stuff",
        jest.fn<any>().mockRejectedValue(new Error("nope"))
      ),
    ]);

    const result = await i.ingestInitial("user.created", { userId: "yay" });

    expect(result.result).toMatchObject({
      functionStates: {
        "do stuff": {
          state: {
            err: expect.any(Error),
            numberOfFailedPreviousAttempts: 1,
            numberOfPreviousAttempts: 1,
            status: "error",
          },
          stepStates: {},
        },
      },
    });
  });

  test("function step state should look correct on function fail", async () => {
    const i = createJobRouter<EventSchema>();
    const step2Mock = jest.fn<any>().mockRejectedValue(new Error("nope"));
    i.on("user.created", [
      i.createHandler("do stuff", async ({ step }) => {
        await step.run("step 1", () => Promise.resolve(5));
        await step.run("step 2", step2Mock);
        await step.run("step 3", () => Promise.resolve(6));
      }),
    ]);

    const result = await i.ingestInitial("user.created", { userId: "yay" });

    expect(result.result).toMatchObject({
      functionStates: {
        "do stuff": {
          functionName: "do stuff",
          state: {
            err: expect.any(Error),
            numberOfFailedPreviousAttempts: 1,
            numberOfPreviousAttempts: 1,
            status: "error",
          },
          stepStates: {
            "step 1": {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              result: 5,
              status: "success",
            },
            "step 2": {
              err: expect.any(Error),
              numberOfFailedPreviousAttempts: 1,
              numberOfPreviousAttempts: 1,
              status: "error",
            },
          },
        },
      },
    });

    step2Mock.mockResolvedValue("yay!!");

    const result2 = await i.ingest(result.nextJobs[0]);
    expect(result2.result).toMatchObject({
      functionStates: {
        "do stuff": {
          state: {
            numberOfFailedPreviousAttempts: 1,
            numberOfPreviousAttempts: 2,
            result: undefined,
            status: "success",
          },
          stepStates: {
            "step 1": {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              result: 5,
              status: "success",
            },
            "step 2": {
              numberOfFailedPreviousAttempts: 1,
              numberOfPreviousAttempts: 2,
              result: "yay!!",
              status: "success",
            },
            "step 3": {
              numberOfFailedPreviousAttempts: 0,
              numberOfPreviousAttempts: 1,
              result: 6,
              status: "success",
            },
          },
        },
      },
    });
  });

  test("failed function state should be serializable", async () => {
    const i = createJobRouter<EventSchema>();
    i.on("user.created", [
      i.createHandler(
        "do stuff",
        jest.fn<any>().mockRejectedValue(new Error("nope"))
      ),
    ]);

    const result = await i.ingestInitial("user.created", { userId: "yay" });
    expect(() => JSON.stringify(result.result)).not.toThrow();
  });

  test("ingest job with no handlers", async () => {
    const i = createJobRouter<EventSchema>();

    let res = await i.ingestInitial("user.created", { userId: "123" });

    // todo: maybe throw error instead?
    expect(res.status).toEqual("success");
    expect(res.result.status.type).toBe("complete");
  });

  test("state.numberOfFailedPreviousAttempts increments correctly on fail", async () => {
    const i = createJobRouter<EventSchema>();
    i.on("user.created", [
      i.createHandler("yo", jest.fn<any>().mockRejectedValue(new Error("nope"))),
    ]);

    const result1 = await i.ingestInitial("user.created", { userId: "yay" });
    typedExpect(result1.result).toMatchObject({
      status: {
        type: "complete",
      },
      numberOfFailedPreviousAttempts: 1,
      numberOfPreviousAttempts: 1,
    });

    const result2 = await i.ingest(result1.nextJobs[0]);
    typedExpect(result2.result).toMatchObject({
      status: {
        type: "complete",
      },
      numberOfFailedPreviousAttempts: 2,
      numberOfPreviousAttempts: 2,
    });

    expect(result2.nextJobs.length).toEqual(1);
    typedExpect(result2.nextJobs[0]).toMatchObject({
      status: {
        type: "ready",
      },
      numberOfFailedPreviousAttempts: 2,
      numberOfPreviousAttempts: 2,
    });
  });

  test("state.numberOfFailedPreviousAttempts increments correctly on success", async () => {
    const i = createJobRouter<EventSchema>();
    i.on("user.created", [
      i.createHandler("yo", jest.fn<any>().mockResolvedValue("wat")),
    ]);

    const result1 = await i.ingestInitial("user.created", { userId: "yay" });
    typedExpect(result1.result).toMatchObject({
      status: {
        type: "complete",
      },
      numberOfFailedPreviousAttempts: 0,
      numberOfPreviousAttempts: 1,
    });

    expect(result1.nextJobs.length).toEqual(0);
  });

  test("i.ingest should throw if complete", async () => {
    const i = createJobRouter<EventSchema>();
    i.on("user.created", [
      i.createHandler("yo", jest.fn<any>().mockResolvedValue("wat")),
    ]);

    const state = createInitialEventExecutionState<EventSchema, "user.created">(
      {
        data: { userId: "123" },
        eventName: "user.created",
      }
    );

    state.status = {
      type: "complete",
    };

    await expect(i.ingest(state)).rejects.toThrowErrorMatchingInlineSnapshot(`"job.status.type === complete, cannot ingest a completed job"`);
  });

  test("maxRetriesExceeded should happened", async () => {
    const i = createJobRouter<EventSchema>({ maxRetries: 1 });
    i.on("user.created", [
      i.createHandler("yo", jest.fn<any>().mockRejectedValue(new Error("nope"))),
    ]);

    const result1 = await i.ingestInitial("user.created", { userId: "yay" });
    typedExpect(result1.result).toMatchObject({
      status: {
        type: "complete",
      },
      numberOfFailedPreviousAttempts: 1,
      numberOfPreviousAttempts: 1,
    });
    typedExpect(result1.status).toBe("needsRetry");

    const result2 = await i.ingest(result1.nextJobs[0]);
    typedExpect(result2.result).toMatchObject({
      status: {
        type: "complete",
      },
      numberOfFailedPreviousAttempts: 2,
      numberOfPreviousAttempts: 2,
    });
    typedExpect(result2.status).toBe("maxRetriesExceeded");
  });
});
