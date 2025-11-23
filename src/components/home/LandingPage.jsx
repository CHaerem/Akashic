import Navbar from '../common/Navbar';
import Footer from '../common/Footer';
import TrekCard from './TrekCard';

const treks = [
    {
        id: 'kilimanjaro',
        title: 'Kilimanjaro',
        country: 'Tanzania',
        slug: 'kilimanjaro',
        imageUrl: 'hero-images/kilimanjaro-hero.png',
        stats: {
            elevation: '5,895m',
            distance: '71km',
            days: '7 Days'
        }
    },
    {
        id: 'mount-kenya',
        title: 'Mount Kenya',
        country: 'Kenya',
        slug: 'mount-kenya',
        imageUrl: 'hero-images/mount-kenya-hero.png',
        stats: {
            elevation: '4,985m',
            distance: '75km',
            days: '5 Days'
        }
    },
    {
        id: 'inca-trail',
        title: 'Inca Trail',
        country: 'Peru',
        slug: 'inca-trail',
        imageUrl: 'hero-images/inca-trail-hero.png',
        stats: {
            elevation: '4,215m',
            distance: '43km',
            days: '4 Days'
        }
    }
];

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-mountain-50 to-white flex flex-col">
            <Navbar />

            {/* Hero Section */}
            <div className="relative h-[70vh] min-h-[600px] flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0">
                    <img
                        src="hero-images/landing-hero.png"
                        alt="Mountain Landscape"
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />
                </div>

                <div className="relative z-10 text-center text-white px-4 max-w-5xl mx-auto">
                    <h1 className="font-display text-6xl md:text-8xl font-bold mb-6 tracking-tight animate-fade-in">
                        Akashic Records
                    </h1>
                    <p className="text-xl md:text-2xl max-w-3xl mx-auto font-light text-gray-100 mb-8 animate-fade-in-delay">
                        A visual journey through the peaks of Africa and the Andes
                    </p>
                    <div className="animate-bounce mt-12">
                        <svg className="w-8 h-8 mx-auto text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Treks Grid */}
            <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 -mt-32 relative z-20">
                <div className="text-center mb-16">
                    <h2 className="font-display text-4xl md:text-5xl font-bold text-mountain-900 mb-4">
                        Epic Journeys
                    </h2>
                    <p className="text-lg text-mountain-600 max-w-2xl mx-auto">
                        Explore the world's most iconic mountain trails through immersive 3D maps and stunning photography
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {treks.map((trek, index) => (
                        <div
                            key={trek.id}
                            className="animate-fade-in-up"
                            style={{ animationDelay: `${index * 150}ms` }}
                        >
                            <TrekCard {...trek} />
                        </div>
                    ))}
                </div>
            </main>

            <Footer />
        </div>
    );
}
