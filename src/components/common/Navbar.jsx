import { Link } from 'react-router-dom';

export default function Navbar() {
    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/10 backdrop-blur-md border-b border-white/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex-shrink-0">
                        <Link to="/" className="text-white font-bold text-xl tracking-wider hover:text-mountain-100 transition-colors">
                            AKASHIC
                        </Link>
                    </div>
                    <div className="hidden md:block">
                        <div className="ml-10 flex items-baseline space-x-4">
                            <Link to="/" className="text-white hover:bg-white/20 px-3 py-2 rounded-md text-sm font-medium transition-all">
                                Home
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}
