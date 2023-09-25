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


test('overlapping types work', async () => {
    type Events = {
        'user.created': {
            userId: string
        },
        'user.updated': {
            userId: string
        },
        'communityUser.created': {
            communityId: string,
            userId: string,
        },
        'message.created': {
            messageId: string,
        }
    }

    const i = createJobRouter<Events>();

    i.createHandler<'user.created' | 'communityUser.created'>('asdf', async ({ ctx, ...event}) => {
        // @ts-expect-error
        let j = event.data.communityId;

        let userId = event.data.userId;

        if (event.eventName === 'communityUser.created') {
            event.eventName
            let j = event.data.communityId;
        }
    });

    i.createHandler<'user.created' | 'communityUser.created'>('asdf', async ({ ctx, data, eventName}) => {
        // @ts-expect-error
        let j = event.data.communityId;

        let userId = data.userId;

        if (eventName === 'communityUser.created') {
            eventName
            let j = data.communityId;
        }
    });

    i.createHandler<'user.created' | 'user.updated'>('asdf', async ({ ctx, data, eventName}) => {
        let userId = data.userId;
        // @ts-expect-error
        eventName === 'abc';
    });
});