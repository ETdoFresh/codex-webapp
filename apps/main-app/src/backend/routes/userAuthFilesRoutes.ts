import { Router } from "express";
import { z } from "zod";
import database from "../db";
import asyncHandler from "../middleware/asyncHandler";
import { requireAdmin } from "../middleware/auth";
import { decryptSecret, encryptSecret } from "../utils/secretVault";

const router = Router();

const providerSchema = z.enum(["codex", "claude", "droid", "copilot"]);
const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w.-]+$/, "Invalid file name");

const saveAuthFileSchema = z.object({
  content: z.string().min(2, "Content must not be empty"),
});

router.use(requireAdmin);

router.get(
  "/users/:id/auth-files",
  asyncHandler(async (req, res) => {
    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    const files = database.listUserAuthFiles(user.id).map((file) => ({
      id: file.id,
      provider: file.provider,
      fileName: file.fileName,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }));

    res.json({ files });
  }),
);

router.put(
  "/users/:id/auth-files/:provider/:fileName",
  asyncHandler(async (req, res) => {
    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    const providerParse = providerSchema.safeParse(req.params.provider);
    if (!providerParse.success) {
      res.status(400).json({ error: "InvalidProvider" });
      return;
    }

    const fileNameParse = fileNameSchema.safeParse(req.params.fileName);
    if (!fileNameParse.success) {
      res.status(400).json({ error: "InvalidFileName" });
      return;
    }

    const parsedBody = saveAuthFileSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(400).json({ error: "InvalidRequest" });
      return;
    }

    const rawContent = parsedBody.data.content.trim();
    try {
      JSON.parse(rawContent);
    } catch {
      res.status(400).json({ error: "InvalidJson" });
      return;
    }

    const encrypted = encryptSecret(rawContent);
    let encryptedContent: string;
    let encryptedIv: string | null = null;
    let encryptedTag: string | null = null;

    if (encrypted) {
      encryptedContent = encrypted.cipherText;
      encryptedIv = encrypted.iv;
      encryptedTag = encrypted.tag;
    } else {
      encryptedContent = Buffer.from(rawContent, "utf8").toString("base64");
    }

    const record = database.upsertUserAuthFile({
      userId: user.id,
      provider: providerParse.data,
      fileName: fileNameParse.data,
      encryptedContent,
      encryptedIv,
      encryptedTag,
    });

    res.json({
      file: {
        id: record.id,
        provider: record.provider,
        fileName: record.fileName,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    });
  }),
);

router.get(
  "/users/:id/auth-files/:provider/:fileName",
  asyncHandler(async (req, res) => {
    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    const providerParse = providerSchema.safeParse(req.params.provider);
    const fileNameParse = fileNameSchema.safeParse(req.params.fileName);
    if (!providerParse.success || !fileNameParse.success) {
      res.status(400).json({ error: "InvalidParameters" });
      return;
    }

    const record = database.getUserAuthFile({
      userId: user.id,
      provider: providerParse.data,
      fileName: fileNameParse.data,
    });

    if (!record) {
      res.status(404).json({ error: "AuthFileNotFound" });
      return;
    }

    const decrypted = decryptSecret(
      record.encryptedContent,
      record.encryptedIv,
      record.encryptedTag,
    );

    if (!decrypted) {
      res.status(500).json({ error: "DecryptFailed" });
      return;
    }

    res.json({
      file: {
        provider: record.provider,
        fileName: record.fileName,
        content: decrypted,
        updatedAt: record.updatedAt,
      },
    });
  }),
);

router.delete(
  "/users/:id/auth-files/:provider/:fileName",
  asyncHandler(async (req, res) => {
    const user = database.getUserById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "UserNotFound" });
      return;
    }

    const providerParse = providerSchema.safeParse(req.params.provider);
    const fileNameParse = fileNameSchema.safeParse(req.params.fileName);
    if (!providerParse.success || !fileNameParse.success) {
      res.status(400).json({ error: "InvalidParameters" });
      return;
    }

    const deleted = database.deleteUserAuthFile({
      userId: user.id,
      provider: providerParse.data,
      fileName: fileNameParse.data,
    });

    if (!deleted) {
      res.status(404).json({ error: "AuthFileNotFound" });
      return;
    }

    res.status(204).end();
  }),
);

export default router;
