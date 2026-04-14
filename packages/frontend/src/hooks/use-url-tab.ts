import { useState } from "react";
import { useParams } from "react-router-dom";

/**
 * Syncs active tab state with the URL path.
 * Reads the initial tab from :tab route param and updates URL on tab change.
 */
export function useUrlTab(
  validTabs: string[],
  defaultTab: string,
  buildUrl: (tab: string) => string
): [string, (tab: string) => void] {
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [activeTab, setActiveTabState] = useState(() =>
    tabParam && validTabs.includes(tabParam) ? tabParam : defaultTab
  );
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    window.history.replaceState(null, "", buildUrl(tab));
  };
  return [activeTab, setActiveTab];
}
