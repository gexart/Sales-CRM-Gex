import { Hono } from 'hono';
import type { BusinessVariables } from '../middleware/tenant';
import type { Env } from '../types';

export const notificationRoutes = new Hono<{
  Bindings: Env;
  Variables: BusinessVariables;
}>();

notificationRoutes.get('/', async (c) => {
  const stub = c.get('businessStub');
  const res = await stub.getNotifications();
  return c.json(res);
});

notificationRoutes.post('/mark-read/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  const res = await stub.markNotificationAsRead(id);
  return c.json(res);
});

notificationRoutes.post('/mark-all-read', async (c) => {
  const stub = c.get('businessStub');
  const res = await stub.markAllNotificationsAsRead();
  return c.json(res);
});

notificationRoutes.post('/', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));
  const res = await stub.createNotification(body);
  return c.json(res);
});
