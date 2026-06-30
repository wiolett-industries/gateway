import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";

export { SettingsControlRow } from "@/components/common/SettingsControlRow";

export function SaveSettingsButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button onClick={onClick} disabled={disabled}>
      <Save className="h-4 w-4" />
      Save
    </Button>
  );
}
