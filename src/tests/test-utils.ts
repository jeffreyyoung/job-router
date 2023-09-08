import { expect } from "@jest/globals";
import { IEventExecutionState } from "../JobRouter";

export function getSleepUntilDate(result: IEventExecutionState<any, any>) {
  if (result.status.type !== "sleeping") {
    throw new Error("expected status to be sleeping");
  }
  return new Date(result.status.sleepingUntilISO);
}

export function expectDate(date: Date) {
  return {
    toBeBetween(start: Date, end: Date) {
      expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(date.getTime()).toBeLessThanOrEqual(end.getTime());
    },
  };
}

export function jobInsights<EventTypes = any>(
  job: IEventExecutionState<EventTypes, any>
) {
  const self = {
    functionNamesThatRan(): string[] {
      return self.functionsThatRan().map((state) => state.functionName);
    },
    functionsThatRan() {
      return Object.entries(job.functionStates).flatMap(([name, state]) => {
        return state?.state.executionId === job.executionId ? [state] : [];
      });
    },
    functionNamesThatDidNotRun() {
      return Object.entries(job.functionStates).flatMap(([name, state]) => {
        return state?.state.executionId !== job.executionId ? [name] : [];
      });
    },
    stepsThatRan() {
      return self.functionsThatRan().flatMap((func) => {
        return Object.entries(func.stepStates).flatMap(([name, state]) => {
          return state?.executionId === job.executionId
            ? [{ ...state, stepName: name }]
            : [];
        });
      });
    },
    stepsThatRanInFunction(functionName: string) {
      return Object.entries(
        job.functionStates[functionName]?.stepStates || {}
      ).flatMap(([name, state]) => {
        return state?.executionId === job.executionId
          ? [{ ...state, stepName: name }]
          : [];
      });
    },
    stepNamesThatRan() {
      return self.stepsThatRan().map((state) => state.stepName);
    },
    simpleFunctionSummary() {
      return self.functionsThatRan().map((func) => {
        return [func.functionName, func.state.status];
      });
    },
    executedFunctionsAndSteps() {
      return Object.fromEntries(
        self.functionsThatRan().map((func) => {
          const stepSummary = Object.fromEntries(
            Object.entries(func.stepStates)
              .filter(
                ([stepName, state]) => state?.executionId === job.executionId
              )
              .map(([stepName, state]) => {
                return [stepName, state?.status];
              })
          );
          return [func.functionName, stepSummary];
        })
      );
    },
  };
  return self;
}
