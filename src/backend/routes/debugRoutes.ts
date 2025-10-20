import { Router } from 'express';
import { getStreamDebugEvents } from '../services/streamDebug';

const router = Router();

router.get('/api/debug/stream-events', (_req, res) => {
  res.json({ events: getStreamDebugEvents() });
});

export default router;
