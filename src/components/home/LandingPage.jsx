import Navbar from '../common/Navbar';
import Globe3D from './Globe3D';

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-[#0a0a0f]">
            <Navbar transparent />
            <Globe3D />
        </div>
    );
}
