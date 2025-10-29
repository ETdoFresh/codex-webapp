import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  fetchCurrentUser,
  login as apiLogin,
  logout as apiLogout,
} from "../api/client";
import type { AuthUser, LoginRequest } from "../api/types";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (payload: LoginRequest) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCurrentUser = useCallback(async () => {
    try {
      const current = await fetchCurrentUser();
      setUser(current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        return;
      }
      console.error("Failed to load current user", error);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      await loadCurrentUser();
      setLoading(false);
    };
    void bootstrap();
  }, [loadCurrentUser]);

  const login = useCallback(async (payload: LoginRequest) => {
    const authenticated = await apiLogin(payload);
    setUser(authenticated);
    return authenticated;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    await loadCurrentUser();
  }, [loadCurrentUser]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
