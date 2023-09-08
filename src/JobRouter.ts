import { addDays, addHours, addMinutes, addSeconds } from "date-fns";
import { makeId } from "./utils/makeId";

const HandledErrorSymbol = Symbol('HandledError');
type HandledError = {
  handledSymbol: typeof HandledErrorSymbol,
  error: any
}
function handledError(error: any): HandledError {
  return {
    handledSymbol: HandledErrorSymbol,
    error
  }
}

function isHandledError(e: any): e is HandledError {
  return e?.handledSymbol === HandledErrorSymbol;
}

/**
 * Keys are event names, values are the data schema for that event
 */
export type IEventSchemas<EventNames extends string = any> = {
  [EventName in EventNames]: any;
};

/**
 * An event that is being dispatched
 *
 * @property data - the data for the event
 * @property eventName - the name of the event
 * @property jobId - the id of the job
 */
type IEvent<EventSchemas, EventName extends keyof EventSchemas> = {
  data: Intersection<EventSchemas[EventName]>;
  eventName: EventName;
  jobId: string;
};

/**
 * A step is a function that can be retried
 * @property name - the name of the step
 * @property cb - the function to run
 * @returns the result of the function
 */
type IStep = {
  run<T>(name: string, cb: () => Promise<T>): Promise<T>;
  sleep(
    name: string,
    time: [number, "minutes" | "hours" | "days" | 'seconds']
  ): Promise<true>;
};

/**
 * The arguments passed to a function handler
 * @property data - the data for the event
 * @property eventName - the name of the event
 * @property jobId - the id of the job
 * @property step - a step function
 * @property numberOfFailedPreviousAttempts - the number of times this function has been attempted and failed
 * @property numberOfPreviousAttempts - the number of times this function has been attempted.  This count does not imply failure because the function may have slept.
 */
type IFunctionHandlerArg<
  EventSchemas,
  EventName extends keyof EventSchemas,
  Ctx extends any = undefined
> = IEvent<EventSchemas, EventName> & {
  step: IStep;
  numberOfFailedPreviousAttempts: number;
  numberOfPreviousAttempts: number;
  ctx: Ctx;
};

/**
 * A function handler
 * @property args - the arguments passed to the function handler
 * @returns the result of the function
 */
type IFunctionHandler<
  EventSchemas,
  EventName extends keyof EventSchemas,
  Ctx
> = (args: IFunctionHandlerArg<EventSchemas, EventName, Ctx>) => Promise<any>;

type ValueOf<T> = T[keyof T];
type KeysMatching<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

type Intersection<UnionTypes> = Omit<UnionTypes, never>;

type IFunction<EventNames extends keyof EventSchemas, EventSchemas, Ctx> = {
  functionName: string;
  // handlesEvents: EventNames;
  handler: IFunctionHandler<EventSchemas, EventNames, Ctx>;
};

/**
 * The state of a step
 * @property status - the status of the step
 * @property result - the result of the step
 * @property err - the error of the step
 * @property attempts - the number of times the step has been attempted
 */
type StepState = (
  | { status: "success"; result: any }
  | { status: "error"; err: any }
  | { status: "pending" }
  | { status: "sleeping"; untilISO: string, delaySeconds: number }
  | { status: "handledByAnotherExecution" }
) & {
  /**
   * The number of times this step failed during an attempt.
   */
  numberOfFailedPreviousAttempts: number;
  /**
   * The number of times this step was attempted.
   */
  numberOfPreviousAttempts: number;

  executionId: string;
};

/**
 * The state of a function
 *
 * @property functionName - the name of the function
 * @property result - the result of the function
 * @property stepStates - the state of the steps of the function
 * @property stepStates[stepName] - the state of the step
 */
type IFunctionExecutionState = {
  functionName: string;
  state: StepState;
  stepStates: {
    [stepName: string]: StepState | undefined;
  };
};

/**
 * The state of an event
 * @property event - the event
 * @property functionStates - the state of the functions
 * @property functionStates[functionName] - the state of the function
 * @property functionStates[functionName].stepStates - the state of the steps of the function
 */
export type IEventExecutionState<
  EventSchemas,
  EventName extends keyof EventSchemas
> = {
  executionId: string;
  event: IEvent<EventSchemas, EventName>;
  numberOfPreviousAttempts: number;
  numberOfFailedPreviousAttempts: number;
  /**
   * The functions to include in the next job
   */
  includeFunctions?: string[];
  /**
   * The functions to exclude in the next job
   */
  excludeFunctions?: string[];
  status:
    | {
        type: "complete"; // job is completed
        // job may have failed or succeeded
      }
    | {
        type: "ready"; // job is waiting to be retried
      }
    | {
        type: "readyAt"; // job is waiting until a certain time to be retried (sleeping)
        readyAtISO: string;
        readyAtDelaySeconds: number;
      }
    | {
        type: "maxRetriesExceeded";
        error?: any;
      };
  functionStates: Record<string, IFunctionExecutionState | undefined>;
};

export function createInitialEventExecutionState<
  Events extends IEventSchemas,
  EventName extends keyof Events
>({
  eventName,
  data,
  jobId = makeId(),
}: {
  eventName: EventName;
  data: Events[EventName];
  jobId?: string;
}): IEventExecutionState<Events, EventName> {
  return {
    status: { type: "ready" },
    executionId: makeId(),
    numberOfPreviousAttempts: 0,
    numberOfFailedPreviousAttempts: 0,
    event: {
      data,
      eventName,
      jobId,
    },
    functionStates: {},
  };
}

type HookArg<Ctx>= {
  ctx: Ctx,
  executionState: IEventExecutionState<any, any>,
  functionName: string,
}

export type JobRouterArgs<Ctx> = {
  getCtx?: () => Promise<Ctx>;
  /**
   * The maximum number of times a job can be retried
   * @default 3
   */
  maxRetries?: number;
  hooks?: {
    beforeExecuteFunction?: (args: HookArg<Ctx> & { functionState?: IFunctionExecutionState }) => void;
    afterExecuteFunction?: (args: HookArg<Ctx> & { functionState: IFunctionExecutionState }) => void;
    beforeExecuteStep?: (args: HookArg<Ctx> & { functionState: IFunctionExecutionState, stepName: string, stepState?: StepState }) => void;
    afterExecuteStep?: (args: HookArg<Ctx> & { functionState: IFunctionExecutionState, stepName: string, stepState?: StepState }) => void;
    onError?: (args: HookArg<Ctx> & { error: Error | any, functionState: IFunctionExecutionState, stepName?: string, stepState?: StepState}) => void;
  }
};

const SleepSymbol = Symbol("sleep");

type SleepMessage = {
  type: typeof SleepSymbol;
  untilISO: string;
  delaySeconds: number;
};

function createSleepMessage(err: SleepMessage) {
  return err;
}

function isThrownSleep(err: any): err is SleepMessage {
  if (err?.type === SleepSymbol) {
    return true;
  }
  return false;
}

/**
 *
 * Creates an job router which can handle dispatched events
 *
 * @returns
 */
export function createJobRouter<
  EventSchemas extends IEventSchemas,
  Ctx extends any = any
>(args: JobRouterArgs<Ctx> = {}) {
  let handlersRegistry: Partial<{
    [EventName in keyof EventSchemas]: IFunction<
      EventName,
      EventSchemas,
      Ctx
    >[];
  }> = {};
  const maxRetries = typeof args.maxRetries === "number" ? args.maxRetries : 3;
  return {
    _handlersRegistry: handlersRegistry,
    utils: {
      createJobForEvent<EventName extends keyof EventSchemas>(
        eventName: EventName,
        data: EventSchemas[EventName]
      ) {
        return createInitialEventExecutionState({
          eventName,
          data,
        });
      },
    },
    /**
     * Creates a function that can handle events. Later the function should be passed
     * into i.registerFunctions
     * @param functionName - unique name of the function
     * @param handler - the event handler
     * @returns
     */
    createHandler<EventNames extends keyof EventSchemas>(
      functionName: string,
      handler: IFunctionHandler<EventSchemas, EventNames, Ctx>
    ): IFunction<EventNames, EventSchemas, Ctx> {
      return {
        functionName,
        handler,
      };
    },

    /**
     *
     * @param eventName - the name of the event that the functions handle
     * @param functions - the functions that handle the event
     */
    on<EventName extends keyof EventSchemas>(
      eventName: EventName,
      functions: IFunction<EventName, EventSchemas, Ctx>[]
    ) {
      handlersRegistry[eventName] = functions;
      return this;
    },

    /**
     * Ingests an event and returns the state of the event and whether
     * the event should be retried
     *
     * @param eventName - the name of the event
     * @param data - the data for the event
     * @param jobId - (optional) the id of the job
     * @returns
     */
    ingestInitial<EventName extends keyof EventSchemas>(
      eventName: EventName,
      data: EventSchemas[EventName],
      jobId = makeId()
    ) {
      return this.ingest(
        createInitialEventExecutionState({
          eventName,
          data,
          jobId,
        })
      );
    },

    /**
     * Ingests an event and returns the state of the event and whether
     * the event should be retried
     *
     * @param _state the state of an event
     * @returns
     */
    async ingest<EventName extends keyof EventSchemas>(
      _state: IEventExecutionState<EventSchemas, EventName>,
      _ctx?: Ctx
    ): Promise<{
      input: IEventExecutionState<EventSchemas, EventName>;
      result: IEventExecutionState<EventSchemas, EventName>;
      nextJobs: IEventExecutionState<EventSchemas, EventName>[];
      status: "success" | "needsRetry" | "maxRetriesExceeded";
    }> {
      if (_state.status.type === "complete") {
        throw new Error(
          "job.status.type === complete, cannot ingest a completed job"
        );
      }

      const executionId = makeId();
      // state for this event
      let state: IEventExecutionState<EventSchemas, EventName> =
        structuredClone(_state);

      state.executionId = executionId;
      // all handlers for this event
      let handlers = handlersRegistry[state.event.eventName] || [];

      // todo: check if include/exclude function overlap

      if (state.includeFunctions?.length) {
        handlers = handlers.filter((fn) =>
          state.includeFunctions?.includes(fn.functionName)
        );
      }

      if (state.excludeFunctions?.length) {
        handlers = handlers.filter(
          (fn) => !state.excludeFunctions?.includes(fn.functionName)
        );
      }

      const ctx = _ctx || (await args.getCtx?.());
      let someFunctionDidFail = false;
      state.functionStates = Object.fromEntries(
        await Promise.all(
          handlers.map(async (fn) => {
            // get the function state
            let fnState: IFunctionExecutionState =
              state.functionStates[fn.functionName] ||
              createInitialFunctionState(fn.functionName, executionId);

            if (fnState.state.status === "success") {
              return [fn.functionName, fnState];
            }

            let handlerArg: IFunctionHandlerArg<EventSchemas, EventName, Ctx> =
              {
                ...state.event,
                // @ts-ignore
                ctx,
                numberOfFailedPreviousAttempts:
                  fnState.state.numberOfFailedPreviousAttempts,
                step: {
                  sleep: async (uniqueStepName, [amount, unit]) => {
                    let stepState = fnState.stepStates[uniqueStepName];
                    if (!stepState) {
                      args.hooks?.beforeExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: undefined,
                      });
                      let delaySeconds = 
                        unit === "days" ? amount * 24 * 60 * 60 :
                        unit === "hours" ? amount * 60 * 60 :
                        unit === 'minutes' ? amount * 60 :
                        unit === 'seconds' ? amount : 1;

                      let untilISO = addSeconds(new Date(), delaySeconds).toISOString();
                      
                      fnState.stepStates[uniqueStepName] = {
                        status: "sleeping",
                        untilISO,
                        delaySeconds,
                        numberOfFailedPreviousAttempts: 0,
                        numberOfPreviousAttempts: 1,
                        executionId,
                      };

                      args.hooks?.afterExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: fnState.stepStates[uniqueStepName],
                      });
                      
                      throw createSleepMessage({
                        type: SleepSymbol,
                        untilISO,
                        delaySeconds,
                      });
                    } else if (stepState.status === "sleeping") {
                      args.hooks?.beforeExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: fnState.stepStates[uniqueStepName],
                      });

                      fnState.stepStates[uniqueStepName] = {
                        status: "success",
                        result: true,
                        executionId,
                        numberOfPreviousAttempts:
                          stepState.numberOfPreviousAttempts,
                        numberOfFailedPreviousAttempts:
                          stepState.numberOfFailedPreviousAttempts,
                      };
                      args.hooks?.afterExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: fnState.stepStates[uniqueStepName],
                      });
                    }
                    return true;
                  },
                  run: async (uniqueStepName, cb) => {
                    let stepState = fnState.stepStates[uniqueStepName];
                    if (!stepState) {
                      stepState = {
                        status: "pending",
                        executionId,
                        numberOfFailedPreviousAttempts: 0,
                        numberOfPreviousAttempts: 0,
                      };
                      fnState.stepStates[uniqueStepName] = stepState;
                    }

                    if (stepState.status === "success") {
                      return stepState.result;
                    }



                    try {
                      args.hooks?.beforeExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: fnState.stepStates[uniqueStepName],
                      });
                      let result = await cb();
                      fnState.stepStates[uniqueStepName] = {
                        status: "success",
                        result,
                        executionId,
                        numberOfFailedPreviousAttempts:
                          stepState.numberOfFailedPreviousAttempts,
                        numberOfPreviousAttempts:
                          stepState.numberOfPreviousAttempts + 1,
                      };
                      args.hooks?.afterExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: fnState.stepStates[uniqueStepName],
                      });
                      return result;
                    } catch (err) {
                      fnState.stepStates[uniqueStepName] = {
                        status: "error",
                        executionId,
                        err,
                        numberOfFailedPreviousAttempts:
                          stepState.numberOfFailedPreviousAttempts + 1,
                        numberOfPreviousAttempts:
                          stepState.numberOfPreviousAttempts + 1,
                      };

                      args.hooks?.onError?.({
                        // @ts-expect-error
                        ctx,
                        error: err,
                        executionState: state,
                        stepName: uniqueStepName,
                        functionName: fn.functionName,
                        stepState: fnState.stepStates[uniqueStepName]
                      });

                      args.hooks?.afterExecuteStep?.({
                        // @ts-expect-error
                        ctx,
                        executionState: state,
                        functionName: fn.functionName,
                        stepName: uniqueStepName,
                        functionState: fnState,
                        stepState: fnState.stepStates[uniqueStepName],
                      });
                      throw handledError(err);
                    }
                  },
                },
              };

            try {
              args.hooks?.beforeExecuteFunction?.({
                ctx: handlerArg.ctx,
                executionState: state,
                functionName: fn.functionName,
                functionState: fnState,
              });
              // @ts-ignore
              let result = await fn.handler(handlerArg);
              const successState: IFunctionExecutionState = {
                ...fnState,
                state: {
                  status: "success",
                  result,
                  executionId,
                  numberOfPreviousAttempts:
                    fnState.state.numberOfPreviousAttempts + 1,

                  numberOfFailedPreviousAttempts:
                    fnState.state.numberOfFailedPreviousAttempts,
                },
              };
              args.hooks?.afterExecuteFunction?.({
                ctx: handlerArg.ctx,
                executionState: state,
                functionName: fn.functionName,
                functionState: fnState,
              });
              return [
                fn.functionName,
                successState,
              ];
            } catch (err) {
              if (isThrownSleep(err)) {
                // is sleeping
                const sleepState: IFunctionExecutionState = {
                  ...fnState,
                  state: {
                    executionId,
                    status: "sleeping",
                    untilISO: err.untilISO,
                    delaySeconds: err.delaySeconds,
                    numberOfFailedPreviousAttempts:
                      fnState.state.numberOfFailedPreviousAttempts,
                    numberOfPreviousAttempts:
                      fnState.state.numberOfPreviousAttempts + 1,
                  },
                };
                args.hooks?.afterExecuteFunction?.({
                  ctx: handlerArg.ctx,
                  executionState: state,
                  functionName: fn.functionName,
                  functionState: sleepState
                });
                return [
                  fn.functionName,
                  sleepState,
                ];
              }

              let originalError = isHandledError(err) ? err.error : err;
              someFunctionDidFail = true;

              const errorState: IFunctionExecutionState = {
                ...fnState,
                state: {
                  executionId,
                  status: "error",
                  err: originalError,
                  numberOfFailedPreviousAttempts:
                    fnState.state.numberOfFailedPreviousAttempts + 1,
                  numberOfPreviousAttempts:
                    fnState.state.numberOfPreviousAttempts + 1,
                },
              };
              if (!isHandledError(err)) {
                args.hooks?.onError?.({
                  ctx: handlerArg.ctx,
                  executionState: state,
                  functionName: fn.functionName,
                  functionState: errorState,
                  error: originalError,
                })
              }
              args.hooks?.afterExecuteFunction?.({
                ctx: handlerArg.ctx,
                executionState: state,
                functionName: fn.functionName,
                functionState: errorState
              });
              // actual error happened
              return [
                fn.functionName,
               errorState
              ];
            }
          })
        )
      );

      const forks: IEventExecutionState<EventSchemas, EventName>[] = [];
      const failedFunctions: string[] = [];
      const successFunctions: string[] = [];
      const sleepingFunctions: string[] = [];
      for (const [functionName, functionState] of Object.entries(
        state.functionStates
      )) {
        if (!functionState) {
          throw new Error("functionState is undefined");
        }
        if (functionState.state.status === "error") {
          failedFunctions.push(functionName);
        } else if (functionState.state.status === "sleeping") {
          sleepingFunctions.push(functionName);
          const sleepingUntil = functionState.state.untilISO;
          const clone = structuredClone(state);
          clone.includeFunctions = [functionName];
          clone.status = {
            type: "readyAt",
            readyAtDelaySeconds: functionState.state.delaySeconds,
            readyAtISO: sleepingUntil,
          };
          forks.push(clone);
        } else if (functionState.state.status === "success") {
          successFunctions.push(functionName);
        }
      }

      state.numberOfPreviousAttempts++;
      if (someFunctionDidFail) {
        state.numberOfFailedPreviousAttempts++;
      }

      if (failedFunctions.length > 0) {
        const clone = structuredClone(state);
        clone.excludeFunctions = Array.from(
          new Set([
            ...(state.excludeFunctions || []),
            ...forks.flatMap((f) => f.includeFunctions || []),
          ])
        );
        clone.status = {
          type: "ready",
        };
        forks.push(clone);
      }

      return {
        result: {
          ...state,
          status: {
            type: "complete",
          },
        },
        input: _state,
        nextJobs: forks,
        status: (() => {
          if (
            forks.length > 0 &&
            state.numberOfFailedPreviousAttempts > maxRetries
          ) {
            return "maxRetriesExceeded";
          }
          if (forks.length > 0) {
            return "needsRetry";
          }
          return "success";
        })(),
      };
    },
  };
}

function createInitialFunctionState(
  functionName: string,
  executionId: string
): IFunctionExecutionState {
  return {
    functionName,
    state: {
      executionId,
      status: "pending",
      numberOfFailedPreviousAttempts: 0,
      numberOfPreviousAttempts: 0,
    },
    stepStates: {},
  };
}
