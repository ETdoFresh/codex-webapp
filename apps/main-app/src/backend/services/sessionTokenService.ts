import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const DEFAULT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

export type SessionTokenPayload = {
  sessionId: string;
  userId: string;
  iat?: number;
  exp?: number;
};

/**
 * Generate a JWT token for a container to authenticate with the main app
 */
export function generateSessionToken(
  sessionId: string,
  userId: string,
  expiresIn: number = DEFAULT_EXPIRY,
): string {
  return jwt.sign({ sessionId, userId }, JWT_SECRET, { expiresIn });
}

/**
 * Validate and decode a session token
 * @throws Error if token is invalid or expired
 */
export function validateSessionToken(token: string): SessionTokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionTokenPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Session token has expired");
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid session token");
    }
    throw new Error("Token validation failed");
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1] ?? null;
}
