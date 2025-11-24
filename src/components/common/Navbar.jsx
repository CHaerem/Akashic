import { Link } from 'react-router-dom';

export default function Navbar({ transparent = false }) {
    return (
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
            transparent ? 'bg-transparent' : 'bg-mountain-900/80 backdrop-blur-md border-b border-white/5'
        }`}>
            <div className="max-w-7xl mx-auto px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <Link
                        to="/"
                        className="text-white text-sm font-light tracking-[0.3em] uppercase hover:text-white/70 transition-colors"
                    >
                        Akashic
                    </Link>
                    <div className="flex items-center gap-8">
                        <Link
                            to="/"
                            className="text-white/60 hover:text-white text-xs tracking-widest uppercase transition-colors"
                        >
                            Journeys
                        </Link>
                    </div>
                </div>
            </div>
        </nav>
    );
}
