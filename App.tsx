import { Routes, Route } from 'react-router-dom';
import { SimulationSelector } from './components/SimulationSelector';
import { SimulationView } from './components/SimulationView';
import './index.css';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<SimulationSelector />} />
      <Route path="/simulation/:simulationId" element={<SimulationView />} />
    </Routes>
  );
}
