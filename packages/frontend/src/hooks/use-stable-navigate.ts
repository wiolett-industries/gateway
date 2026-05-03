import { useCallback, useEffect, useRef } from "react";
import {
  type NavigateFunction,
  type NavigateOptions,
  type To,
  useNavigate,
} from "react-router-dom";

export function useStableNavigate(): NavigateFunction {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  return useCallback(
    ((to: To | number, options?: NavigateOptions) => {
      if (typeof to === "number") {
        navigateRef.current(to);
        return;
      }
      navigateRef.current(to, options);
    }) as NavigateFunction,
    []
  );
}
