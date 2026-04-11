import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";

export function CopyButton({ text, children }: { text: string; children?: React.ReactNode }) {
  const [isCopying, setIsCopying] = useState(false);
  const handleCopy = () => {
    setIsCopying(true);
    navigator.clipboard.writeText(text).then(
      () => {
        toast.success("copied to clipboard");
      },
      () => {
        toast.error("Failed to copy");
      },
    );
    setTimeout(() => setIsCopying(false), 3000);
  };
  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {children}
      {isCopying ? (
        <Check className="ml-0.5" size={16} />
      ) : (
        <Copy className="mr-0.5" size={16} />
      )}
    </Button>
  );
}
