import { Routes, Route, Navigate } from 'react-router-dom';
import { SimulationSelector } from './components/SimulationSelector';
import { SimulationView } from './components/SimulationView';
import { SyntheticChartDemo } from './components/SyntheticChartDemo';
import { SnapshotTool } from './components/SnapshotTool';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/simulation/multi-model" replace />} />
      <Route path="/menu" element={<SimulationSelector />} />
      <Route path="/simulation/:simulationId" element={<SimulationView />} />
      <Route path="/synthetic-demo" element={<SyntheticChartDemo />} />
      <Route path="/synthetic-demo" element={<SyntheticChartDemo />} />
      {import.meta.env.VITE_ENABLE_SNAPSHOT_TOOL === 'true' && (
        <Route path="/snapshot-tool" element={<SnapshotTool />} />
      )}
    </Routes>
  );
}
