import { test } from '@jest/globals';
import { createJobRouter } from '../JobRouter';

type Events = {
    'user.created': {
        userId: string
    },
    'user.updated': {
        userId: string
    },
    'community.created': {
        communityId: string
    }
}

test('types work', async () => {
  const i = createJobRouter<Events>();


  // cant attach to invalid events
  // @ts-expect-error
  i.on('abc', []);
  
  const communityHandler = i.createHandler<'community.created'>('asdf', async () => ({}));

  // cant attach handlers to the wrong event
  // @ts-expect-error
  i.on('user.created', [ communityHandler])

  i.on('community.created', [communityHandler]);

  // cant create handlers for events that dont exist
  // @ts-expect-error
  i.createHandler<'asdf'>('asdf', () => Promise.resolve({}))
});