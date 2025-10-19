export const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export const allowedImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);

export const mimeExtensionMap: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg'
};
