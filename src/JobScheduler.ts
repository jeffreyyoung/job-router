import {
  IEventSchemas,
  IEventExecutionState,
  createInitialEventExecutionState,
} from "./JobRouter";
import { makeId } from "./utils/makeId";

export const getDelaySeconds = (job: IEventExecutionState<any, any>) => {
  if (job.state.status === "error-retryable") {
    return job.state.numberOfSecondsToSleep;
  } else if (job.state.status === "ready") {
    return 0;
  } else if (job.state.status === "sleeping") {
    return job.state.numberOfSecondsToSleep;
  }
  return 0;
};

export type JobScheduler<Events extends IEventSchemas> = {
  send: <EventName extends keyof Events>(
    eventName: EventName,
    data: Events[EventName],
    ops?: { delaySeconds?: number, traceId?: string }
  ) => Promise<any>;
  sendMany: (jobs: IEventExecutionState<Events, any>[]) => Promise<any>;
};
/**
 *
 * @param send - a function that sends an event
 * @returns
 */

export function createJobScheduler<Events extends IEventSchemas>(
  send: (state: IEventExecutionState<Events, any>[]) => Promise<any>
): JobScheduler<Events> {
  return {
    send<EventName extends keyof Events>(
      eventName: EventName,
      data: Events[EventName],
      { delaySeconds = 0, traceId = makeId() } = {}
    ) {
      return send([createInitialEventExecutionState({ eventName, data, delaySeconds, traceId })]);
    },
    sendMany(jobs) {
      return send(jobs);
    },
  };
}
