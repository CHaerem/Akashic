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
        <div className="min-h-screen bg-mountain-50 flex flex-col">
            <Navbar />

            {/* Hero Section */}
            <div className="relative h-[60vh] min-h-[500px] flex items-center justify-center">
                <div className="absolute inset-0">
                    <img
                        src="hero-images/landing-hero.png"
                        alt="Mountain Landscape"
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40" />
                </div>

                <div className="relative z-10 text-center text-white px-4">
                    <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
                        Akashic Records
                    </h1>
                    <p className="text-xl md:text-2xl max-w-2xl mx-auto font-light text-gray-200">
                        A visual journey through the peaks of Africa and the Andes
                    </p>
                </div>
            </div>

            {/* Treks Grid */}
            <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 -mt-20 relative z-20">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {treks.map(trek => (
                        <TrekCard key={trek.id} {...trek} />
                    ))}
                </div>
            </main>

            <Footer />
        </div>
    );
}
