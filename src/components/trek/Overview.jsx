export default function Overview({ trekData }) {
    return (
        <div className="space-y-8 animate-fadeIn">
            <div>
                <h2 className="text-2xl font-bold text-mountain-900 mb-4">About the Trek</h2>
                <p className="text-gray-600 leading-relaxed text-lg">
                    {trekData.description}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="bg-mountain-50 p-4 rounded-xl">
                    <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Start Date</p>
                    <p className="font-semibold text-mountain-900">{trekData.dates.start}</p>
                </div>
                <div className="bg-mountain-50 p-4 rounded-xl">
                    <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">End Date</p>
                    <p className="font-semibold text-mountain-900">{trekData.dates.end}</p>
                </div>
                <div className="bg-mountain-50 p-4 rounded-xl">
                    <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Country</p>
                    <p className="font-semibold text-mountain-900">{trekData.country}</p>
                </div>
                <div className="bg-mountain-50 p-4 rounded-xl">
                    <p className="text-sm text-gray-500 uppercase tracking-wider mb-1">Highest Point</p>
                    <p className="font-semibold text-mountain-900">{trekData.stats.highestPoint.name}</p>
                </div>
            </div>

            <div>
                <h3 className="text-xl font-bold text-mountain-900 mb-4">Highlights</h3>
                <ul className="space-y-3">
                    {trekData.camps.flatMap(camp => camp.highlights || []).slice(0, 5).map((highlight, idx) => (
                        <li key={idx} className="flex items-start">
                            <svg className="w-5 h-5 text-orange-500 mr-3 mt-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="text-gray-700">{highlight}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
