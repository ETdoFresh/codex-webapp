import { useEffect, useCallback } from "react";
import type { MainToContainerMessage, ContainerToMainMessage } from "@codex-webapp/shared";

type MessageHandler = (message: MainToContainerMessage) => void;

/**
 * Hook to communicate with the main app via postMessage
 */
export function useMainAppBridge(onMessage?: MessageHandler) {
  const sendToMainApp = useCallback((message: ContainerToMainMessage) => {
    if (window.parent === window) {
      // Not in an iframe, skip
      return;
    }

    window.parent.postMessage(message, "*");
  }, []);

  useEffect(() => {
    if (!onMessage) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      // In production, validate event.origin
      // if (event.origin !== EXPECTED_MAIN_APP_ORIGIN) return;

      try {
        const message = event.data as MainToContainerMessage;
        onMessage(message);
      } catch (error) {
        console.error("[Container] Failed to handle message from main app:", error);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onMessage]);

  // Send READY signal on mount
  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("sessionId") || 
                     process.env.SESSION_ID || 
                     "unknown";

    sendToMainApp({
      type: "READY",
      sessionId,
    });
  }, [sendToMainApp]);

  return { sendToMainApp };
}
