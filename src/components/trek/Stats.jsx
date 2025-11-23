export default function Stats({ trekData }) {
    const stats = trekData.stats;

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border border-gray-100 shadow-sm p-4 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Distance</p>
                    <p className="text-2xl font-bold text-mountain-900">{stats.totalDistance} km</p>
                </div>
                <div className="bg-white border border-gray-100 shadow-sm p-4 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Duration</p>
                    <p className="text-2xl font-bold text-mountain-900">{stats.duration} Days</p>
                </div>
                <div className="bg-white border border-gray-100 shadow-sm p-4 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Elevation Gain</p>
                    <p className="text-2xl font-bold text-green-600">+{stats.totalElevationGain} m</p>
                </div>
                <div className="bg-white border border-gray-100 shadow-sm p-4 rounded-xl">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Elevation Loss</p>
                    <p className="text-2xl font-bold text-red-500">-{stats.totalElevationLoss} m</p>
                </div>
            </div>

            <div className="bg-mountain-900 text-white p-6 rounded-2xl">
                <h3 className="text-lg font-bold mb-4">Highest Point</h3>
                <div className="flex items-end justify-between">
                    <div>
                        <p className="text-3xl font-bold">{stats.highestPoint.elevation}m</p>
                        <p className="text-mountain-300">{stats.highestPoint.name}</p>
                    </div>
                    <div className="text-4xl">🏔️</div>
                </div>
            </div>

            {/* Placeholder for Elevation Profile Chart */}
            <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <h3 className="text-sm font-bold text-gray-500 uppercase mb-4">Elevation Profile</h3>
                <div className="h-40 flex items-end justify-between space-x-1">
                    {/* Simple CSS bar chart visualization based on camp elevations */}
                    {trekData.camps.map((camp, idx) => {
                        const maxEle = stats.highestPoint.elevation;
                        const height = (camp.elevation / maxEle) * 100;
                        return (
                            <div key={idx} className="flex flex-col items-center flex-1 group relative">
                                <div
                                    className="w-full bg-orange-400 rounded-t hover:bg-orange-500 transition-colors"
                                    style={{ height: `${height}%` }}
                                ></div>
                                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-black text-white text-xs p-1 rounded whitespace-nowrap z-10">
                                    {camp.name}: {camp.elevation}m
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-400">
                    <span>Start</span>
                    <span>Finish</span>
                </div>
            </div>
        </div>
    );
}
