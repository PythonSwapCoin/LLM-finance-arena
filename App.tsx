import { Routes, Route, Navigate } from 'react-router-dom';
import { SimulationSelector } from './components/SimulationSelector';
import { SimulationView } from './components/SimulationView';
import { SyntheticChartDemo } from './components/SyntheticChartDemo';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/simulation/multi-model" replace />} />
      <Route path="/menu" element={<SimulationSelector />} />
      <Route path="/simulation/:simulationId" element={<SimulationView />} />
      <Route path="/synthetic-demo" element={<SyntheticChartDemo />} />
    </Routes>
  );
}
