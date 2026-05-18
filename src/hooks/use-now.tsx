import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const NowContext = createContext<number>(Date.now());

export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useNow() {
  return useContext(NowContext);
}
