import { Navigate, Route, Routes } from "react-router-dom";
import { Controller } from "../features/controller/Controller";
import { Viewer } from "../features/viewer/Viewer";
import { ObsOverlay } from "../features/obs/ObsOverlay";
import { LowerThird } from "../features/obs/LowerThird";
import { Agenda } from "../features/obs/Agenda";
import { Settings } from "../features/settings/Settings";

export function App() {
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
