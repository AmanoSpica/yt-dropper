import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

export function LoginPage() {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handleLogin = () => {
    if (isRedirecting) {
      return;
    }

    setIsRedirecting(true);
    window.setTimeout(() => {
      window.location.assign("/api/auth/discord");
    }, 0);
  };

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 rounded-lg border p-8 text-center">
        <h1 className="text-2xl font-bold">yt-Dropper</h1>
        <p className="text-sm text-muted-foreground">
          続行するには Discord でログインしてください
        </p>
        <Button
          className="w-full"
          size="lg"
          onClick={handleLogin}
          disabled={isRedirecting}
          type="button"
        >
          {isRedirecting ? (
            <>
              <LoaderCircle className="mr-2 size-5 animate-spin" />
              Discord に移動中...
            </>
          ) : (
            <>
              <img
                src="/discord-logo.svg"
                alt="Discord Logo"
                className="mr-2 h-5 w-5"
              />
              Discord でログイン
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
