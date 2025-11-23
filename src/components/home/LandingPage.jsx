import Navbar from '../common/Navbar';
import Footer from '../common/Footer';
import Globe3D from './Globe3D';

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-mountain-900 to-black flex flex-col">
            <Navbar />

            {/* Globe Section */}
            <Globe3D />

            <Footer />
        </div>
    );
}
