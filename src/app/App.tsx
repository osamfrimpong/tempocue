import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { Controller } from "../features/controller/Controller";
import { Viewer } from "../features/viewer/Viewer";
import { ObsOverlay } from "../features/obs/ObsOverlay";
import { LowerThird } from "../features/obs/LowerThird";
import { Agenda } from "../features/obs/Agenda";
import { Settings } from "../features/settings/Settings";
import { useTempoCueStore } from "../stores/useTempoCueStore";

export function App() {
  const initialize = useTempoCueStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/control" replace />} />
      <Route path="/control" element={<Controller />} />
      <Route path="/viewer" element={<Viewer />} />
      <Route path="/obs" element={<ObsOverlay />} />
      <Route path="/lower-third" element={<LowerThird />} />
      <Route path="/agenda" element={<Agenda />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/control" replace />} />
    </Routes>
  );
}
