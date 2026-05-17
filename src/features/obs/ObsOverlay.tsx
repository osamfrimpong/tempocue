import { useSearchParams } from "react-router-dom";
import { OutputFrame } from "../../components/layout/OutputFrame";

export function ObsOverlay() {
  const [searchParams] = useSearchParams();
  const transparent = searchParams.get("transparent") !== "false";

  return <OutputFrame mode="obs" transparent={transparent} />;
}
