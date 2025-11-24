import { useState } from 'react';

export default function Timeline({ trekData }) {
    const [expandedDay, setExpandedDay] = useState(null);
    const sortedCamps = [...trekData.camps].sort((a, b) => a.dayNumber - b.dayNumber);

    return (
        <div className="space-y-1">
            {sortedCamps.map((camp, index) => (
                <div
                    key={camp.id}
                    className="group"
                >
                    <button
                        onClick={() => setExpandedDay(expandedDay === camp.dayNumber ? null : camp.dayNumber)}
                        className="w-full text-left py-4 border-b border-white/5 transition-colors hover:bg-white/5 -mx-2 px-2 rounded"
                    >
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-white/30 tracking-[0.15em] uppercase">
                                Day {camp.dayNumber}
                            </span>
                            <span className="text-[10px] text-white/20">{camp.elevation}m</span>
                        </div>

                        <h3 className="text-white/80 text-sm group-hover:text-white transition-colors">
                            {camp.name}
                        </h3>

                        {camp.distanceFromPrevious > 0 && (
                            <p className="text-white/30 text-xs mt-1">
                                {camp.distanceFromPrevious}km {camp.timeFromPrevious && `· ${camp.timeFromPrevious}`}
                            </p>
                        )}
                    </button>

                    {/* Expanded Content */}
                    <div className={`overflow-hidden transition-all duration-300 ${
                        expandedDay === camp.dayNumber ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                    }`}>
                        <div className="py-4 px-2 space-y-4">
                            {camp.notes && (
                                <p className="text-white/40 text-sm italic">
                                    "{camp.notes}"
                                </p>
                            )}

                            {camp.terrain && (
                                <div>
                                    <p className="text-[10px] text-white/20 tracking-[0.1em] uppercase mb-1">Terrain</p>
                                    <p className="text-white/50 text-sm">{camp.terrain}</p>
                                </div>
                            )}

                            {camp.highlights && camp.highlights.length > 0 && (
                                <div>
                                    <p className="text-[10px] text-white/20 tracking-[0.1em] uppercase mb-2">Highlights</p>
                                    <div className="space-y-1">
                                        {camp.highlights.map((h, i) => (
                                            <p key={i} className="text-white/40 text-sm">· {h}</p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
