import {
  IEventSchemas,
  IEventExecutionState,
  createInitialEventExecutionState,
} from "./JobRouter";

export type JobSender<Events extends IEventSchemas> = {
  send: <EventName extends keyof Events>(
    eventName: EventName,
    data: Events[EventName]
  ) => Promise<any>;
  sendMany: (jobs: IEventExecutionState<Events, any>[]) => Promise<any>;
};
/**
 *
 * @param send - a function that sends an event
 * @returns
 */

export function createJobSender<Events extends IEventSchemas>(
  send: (state: IEventExecutionState<Events, any>[]) => Promise<any>
): JobSender<Events> {
  return {
    send<EventName extends keyof Events>(
      eventName: EventName,
      data: Events[EventName]
    ) {
      return send([createInitialEventExecutionState({ eventName, data })]);
    },
    sendMany(jobs) {
      return send(jobs);
    },
  };
}
