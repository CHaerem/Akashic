export default function Footer() {
    return (
        <footer className="bg-mountain-900 text-mountain-100 py-8">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center">
                <div className="mb-4 md:mb-0">
                    <p className="text-sm">© {new Date().getFullYear()} Mountain Adventures. All rights reserved.</p>
                </div>
                <div className="flex space-x-6">
                    <a
                        href="https://github.com/christopherhaerem/hiking-trails-photos"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-mountain-500 hover:text-white transition-colors"
                    >
                        GitHub
                    </a>
                </div>
            </div>
        </footer>
    );
}
