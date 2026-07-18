import { Box } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  type ProxyUpstreamLabelInput,
  proxyUpstreamResourceName,
  proxyUpstreamText,
} from "@/lib/proxy-upstream-label";
import { getNodeAppearanceColor } from "@/lib/node-appearance";

export function ProxyUpstreamTarget({ host }: { host: ProxyUpstreamLabelInput }) {
  const resourceName = proxyUpstreamResourceName(host);
  if (resourceName) {
    const appearance = getNodeAppearanceColor(host.dockerNodeAppearanceColor);
    return (
      <Badge variant="secondary" className={appearance?.badgeClassName} title={resourceName}>
        <Box className="mr-1.5 h-3.5 w-3.5" />
        {resourceName}
      </Badge>
    );
  }

  const text = proxyUpstreamText(host);
  return text ? <span>{text}</span> : null;
}
