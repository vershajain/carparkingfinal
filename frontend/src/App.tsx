import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Analytics from './pages/Analytics';
import Config from './pages/Config';
import Decisions from './pages/Decisions';
import ParkingLayout from './pages/ParkingLayout';
import Overview from './pages/Overview';
import Queue from './pages/Queue';
import Requests from './pages/Requests';
import Reservations from './pages/Reservations';
import Sessions from './pages/Sessions';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="layout" element={<ParkingLayout />} />
        <Route path="requests" element={<Requests />} />
        <Route path="queue" element={<Queue />} />
        <Route path="decisions" element={<Decisions />} />
        <Route path="reservations" element={<Reservations />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="config" element={<Config />} />
        <Route path="*" element={<p className="p-6">Page not found.</p>} />
      </Route>
    </Routes>
  );
}
