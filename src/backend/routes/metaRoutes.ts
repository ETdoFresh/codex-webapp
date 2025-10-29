import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getCodexMeta, updateCodexMeta } from '../settings';
import { codexManager } from '../codexManager';
import { droidCliManager } from '../droidCliManager';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

const metaUpdateSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
    provider: z.enum(['CodexSDK', 'ClaudeCodeSDK', 'DroidCLI', 'GeminiSDK']).optional()
  })
  .refine(
    (value) =>
      value.model !== undefined ||
      value.reasoningEffort !== undefined ||
      value.provider !== undefined,
    {
      message: 'Provide a model, reasoningEffort, or provider to update.'
    }
  );

router.get('/meta', (_req: Request, res: Response) => {
  res.json(getCodexMeta());
});

router.patch('/meta', (req: Request, res: Response) => {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'AdminAccessRequired' });
    return;
  }

  const body = metaUpdateSchema.safeParse(req.body ?? {});
  if (!body.success) {
    const { formErrors, fieldErrors } = body.error.flatten();
    const messages = [...formErrors, ...Object.values(fieldErrors).flat()].filter(
      (message) => message && message.length > 0
    );
    res.status(400).json({ error: messages.join('; ') || 'Invalid meta payload.' });
    return;
  }

  try {
    const { meta, modelChanged, providerChanged } = updateCodexMeta(body.data);
    if (modelChanged || providerChanged) {
      codexManager.clearThreadCache();
      droidCliManager.clearThreadCache();
    }
    res.json(meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update Codex settings';
    res.status(400).json({ error: message });
  }
});

export default router;
