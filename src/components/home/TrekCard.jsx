import { Link } from 'react-router-dom';

export default function TrekCard({ title, country, stats, imageUrl, slug }) {
    return (
        <Link to={`/trek/${slug}`} className="group block relative overflow-hidden rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-2">
            <div className="aspect-[4/5] md:aspect-[3/4] relative">
                {/* Image Background */}
                <div className="absolute inset-0">
                    <img
                        src={imageUrl}
                        alt={title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
                </div>

                {/* Content */}
                <div className="absolute bottom-0 left-0 right-0 p-6 text-white transform transition-transform duration-300">
                    <p className="text-sm font-medium text-mountain-100 mb-1 tracking-wider uppercase">{country}</p>
                    <h3 className="text-2xl font-bold mb-4 group-hover:text-white transition-colors">{title}</h3>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-4 border-t border-white/20 pt-4 mb-6">
                        <div>
                            <p className="text-xs text-gray-300 uppercase">Elevation</p>
                            <p className="font-semibold">{stats.elevation}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-300 uppercase">Distance</p>
                            <p className="font-semibold">{stats.distance}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-300 uppercase">Days</p>
                            <p className="font-semibold">{stats.days}</p>
                        </div>
                    </div>

                    <div className="flex items-center text-sm font-medium text-white opacity-0 group-hover:opacity-100 transform translate-y-4 group-hover:translate-y-0 transition-all duration-300">
                        Explore Trek
                        <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                    </div>
                </div>
            </div>
        </Link>
    );
}
