import {
  IEventExecutionState,
  IEventSchemas,
  createJobRouter,
} from "./JobRouter";
import { createJobSender } from "./JobSender";

export function createJobWorker<EventSchema extends IEventSchemas, Ctx>(args: {
  createCtx?: () => Ctx;
  router: ReturnType<typeof createJobRouter<EventSchema, Ctx>>;
  scheduler: ReturnType<typeof createJobSender<EventSchema>>;
  hooks?: {
    beforeHandleJob?: (
      job: IEventExecutionState<EventSchema, Ctx>
    ) => Promise<any>;
    afterHandleJob?: (
      type: "needsRetry" | "success" | "maxRetriesExceeded",
      result: Awaited<ReturnType<typeof args.router.ingest>>
    ) => Promise<any>;
  };
}) {
  return {
    scheduler: () => args.scheduler,
    async handleJob(job: IEventExecutionState<any, any>, _ctx?: Ctx) {
      const ctx = _ctx || args.createCtx?.();
      await args?.hooks?.beforeHandleJob?.(job);
      let res = await args.router.ingest(job, ctx);
      await args?.hooks?.afterHandleJob?.(res.status, res);

      if (res.status === "needsRetry" && res.nextJobs.length > 0) {
        await args.scheduler.sendMany(res.nextJobs);
      }

      return res;
    },
    async handleMany(jobs: IEventExecutionState<any, any>[], _ctx?: Ctx) {
      return Promise.all(jobs.map((job) => this.handleJob(job, _ctx)));
    },
  };
}
