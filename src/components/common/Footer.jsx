export default function Footer({ minimal = false }) {
    if (minimal) {
        return null;
    }

    return (
        <footer className="bg-mountain-900 border-t border-white/5">
            <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-white/30 text-xs tracking-wider">
                        {new Date().getFullYear()} Akashic
                    </p>
                    <a
                        href="https://github.com/christopherhaerem/hiking-trails-photos"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white/30 hover:text-white/60 text-xs tracking-wider transition-colors"
                    >
                        GitHub
                    </a>
                </div>
            </div>
        </footer>
    );
}
