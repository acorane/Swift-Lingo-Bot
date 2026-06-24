import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

const DEV_INIT_DATA = "mock_dev_init_data";

export default function Login() {
  const { login, user } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [attemptedLogin, setAttemptedLogin] = useState(false);

  useEffect(() => {
    if (user) {
      setLocation("/");
      return;
    }

    if (attemptedLogin) return;
    setAttemptedLogin(true);

    // Inside Telegram WebApp — use real initData
    const telegramInitData = window.Telegram?.WebApp?.initData;
    if (telegramInitData) {
      window.Telegram!.WebApp!.ready();
      login(telegramInitData).catch(() => {
        setError("Telegram authentication failed. Please reopen from Telegram.");
      });
      return;
    }

    // Outside Telegram (browser preview / testing) — auto-login with dev token
    login(DEV_INIT_DATA).catch(() => {
      setError("Could not connect to the server. Please try refreshing.");
    });
  }, [user, login, setLocation, attemptedLogin]);

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <div className="text-center space-y-3">
          <p className="text-destructive font-medium">{error}</p>
          <button
            className="text-sm text-primary underline"
            onClick={() => { setError(null); setAttemptedLogin(false); }}
          >
            {t("try_again") ?? "Try again"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          {t("logging_in") ?? "Logging in…"}
        </p>
      </div>
    </div>
  );
}
