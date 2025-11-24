export default function Overview({ trekData }) {
    return (
        <div className="space-y-8">
            {/* Description */}
            <div>
                <p className="text-white/60 leading-relaxed">
                    {trekData.description}
                </p>
            </div>

            {/* Key Info Grid */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Start</p>
                    <p className="text-white/80 text-sm">{trekData.dates.start}</p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">End</p>
                    <p className="text-white/80 text-sm">{trekData.dates.end}</p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Duration</p>
                    <p className="text-white/80 text-sm">{trekData.stats.duration} days</p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                    <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-1">Summit</p>
                    <p className="text-white/80 text-sm">{trekData.stats.highestPoint.elevation}m</p>
                </div>
            </div>

            {/* Highlights */}
            <div>
                <p className="text-[10px] text-white/30 tracking-[0.15em] uppercase mb-4">Highlights</p>
                <div className="space-y-3">
                    {trekData.camps.flatMap(camp => camp.highlights || []).slice(0, 5).map((highlight, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                            <span className="text-white/20 text-xs mt-0.5">—</span>
                            <span className="text-white/50 text-sm">{highlight}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
