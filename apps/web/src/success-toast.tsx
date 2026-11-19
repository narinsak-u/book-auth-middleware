import { useEffect, useState } from "react";

export function SuccessToast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timeout);
  }, []);
  return visible ? <p className="success-toast" role="status" aria-live="polite">{message}</p> : null;
}
