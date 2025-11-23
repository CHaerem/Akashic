import { useState } from 'react';

export default function Timeline({ trekData }) {
    const [expandedDay, setExpandedDay] = useState(null);

    const toggleDay = (dayNum) => {
        setExpandedDay(expandedDay === dayNum ? null : dayNum);
    };

    // Combine camps and daily stages logic if needed, or just use camps for now as they have day numbers
    const sortedCamps = [...trekData.camps].sort((a, b) => a.dayNumber - b.dayNumber);

    return (
        <div className="space-y-6">
            <div className="relative border-l-2 border-mountain-200 ml-3 space-y-8 py-2">
                {sortedCamps.map((camp, index) => (
                    <div key={camp.id} className="relative pl-8 group">
                        {/* Dot on timeline */}
                        <div
                            className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 transition-colors duration-300 ${expandedDay === camp.dayNumber
                                    ? 'bg-orange-500 border-orange-500'
                                    : 'bg-white border-mountain-300 group-hover:border-orange-500'
                                }`}
                        />

                        <div
                            className="cursor-pointer"
                            onClick={() => toggleDay(camp.dayNumber)}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-bold text-orange-600 uppercase tracking-wider">
                                    Day {camp.dayNumber}
                                </span>
                                <span className="text-sm text-gray-500">{camp.date}</span>
                            </div>

                            <h3 className="text-lg font-bold text-mountain-900 mb-2 group-hover:text-orange-600 transition-colors">
                                {camp.name}
                            </h3>

                            <div className="flex items-center space-x-4 text-sm text-gray-600 mb-2">
                                <span className="flex items-center">
                                    <span className="mr-1">⛰️</span> {camp.elevation}m
                                </span>
                                {camp.distanceFromPrevious > 0 && (
                                    <span className="flex items-center">
                                        <span className="mr-1">👣</span> {camp.distanceFromPrevious}km
                                    </span>
                                )}
                                {camp.timeFromPrevious && (
                                    <span className="flex items-center">
                                        <span className="mr-1">⏱️</span> {camp.timeFromPrevious}
                                    </span>
                                )}
                            </div>

                            {/* Expanded Content */}
                            <div className={`overflow-hidden transition-all duration-300 ${expandedDay === camp.dayNumber ? 'max-h-96 opacity-100 mt-4' : 'max-h-0 opacity-0'
                                }`}>
                                <div className="bg-mountain-50 rounded-lg p-4 text-sm space-y-3">
                                    <p className="text-gray-700 italic">"{camp.notes}"</p>

                                    {camp.terrain && (
                                        <div>
                                            <span className="font-semibold text-mountain-900">Terrain:</span> {camp.terrain}
                                        </div>
                                    )}

                                    {camp.highlights && (
                                        <div>
                                            <span className="font-semibold text-mountain-900">Highlights:</span>
                                            <ul className="list-disc list-inside text-gray-600 mt-1 ml-1">
                                                {camp.highlights.map((h, i) => <li key={i}>{h}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
