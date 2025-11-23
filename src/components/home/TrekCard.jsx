import { Link } from 'react-router-dom';

export default function TrekCard({ id, title, country, imageUrl, stats }) {
    return (
        <Link to={`/trek/${id}`} className="block group">
            <div className="bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-2">
                {/* Image */}
                <div className="relative h-72 overflow-hidden">
                    <img
                        src={imageUrl}
                        alt={title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-80 group-hover:opacity-90 transition-opacity duration-500" />

                    {/* Title Overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                        <p className="text-accent-400 text-sm font-semibold uppercase tracking-wider mb-2">
                            {country}
                        </p>
                        <h3 className="font-display text-3xl font-bold text-white mb-1">
                            {title}
                        </h3>
                    </div>
                </div>

                {/* Stats */}
                <div className="p-6 bg-gradient-to-br from-white to-mountain-50">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-mountain-900">
                                {stats.elevation}
                            </div>
                            <div className="text-xs text-mountain-600 uppercase tracking-wide mt-1">
                                Elevation
                            </div>
                        </div>
                        <div className="text-center border-x border-mountain-200">
                            <div className="text-2xl font-bold text-mountain-900">
                                {stats.distance}
                            </div>
                            <div className="text-xs text-mountain-600 uppercase tracking-wide mt-1">
                                Distance
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-mountain-900">
                                {stats.days}
                            </div>
                            <div className="text-xs text-mountain-600 uppercase tracking-wide mt-1">
                                Duration
                            </div>
                        </div>
                    </div>

                    {/* CTA */}
                    <div className="mt-6 flex items-center justify-center text-accent-600 font-semibold group-hover:text-accent-700 transition-colors">
                        <span>Explore Journey</span>
                        <svg className="w-5 h-5 ml-2 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                    </div>
                </div>
            </div>
        </Link>
    );
}
