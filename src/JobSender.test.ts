import { createJobRouter } from "./JobRouter";
import { createJobSender } from "./JobSender";
import { test, jest } from '@jest/globals';
test("job sender should work", () => {
  type Events = {
    "user.created": {
      userId: string;
    };
  };
  const i = createJobRouter<Events>();
  const fn = jest.fn<any>();
  fn.mockResolvedValue(undefined);

  i.on("user.created", [i.createHandler("welcome flow", fn)]);

  let queue: any[] = [];

  const sender = createJobSender<Events>((state) =>
    Promise.resolve(queue.push(state))
  );

  sender.send("user.created", {
    userId: "123",
  });

  while (queue.length > 0) {
    const state = queue.shift();
    if (state) {
      i.ingest(state);
    }
  }
});
