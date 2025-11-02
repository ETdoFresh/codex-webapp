import { useEffect, useRef, useState, useCallback } from "react";
import type { ContainerToMainMessage, MainToContainerMessage } from "@codex-webapp/shared";

type ContainerIframeProps = {
  containerUrl: string;
  sessionId: string;
};

const ContainerIframe = ({ containerUrl, sessionId }: ContainerIframeProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sendToContainer = useCallback((message: MainToContainerMessage) => {
    if (!iframeRef.current?.contentWindow) {
      console.warn("[Main App] Cannot send message to container: iframe not ready");
      return;
    }

    iframeRef.current.contentWindow.postMessage(message, "*");
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // In production, validate event.origin matches containerUrl
      // if (!event.origin.startsWith(containerUrl)) return;

      try {
        const message = event.data as ContainerToMainMessage;

        switch (message.type) {
          case "READY":
            console.log("[Main App] Container is ready:", message.sessionId);
            setStatus("ready");
            setErrorMessage(null);
            break;

          case "ERROR":
            console.error("[Main App] Container error:", message.error);
            setStatus("error");
            setErrorMessage(message.error);
            break;

          case "TITLE_SUGGEST":
            console.log("[Main App] Container suggests title:", message.title);
            // Could update session title here
            break;

          case "CONTAINER_HEIGHT":
            // Could adjust iframe height dynamically
            break;
        }
      } catch (error) {
        console.error("[Main App] Failed to handle container message:", error);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [containerUrl]);

  // Send initial auth token to container
  useEffect(() => {
    if (status === "ready") {
      // In a real implementation, you might send settings or auth info
      sendToContainer({
        type: "SETTINGS_UPDATE",
        settings: {
          autoCommit: true,
        },
      });
    }
  }, [status, sendToContainer]);

  const iframeSrc = `${containerUrl}?sessionId=${sessionId}`;

  return (
    <div className="container-iframe-wrapper">
      {status === "loading" && (
        <div className="container-loading">
          <p>Loading container...</p>
        </div>
      )}

      {status === "error" && (
        <div className="container-error">
          <h3>Container Error</h3>
          <p>{errorMessage || "Failed to load container"}</p>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="container-iframe"
        title={`Session ${sessionId}`}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        style={{
          display: status === "ready" ? "block" : "none",
        }}
      />
    </div>
  );
};

export default ContainerIframe;
