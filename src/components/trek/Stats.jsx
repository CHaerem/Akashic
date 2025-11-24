export default function Stats({ trekData }) {
    const stats = trekData.stats;

    return (
        <div className="space-y-8">
            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Distance</p>
                    <p className="text-xl text-white/90 font-light">{stats.totalDistance} km</p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Duration</p>
                    <p className="text-xl text-white/90 font-light">{stats.duration} days</p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Ascent</p>
                    <p className="text-xl text-emerald-400/80 font-light">+{stats.totalElevationGain}m</p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Descent</p>
                    <p className="text-xl text-rose-400/80 font-light">-{stats.totalElevationLoss}m</p>
                </div>
            </div>

            {/* Summit */}
            <div className="border border-white/10 rounded-lg p-6">
                <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-3">Summit</p>
                <p className="text-3xl text-white/90 font-light mb-1">{stats.highestPoint.elevation}m</p>
                <p className="text-white/40 text-sm">{stats.highestPoint.name}</p>
            </div>

            {/* Elevation Profile */}
            <div>
                <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-4">Elevation Profile</p>
                <div className="h-32 flex items-end gap-1">
                    {trekData.camps.map((camp, idx) => {
                        const maxEle = stats.highestPoint.elevation;
                        const height = (camp.elevation / maxEle) * 100;
                        return (
                            <div
                                key={idx}
                                className="flex-1 group relative"
                            >
                                <div
                                    className="w-full bg-white/20 hover:bg-white/40 rounded-sm transition-colors"
                                    style={{ height: `${height}%` }}
                                />
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-white text-black text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                                    {camp.name}: {camp.elevation}m
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between mt-3 text-[10px] text-white/20 tracking-wider">
                    <span>START</span>
                    <span>FINISH</span>
                </div>
            </div>
        </div>
    );
}
