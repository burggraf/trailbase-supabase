import { test } from '@playwright/test';
import { context, confirmEmail } from '../phase-a/helpers.js';
import { taskFlow } from './task-flow.js';

test('L1-05–20/L1-24/E01–04/E07/E08/E10/E11/E13/E14 standalone usable task flow and two SDK-authenticated owners', async ({ browser }) => {
  test.setTimeout(120000);
  const env = await context();
  await taskFlow(browser, env.trailUrl, email => confirmEmail(env, email));
});
