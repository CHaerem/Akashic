import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './components/home/LandingPage';
import TrekDetailPage from './components/trek/TrekDetailPage';
import ScrollToTop from './components/common/ScrollToTop';

function App() {
  return (
    <BrowserRouter basename="/Akashic/">
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/trek/:trekId" element={<TrekDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
