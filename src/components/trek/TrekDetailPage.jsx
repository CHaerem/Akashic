import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Navbar from '../common/Navbar';
import Map3D from './Map3D';
import InfoPanel from './InfoPanel';
import kilimanjaroData from '../../data/kilimanjaro.json';
import mountKenyaData from '../../data/mountKenya.json';
import incaTrailData from '../../data/incaTrail.json';

const trekDataMap = {
    'kilimanjaro': kilimanjaroData,
    'mount-kenya': mountKenyaData,
    'inca-trail': incaTrailData
};

export default function TrekDetailPage() {
    const { trekId } = useParams();
    const navigate = useNavigate();
    const [trekData, setTrekData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showContent, setShowContent] = useState(false);

    useEffect(() => {
        setLoading(true);
        setShowContent(false);

        // Quick data load
        const data = trekId && trekDataMap[trekId];
        if (data) {
            setTrekData(data);
        }
        setLoading(false);

        // Trigger animations after mount
        requestAnimationFrame(() => {
            setShowContent(true);
        });
    }, [trekId]);

    if (loading) {
        return (
            <div className="h-screen bg-[#0a0a0f] flex items-center justify-center">
                <div className="w-8 h-8 border border-white/20 border-t-white/60 rounded-full animate-spin" />
            </div>
        );
    }

    if (!trekData) {
        return (
            <div className="h-screen bg-[#0a0a0f] flex items-center justify-center">
                <div className="text-center">
                    <p className="text-white/40 text-sm tracking-widest uppercase mb-6">Trek not found</p>
                    <button
                        onClick={() => navigate('/')}
                        className="text-white/60 hover:text-white text-xs tracking-widest uppercase transition-colors"
                    >
                        Return Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen bg-[#0a0a0f] flex flex-col overflow-hidden">
            <Navbar />

            <div className="flex-grow flex flex-col lg:flex-row pt-16">
                {/* Map Section */}
                <div className={`w-full lg:w-3/5 h-[45vh] lg:h-full relative transition-opacity duration-700 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
                    <Map3D routeData={trekData} />

                    {/* Back button overlay */}
                    <button
                        onClick={() => navigate('/')}
                        className="absolute top-4 left-4 z-10 text-white/50 hover:text-white text-xs tracking-widest uppercase transition-colors flex items-center gap-2"
                    >
                        <span>&larr;</span>
                        <span>Globe</span>
                    </button>

                    {/* Trek title overlay (mobile) */}
                    <div className="absolute bottom-6 left-6 lg:hidden z-10">
                        <p className="text-white/40 text-[10px] tracking-[0.2em] uppercase mb-1">
                            {trekData.country}
                        </p>
                        <h1 className="text-2xl font-light text-white tracking-wide">
                            {trekData.name}
                        </h1>
                    </div>
                </div>

                {/* Info Panel Section */}
                <div className={`w-full lg:w-2/5 h-[55vh] lg:h-full border-l border-white/5 transition-all duration-500 delay-200 ${showContent ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
                    <InfoPanel trekData={trekData} />
                </div>
            </div>
        </div>
    );
}
