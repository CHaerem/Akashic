export default function LoadingSpinner({ fullScreen = false }) {
    const spinner = (
        <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-mountain-200 border-t-orange-500 rounded-full animate-spin"></div>
            <p className="text-mountain-600 font-medium animate-pulse">Loading...</p>
        </div>
    );

    if (fullScreen) {
        return (
            <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
                {spinner}
            </div>
        );
    }

    return (
        <div className="w-full h-full flex items-center justify-center min-h-[200px]">
            {spinner}
        </div>
    );
}
