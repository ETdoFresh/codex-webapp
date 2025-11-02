import { useEffect, useRef, useState, useCallback } from "react";
import type { ServiceToMainMessage, MainToServiceMessage } from "@codex-webapp/shared";

type ServiceIframeProps = {
  serviceUrl: string;
  sessionId: string;
};

const ServiceIframe = ({ serviceUrl, sessionId }: ServiceIframeProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sendToService = useCallback((message: MainToServiceMessage) => {
    if (!iframeRef.current?.contentWindow) {
      console.warn("[Main App] Cannot send message to service: iframe not ready");
      return;
    }

    iframeRef.current.contentWindow.postMessage(message, "*");
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // In production, validate event.origin matches serviceUrl
      // if (!event.origin.startsWith(serviceUrl)) return;

      try {
        const message = event.data as ServiceToMainMessage;

        switch (message.type) {
          case "READY":
            console.log("[Main App] Service is ready:", message.sessionId);
            setStatus("ready");
            setErrorMessage(null);
            break;

          case "ERROR":
            console.error("[Main App] Service error:", message.error);
            setStatus("error");
            setErrorMessage(message.error);
            break;

          case "TITLE_SUGGEST":
            console.log("[Main App] Service suggests title:", message.title);
            // Could update session title here
            break;

          case "SERVICE_HEIGHT":
            // Could adjust iframe height dynamically
            break;
        }
      } catch (error) {
        console.error("[Main App] Failed to handle service message:", error);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [serviceUrl]);

  // Send initial auth token to service
  useEffect(() => {
    if (status === "ready") {
      // In a real implementation, you might send settings or auth info
      sendToService({
        type: "SETTINGS_UPDATE",
        settings: {
          autoCommit: true,
        },
      });
    }
  }, [status, sendToService]);

  const iframeSrc = `${serviceUrl}?sessionId=${sessionId}`;

  return (
    <div className="service-iframe-wrapper">
      {status === "loading" && (
        <div className="service-loading">
          <p>Loading service...</p>
        </div>
      )}

      {status === "error" && (
        <div className="service-error">
          <h3>Service Error</h3>
          <p>{errorMessage || "Failed to load service"}</p>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="service-iframe"
        title={`Session ${sessionId}`}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        style={{
          display: status === "ready" ? "block" : "none",
        }}
      />
    </div>
  );
};

export default ServiceIframe;
