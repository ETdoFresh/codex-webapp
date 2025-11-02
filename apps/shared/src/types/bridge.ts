/**
 * postMessage protocol between Main App and Service App
 */

export type MainToServiceMessage =
  | {
      type: "AUTH_TOKEN";
      token: string;
      sessionId: string;
    }
  | {
      type: "SETTINGS_UPDATE";
      settings: {
        autoCommit?: boolean;
        gitRemoteUrl?: string | null;
        gitBranch?: string | null;
      };
    };

export type ServiceToMainMessage =
  | {
      type: "READY";
      sessionId: string;
    }
  | {
      type: "ERROR";
      sessionId: string;
      error: string;
    }
  | {
      type: "TITLE_SUGGEST";
      sessionId: string;
      title: string;
    }
  | {
      type: "SERVICE_HEIGHT";
      height: number;
    };

export type BridgeMessage = MainToServiceMessage | ServiceToMainMessage;
