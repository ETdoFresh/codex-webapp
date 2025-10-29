import { Router } from 'express';
import { getStreamDebugEvents } from '../services/streamDebug';
import { requireAdmin } from '../middleware/auth';

const router = Router();

router.use(requireAdmin);

router.get('/api/debug/stream-events', (_req, res) => {
  res.json({ events: getStreamDebugEvents() });
});

export default router;
