/**
 * postMessage protocol between Main App and Container App
 */

export type MainToContainerMessage =
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

export type ContainerToMainMessage =
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
      type: "CONTAINER_HEIGHT";
      height: number;
    };

export type BridgeMessage = MainToContainerMessage | ContainerToMainMessage;
